import json
import time
from urllib.parse import parse_qs, urlparse
import pytest
from sqlalchemy import select
from app.core import (
    Session,
    User,
    SystemSetting,
    Connection,
    PipelineRun,
    redis,
    decrypt,
    encrypt,
)
from app.workspace_settings import store_setting


@pytest.fixture
def admin(signed_client, user):
    with Session() as db:
        db.get(User, user.id).is_admin = True
        db.commit()
    return signed_client


def test_settings_are_role_protected(signed_client):
    for path in ("zoho", "pipelines", "users", "system"):
        assert signed_client.get("/api/v1/settings/" + path).status_code == 403
    assert (
        signed_client.put(
            "/api/v1/settings/workspace", json={"name": "Forbidden"}
        ).status_code
        == 403
    )
    assert (
        signed_client.put(
            "/api/v1/settings/zoho", json={"client_id": "id", "client_secret": "secret"}
        ).status_code
        == 403
    )


def test_zoho_secret_encryption_rotation_and_masking(admin):
    body = {"client_id": "client", "client_secret": "very-private", "region": "eu"}
    response = admin.put("/api/v1/settings/zoho", json=body)
    assert response.status_code == 200
    assert "very-private" not in response.text
    assert "client_secret" not in response.json()
    with Session() as db:
        stored = db.get(SystemSetting, "zoho").value
        assert "very-private" not in stored
        assert decrypt(stored)["client_secret"] == "very-private"
    assert (
        admin.put(
            "/api/v1/settings/zoho", json={**body, "client_secret": ""}
        ).status_code
        == 200
    )
    assert (
        admin.put(
            "/api/v1/settings/zoho",
            json={**body, "client_id": "new", "client_secret": ""},
        ).status_code
        == 422
    )
    assert (
        admin.put(
            "/api/v1/settings/zoho", json={**body, "client_secret": "rotated"}
        ).status_code
        == 200
    )
    with Session() as db:
        assert (
            decrypt(db.get(SystemSetting, "zoho").value)["client_secret"] == "rotated"
        )


def test_preferences_validation_and_onboarding(signed_client, user):
    prefs = signed_client.get("/api/v1/settings/preferences").json()
    assert prefs["onboarding_completed"] is False
    assert (
        signed_client.put(
            "/api/v1/settings/preferences", json={**prefs, "timezone": "Invalid/Zone"}
        ).status_code
        == 422
    )
    assert (
        signed_client.put(
            "/api/v1/settings/preferences",
            json={**prefs, "default_account": "someone-elses-account"},
        ).status_code
        == 422
    )
    response = signed_client.put(
        "/api/v1/settings/preferences",
        json={
            **prefs,
            "display_name": "Alice",
            "timezone": "Europe/London",
            "onboarding_completed": True,
        },
    )
    assert response.status_code == 200
    assert signed_client.get("/api/v1/onboarding").json()["completed"] is True
    with Session() as db:
        assert (
            "Europe/London" not in db.get(SystemSetting, "preferences:" + user.id).value
        )


def test_workspace_private_hosts_only_visible_to_admin(admin, user):
    assert (
        admin.put(
            "/api/v1/settings/workspace",
            json={"name": "Workspace", "private_mail_hosts": ["mail.lan"]},
        ).status_code
        == 200
    )
    with Session() as db:
        db.get(User, user.id).is_admin = False
        db.commit()
    assert admin.get("/api/v1/settings/workspace").json() == {"name": "Workspace"}


def test_last_admin_cannot_be_removed(admin, user):
    assert (
        admin.patch(
            "/api/v1/settings/users/" + user.id, json={"is_admin": False}
        ).status_code
        == 409
    )


def test_pipeline_validation_and_independent_execution(admin, monkeypatch):
    import app.tasks as tasks

    called = []
    monkeypatch.setattr(tasks.dispatch_outbox, "delay", lambda: called.append("outbox"))
    assert (
        admin.put("/api/v1/settings/pipelines", json={"sync_interval": 1}).status_code
        == 422
    )
    assert (
        admin.put(
            "/api/v1/settings/pipelines",
            json={"sync_interval": 300, "sync_enabled": False},
        ).status_code
        == 200
    )
    assert (
        admin.post("/api/v1/settings/pipelines/outbox-dispatch/run").status_code == 200
    )
    assert (
        admin.post("/api/v1/settings/pipelines/outbox-dispatch/run").status_code == 429
    )
    assert called == ["outbox"]
    assert (
        admin.get("/api/v1/settings/pipelines").json()["configuration"]["sync_interval"]
        == 300
    )


