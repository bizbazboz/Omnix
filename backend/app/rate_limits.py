"""Shared Redis limits, in requests per minute, across all API workers.

Health probes and static assets are exempt. Peer addresses come from ASGI, not
client-supplied forwarding headers. Account budgets are shared by browser
sessions and all of an account's API tokens, including MCP calls.
"""

import hashlib
import ipaddress
import os
from fastapi import HTTPException
from redis.exceptions import RedisError
from .core import redis

PEER_LIMIT = 3000
ACCOUNT_LIMIT = 600
WRITE_LIMIT = 240
PUBLIC_LIMIT = 120
LOGIN_LIMIT = 10
CALLBACK_LIMIT = 30
FAILURE_LIMIT = 60
WINDOW = 60

_COUNTER = """
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
    ttl = tonumber(ARGV[1])
end
return {count, ttl}
"""


def consume(bucket, identity, limit, window=WINDOW):
    digest = hashlib.sha256(str(identity).encode()).hexdigest()
    try:
        count, ttl = redis.eval(_COUNTER, 1, "limit:" + bucket + ":" + digest, window)
    except RedisError:
        raise HTTPException(
            503,
            "rate_limit_unavailable",
            headers={
                "Retry-After": "5",
                "Cache-Control": "no-store",
                "Referrer-Policy": "no-referrer",
            },
        )
    if count > limit:
        raise HTTPException(
            429,
            "rate_limited",
            headers={
                "Retry-After": str(max(1, ttl)),
                "Cache-Control": "no-store",
                "Referrer-Policy": "no-referrer",
            },
        )


def peer(scope):
    address = scope.get("client")
    raw = address[0] if address else "unknown"
    # Disabled unless the operator identifies the tunnel peer explicitly.
    # A single canonical header is accepted, never an arbitrary XFF chain.
    try:
        networks = [
            ipaddress.ip_network(value.strip())
            for value in os.getenv("TRUSTED_PROXY_CIDRS", "").split(",")
            if value.strip()
        ]
        if any(network.prefixlen == 0 for network in networks):
            return raw
        trusted = any(ipaddress.ip_address(raw) in network for network in networks)
        if trusted:
            header = (
                os.getenv("TRUSTED_CLIENT_IP_HEADER", "cf-connecting-ip")
                .lower()
                .encode("ascii")
            )
            if header not in (b"cf-connecting-ip", b"x-real-ip"):
                return raw
            values = [
                value.decode("ascii").strip()
                for key, value in scope.get("headers", [])
                if key.lower() == header
            ]
            if len(values) == 1:
                return str(ipaddress.ip_address(values[0]))
    except (ValueError, UnicodeError):
        pass
    return raw


def inbound(scope):
    path = scope.get("path", "")
    if scope.get("omnix.mcp_internal") or path in (
        "/api/health/live",
        "/api/health/ready",
    ):
        return
    if not (path.startswith("/api/") or path == "/mcp" or path.startswith("/mcp/")):
        return
    address = scope.get("client")
    consume("peer", address[0] if address else "unknown", PEER_LIMIT)
    if path == "/api/v1/auth/login":
        consume("login", peer(scope), LOGIN_LIMIT)
    elif path == "/api/v1/auth/callback":
        consume("callback", peer(scope), CALLBACK_LIMIT)
    elif path in ("/api/v1/config", "/api/v1/setup/status"):
        consume("public", peer(scope), PUBLIC_LIMIT)


def failed_auth(scope):
    if not scope.get("omnix.mcp_internal"):
        consume("auth-failure", peer(scope), FAILURE_LIMIT)


def account(scope, user_id, write=False):
    state = scope.setdefault("state", {})
    if state.get("omnix.account_limited"):
        return
    if not scope.get("omnix.mcp_internal"):
        consume("account", user_id, ACCOUNT_LIMIT)
    if write:
        consume("write", user_id, WRITE_LIMIT)
    state["omnix.account_limited"] = True
