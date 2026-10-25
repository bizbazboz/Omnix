"""Protected operator pairing and database-backed OIDC configuration."""

import hashlib
import json
import secrets
from urllib.parse import urlsplit
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Header
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, SecretStr
from sqlalchemy import select, func, text
from .core import (
    Session,
    SystemSetting,
    User,
    encrypt,
    decrypt,
    redis,
    now,
    BOOTSTRAP_TOKEN_FILE,
)

SETUP_COOKIE = "omnix_setup_claim"


def load_oidc():
    with Session() as db:
        row = db.get(SystemSetting, "oidc")
        return decrypt(row.value) if row else None


def normalize_origin(value):
    parsed = urlsplit(value)
    if (
        not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path not in ("", "/")
    ):
        raise HTTPException(422, "Use a valid browser origin without a path.")
    if parsed.scheme != "https" and not (
        parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1", "::1")
    ):
        raise HTTPException(
            422,
            "Open Omnix through the HTTPS tunnel before setup. HTTP is supported only on loopback.",
        )
    try:
        port = parsed.port
    except ValueError:
        raise HTTPException(422, "Invalid origin port.")
    host = parsed.hostname.lower()
    if ":" in host:
        host = "[" + host + "]"
    suffix = (
        ""
        if port is None
        or (parsed.scheme == "https" and port == 443)
        or (parsed.scheme == "http" and port == 80)
        else ":" + str(port)
    )
    return parsed.scheme + "://" + host + suffix


def configured_origin():
    config = load_oidc()
    if not config or not config.get("public_origin"):
        raise HTTPException(503, "Complete the browser setup first.")
    return config["public_origin"]


def admin_exists(db):
    return bool(
        db.scalar(select(func.count()).select_from(User).where(User.is_admin == True))
    )


def public_settings(config):
    if not config:
        return {"configured": False}
    return {
        "configured": True,
        "public_origin": config["public_origin"],
        "issuer": config["issuer"],
        "client_id": config["client_id"],
        "client_secret_configured": bool(config["client_secret"]),
        "allow_all": config["allow_all"],
        "allowed_subjects": config["allowed_subjects"],
    }


class OIDCInput(BaseModel):
    public_origin: str = Field(max_length=500)
    issuer: str = Field(max_length=500)
    client_id: str = Field(min_length=1, max_length=500)
    client_secret: SecretStr = Field(default=SecretStr(""))
    allow_all: bool = False
    allowed_subjects: list[str] = Field(default_factory=list, max_length=1000)


async def validate_registration(body, previous=None, request_origin=""):
    origin = normalize_origin(body.public_origin)
    if origin != normalize_origin(request_origin):
        raise HTTPException(403, "Browser origin mismatch.")
    issuer = body.issuer.rstrip("/")
    parsed = urlsplit(issuer)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise HTTPException(422, "Use the HTTPS base URL of your Pocket ID instance.")
    if not body.allow_all and not body.allowed_subjects:
        raise HTTPException(
            422,
            "Choose an admission policy: assigned Pocket ID users or explicit subject IDs.",
        )
    secret = body.client_secret.get_secret_value()
    if (
        not secret
        and previous
        and issuer == previous["issuer"].rstrip("/")
        and body.client_id == previous["client_id"]
    ):
        secret = previous["client_secret"]
    if not secret:
        raise HTTPException(422, "Enter the Pocket ID client secret.")
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
            response = await client.get(issuer + "/.well-known/openid-configuration")
            response.raise_for_status()
            metadata = response.json()
        if metadata["issuer"].rstrip("/") != issuer:
            raise ValueError("issuer mismatch")
        for endpoint in ["authorization_endpoint", "token_endpoint", "jwks_uri"]:
            url = urlsplit(metadata[endpoint])
            if (
                url.scheme != "https"
                or not url.hostname
                or url.username
                or url.password
            ):
                raise ValueError("invalid endpoint")
        if "S256" not in metadata.get("code_challenge_methods_supported", ["S256"]):
            raise ValueError("PKCE unsupported")
        methods = metadata.get(
            "token_endpoint_auth_methods_supported", ["client_secret_basic"]
        )
        method = (
            "client_secret_basic"
            if "client_secret_basic" in methods
            else "client_secret_post"
            if "client_secret_post" in methods
            else None
        )
        if not method:
            raise ValueError("confidential clients unsupported")
    except Exception:
        raise HTTPException(
            422,
            "Discovery failed. Verify the Pocket ID URL, HTTPS certificate and container network access.",
        )
    return {
        "public_origin": origin,
        "issuer": metadata["issuer"],
        "client_id": body.client_id,
        "client_secret": secret,
        "allow_all": body.allow_all,
        "allowed_subjects": body.allowed_subjects,
        "token_auth_method": method,
        "version": secrets.token_urlsafe(16),
    }


