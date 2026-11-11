"""Browser-approved, proof-bound handoff to a companion WebView. No OIDC tokens leave the server."""

import base64
import hashlib
import json
import secrets
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field
from typing import Literal
from urllib.parse import urlencode
from .admission import admitted
from .core import redis, User, SESSION_COOKIE
from .auth_settings import configured_origin, load_oidc
from . import rate_limits

PUBLIC_POSTS = {"/api/v1/mobile/requests", "/api/v1/mobile/exchange"}
_CLAIM = """
local raw = redis.call('GET', KEYS[1])
local grant = redis.call('GET', KEYS[2])
if not raw or not grant then return nil end
local data = cjson.decode(raw)
local approval = cjson.decode(grant)
if data.challenge ~= ARGV[1] or data.version ~= ARGV[2]
    or approval.version ~= ARGV[2] or approval.request ~= ARGV[3] then return nil end
redis.call('DEL', KEYS[1], KEYS[2])
return grant
"""
_APPROVE = """
local raw = redis.call('GET', KEYS[1])
if not raw then return nil end
local data = cjson.decode(raw)
if data.version ~= ARGV[1] then return nil end
redis.call('SET', KEYS[2], ARGV[2], 'EX', 30)
return raw
"""


class PairRequest(BaseModel):
    callback_scheme: Literal["omnix", "omnix-preview"] = "omnix"
    challenge: str = Field(pattern=r"^[A-Za-z0-9_-]{43}$")
    platform: str = Field(pattern=r"^(android|ios)$")


class Exchange(BaseModel):
    grant: str = Field(pattern=r"^[A-Za-z0-9_-]{54}$")
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
        redis.set(
            request_key(identifier),
            json.dumps(
                {
                    "challenge": body.challenge,
                    "platform": body.platform,
                    "callback_scheme": body.callback_scheme,
                    "version": config["version"],
                }
            ),
            ex=300,
        )
        return {
            "request_id": identifier,
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
            "approved": False,
        }

    @router.post("/requests/{identifier}/approve")
    def approve(identifier: str, request: Request, user=Depends(authenticated)):
        # API tokens must never be promoted into interactive browser sessions.
        if not getattr(request.state, "sid", None):
            raise HTTPException(403, "Approve from a signed-in browser.")
        code = secrets.token_urlsafe(40)
        config = registration()
        grant_key = "mobile-grant:" + hashlib.sha256(code.encode()).hexdigest()
        raw = redis.eval(
            _APPROVE,
            2,
            request_key(identifier),
            grant_key,
            config["version"],
            json.dumps(
                {"request": identifier, "user": user.id, "version": config["version"]}
            ),
        )
        if not raw:
            raise HTTPException(409, "Pairing expired. Start again.")
        value = json.loads(raw)
        scheme = value.get("callback_scheme", "omnix")
        # Only the native app holding the matching local request and verifier
        # can finish this browser grant. It is never visible by polling.
        return {
            "callback_url": scheme
            + "://paired?"
            + urlencode({"request": identifier, "code": code}),
            "expires_in": 30,
        }

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
            _CLAIM,
            2,
            request_key(body.request_id),
            "mobile-grant:" + hashlib.sha256(body.grant.encode()).hexdigest(),
            challenge,
            config["version"],
            body.request_id,
        )
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
        config = registration()
        if data["version"] != config["version"] or not admitted(
            db.get(User, data["user"]), config
        ):
            raise HTTPException(401, "Sign-in configuration changed. Sign in again.")
        return session_response(data["user"], request.cookies.get(SESSION_COOKIE))

    return router
