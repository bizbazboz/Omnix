"""Black-box checks against the tunnel-facing plain HTTP application service."""

import json, httpx

with httpx.Client(
    base_url="http://api:8000",
    headers={"Origin": "https://tunnel.example.test"},
    timeout=20,
    follow_redirects=False,
) as client:
    response = client.get("/api/health/ready")
    assert response.status_code == 200 and response.json()["mode"] == "production"
    configuration = client.get("/api/v1/config").json()
    assert "demo" not in configuration
    assert client.get("/api/v1/auth/demo").status_code == 404
    for path in [
        "/me",
        "/overview",
        "/products",
        "/connections",
        "/email/messages",
        "/email/drafts",
        "/email/send-attempts",
        "/settings/auth",
    ]:
        assert client.get("/api/v1" + path).status_code == 401, path
    status = client.get("/api/v1/setup/status").json()
    if status["setup_available"]:
        payload = {
            "public_origin": "https://tunnel.example.test",
            "issuer": "https://invalid.example.test",
            "client_id": "invalid",
            "client_secret": "not-real",
            "allow_all": True,
        }
        assert client.post("/api/v1/setup/oidc", json=payload).status_code == 403
    page = client.get("/setup")
    assert page.status_code == 200 and "<title>Omnix</title>" in page.text
    assert "default-src 'self'" in page.headers["content-security-policy"]
    assert page.headers["x-content-type-options"] == "nosniff"
    assert client.get("/api/not-a-route").status_code == 404
    print(
        json.dumps(
            {
                "production": True,
                "transport": "http-for-tunnel",
                "protected_routes": 8,
                "setup_token_required": True,
                "security_headers": True,
                "oidc_configured": configuration["oidc_configured"],
            }
        )
    )
