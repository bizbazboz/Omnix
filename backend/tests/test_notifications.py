import asyncio
import base64
import hashlib
import hmac
import json
from types import SimpleNamespace
from datetime import timedelta

import pytest
from sqlalchemy import select, func
from app.core import (
    Session,
    Notification,
    PushDevice,
    PushDelivery,
    User,
    Connection,
    now,
    redis,
)
from app.notifications import record, deliver_pending
from app.workspace_settings import store_setting


def device(client):
    with Session() as db:
        store_setting(
            db, "firebase-push", {"project_id": "test-project", "version": "fixture"}
        )
    response = client.post(
        "/api/v1/notifications/devices",
        json={
            "kind": "fcm",
            "endpoint": "firebase_device_token_abcdefghijklmnopqrstuvwxyz1234567890",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


def test_notifications_are_private_and_deduplicated(signed_client, user):
    d = device(signed_client)
    with Session() as db:
        other = User(
            issuer=user.issuer, subject="other", name="Other", email="other@example.com"
        )
        db.add(other)
        db.flush()
        record(db, user.id, "email", "one", "Private subject", "Sender", "/email/inbox")
        record(db, user.id, "email", "one", "Private subject", "Sender", "/email/inbox")
        record(db, other.id, "email", "secret", "Other account", "", "/email")
        db.commit()
        foreign = db.scalar(
            select(Notification).where(Notification.owner == other.id)
        ).id
        assert db.scalar(select(func.count()).select_from(PushDelivery)) == 1
    inbox = signed_client.get("/api/v1/notifications").json()
    assert inbox["unread"] == 1
    assert len(inbox["items"]) == 1 and inbox["items"][0]["title"] == "Private subject"
    assert (
        signed_client.post(f"/api/v1/notifications/{foreign}/read").status_code == 404
    )
    assert signed_client.post("/api/v1/notifications/read").status_code == 204
    assert signed_client.get("/api/v1/notifications").json()["unread"] == 0
    assert signed_client.delete("/api/v1/notifications/devices/" + d).status_code == 204
    with Session() as db:
        assert db.scalar(select(func.count()).select_from(PushDelivery)) == 0


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://127.0.0.1/push",
        "https://localhost/push",
        "https://fcm.googleapis.com.evil.test/push",
        "https://evil.test/push",
        "https://user:pass@fcm.googleapis.com/push",
        "https://fcm.googleapis.com:8443/push",
    ],
)
def test_push_registration_rejects_ssrf(signed_client, endpoint):
    assert (
        signed_client.post(
            "/api/v1/notifications/devices",
            json={"kind": "fcm", "endpoint": endpoint},
        ).status_code
        == 422
    )


def test_push_preferences_and_logout(signed_client, user):
    device(signed_client)
    assert (
        signed_client.put(
            "/api/v1/notifications/preferences",
            json={"email": False, "news": True, "previews": False},
        ).status_code
        == 200
    )
    with Session() as db:
        record(db, user.id, "email", "ignored", "Quiet", "", "/email")
        db.commit()
        assert db.scalar(select(func.count()).select_from(Notification)) == 0
    assert signed_client.post("/api/v1/auth/logout").status_code == 200
    with Session() as db:
        assert db.scalar(select(func.count()).select_from(PushDevice)) == 0


def test_push_retry_redacts_preview_and_rechecks_admission(
    signed_client, user, monkeypatch
):
    device(signed_client)
    with Session() as db:
        record(
            db,
            user.id,
            "email",
            "one",
            "Private subject",
            "Private sender",
            "/email/inbox?message=one",
        )
        db.commit()
    payloads = []

    def send(token, payload, origin):
        payloads.append(payload)
        raise OSError("offline")

    monkeypatch.setattr("app.firebase_push.send_firebase", send)
    deliver_pending()
    assert payloads[0]["title"] == "New email" and "Private" not in json.dumps(payloads)
    assert payloads[0]["href"].endswith("message=one")
    with Session() as db:
        delivery = db.scalar(select(PushDelivery))
        assert delivery.status == "pending" and delivery.attempts == 1
        delivery.next_attempt = now() - timedelta(seconds=1)
        store_setting(
            db,
            "oidc",
            {"issuer": user.issuer, "allow_all": False, "allowed_subjects": []},
        )
    deliver_pending()
    assert len(payloads) == 1
    with Session() as db:
        assert db.scalar(select(PushDelivery)).status == "cancelled"