def save_config(db, config):
    row = db.get(SystemSetting, "oidc")
    if not row:
        row = SystemSetting(key="oidc", value="")
        db.add(row)
    row.value = encrypt(config)
    row.updated_at = now()
    db.commit()


def build_router(authenticated, db_session, rate):
    router = APIRouter(prefix="/api/v1")

    def operator(
        request: Request,
        token: str = Header(default="", alias="X-Setup-Token"),
        db=Depends(db_session),
    ):
        rate("setup:" + request.client.host, 10)
        if admin_exists(db):
            raise HTTPException(409, "Setup is locked. Sign in as an administrator.")
        expected = (
            BOOTSTRAP_TOKEN_FILE.read_text().strip()
            if BOOTSTRAP_TOKEN_FILE.is_file()
            else ""
        )
        if not token or not expected or not secrets.compare_digest(token, expected):
            raise HTTPException(403, "Invalid setup code.")
        return True

    def administrator(user=Depends(authenticated)):
        if not user.is_admin:
            raise HTTPException(403, "Administrator access required.")
        return user

    @router.get("/setup/status")
    def status(db=Depends(db_session)):
        return {
            "configured": bool(load_oidc()),
            "setup_available": not admin_exists(db),
            "callback_url": (load_oidc() or {}).get("public_origin", "")
            + "/api/v1/auth/callback",
        }

    @router.post("/setup/oidc/probe")
    async def probe(body: OIDCInput, request: Request, authorized=Depends(operator)):
        value = await validate_registration(
            body, load_oidc(), request.headers.get("origin", "")
        )
        return {
            "ok": True,
            "issuer": value["issuer"],
            "callback_url": value["public_origin"] + "/api/v1/auth/callback",
            "credentials_verified": False,
        }

    @router.post("/setup/oidc")
    async def initialize(
        body: OIDCInput,
        request: Request,
        authorized=Depends(operator),
        db=Depends(db_session),
    ):
        value = await validate_registration(
            body, load_oidc(), request.headers.get("origin", "")
        )
        db.execute(text("SELECT pg_advisory_xact_lock(901177)"))
        if admin_exists(db):
            raise HTTPException(409, "Setup is already locked.")
        save_config(db, value)
        ticket = secrets.token_urlsafe(32)
        redis.set("setup-admin:" + ticket, value["version"], ex=900)
        response = JSONResponse({"ok": True, "next": "/api/v1/auth/login"})
        response.set_cookie(
            SETUP_COOKIE,
            ticket,
            httponly=True,
            secure=True,
            samesite="lax",
            path="/api/v1/auth",
            max_age=900,
        )
        return response

    @router.get("/settings/auth")
    def read_config(user=Depends(administrator)):
        return {
            **public_settings(load_oidc()),
            "callback_url": configured_origin() + "/api/v1/auth/callback",
        }

    @router.post("/settings/auth/probe")
    async def admin_probe(
        body: OIDCInput, request: Request, user=Depends(administrator)
    ):
        value = await validate_registration(
            body, load_oidc(), request.headers.get("origin", "")
        )
        return {"ok": True, "issuer": value["issuer"], "credentials_verified": False}

    @router.post("/settings/auth")
    async def update_config(
        body: OIDCInput,
        request: Request,
        user=Depends(administrator),
        db=Depends(db_session),
    ):
        value = await validate_registration(
            body, load_oidc(), request.headers.get("origin", "")
        )
        save_config(db, value)
        return public_settings(value)

    return router
