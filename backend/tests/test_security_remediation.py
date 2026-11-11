import asyncio
import secrets
from fastapi import Request
from fastapi.testclient import TestClient
from app.core import Session, SystemSetting, ApiToken, decrypt
from app.auth_settings import save_config
from app.main import app, security
from app import rate_limits


def test_absolute_deadline_interrupts_slow_headers_and_body():
    import http.client
    import threading
    import time
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    from app.download_deadline import DownloadDeadline, read_chunk

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            try:
                if self.path == "/headers":
                    time.sleep(0.6)
                self.send_response(200)
                self.send_header("Content-Length", "6")
                self.end_headers()
                for _ in range(6):
                    self.wfile.write(b"x")
                    self.wfile.flush()
                    time.sleep(0.15)
            except (OSError, ValueError):
                pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        for path in ["/body", "/headers"]:
            connection = http.client.HTTPConnection(
                "127.0.0.1", server.server_port, timeout=2
            )
            start = time.monotonic()
            deadline = start + 0.25
            try:
                with DownloadDeadline(connection, deadline):
                    connection.request("GET", path)
                    connection.deadline_socket = connection.sock
                    response = connection.getresponse()
                    while read_chunk(response, deadline):
                        pass
                raise AssertionError("Slow source was not interrupted")
            except (ValueError, OSError, http.client.HTTPException):
                pass
            assert time.monotonic() - start < 1
    finally:
        server.shutdown()
        server.server_close()


def test_revoked_admission_invalidates_sessions_and_all_token_transports(
    signed_client, user
):
    token = signed_client.post(
        "/api/v1/settings/api-tokens",
        json={"name": "revocation", "permission": "write"},
    ).json()["token"]
    with Session() as db:
        config = decrypt(db.get(SystemSetting, "oidc").value)
        config.update(
            allow_all=False, allowed_subjects=["other-subject"], version="rotated"
        )
        save_config(db, config)
        assert all(
            t.revoked_at is not None
            for t in db.query(ApiToken).filter(ApiToken.owner == user.id)
        )
    assert signed_client.get("/api/v1/me").status_code == 401
    with TestClient(app, base_url="https://app.example.test") as api:
        assert (
            api.get(
                "/api/v1/notes/pages", headers={"Authorization": "Bearer " + token}
            ).status_code
            == 401
        )
        assert (
            api.post(
                "/mcp?accesstoken=" + token,
                json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
            ).status_code
            == 401
        )
    with Session() as db:
        config.update(allow_all=True, version="readmitted")
        save_config(db, config)
    assert signed_client.get("/api/v1/me").status_code == 401


def test_unauthenticated_large_body_is_not_read(signed_client):
    async def run():
        async def receive():
            raise AssertionError("Anonymous request body must not be consumed")

        async def endpoint(request):
            raise AssertionError("Endpoint must not be reached")

        scope = {
            "type": "http",
            "http_version": "1.1",
            "method": "POST",
            "scheme": "https",
            "path": "/api/v1/notes/import",
            "query_string": b"",
            "headers": [],
            "client": ("anonymous", 1),
            "server": ("app.example.test", 443),
            "state": {},
        }
        result = await security(Request(scope, receive), endpoint)
        assert result.status_code == 403
        scope["headers"] = [(b"authorization", b"Bearer invalid")]
        result = await security(Request(scope, receive), endpoint)
        assert result.status_code == 401

    asyncio.run(run())


def test_only_verified_tunnel_peer_can_supply_client_identity(monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXY_CIDRS", "192.0.2.10/32")
    monkeypatch.setenv("TRUSTED_CLIENT_IP_HEADER", "cf-connecting-ip")

    def scope(peer, ip):
        return {"client": (peer, 10), "headers": [(b"cf-connecting-ip", ip.encode())]}

    assert rate_limits.peer(scope("203.0.113.1", "198.51.100.1")) == "203.0.113.1"
    assert rate_limits.peer(scope("192.0.2.10", "198.51.100.1")) == "198.51.100.1"
    assert rate_limits.peer(scope("192.0.2.10", "1.1.1.1, 2.2.2.2")) == "192.0.2.10"
    assert rate_limits.peer(scope("192.0.2.10", "invalid")) == "192.0.2.10"
    for ip in ["198.51.100.1", "198.51.100.2"]:
        for _ in range(rate_limits.LOGIN_LIMIT):
            rate_limits.inbound(
                {**scope("192.0.2.10", ip), "path": "/api/v1/auth/login"}
            )


def test_pairing_requires_browser_return_grant_not_just_attacker_verifier(
    signed_client, user
):
    import base64, hashlib
    from urllib.parse import urlsplit, parse_qs

    verifier = secrets.token_urlsafe(32)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
        .rstrip(b"=")
        .decode()
    )
    with TestClient(app, base_url="https://app.example.test") as attacker:
        pairing = attacker.post(
            "/api/v1/mobile/requests",
            json={"challenge": challenge, "platform": "android"},
        ).json()
        approval = signed_client.post(
            "/api/v1/mobile/requests/" + pairing["request_id"] + "/approve"
        )
        assert approval.status_code == 200
        # The browser grant is returned only through the app callback. Knowing
        # the request and verifier, or polling the request, cannot retrieve it.
        assert (
            "code"
            not in signed_client.get(
                "/api/v1/mobile/requests/" + pairing["request_id"]
            ).json()
        )
        assert (
            attacker.post(
                "/api/v1/mobile/exchange",
                json={"request_id": pairing["request_id"], "verifier": verifier},
            ).status_code
            == 422
        )
        assert (
            attacker.post(
                "/api/v1/mobile/exchange",
                json={
                    "request_id": pairing["request_id"],
                    "verifier": verifier,
                    "grant": "x" * 54,
                },
            ).status_code
            == 400
        )
        code = parse_qs(urlsplit(approval.json()["callback_url"]).query)["code"][0]
        assert (
            attacker.post(
                "/api/v1/mobile/exchange",
                json={"request_id": "x" * 43, "verifier": verifier, "grant": code},
            ).status_code
            == 400
        )
        valid = {
            "request_id": pairing["request_id"],
            "verifier": verifier,
            "grant": code,
        }
        assert attacker.post("/api/v1/mobile/exchange", json=valid).status_code == 200
        assert attacker.post("/api/v1/mobile/exchange", json=valid).status_code == 400
