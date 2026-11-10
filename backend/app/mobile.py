"""Browser-approved, proof-bound handoff to a companion WebView. No OIDC tokens leave the server."""

import base64
import hashlib
import json
import secrets
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field
from .core import redis, User, SESSION_COOKIE
from .auth_settings import configured_origin, load_oidc
from . import rate_limits

PUBLIC_POSTS = {"/api/v1/mobile/requests", "/api/v1/mobile/exchange"}
_CLAIM = """
local raw = redis.call('GET', KEYS[1])
if not raw then return nil end
local data = cjson.decode(raw)
if data.challenge ~= ARGV[1] or data.version ~= ARGV[2] then return 'invalid' end
if not data.user then return 'pending' end
redis.call('DEL', KEYS[1])
return raw
"""
_APPROVE = """
local raw = redis.call('GET', KEYS[1])
if not raw then return nil end
local data = cjson.decode(raw)
if data.user or data.version ~= ARGV[2] then return nil end
data.user = ARGV[1]
redis.call('SET', KEYS[1], cjson.encode(data), 'KEEPTTL')
return 'ok'
"""


class PairRequest(BaseModel):
    challenge: str = Field(pattern=r"^[A-Za-z0-9_-]{43}$")
    platform: str = Field(pattern=r"^(android|ios)$")


class Exchange(BaseModel):
    request_id: str = Field(pattern=r"^[A-Za-z0-9_-]{43}$")
    verifier: str = Field(min_length=43, max_length=128, pattern=r"^[A-Za-z0-9._~-]+$")


def registration():
    value = load_oidc()
    if not value:
        raise HTTPException(503, "Sign-in is not configured.")
    return value


def request_key(value):
    if len(value) != 43 or not all(c.isalnum() or c in "_-" for c in value):
        raise HTTPException(404, "Pairing request unavailable.")
    return "mobile-request:" + value


def build_mobile_router(authenticated, db_session, session_response):
    router = APIRouter(prefix="/api/v1/mobile")

    @router.get("/pairing")
    def pairing(user=Depends(authenticated)):
        return {"origin": configured_origin(), "version": 1}

    @router.post("/requests", status_code=201)
    def create(body: PairRequest, request: Request):
        rate_limits.consume("mobile-create", rate_limits.peer(request.scope), 8)
        config = registration()
        identifier = secrets.token_urlsafe(32)
        code = str(secrets.randbelow(1000000)).zfill(6)
        redis.set(
            request_key(identifier),
            json.dumps(
                {
                    "challenge": body.challenge,
                    "platform": body.platform,
                    "code": code,
                    "version": config["version"],
                }
            ),
            ex=300,
        )
        return {
            "request_id": identifier,
            "code": code,
            "expires_in": 300,
            "login_url": configured_origin()
            + "/api/v1/auth/login?return_to=%2Fmobile%2Fapprove%3Frequest%3D"
            + identifier,
        }

    @router.get("/requests/{identifier}")
    def inspect(identifier: str, user=Depends(authenticated)):
        raw = redis.get(request_key(identifier))
        if not raw:
            raise HTTPException(404, "Pairing expired. Start again in the app.")
        value = json.loads(raw)
        if value["version"] != registration()["version"]:
            raise HTTPException(409, "Sign-in configuration changed. Start again.")
        return {
            "platform": value["platform"],
            "code": value["code"],
            "approved": bool(value.get("user")),
        }

    @router.post("/requests/{identifier}/approve")
    def approve(identifier: str, request: Request, user=Depends(authenticated)):
        # API tokens must never be promoted into interactive browser sessions.
        if not getattr(request.state, "sid", None):
            raise HTTPException(403, "Approve from a signed-in browser.")
        if not redis.eval(
            _APPROVE, 1, request_key(identifier), user.id, registration()["version"]
        ):
            raise HTTPException(409, "Pairing expired or already approved.")
        return {"ok": True}

    @router.post("/exchange")
    def exchange(body: Exchange, request: Request):
        rate_limits.consume("mobile-exchange", rate_limits.peer(request.scope), 30)
        config = registration()
        challenge = (
            base64.urlsafe_b64encode(hashlib.sha256(body.verifier.encode()).digest())
            .rstrip(b"=")
            .decode()
        )
        raw = redis.eval(
            _CLAIM, 1, request_key(body.request_id), challenge, config["version"]
        )
        if raw == "pending":
            raise HTTPException(409, "Approve this device in the browser first.")
        if not raw or raw == "invalid":
            raise HTTPException(400, "Pairing unavailable. Start again.")
        value = json.loads(raw)
        ticket = secrets.token_urlsafe(40)
        key = "mobile-session:" + hashlib.sha256(ticket.encode()).hexdigest()
        redis.set(
            key,
            json.dumps({"user": value["user"], "version": config["version"]}),
            ex=30,
        )
        return {"ticket": ticket, "expires_in": 30}

    @router.get("/session")
    def session(
        request: Request,
        x_omnix_mobile_ticket: str = Header(default=""),
        db=Depends(db_session),
    ):
        # A native WebView can set this header on its initial GET. Cross-origin
        # forms/navigation cannot; cross-origin script requests fail CORS.
        if not 40 <= len(x_omnix_mobile_ticket) <= 128:
            raise HTTPException(401, "A companion session ticket is required.")
        rate_limits.consume("mobile-session", rate_limits.peer(request.scope), 30)
        key = (
            "mobile-session:"
            + hashlib.sha256(x_omnix_mobile_ticket.encode()).hexdigest()
        )
        raw = redis.getdel(key)
        if not raw:
            raise HTTPException(
                401, "Companion session ticket expired or already used."
            )
        data = json.loads(raw)
        if data["version"] != registration()["version"] or not db.get(
            User, data["user"]
        ):
            raise HTTPException(401, "Sign-in configuration changed. Sign in again.")
        return session_response(data["user"], request.cookies.get(SESSION_COOKIE))

    return router