def test_mail_sync_suppresses_import_then_notifies_once(
    signed_client, user, accounts, monkeypatch
):
    from app import tasks

    account = accounts[0]
    item = {
        "provider_id": "first",
        "folder": "inbox",
        "sender": "sender@example.com",
        "recipients": account.address,
        "subject": "A message",
        "body": "Hello",
        "unread": True,
        "date": now(),
    }
    monkeypatch.setattr(tasks, "fetch_messages", lambda *_: iter([item]))
    tasks.sync.run(account.id)
    assert signed_client.get("/api/v1/notifications").json()["unread"] == 0
    item = {**item, "provider_id": "second", "date": now()}
    tasks.sync.run(account.id)
    tasks.sync.run(account.id)
    rows = signed_client.get("/api/v1/notifications").json()["items"]
    assert (
        len(rows) == 1
        and "message=" in rows[0]["href"]
        and account.id in rows[0]["href"]
    )
    assert redis.xrevrange("live:" + user.id, count=1)[0][1]["scope"] == "email"


def test_zoho_webhook_is_signed_scoped_and_rotatable(
    signed_client, accounts, monkeypatch
):
    account = accounts[0]
    with Session() as db:
        db.get(Connection, account.id).provider = "zoho"
        db.commit()
    seen = []
    monkeypatch.setattr("app.tasks.queue_sync", lambda id: seen.append(id))
    path = signed_client.post(f"/api/v1/email/mailboxes/{account.id}/webhook").json()[
        "url"
    ]
    secret = "private-zoho-secret-123"
    assert (
        signed_client.post(
            path, headers={"X-Hook-Secret": secret}, content=b"{}"
        ).status_code
        == 200
    )
    assert signed_client.post(path, content=b"{}").status_code == 403
    body = b'{"mailbox":"someone-else"}'
    sig = base64.b64encode(
        hmac.new(secret.encode(), body, hashlib.sha256).digest()
    ).decode()
    assert (
        signed_client.post(
            path, headers={"X-Hook-Signature": sig}, content=body
        ).status_code
        == 200
    )
    assert seen == [account.id, account.id]
    signed_client.post(f"/api/v1/email/mailboxes/{account.id}/webhook")
    assert (
        signed_client.post(
            path, headers={"X-Hook-Signature": sig}, content=body
        ).status_code
        == 404
    )


def test_live_stream_is_scoped_and_closes_after_revocation(signed_client, user):
    from app.notifications import build_notification_router

    router = build_notification_router(lambda: None, lambda: None)
    endpoint = next(r.endpoint for r in router.routes if r.path == "/api/v1/live")
    sid = signed_client.cookies.get("omnix_session")

    async def disconnected():
        return False

    request = SimpleNamespace(
        headers={}, state=SimpleNamespace(sid=sid), is_disconnected=disconnected
    )

    async def run():
        with Session() as db:
            response = await endpoint(request, user, db)
            first = await anext(response.body_iterator)
            assert '"scope":"all"' in first
            redis.delete("session:" + sid)
            with pytest.raises(StopAsyncIteration):
                await anext(response.body_iterator)

    asyncio.run(run())
    assert redis.zcard("live-lease:" + user.id) == 0


