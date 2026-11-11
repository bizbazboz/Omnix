import base64
import hashlib
import secrets
from app.core import Session, SystemSetting, encrypt, redis, SESSION_COOKIE


def begin(client, verifier=None):
    verifier = verifier or secrets.token_urlsafe(32)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
        .rstrip(b"=")
        .decode()
    )
    response = client.post(
        "/api/v1/mobile/requests", json={"challenge": challenge, "platform": "android"}
    )
    assert response.status_code == 201, response.text
    return response.json(), verifier


def approve(client, request):
    return client.post(f"/api/v1/mobile/requests/{request['request_id']}/approve")


def test_native_handoff_is_proof_bound_and_one_use(signed_client, user):
    pairing = signed_client.get("/api/v1/mobile/pairing").json()
    assert pairing["origin"] == "https://app.example.test"
    request, verifier = begin(signed_client)
    assert len(request["code"]) == 6
    assert verifier not in request["login_url"]
    assert "/api/v1/auth/login?return_to=" in request["login_url"]
    body = {"request_id": request["request_id"], "verifier": verifier}
    assert signed_client.post("/api/v1/mobile/exchange", json=body).status_code == 409
    assert approve(signed_client, request).status_code == 200
    assert approve(signed_client, request).status_code == 409
    wrong = {**body, "verifier": secrets.token_urlsafe(32)}
    assert signed_client.post("/api/v1/mobile/exchange", json=wrong).status_code == 400
    response = signed_client.post("/api/v1/mobile/exchange", json=body)
    assert response.status_code == 200
    ticket = response.json()["ticket"]
    assert "set-cookie" not in response.headers
    assert signed_client.post("/api/v1/mobile/exchange", json=body).status_code == 400
    headers = {"X-Omnix-Mobile-Ticket": ticket}
    assert (
        signed_client.get("/api/v1/mobile/session?ticket=" + ticket).status_code == 401
    )
    response = signed_client.get("/api/v1/mobile/session", headers=headers)
    assert response.status_code == 303 and response.headers["location"] == "/"
    cookie = response.headers["set-cookie"]
    assert SESSION_COOKIE in cookie and "Secure" in cookie and "HttpOnly" in cookie
    assert "no-store" in response.headers["cache-control"]
    assert (
        signed_client.get("/api/v1/mobile/session", headers=headers).status_code == 401
    )
    assert signed_client.get("/api/v1/me").json()["id"] == user.id


def test_public_native_posts_do_not_bypass_browser_approval(signed_client):
    request, verifier = begin(signed_client)
    signed_client.cookies.clear()
    signed_client.headers.pop("Origin", None)
    signed_client.headers.pop("X-CSRF-Token", None)
    assert approve(signed_client, request).status_code in (401, 403)
    response = signed_client.post(
        "/api/v1/mobile/exchange",
        json={"request_id": request["request_id"], "verifier": verifier},
    )
    assert response.status_code == 409
    assert signed_client.post("/api/v1/auth/logout").status_code == 403
    assert (
        signed_client.options(
            "/api/v1/mobile/session",
            headers={
                "Origin": "https://evil.test",
                "Access-Control-Request-Headers": "X-Omnix-Mobile-Ticket",
            },
        ).headers.get("access-control-allow-origin")
        is None
    )


def test_request_and_ticket_expiry_and_registration_rotation(signed_client):
    request, verifier = begin(signed_client)
    redis.delete("mobile-request:" + request["request_id"])
    assert approve(signed_client, request).status_code == 409
    request, verifier = begin(signed_client)
    assert approve(signed_client, request).status_code == 200
    response = signed_client.post(
        "/api/v1/mobile/exchange",
        json={"request_id": request["request_id"], "verifier": verifier},
    )
    ticket = response.json()["ticket"]
    key = "mobile-session:" + hashlib.sha256(ticket.encode()).hexdigest()
    assert 0 < redis.ttl(key) <= 30
    with Session() as db:
        row = db.get(SystemSetting, "oidc")
        from app.core import decrypt

        config = decrypt(row.value)
        config["version"] = "rotated"
        row.value = encrypt(config)
        db.commit()
    assert (
        signed_client.get(
            "/api/v1/mobile/session", headers={"X-Omnix-Mobile-Ticket": ticket}
        ).status_code
        == 401
    )


def test_mobile_auth_not_in_token_or_mcp_scope(signed_client):
    from app.api_tokens import personal_operation

    for path in (
        "/api/v1/mobile/requests",
        "/api/v1/mobile/exchange",
        "/api/v1/mobile/session",
        "/api/v1/mobile/requests/a/approve",
    ):
        for method in ("GET", "POST"):
            assert not personal_operation(path, method)
    response = signed_client.post(
        "/api/v1/mobile/requests", json={"challenge": "bad", "platform": "android"}
    )
    assert response.status_code == 422
    assert "bad" not in response.text
