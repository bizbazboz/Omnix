import uuid
from sqlalchemy import select
from app.core import Session, User, Connection, Message, encrypt, decrypt, redis


def test_production_health_and_no_demo(client):
    assert client.get("/api/health/ready").json()["mode"] == "production"
    assert not any(
        getattr(route, "path", "") == "/api/v1/auth/demo"
        for route in __import__("app.main", fromlist=["app"]).app.routes
    )
    assert client.get("/api/v1/email/messages").status_code == 401


def test_csrf_and_origin(signed_client):
    assert (
        signed_client.post(
            "/api/v1/auth/logout", headers={"X-CSRF-Token": "bad"}
        ).status_code
        == 403
    )
    assert (
        signed_client.post(
            "/api/v1/auth/logout", headers={"Origin": "https://attacker.invalid"}
        ).status_code
        == 403
    )


def test_overview_scope_and_idor(signed_client, user, accounts):
    summary = signed_client.get("/api/v1/overview").json()
    assert summary["accounts"] == 3 and summary["unread"] == 9
    assert all(m["mailbox"] in {a.id for a in accounts} for m in summary["recent"])
    with Session() as db:
        other = User(
            issuer="https://id.example.test",
            subject="bob",
            name="Bob",
            email="bob@example.com",
        )
        db.add(other)
        db.flush()
        mailbox = Connection(
            owner=other.id, provider="imap", label="Private", address="bob@example.com"
        )
        db.add(mailbox)
        db.flush()
        message = Message(
            mailbox=mailbox.id,
            provider_id="one",
            sender="secret@example.com",
            recipients=mailbox.address,
            subject="Not Alice",
            body="Secret",
        )
        db.add(message)
        db.commit()
        assert (
            signed_client.get(
                "/api/v1/email/mailboxes/" + mailbox.id + "/messages/" + message.id
            ).status_code
            == 404
        )
        assert (
            signed_client.post(
                "/api/v1/email/mailboxes/" + mailbox.id + "/sync"
            ).status_code
            == 404
        )
    assert signed_client.get("/api/v1/overview").json()["accounts"] == 3


def test_draft_versions(signed_client, accounts):
    payload = {
        "mailbox": accounts[0].id,
        "to": [],
        "subject": "Draft",
        "body": "Private",
        "version": 1,
    }
    created = signed_client.post("/api/v1/email/drafts", json=payload)
    assert created.status_code == 200
    did = created.json()["id"]
    assert (
        signed_client.patch("/api/v1/email/drafts/" + did, json=payload).json()[
            "version"
        ]
        == 2
    )
    assert (
        signed_client.patch("/api/v1/email/drafts/" + did, json=payload).status_code
        == 409
    )
    assert signed_client.delete("/api/v1/email/drafts/" + did).status_code == 200


def test_send_idempotency(signed_client, accounts):
    path = "/api/v1/email/mailboxes/" + accounts[0].id + "/send"
    payload = {
        "mailbox": accounts[0].id,
        "to": ["recipient@example.com"],
        "subject": "Hello",
        "body": "Body",
    }
    headers = {"Idempotency-Key": str(uuid.uuid4())}
    first = signed_client.post(path, json=payload, headers=headers)
    assert first.status_code == 200
    assert (
        signed_client.post(path, json=payload, headers=headers).json()["id"]
        == first.json()["id"]
    )
    assert (
        signed_client.post(
            path, json={**payload, "body": "changed"}, headers=headers
        ).status_code
        == 409
    )
    assert (
        signed_client.post(
            path,
            json={**payload, "to": ["invalid"]},
            headers={"Idempotency-Key": str(uuid.uuid4())},
        ).status_code
        == 422
    )
    assert (
        signed_client.post(
            path,
            json={**payload, "subject": "Hello\r\nBcc: bad@example.com"},
            headers={"Idempotency-Key": str(uuid.uuid4())},
        ).status_code
        == 422
    )
    history = signed_client.get("/api/v1/email/send-attempts").json()
    assert len(history) == 1
    assert history[0]["mailbox"] == accounts[0].id


def test_pagination_filter_binding(signed_client):
    first = signed_client.get("/api/v1/email/messages?limit=2").json()
    assert first["next_cursor"]
    second = signed_client.get(
        "/api/v1/email/messages", params={"limit": 2, "cursor": first["next_cursor"]}
    ).json()
    assert not {x["id"] for x in first["items"]} & {x["id"] for x in second["items"]}
    assert (
        signed_client.get(
            "/api/v1/email/messages",
            params={"q": "changed", "cursor": first["next_cursor"]},
        ).status_code
        == 400
    )


def test_secret_and_products(signed_client):
    for item in signed_client.get("/api/v1/connections").json():
        assert "credentials" not in item
    assert [p["id"] for p in signed_client.get("/api/v1/products").json()] == ["email"]
    value = encrypt({"secret": "not-plaintext"})
    assert "not-plaintext" not in value and decrypt(value)["secret"] == "not-plaintext"


def test_logout(signed_client):
    assert signed_client.post("/api/v1/auth/logout").status_code == 200
    assert signed_client.get("/api/v1/me").status_code == 401


def test_request_size_limit(client):
    assert client.post("/api/v1/setup/oidc", content=b"x" * 1048577).status_code == 413
