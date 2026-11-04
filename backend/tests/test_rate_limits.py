import json
import time
from concurrent.futures import ThreadPoolExecutor
import pytest
from fastapi import HTTPException
from redis.exceptions import ConnectionError
from app.core import redis
from app import rate_limits as limits
from test_api_tokens import create_token, other_workspace, bearer, rpc, tool_name


def reset_limits():
    keys = list(redis.scan_iter("limit:*"))
    if keys:
        redis.delete(*keys)


def test_atomic_counter_under_concurrent_requests_and_expiry():
    def attempt(_):
        try:
            limits.consume("contract", "one-owner", 7)
            return True
        except HTTPException as error:
            assert error.status_code == 429 and int(error.headers["Retry-After"]) > 0
            return False

    with ThreadPoolExecutor(max_workers=12) as executor:
        assert sum(executor.map(attempt, range(30))) == 7
    keys = list(redis.scan_iter("limit:contract:*"))
    assert len(keys) == 1 and 0 < redis.ttl(keys[0]) <= 60
    redis.pexpire(keys[0], 1)
    time.sleep(0.02)
    limits.consume("contract", "one-owner", 7)


def test_peer_limits_ignore_spoofed_forwarding_headers_and_exempt_probes(
    client, monkeypatch
):
    monkeypatch.setattr(limits, "PEER_LIMIT", 2)
    for ip in ("1.1.1.1", "2.2.2.2"):
        assert (
            client.get("/api/v1/config", headers={"X-Forwarded-For": ip}).status_code
            == 200
        )
    response = client.get("/api/v1/config", headers={"X-Forwarded-For": "3.3.3.3"})
    assert response.status_code == 429 and int(response.headers["Retry-After"]) > 0
    assert client.get("/api/health/live").status_code == 200
    assert client.get("/api/health/ready").status_code == 200
    assert client.get("/").status_code == 200


def test_login_and_callback_have_separate_limits(client, monkeypatch):
    monkeypatch.setattr(limits, "LOGIN_LIMIT", 1)
    monkeypatch.setattr(limits, "CALLBACK_LIMIT", 1)
    assert client.get("/api/v1/auth/login").status_code == 503
    assert client.get("/api/v1/auth/login").status_code == 429
    assert client.get("/api/v1/auth/callback").status_code == 400
    assert client.get("/api/v1/auth/callback").status_code == 429


def test_failed_credentials_are_limited_across_api_and_mcp(client, monkeypatch):
    monkeypatch.setattr(limits, "FAILURE_LIMIT", 2)
    assert client.get("/api/v1/me").status_code == 401
    assert rpc(client, "bad", "tools/list").status_code == 401
    response = client.get("/api/v1/me")
    assert response.status_code == 429 and response.json()["detail"] == "rate_limited"


def test_account_budget_is_shared_by_tokens_and_browser_and_isolates_owners(
    signed_client, monkeypatch
):
    a = create_token(signed_client)["token"]
    b = create_token(signed_client)["token"]
    other, _, _, _ = other_workspace()
    reset_limits()
    monkeypatch.setattr(limits, "ACCOUNT_LIMIT", 2)
    assert (
        signed_client.get("/api/v1/notes/pages", headers=bearer(a)).status_code == 200
    )
    assert signed_client.get("/api/v1/me").status_code == 200
    assert (
        signed_client.get("/api/v1/notes/pages", headers=bearer(b)).status_code == 429
    )
    assert (
        signed_client.get("/api/v1/notes/pages", headers=bearer(other)).status_code
        == 200
    )


def test_mcp_tool_call_counts_once_and_cannot_bypass_write_limit(
    signed_client, monkeypatch
):
    token = create_token(signed_client, permission="write")["token"]
    reset_limits()
    monkeypatch.setattr(limits, "ACCOUNT_LIMIT", 2)
    response = rpc(
        signed_client,
        token,
        "tools/call",
        {"name": tool_name("/api/v1/notes/pages"), "arguments": {}},
    )
    assert response.status_code == 200 and not response.json()["result"].get("isError")
    assert (
        signed_client.get("/api/v1/notes/pages", headers=bearer(token)).status_code
        == 200
    )
    assert rpc(signed_client, token, "tools/list").status_code == 429
    reset_limits()
    monkeypatch.setattr(limits, "ACCOUNT_LIMIT", 600)
    monkeypatch.setattr(limits, "WRITE_LIMIT", 1)
    params = {
        "name": tool_name("/api/v1/notes/pages", "post"),
        "arguments": {"title": "Limited"},
    }
    assert (
        not rpc(signed_client, token, "tools/call", params)
        .json()["result"]
        .get("isError")
    )
    denied = rpc(signed_client, token, "tools/call", params).json()["result"]
    assert denied["isError"] and "rate limited" in json.dumps(denied).lower()
    assert (
        signed_client.post(
            "/api/v1/notes/pages", headers=bearer(token), json={"title": "Denied"}
        ).status_code
        == 429
    )
    assert len(signed_client.get("/api/v1/notes/pages").json()["items"]) == 1


def test_http_headers_cannot_claim_internal_mcp_privileges(signed_client, monkeypatch):
    reset_limits()
    monkeypatch.setattr(limits, "ACCOUNT_LIMIT", 1)
    assert signed_client.get("/api/v1/me").status_code == 200
    assert (
        signed_client.get(
            "/api/v1/me", headers={"X-Omnix-MCP-Internal": "true"}
        ).status_code
        == 429
    )


def test_limiter_failure_fails_closed_without_disclosing_connection_details(
    client, monkeypatch
):
    def unavailable(*args, **kwargs):
        raise ConnectionError("private connection details")

    monkeypatch.setattr(limits.redis, "eval", unavailable)
    response = client.get("/api/v1/config")
    assert response.status_code == 503 and response.headers["Retry-After"] == "5"
    assert "private" not in response.text
    assert client.get("/api/health/live").status_code == 200