def test_pipeline_history_sanitizes_failures():
    from app.pipeline_history import execution

    with pytest.raises(ValueError):
        with execution("mail-sync", "connection"):
            raise ValueError("password=should-never-be-persisted")
    with Session() as db:
        row = db.scalar(select(PipelineRun))
        assert row.status == "failed"
        assert "password" not in row.detail
        assert row.finished_at


def test_disabled_sync_does_not_stop_outbox(user, accounts, monkeypatch):
    from app.tasks import dispatch_sync, dispatch_outbox, send
    from app.core import SendAttempt

    with Session() as db:
        store_setting(db, "pipelines", {"sync_enabled": False, "sync_interval": 120})
        attempt = SendAttempt(
            owner=user.id,
            mailbox=accounts[0].id,
            key="unique",
            payload_hash="hash",
            payload="{}",
        )
        db.add(attempt)
        db.commit()
        identifier = attempt.id
    queued = []
    monkeypatch.setattr(send, "delay", lambda aid: queued.append(aid))
    dispatch_sync.run()
    dispatch_outbox.run()
    assert queued == [identifier]


def test_zoho_state_version_and_replay(admin):
    body = {"client_id": "client", "client_secret": "secret", "region": "eu"}
    assert admin.put("/api/v1/settings/zoho", json=body).status_code == 200
    response = admin.post("/api/v1/connections/zoho/authorize", json={"region": "eu"})
    params = parse_qs(urlparse(response.json()["url"]).query)
    assert params["redirect_uri"] == [
        "https://app.example.test/api/v1/connections/zoho/callback"
    ]
    state = params["state"][0]
    assert (
        admin.put(
            "/api/v1/settings/zoho", json={**body, "client_secret": "rotated"}
        ).status_code
        == 200
    )
    assert (
        admin.get(
            "/api/v1/connections/zoho/callback", params={"state": state, "code": "code"}
        ).status_code
        == 400
    )
    assert not redis.exists("zoho:" + state)


def test_zoho_callback_and_reconnect_preserve_mailbox(admin, monkeypatch):
    import app.zoho_oauth as oauth

    async def exchange(*args):
        return {
            "access_token": "access",
            "refresh_token": "refresh",
            "expires_at": time.time() + 3600,
        }, [{"accountId": "account", "primaryEmailAddress": "alice@example.com"}]

    monkeypatch.setattr(oauth, "exchange", exchange)
    admin.put(
        "/api/v1/settings/zoho", json={"client_id": "client", "client_secret": "secret"}
    )
    identifiers = []
    for _ in range(2):
        url = admin.post(
            "/api/v1/connections/zoho/authorize", json={"region": "eu"}
        ).json()["url"]
        state = parse_qs(urlparse(url).query)["state"][0]
        response = admin.get(
            "/api/v1/connections/zoho/callback", params={"state": state, "code": "code"}
        )
        assert response.status_code == 307
        token = parse_qs(urlparse(response.headers["location"]).query)["discovery"][0]
        visible = admin.get("/api/v1/connections/zoho/discovery/" + token)
        assert "refresh" not in visible.text
        assert (
            admin.post(
                "/api/v1/connections/zoho/discovery/" + token,
                json={"account_ids": ["account"]},
            ).status_code
            == 200
        )
        with Session() as db:
            rows = list(
                db.scalars(select(Connection).where(Connection.provider == "zoho"))
            )
            assert len(rows) == 1
            identifiers.append(rows[0].id)
    assert identifiers[0] == identifiers[1]


