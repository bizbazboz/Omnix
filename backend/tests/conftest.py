"""Destructive fixtures are restricted to scripts/test.py's isolated Docker project."""

import os
from http.cookies import SimpleCookie
import pytest
from fastapi.testclient import TestClient
from app.core import (
    Base,
    engine,
    Session,
    redis,
    User,
    Connection,
    Message,
    encrypt,
    SESSION_COOKIE,
    BOOTSTRAP_TOKEN_FILE,
)
from app.main import app, session_response

PUBLIC_URL = "https://app.example.test"

if os.getenv("OMNIX_TESTS") != "1":
    raise RuntimeError(
        "Run tests with python scripts/test.py, never against a production database."
    )


@pytest.fixture(autouse=True)
def isolated_database():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    redis.flushdb()
    yield


@pytest.fixture
def client():
    with TestClient(
        app, base_url=PUBLIC_URL, headers={"Origin": PUBLIC_URL}, follow_redirects=False
    ) as value:
        yield value


@pytest.fixture
def operator_token():
    return BOOTSTRAP_TOKEN_FILE.read_text().strip()


@pytest.fixture
def user():
    with Session() as db:
        value = User(
            issuer="https://id.example.test",
            subject="alice",
            name="Alice Example",
            email="alice@example.com",
        )
        db.add(value)
        db.commit()
        return value


@pytest.fixture
def accounts(user):
    with Session() as db:
        values = []
        for i in range(3):
            account = Connection(
                owner=user.id,
                provider="imap",
                label="Account " + str(i + 1),
                address="alice" + str(i + 1) + "@example.com",
                credentials=encrypt({}),
            )
            db.add(account)
            db.flush()
            values.append(account)
            for j in range(3):
                db.add(
                    Message(
                        mailbox=account.id,
                        provider_id=str(j),
                        sender="sender@example.com",
                        sender_name="Sender",
                        recipients=account.address,
                        subject="Message " + str(j),
                        body="Private content",
                        unread=True,
                    )
                )
        db.commit()
        return values


@pytest.fixture
def signed_client(client, user, accounts):
    cookie = SimpleCookie()
    cookie.load(session_response(user.id).headers["set-cookie"])
    client.cookies.set(SESSION_COOKIE, cookie[SESSION_COOKIE].value)
    from app.core import SystemSetting

    with Session() as db:
        db.add(
            SystemSetting(
                key="oidc",
                value=encrypt(
                    {
                        "public_origin": PUBLIC_URL,
                        "issuer": "https://id.example.test",
                        "client_id": "fixture",
                        "client_secret": "fixture",
                        "allow_all": True,
                        "allowed_subjects": [],
                        "version": "fixture",
                        "token_auth_method": "client_secret_basic",
                    }
                ),
            )
        )
        db.commit()
    profile = client.get("/api/v1/me").json()
    client.headers["X-CSRF-Token"] = profile["csrf"]
    return client