def test_imap_refreshes_known_flags_without_downloading_bodies(accounts, monkeypatch):
    from app import mail_provider, providers
    from app.core import Message

    account = accounts[0]
    with Session() as db:
        db.add(
            Message(
                mailbox=account.id,
                provider_id="INBOX:7:9",
                sender="a@example.com",
                recipients=account.address,
                subject="Existing",
                body="Keep my content",
            )
        )
        db.commit()
    calls = []

    class IMAP:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

        def select(self, *_, **kwargs):
            return "OK", []

        def response(self, *_):
            return "UIDVALIDITY", [b"7"]

        def uid(self, command, *args):
            calls.append((command, args))
            if command == "search":
                return "OK", [b"9"]
            assert args[-1] == "(FLAGS)", "Known message body was downloaded again"
            return "OK", [b"1 (UID 9 FLAGS (\\Seen \\Flagged))"]

    monkeypatch.setattr(
        mail_provider,
        "profile",
        lambda *_: {"folders": [{"id": "INBOX", "key": "inbox", "kind": "inbox"}]},
    )
    monkeypatch.setattr(providers, "imap_client", lambda *_: IMAP())
    with Session() as db:
        rows = list(mail_provider.fetch_recent(db.get(Connection, account.id), db))
    assert rows == [
        {
            "provider_id": "INBOX:7:9",
            "folder": "inbox",
            "unread": False,
            "starred": True,
        }
    ]
    assert len(calls) == 2


def test_revoking_session_cancels_device_delivery(signed_client, user):
    device(signed_client)
    with Session() as db:
        record(db, user.id, "email", "revoked", "Subject", "", "/email")
        record(db, user.id, "email", "revoked-two", "Subject", "", "/email")
        db.commit()
    redis.delete("session:" + signed_client.cookies.get("omnix_session"))
    deliver_pending()
    with Session() as db:
        assert db.scalar(select(func.count()).select_from(PushDevice)) == 0
        assert db.scalar(select(func.count()).select_from(PushDelivery)) == 0


def test_reading_email_marks_related_notification_read(
    signed_client, user, accounts, monkeypatch
):
    from app.core import Message

    with Session() as db:
        message = db.scalar(select(Message).where(Message.mailbox == accounts[0].id))
        mid = message.id
        record(db, user.id, "email", mid, "Subject", "", "/email")
        db.commit()
    monkeypatch.setattr(
        "app.mail_client.change_message",
        lambda c, db, m, *_: setattr(m, "unread", False),
    )
    response = signed_client.post(
        f"/api/v1/email/mailboxes/{accounts[0].id}/messages/{mid}/action",
        json={"action": "read"},
    )
    assert response.status_code == 200, response.text
    assert signed_client.get("/api/v1/notifications").json()["unread"] == 0


def test_expired_firebase_device_removes_all_queued_deliveries(
    signed_client, user, monkeypatch
):
    from app.firebase_push import FirebaseError

    device(signed_client)
    with Session() as db:
        for index in range(2):
            record(db, user.id, "email", f"expired-{index}", "Subject", "", "/email")
        db.commit()

    def invalid(*args, **kwargs):
        raise FirebaseError(invalid_token=True, permanent=True)

    monkeypatch.setattr("app.firebase_push.send_firebase", invalid)
    deliver_pending()
    assert signed_client.get("/api/v1/notifications/devices").json() == []
    with Session() as db:
        assert db.scalar(select(func.count()).select_from(PushDelivery)) == 0


def test_fcm_rotation_replaces_session_token(signed_client, user):
    first = device(signed_client)
    response = signed_client.post(
        "/api/v1/notifications/devices",
        json={
            "kind": "fcm",
            "endpoint": "firebase_rotated_token_abcdefghijklmnopqrstuvwxyz123456789",
        },
    )
    assert response.status_code == 200
    rows = signed_client.get("/api/v1/notifications/devices").json()
    assert len(rows) == 1 and rows[0]["id"] != first and rows[0]["kind"] == "fcm"