def test_zoho_refresh_uses_rotated_db_secret(admin, user, monkeypatch):
    import app.providers as providers

    admin.put(
        "/api/v1/settings/zoho",
        json={"client_id": "client", "client_secret": "new-secret"},
    )
    requests = []

    class Response:
        def json(self):
            return {"access_token": "new-access", "expires_in": 3600}

    def post(url, **kwargs):
        requests.append(kwargs["data"])
        return Response()

    monkeypatch.setattr(providers.httpx, "post", post)
    with Session() as db:
        connection = Connection(
            owner=user.id,
            provider="zoho",
            label="Zoho",
            address="alice@example.com",
            credentials=encrypt(
                {
                    "refresh_token": "refresh",
                    "oauth_client": {
                        "client_id": "client",
                        "client_secret": "old-secret",
                    },
                }
            ),
        )
        db.add(connection)
        db.commit()
        assert providers.zoho_token(connection, db) == "new-access"
        assert requests[0]["client_secret"] == "new-secret"
        assert decrypt(connection.credentials)["access_token"] == "new-access"
        assert decrypt(connection.credentials)["oauth_client"]["client_secret"] == "new-secret"


def test_connection_test_preserves_owner_boundary(signed_client):
    assert signed_client.post("/api/v1/connections/not-owned/test").status_code == 404


def test_sessions_never_return_session_tokens(signed_client, user):
    redis.set(
        "session:another-secret-session",
        json.dumps(
            {
                "user": user.id,
                "csrf": "another-secret-csrf",
                "expires": time.time() + 300,
            }
        ),
    )
    response = signed_client.get("/api/v1/settings/sessions")
    assert len(response.json()) == 2
    assert "another-secret" not in response.text
    assert (
        signed_client.post("/api/v1/settings/sessions/revoke-others").status_code == 200
    )
    assert not redis.exists("session:another-secret-session")
    assert signed_client.get("/api/v1/me").status_code == 200


def test_validation_response_never_echoes_credentials(admin):
    response = admin.put(
        "/api/v1/settings/zoho",
        json={"client_id": "client", "client_secret": {"private": "never-echo-this"}},
    )
    assert response.status_code == 422
    assert "never-echo-this" not in response.text
    assert all("input" not in item for item in response.json()["detail"])


def test_zoho_exchange_errors_are_safe(monkeypatch):
    import asyncio
    import app.zoho_oauth as oauth
    from fastapi import HTTPException

    def broken(*args, **kwargs):
        raise ValueError("secret=not-for-response")

    monkeypatch.setattr(oauth.httpx, "AsyncClient", broken)
    with pytest.raises(HTTPException) as error:
        asyncio.run(
            oauth.exchange(
                {"client_id": "id", "client_secret": "secret"},
                "eu",
                "code",
                "https://app.example.test/callback",
            )
        )
    assert error.value.status_code == 502
    assert "not-for-response" not in error.value.detail


def test_disconnect_revokes_last_zoho_grant(admin, user, monkeypatch):
    import app.zoho_oauth as oauth

    called = []
    monkeypatch.setattr(
        oauth,
        "revoke",
        lambda region, creds: called.append(creds["refresh_token"])
        or "Zoho consent revoked.",
    )
    with Session() as db:
        connection = Connection(
            owner=user.id,
            provider="zoho",
            label="Zoho",
            address="alice@example.com",
            credentials=encrypt({"refresh_token": "refresh"}),
        )
        db.add(connection)
        db.commit()
        identifier = connection.id
    assert (
        admin.delete("/api/v1/connections/" + identifier).json()["provider_revocation"]
        == "Zoho consent revoked."
    )
    assert called == ["refresh"]
    with Session() as db:
        assert not db.get(Connection, identifier).credentials


def test_disconnect_preserves_other_mailbox_grant(admin, user, monkeypatch):
    import app.zoho_oauth as oauth

    def forbidden(*args):
        raise AssertionError("Must retain shared grant")

    monkeypatch.setattr(oauth, "revoke", forbidden)
    with Session() as db:
        values = [
            Connection(
                owner=user.id,
                provider="zoho",
                label="Zoho",
                address=str(i) + "@example.com",
                credentials=encrypt({"refresh_token": "shared"}),
            )
            for i in range(2)
        ]
        db.add_all(values)
        db.commit()
        identifier = values[0].id
    response = admin.delete("/api/v1/connections/" + identifier)
    assert response.status_code == 200
    assert "retained" in response.json()["provider_revocation"]
