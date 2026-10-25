import json, time
from urllib.parse import urlsplit, parse_qs
import httpx, pytest
from authlib.jose import JsonWebKey, jwt
from app.core import Session, SystemSetting, User, decrypt, redis
from conftest import PUBLIC_URL
from app.auth_settings import SETUP_COOKIE
import app.main as main

REGISTRATION = {
    "public_origin": PUBLIC_URL,
    "issuer": "https://identity.example.test",
    "client_id": "omnix-test",
    "client_secret": "fixture-client-secret",
    "allow_all": True,
    "allowed_subjects": [],
}


@pytest.fixture
def identity(monkeypatch):
    key = JsonWebKey.generate_key("RSA", 2048, is_private=True)
    public = key.as_dict(is_private=False)
    public["kid"] = key.thumbprint()
    state = {"nonce": "", "subject": "owner", "discovery_calls": 0}
    metadata = {
        "issuer": REGISTRATION["issuer"],
        "authorization_endpoint": REGISTRATION["issuer"] + "/authorize",
        "token_endpoint": REGISTRATION["issuer"] + "/api/oidc/token",
        "jwks_uri": REGISTRATION["issuer"] + "/.well-known/jwks.json",
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["client_secret_basic"],
    }

    class HTTP:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def get(self, url):
            state["discovery_calls"] += 1
            value = {"keys": [public]} if "jwks" in url else metadata
            return httpx.Response(200, json=value, request=httpx.Request("GET", url))

    original = main.AsyncOAuth2Client

    class OAuth(original):
        async def fetch_token(self, url, **kwargs):
            payload = {
                "iss": REGISTRATION["issuer"],
                "sub": state["subject"],
                "aud": REGISTRATION["client_id"],
                "nonce": state["nonce"],
                "iat": int(time.time()),
                "exp": int(time.time()) + 300,
                "name": "Operator",
                "email": "owner@example.com",
            }
            return {
                "id_token": jwt.encode(
                    {"alg": "RS256", "kid": key.thumbprint()}, payload, key
                )
            }

    from types import SimpleNamespace
    import app.auth_settings as settings

    monkeypatch.setattr(main, "httpx", SimpleNamespace(AsyncClient=HTTP))
    monkeypatch.setattr(settings, "httpx", SimpleNamespace(AsyncClient=HTTP))
    monkeypatch.setattr(main, "AsyncOAuth2Client", OAuth)
    return state


def configure(client, operator_token):
    return client.post(
        "/api/v1/setup/oidc",
        json=REGISTRATION,
        headers={"X-Setup-Token": operator_token},
    )


def login(client, identity):
    response = client.get("/api/v1/auth/login")
    assert response.status_code in (302, 307)
    query = parse_qs(urlsplit(response.headers["location"]).query)
    assert query["code_challenge_method"] == ["S256"]
    identity["nonce"] = query["nonce"][0]
    callback = client.get(
        "/api/v1/auth/callback",
        params={"state": query["state"][0], "code": "fixture-code"},
    )
    return callback, query["state"][0]


def test_unconfigured_is_closed(client):
    assert client.get("/api/v1/config").json()["oidc_configured"] is False
    assert client.get("/api/v1/setup/status").json()["setup_available"] is True
    assert client.get("/api/v1/auth/login").status_code == 503
    assert client.get("/api/v1/overview").status_code == 401


def test_operator_token_and_origin_required(client, identity, operator_token):
    assert client.post("/api/v1/setup/oidc/probe", json=REGISTRATION).status_code == 403
    assert identity["discovery_calls"] == 0
    assert (
        client.post(
            "/api/v1/setup/oidc",
            json=REGISTRATION,
            headers={
                "X-Setup-Token": operator_token,
                "Origin": "https://attacker.invalid",
            },
        ).status_code
        == 403
    )
    good = client.post(
        "/api/v1/setup/oidc/probe",
        json=REGISTRATION,
        headers={"X-Setup-Token": operator_token},
    )
    assert good.status_code == 200 and good.json()["credentials_verified"] is False


