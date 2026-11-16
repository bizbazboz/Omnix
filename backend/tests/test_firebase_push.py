import json
import pytest
import httpx
from authlib.jose import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization
from app.core import Session, User, SystemSetting, decrypt, redis
from app.workspace_settings import store_setting
from app.firebase_push import send_firebase, FirebaseError, token_key


@pytest.fixture
def key():
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return {
        "type": "service_account",
        "project_id": "omnix-test-project",
        "client_email": "firebase-admin@omnix-test-project.iam.gserviceaccount.com",
        "private_key": private.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode(),
        "token_uri": "https://oauth2.googleapis.com/token",
    }


def make_admin(user):
    with Session() as db:
        db.get(User, user.id).is_admin = True
        db.commit()


def android_config(project="omnix-test-project", package="com.bizbazboz.omnix"):
    return {
        "project_info": {"project_id": project, "project_number": "123456789012"},
        "client": [
            {
                "client_info": {
                    "mobilesdk_app_id": "1:123456789012:android:abcdef0123456789",
                    "android_client_info": {"package_name": package},
                },
                "api_key": [{"current_key": "AIza" + "a" * 35}],
            }
        ],
    }


def configure(signed_client, user, key):
    make_admin(user)
    response = signed_client.put(
        "/api/v1/settings/firebase",
        json={
            "service_account": json.dumps(key),
            "android_config": json.dumps(android_config()),
        },
    )
    assert response.status_code == 200, response.text
    with Session() as db:
        return decrypt(db.get(SystemSetting, "firebase-push").value)


def test_firebase_key_is_admin_only_encrypted_and_never_returned(
    signed_client, user, key
):
    assert (
        signed_client.put(
            "/api/v1/settings/firebase", json={"service_account": json.dumps(key)}
        ).status_code
        == 403
    )
    configure(signed_client, user, key)
    response = signed_client.get("/api/v1/settings/firebase")
    assert (
        response.json()["configured"]
        and response.json()["project_id"] == key["project_id"]
    )
    assert (
        "private_key" not in response.text and key["client_email"] not in response.text
    )
    with Session() as db:
        assert "PRIVATE KEY" not in db.get(SystemSetting, "firebase-push").value
    public = signed_client.get("/api/v1/settings/firebase/client")
    assert public.status_code == 200 and len(public.json()["clients"]) == 1
    assert "private_key" not in public.text and key["client_email"] not in public.text
    assert set(public.json()["clients"][0]) == {
        "projectId",
        "appId",
        "apiKey",
        "messagingSenderId",
        "packageName",
    }
    assert signed_client.delete("/api/v1/settings/firebase").status_code == 204
    assert signed_client.get("/api/v1/settings/firebase").json()["configured"] is False
    assert signed_client.get("/api/v1/settings/firebase/client").status_code == 409


def test_runtime_android_config_merges_clients_without_resubmitting_key(
    signed_client, user, key
):
    configure(signed_client, user, key)
    response = signed_client.put(
        "/api/v1/settings/firebase",
        json={
            "android_config": json.dumps(
                android_config(package="com.bizbazboz.omnix.preview")
            )
        },
    )
    assert response.status_code == 200
    assert set(response.json()["packages"]) == {
        "com.bizbazboz.omnix",
        "com.bizbazboz.omnix.preview",
    }
    with Session() as db:
        assert (
            decrypt(db.get(SystemSetting, "firebase-push").value)["private_key"]
            == key["private_key"]
        )


def test_runtime_android_config_validates_project_and_package(signed_client, user, key):
    configure(signed_client, user, key)
    for config in [
        android_config(project="another-project"),
        android_config(package="com.unrelated.app"),
        {"type": "service_account", "private_key": "SECRET"},
    ]:
        response = signed_client.put(
            "/api/v1/settings/firebase", json={"android_config": json.dumps(config)}
        )
        assert response.status_code == 422 and "SECRET" not in response.text
    assert signed_client.get("/api/v1/settings/firebase").json()["configured"] is True


def test_firebase_rejects_invalid_keys_and_custom_oauth_urls(signed_client, user, key):
    make_admin(user)
    for value in [
        "not json",
        json.dumps({**key, "token_uri": "http://127.0.0.1/token"}),
        json.dumps({**key, "private_key": "SECRET-INVALID-KEY"}),
        json.dumps({**key, "project_id": "../escape"}),
    ]:
        response = signed_client.put(
            "/api/v1/settings/firebase", json={"service_account": value}
        )
        assert response.status_code == 422
        assert "SECRET-INVALID-KEY" not in response.text


def test_fcm_signs_oauth_assertion_caches_token_and_sends_deep_link(
    signed_client, user, key, monkeypatch
):
    config = configure(signed_client, user, key)
    calls = []

    def post(url, **kwargs):
        calls.append((url, kwargs))
        assert kwargs["follow_redirects"] is False
        if url == "https://oauth2.googleapis.com/token":
            claims = jwt.decode(kwargs["data"]["assertion"], key["private_key"])
            claims.validate()
            assert claims["iss"] == key["client_email"]
            assert (
                claims["aud"] == url
                and claims["scope"]
                == "https://www.googleapis.com/auth/firebase.messaging"
            )
            return httpx.Response(
                200, json={"access_token": "synthetic-oauth-token", "expires_in": 3600}
            )
        assert (
            url
            == "https://fcm.googleapis.com/v1/projects/omnix-test-project/messages:send"
        )
        assert kwargs["headers"]["Authorization"] == "Bearer synthetic-oauth-token"
        message = kwargs["json"]["message"]
        assert message["data"]["href"] == "/email/inbox?message=one"
        assert message["data"]["origin"] == "https://app.example.test"
        assert message["android"]["notification"]["channel_id"] == "omnix"
        return httpx.Response(
            200, json={"name": "projects/omnix-test-project/messages/one"}
        )

    monkeypatch.setattr("app.firebase_push.httpx.post", post)
    payload = {
        "id": "one",
        "href": "/email/inbox?message=one",
        "title": "New email",
        "body": "Open Omnix",
    }
    send_firebase("native-fcm-token", payload, "https://app.example.test")
    send_firebase("native-fcm-token", payload, "https://app.example.test")
    assert len(calls) == 3
    assert "synthetic-oauth-token" not in redis.get(token_key(config))


def test_fcm_unregistered_token_is_classified(signed_client, user, key, monkeypatch):
    configure(signed_client, user, key)
    monkeypatch.setattr("app.firebase_push.access_token", lambda _: "synthetic")
    monkeypatch.setattr(
        "app.firebase_push.httpx.post",
        lambda *a, **k: httpx.Response(
            404, json={"error": {"details": [{"errorCode": "UNREGISTERED"}]}}
        ),
    )
    with pytest.raises(FirebaseError) as error:
        send_firebase(
            "expired",
            {"id": "one", "href": "/daily/news", "title": "News", "body": "New"},
            "https://app.example.test",
        )
    assert error.value.invalid_token