def test_configuration_encrypted_and_first_login_locks_setup(
    client, identity, operator_token
):
    result = configure(client, operator_token)
    assert result.status_code == 200
    assert (
        "Secure" in result.headers["set-cookie"]
        and "HttpOnly" in result.headers["set-cookie"]
    )
    with Session() as db:
        row = db.get(SystemSetting, "oidc")
        assert REGISTRATION["client_secret"] not in row.value
        assert decrypt(row.value)["client_secret"] == REGISTRATION["client_secret"]
    callback, state = login(client, identity)
    assert callback.status_code == 303
    assert (
        "Secure" in callback.headers["set-cookie"]
        and callback.headers["location"] == "/app"
    )
    me = client.get("/api/v1/me").json()
    assert me["is_admin"] is True
    assert client.get("/api/v1/setup/status").json()["setup_available"] is False
    assert configure(client, operator_token).status_code == 409
    exposed = client.get("/api/v1/settings/auth").json()
    assert (
        exposed["client_secret_configured"] is True and "client_secret" not in exposed
    )
    assert (
        client.get(
            "/api/v1/auth/callback", params={"state": state, "code": "fixture-code"}
        ).status_code
        == 400
    )


def test_unpaired_browser_cannot_become_admin(client, identity, operator_token):
    assert configure(client, operator_token).status_code == 200
    client.cookies.delete(SETUP_COOKIE)
    response, _ = login(client, identity)
    assert response.status_code == 303
    assert client.get("/api/v1/me").json()["is_admin"] is False
    assert client.get("/api/v1/settings/auth").status_code == 403
    assert client.get("/api/v1/setup/status").json()["setup_available"] is True


def test_settings_require_admin_and_csrf(signed_client):
    assert signed_client.get("/api/v1/settings/auth").status_code == 403
    assert (
        signed_client.post("/api/v1/settings/auth", json=REGISTRATION).status_code
        == 403
    )


def test_bad_discovery_and_admission_are_rejected(client, operator_token, identity):
    assert (
        client.post(
            "/api/v1/setup/oidc",
            json={**REGISTRATION, "issuer": "http://identity.example.test"},
            headers={"X-Setup-Token": operator_token},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/v1/setup/oidc",
            json={**REGISTRATION, "allow_all": False},
            headers={"X-Setup-Token": operator_token},
        ).status_code
        == 422
    )


def test_setup_code_rate_limit(client):
    for _ in range(10):
        assert (
            client.post(
                "/api/v1/setup/oidc",
                json=REGISTRATION,
                headers={"X-Setup-Token": "wrong"},
            ).status_code
            == 403
        )
    assert (
        client.post(
            "/api/v1/setup/oidc", json=REGISTRATION, headers={"X-Setup-Token": "wrong"}
        ).status_code
        == 429
    )


def test_admin_can_update_without_exposing_secret_and_stale_flows_fail(
    client, identity, operator_token
):
    assert configure(client, operator_token).status_code == 200
    assert login(client, identity)[0].status_code == 303
    profile = client.get("/api/v1/me").json()
    client.headers["X-CSRF-Token"] = profile["csrf"]
    pending = client.get("/api/v1/auth/login")
    query = parse_qs(urlsplit(pending.headers["location"]).query)
    result = client.post(
        "/api/v1/settings/auth", json={**REGISTRATION, "client_secret": ""}
    )
    assert (
        result.status_code == 200 and result.json()["client_secret_configured"] is True
    )
    assert "client_secret" not in result.json()
    assert (
        client.get(
            "/api/v1/auth/callback",
            params={"state": query["state"][0], "code": "old-flow"},
        ).status_code
        == 400
    )


def test_browser_origin_is_saved_and_forwarded_host_is_ignored(
    client, identity, operator_token
):
    assert configure(client, operator_token).status_code == 200
    with Session() as db:
        assert (
            decrypt(db.get(SystemSetting, "oidc").value)["public_origin"] == PUBLIC_URL
        )
    result = client.get(
        "/api/v1/auth/login",
        headers={"Host": "attacker.invalid", "X-Forwarded-Host": "attacker.invalid"},
    )
    query = parse_qs(urlsplit(result.headers["location"]).query)
    assert query["redirect_uri"] == [PUBLIC_URL + "/api/v1/auth/callback"]


def test_callback_origin_cannot_differ_from_browser_origin(
    client, identity, operator_token
):
    result = client.post(
        "/api/v1/setup/oidc",
        json={**REGISTRATION, "public_origin": "https://attacker.invalid"},
        headers={"X-Setup-Token": operator_token},
    )
    assert result.status_code == 403
    with Session() as db:
        assert db.get(SystemSetting, "oidc") is None
