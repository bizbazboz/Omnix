import os, secrets, json, hashlib, time, base64
from datetime import datetime, timezone
from urllib.parse import urlencode
from contextlib import asynccontextmanager
import httpx, bleach
from fastapi import FastAPI, Depends, HTTPException, Request, Response, Header
from fastapi.responses import RedirectResponse, JSONResponse, FileResponse
from fastapi.exceptions import RequestValidationError
from pathlib import Path
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select, or_, func, text
from sqlalchemy.exc import IntegrityError
from authlib.integrations.httpx_client import AsyncOAuth2Client
from authlib.jose import JsonWebToken
from .core import *
from .providers import REGIONS, SCOPES, validate_protocol, fetch_body
from .tasks import sync, send
from .workspace_settings import (
    load_zoho,
    load_setting,
    preferences,
    build_settings_router,
)
from .auth_settings import (
    load_oidc,
    admin_exists,
    build_router,
    SETUP_COOKIE,
    configured_origin,
    normalize_origin,
)


app = FastAPI(title="Omnix workspace", version="1.0.0")


@app.exception_handler(RequestValidationError)
async def validation_error(request, error):
    # Pydantic's default response includes submitted input, including credentials.
    return JSONResponse(
        status_code=422,
        content={
            "detail": [
                {"loc": list(item["loc"]), "msg": item["msg"], "type": item["type"]}
                for item in error.errors()
            ]
        },
    )


@app.middleware("http")
async def security(request, call_next):
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        chunks = []
        size = 0
        async for chunk in request.stream():
            size += len(chunk)
            limit = (
                10 * 1024 * 1024
                if request.method == "POST"
                and request.url.path.startswith("/api/v1/email/mailboxes/")
                and request.url.path.endswith("/uploads")
                else 1048576
            )
            if size > limit:
                return JSONResponse({"detail": "request_too_large"}, status_code=413)
            chunks.append(chunk)
        request._body = b"".join(chunks)
    if request.method in (
        "POST",
        "PATCH",
        "PUT",
        "DELETE",
    ) and request.url.path.startswith("/api/"):
        setup_path = request.url.path in (
            "/api/v1/setup/oidc",
            "/api/v1/setup/oidc/probe",
        )
        try:
            origin = normalize_origin(request.headers.get("origin", ""))
            registration = load_oidc()
            if not setup_path and (
                not registration or origin != registration.get("public_origin")
            ):
                return JSONResponse({"detail": "origin_mismatch"}, status_code=403)
        except HTTPException:
            return JSONResponse({"detail": "origin_mismatch"}, status_code=403)
        if not setup_path:
            sid = request.cookies.get(SESSION_COOKIE, "")
            raw = redis.get("session:" + sid)
            if not raw or not secrets.compare_digest(
                request.headers.get("x-csrf-token", ""), json.loads(raw)["csrf"]
            ):
                return JSONResponse({"detail": "csrf_failed"}, status_code=403)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https: http:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
    )
    response.headers["Cache-Control"] = (
        "no-store" if request.url.path.startswith("/api") else "no-cache"
    )
    return response


def db_session():
    with Session() as db:
        yield db


def authenticated(request: Request, db=Depends(db_session)):
    sid = request.cookies.get(SESSION_COOKIE, "")
    raw = redis.get("session:" + sid)
    if not raw:
        raise HTTPException(401, "login_required")
    data = json.loads(raw)
    if data["expires"] < time.time():
        redis.delete("session:" + sid)
        raise HTTPException(401, "session_expired")
    redis.expire("session:" + sid, 1800)
    user = db.get(User, data["user"])
    if not user:
        raise HTTPException(401, "login_required")
    request.state.session = data
    request.state.sid = sid
    return user


def session_response(user_id, old_sid=None):
    if old_sid:
        redis.delete("session:" + old_sid)
    sid = secrets.token_urlsafe(40)
    csrf = secrets.token_urlsafe(32)
    redis.setex(
        "session:" + sid,
        1800,
        json.dumps({"user": user_id, "csrf": csrf, "expires": time.time() + 43200}),
    )
    response = RedirectResponse("/", status_code=303)
    response.set_cookie(
        SESSION_COOKIE,
        sid,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=43200,
        path="/",
    )
    return response


def mailbox(db, user, id, send_permission=False):
    c = db.get(Connection, id)
    if not c or c.owner != user.id or c.status == "disconnected":
        raise HTTPException(404, "mailbox_not_found")
    if send_permission and not c.can_send:
        raise HTTPException(403, "sender_not_allowed")
    return c


def rate(key, limit=10):
    count = redis.incr(key)
    if count == 1:
        redis.expire(key, 60)
    if count > limit:
        raise HTTPException(429, "rate_limited")


def audit(db, user, action, target):
    db.add(Audit(owner=user.id, action=action, target=target))


def connection_json(c):
    return {
        "id": c.id,
        "provider": c.provider,
        "label": c.label,
        "address": c.address,
        "status": c.status,
        "region": c.region,
        "can_read": c.can_read,
        "can_send": c.can_send,
        "last_sync": c.last_sync,
        "error": c.error,
    }


def message_json(m, c):
    import html

    return {
        "id": m.id,
        "mailbox": m.mailbox,
        "account": c.label,
        "address": c.address,
        "sender": m.sender,
        "sender_name": m.sender_name,
        "recipients": html.unescape(m.recipients),
        "cc": html.unescape(m.cc),
        "reply_to": m.reply_to,
        "subject": m.subject,
        "preview": m.body[:180],
        "unread": m.unread,
        "starred": m.starred,
        "date": m.date,
        "folder": m.folder,
    }


@app.get("/api/health/live")
def live():
    return {"status": "ok"}


@app.get("/api/health/ready")
def ready(db=Depends(db_session)):
    db.execute(text("SELECT 1"))
    redis.ping()
    return {"status": "ready", "mode": "production"}


@app.get("/api/v1/config")
def config():
    with Session() as db:
        return {
            "oidc_configured": bool(load_oidc()),
            "setup_available": not admin_exists(db),
            "version": "1.0.0",
        }


@app.get("/api/v1/me")
def me(request: Request, user=Depends(authenticated)):
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "csrf": request.state.session["csrf"],
        "is_admin": user.is_admin,
    }


@app.post("/api/v1/auth/logout")
def logout(request: Request, user=Depends(authenticated)):
    redis.delete("session:" + request.state.sid)
    response = JSONResponse({"ok": True})
    response.delete_cookie(SESSION_COOKIE)
    return response


def verify_id_token(encoded, jwks, issuer, client_id, nonce):
    decoder = JsonWebToken(
        [
            "RS256",
            "RS384",
            "RS512",
            "ES256",
            "ES384",
            "ES512",
            "PS256",
            "PS384",
            "PS512",
            "EdDSA",
        ]
    )
    claims = decoder.decode(
        encoded,
        jwks,
        claims_options={
            "iss": {"essential": True, "value": issuer},
            "aud": {"essential": True, "value": client_id},
            "exp": {"essential": True},
            "iat": {"essential": True},
            "sub": {"essential": True},
            "nonce": {"essential": True, "value": nonce},
        },
    )
    claims.validate(leeway=30)
    audience = claims.get("aud", [])
    if (
        isinstance(audience, list)
        and len(audience) > 1
        and claims.get("azp") != client_id
    ) or (claims.get("azp") and claims["azp"] != client_id):
        raise ValueError("Invalid authorized party")
    return claims


async def oidc_metadata(registration=None):
    registration = registration or load_oidc()
    if not registration:
        raise HTTPException(503, "Sign-in is not configured.")
    issuer = registration["issuer"]
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
            response = await client.get(
                issuer.rstrip("/") + "/.well-known/openid-configuration"
            )
            response.raise_for_status()
            metadata = response.json()
        if metadata["issuer"] != issuer:
            raise ValueError("issuer mismatch")
        return metadata
    except Exception:
        raise HTTPException(
            503,
            "Pocket ID is unavailable. Check its URL, certificate and network access.",
        )


@app.get("/api/v1/auth/login")
async def login(request: Request):
    registration = load_oidc()
    metadata = await oidc_metadata(registration)
    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(48)
    async with AsyncOAuth2Client(
        registration["client_id"],
        code_challenge_method="S256",
        redirect_uri=configured_origin() + "/api/v1/auth/callback",
        scope="openid profile email",
    ) as client:
        url, _ = client.create_authorization_url(
            metadata["authorization_endpoint"],
            state=state,
            nonce=nonce,
            code_verifier=verifier,
        )
    redis.set(
        "oidc:" + state,
        json.dumps(
            {
                "nonce": nonce,
                "verifier": verifier,
                "version": registration["version"],
                "setup_ticket": request.cookies.get(SETUP_COOKIE, ""),
            }
        ),
        ex=300,
    )
    response = RedirectResponse(url)
    response.set_cookie(
        OIDC_COOKIE,
        state,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=300,
        path="/api/v1/auth",
    )
    return response


@app.get("/api/v1/auth/callback")
async def callback(
    request: Request, state: str = "", code: str = "", db=Depends(db_session)
):
    if not state or not secrets.compare_digest(
        state, request.cookies.get(OIDC_COOKIE, "")
    ):
        raise HTTPException(400, "Invalid sign-in state. Start again.")
    raw = redis.getdel("oidc:" + state)
    if not raw or not code:
        raise HTTPException(400, "Sign-in expired or was already used. Start again.")
    transaction = json.loads(raw)
    registration = load_oidc()
    if not registration or transaction["version"] != registration["version"]:
        raise HTTPException(400, "Sign-in configuration changed. Start again.")
    metadata = await oidc_metadata(registration)
    try:
        async with AsyncOAuth2Client(
            registration["client_id"],
            registration["client_secret"],
            redirect_uri=configured_origin() + "/api/v1/auth/callback",
            code_challenge_method="S256",
            token_endpoint_auth_method=registration["token_auth_method"],
        ) as client:
            tokens = await client.fetch_token(
                metadata["token_endpoint"],
                code=code,
                code_verifier=transaction["verifier"],
            )
        async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
            response = await client.get(metadata["jwks_uri"])
            response.raise_for_status()
            keys = response.json()
        claims = verify_id_token(
            tokens["id_token"],
            keys,
            registration["issuer"],
            registration["client_id"],
            transaction["nonce"],
        )
    except Exception:
        raise HTTPException(
            400,
            "Pocket ID sign-in failed. Check the client registration and start again.",
        )
    if (
        not registration["allow_all"]
        and claims["sub"] not in registration["allowed_subjects"]
    ):
        raise HTTPException(403, "This user is not admitted to the workspace.")
    db.execute(text("SELECT pg_advisory_xact_lock(901177)"))
    user = db.scalar(
        select(User).where(User.issuer == claims["iss"], User.subject == claims["sub"])
    )
    if not user:
        user = User(
            issuer=claims["iss"],
            subject=claims["sub"],
            name=claims.get("name", "Workspace member"),
            email=claims.get("email", ""),
        )
        db.add(user)
    ticket = transaction.get("setup_ticket", "")
    if (
        ticket
        and ticket == request.cookies.get(SETUP_COOKIE, "")
        and not admin_exists(db)
    ):
        version = redis.getdel("setup-admin:" + ticket)
        if version == registration["version"]:
            user.is_admin = True
    db.commit()
    response = session_response(user.id, request.cookies.get(SESSION_COOKIE))
    response.delete_cookie(OIDC_COOKIE, path="/api/v1/auth")
    response.delete_cookie(SETUP_COOKIE, path="/api/v1/auth")
    return response


PRODUCTS = [
    {
        "id": "email",
        "name": "Mail",
        "path": "/app/email",
        "capabilities": ["mail.read", "mail.send"],
    },
    {
        "id": "calendar",
        "name": "Calendar",
        "path": "/app/calendar",
        "capabilities": ["calendar.read"],
    },
    {
        "id": "health",
        "name": "Health",
        "path": "/app/health",
        "capabilities": ["health.read"],
    },
]


@app.get("/api/v1/products")
def products(user=Depends(authenticated)):
    return PRODUCTS


@app.get("/api/v1/overview")
def overview(user=Depends(authenticated), db=Depends(db_session)):
    owned = select(Connection.id).where(
        Connection.owner == user.id, Connection.status != "disconnected"
    )
    connections = list(
        db.scalars(
            select(Connection).where(
                Connection.owner == user.id, Connection.status != "disconnected"
            )
        )
    )
    messages = (
        select(func.count())
        .select_from(Message)
        .where(Message.mailbox.in_(owned), Message.folder == "inbox")
    )
    unread = db.scalar(messages.where(Message.unread == True))
    recent = db.execute(
        select(Message, Connection)
        .join(Connection, Message.mailbox == Connection.id)
        .where(
            Connection.owner == user.id,
            Connection.status != "disconnected",
            Message.folder == "inbox",
        )
        .order_by(Message.date.desc(), Message.id.desc())
        .limit(5)
    ).all()
    return {
        "unread": unread,
        "messages": db.scalar(messages),
        "drafts": db.scalar(
            select(func.count())
            .select_from(Draft)
            .where(Draft.owner == user.id, Draft.mailbox.in_(owned))
        ),
        "queued": db.scalar(
            select(func.count())
            .select_from(SendAttempt)
            .where(
                SendAttempt.owner == user.id,
                SendAttempt.status.in_(["queued", "sending"]),
            )
        ),
        "unknown": db.scalar(
            select(func.count())
            .select_from(SendAttempt)
            .where(
                SendAttempt.owner == user.id, SendAttempt.status == "outcome_unknown"
            )
        ),
        "accounts": len(connections),
        "healthy": sum(c.status == "ready" for c in connections),
        "recent": [message_json(m, c) for m, c in recent],
    }


@app.get("/api/v1/onboarding")
def onboarding(user=Depends(authenticated), db=Depends(db_session)):
    count = db.scalar(
        select(func.count())
        .select_from(Connection)
        .where(Connection.owner == user.id, Connection.status != "disconnected")
    )
    return {
        "signed_in": True,
        "connections": count,
        "ready": bool(count),
        "zoho_configured": bool(load_zoho()),
        "completed": preferences(user)["onboarding_completed"],
        "is_admin": user.is_admin,
        "database": "connected",
        "authentication": "configured",
    }


@app.get("/api/v1/connectors")
def connectors(user=Depends(authenticated)):
    return [
        {
            "id": "zoho",
            "name": "Zoho Mail",
            "read": True,
            "send": True,
            "configured": bool(load_zoho()),
            "regions": list(REGIONS),
        },
        {
            "id": "imap",
            "name": "IMAP + SMTP",
            "read": True,
            "send": True,
            "configured": True,
        },
    ]


@app.get("/api/v1/connections")
@app.get("/api/v1/email/mailboxes")
def connections(user=Depends(authenticated), db=Depends(db_session)):
    return [
        connection_json(c)
        for c in db.scalars(
            select(Connection)
            .where(Connection.owner == user.id, Connection.status != "disconnected")
            .order_by(Connection.label)
        )
    ]


class Rename(BaseModel):
    label: str = Field(min_length=1, max_length=60)


@app.patch("/api/v1/connections/{id}")
def rename(id: str, body: Rename, user=Depends(authenticated), db=Depends(db_session)):
    c = mailbox(db, user, id)
    c.label = body.label
    db.commit()
    return connection_json(c)


@app.delete("/api/v1/connections/{id}")
def disconnect(id: str, user=Depends(authenticated), db=Depends(db_session)):
    c = mailbox(db, user, id)
    revocation = "not_applicable"
    if c.provider == "zoho" and c.credentials:
        from .zoho_oauth import revoke

        credentials = decrypt(c.credentials)
        shared = any(
            decrypt(other.credentials).get("refresh_token")
            == credentials.get("refresh_token")
            for other in db.scalars(
                select(Connection).where(
                    Connection.owner == user.id,
                    Connection.id != c.id,
                    Connection.provider == "zoho",
                    Connection.status != "disconnected",
                )
            )
            if other.credentials
        )
        revocation = (
            "Consent retained for your other connected mailboxes."
            if shared
            else revoke(c.region, credentials)
        )
    c.status = "disconnected"
    c.credentials = ""
    c.can_send = False
    c.can_read = False
    audit(db, user, "disconnect", id)
    db.commit()
    return {
        "ok": True,
        "provider_revocation": revocation,
    }


@app.post("/api/v1/connections/{id}/test")
def test_connection(id: str, user=Depends(authenticated), db=Depends(db_session)):
    c = mailbox(db, user, id)
    rate("connection-test:" + c.id, 3)
    try:
        if c.provider == "zoho":
            from .providers import zoho_token

            token = zoho_token(c, db)
            response = httpx.get(
                REGIONS[c.region][1] + "/api/accounts/" + c.account_id,
                headers={"Authorization": "Zoho-oauthtoken " + token},
                timeout=15,
            )
            response.raise_for_status()
        else:
            validate_protocol(decrypt(c.credentials))
    except Exception:
        c.status = "degraded"
        c.error = "Connection test failed. Reconnect or update credentials."
        db.commit()
        raise HTTPException(422, c.error)
    c.status, c.error = "ready", ""
    db.commit()
    return {"ok": True}


class ProtocolConnection(BaseModel):
    label: str = Field(min_length=1, max_length=60)
    address: EmailStr
    imap_host: str = ""
    imap_user: str = ""
    imap_password: str = ""
    smtp_host: str = ""
    smtp_port: int = 465
    smtp_user: str = ""
    smtp_password: str = ""


@app.post("/api/v1/connections/protocol")
def protocol(
    body: ProtocolConnection, user=Depends(authenticated), db=Depends(db_session)
):
    rate("connect:" + user.id, 5)
    if not body.imap_host and not body.smtp_host:
        raise HTTPException(422, "Choose an incoming or outgoing server")
    if body.smtp_host and body.smtp_user.lower() != str(body.address).lower():
        raise HTTPException(
            422, "SMTP sender must match authenticated username in this release"
        )
    try:
        validate_protocol(body.model_dump())
    except Exception:
        raise HTTPException(
            422,
            "Connection failed. Verify host, TLS certificate and app password. Only public hosts are allowed by default.",
        )
    c = Connection(
        owner=user.id,
        provider="imap",
        label=body.label,
        address=str(body.address),
        can_read=bool(body.imap_host),
        can_send=bool(body.smtp_host),
        credentials=encrypt(body.model_dump()),
    )
    db.add(c)
    db.commit()
    audit(db, user, "connect", c.id)
    db.commit()
    if c.can_read:
        sync.delay(c.id)
    return connection_json(c)


class ZohoAuthorize(BaseModel):
    region: str = "eu"


@app.put("/api/v1/connections/{id}/protocol")
def update_protocol(
    id: str,
    body: ProtocolConnection,
    user=Depends(authenticated),
    db=Depends(db_session),
):
    c = mailbox(db, user, id)
    if c.provider != "imap":
        raise HTTPException(422, "Reconnect Zoho through authorization.")
    rate("connect:" + user.id, 5)
    if not body.imap_host and not body.smtp_host:
        raise HTTPException(422, "Choose an incoming or outgoing server.")
    if body.smtp_host and body.smtp_user.lower() != str(body.address).lower():
        raise HTTPException(422, "SMTP sender must match authenticated username.")
    try:
        validate_protocol(body.model_dump())
    except Exception:
        raise HTTPException(422, "Connection failed. Check hosts, TLS and credentials.")
    c.credentials, c.label, c.address = (
        encrypt(body.model_dump()),
        body.label,
        str(body.address),
    )
    c.can_read, c.can_send = bool(body.imap_host), bool(body.smtp_host)
    c.status, c.error = "ready", ""
    db.commit()
    return connection_json(c)


@app.post("/api/v1/connections/zoho/authorize")
def authorize(body: ZohoAuthorize, request: Request, user=Depends(authenticated)):
    registration = load_zoho()
    if not registration:
        raise HTTPException(
            503,
            "Zoho OAuth is not configured. Use an IMAP/SMTP account or ask an administrator.",
        )
    if body.region not in REGIONS:
        raise HTTPException(422, "unsupported_region")
    rate("oauth:" + user.id, 5)
    state = secrets.token_urlsafe(32)
    redis.setex(
        "zoho:" + state,
        300,
        json.dumps(
            {
                "user": user.id,
                "session": request.state.sid,
                "region": body.region,
                "version": registration["version"],
                "origin": configured_origin(),
            }
        ),
    )
    return {
        "url": REGIONS[body.region][0]
        + "/oauth/v2/auth?"
        + urlencode(
            {
                "client_id": registration["client_id"],
                "scope": SCOPES,
                "response_type": "code",
                "access_type": "offline",
                "prompt": "consent",
                "redirect_uri": configured_origin()
                + "/api/v1/connections/zoho/callback",
                "state": state,
            }
        )
    }


@app.get("/api/v1/connections/zoho/callback")
async def zoho_callback(
    request: Request,
    state: str = "",
    code: str = "",
    user=Depends(authenticated),
    db=Depends(db_session),
):
    raw = redis.getdel("zoho:" + state)
    if not raw:
        raise HTTPException(400, "expired_or_replayed_callback")
    tx = json.loads(raw)
    if tx["user"] != user.id or tx["session"] != request.state.sid or not code:
        raise HTTPException(400, "invalid_callback")
    registration = load_zoho()
    if (
        not registration
        or tx.get("version") != registration["version"]
        or tx.get("origin") != configured_origin()
    ):
        raise HTTPException(400, "Registration changed; reconnect Zoho.")
    from .zoho_oauth import exchange

    creds, accounts = await exchange(
        registration,
        tx["region"],
        code,
        configured_origin() + "/api/v1/connections/zoho/callback",
    )
    # Keep discovery pending. Enabling each mailbox is an explicit user action.
    discovery = secrets.token_urlsafe(24)
    redis.setex(
        "discovery:" + discovery,
        600,
        json.dumps(
            {
                "owner": user.id,
                "region": tx["region"],
                "credentials": encrypt(creds),
                "accounts": accounts,
            }
        ),
    )
    return RedirectResponse("/app/settings/connections?discovery=" + discovery)


@app.get("/api/v1/connections/zoho/discovery/{token}")
def discover(token: str, user=Depends(authenticated)):
    raw = redis.get("discovery:" + token)
    if not raw:
        raise HTTPException(404, "discovery_expired")
    data = json.loads(raw)
    if data["owner"] != user.id:
        raise HTTPException(404)
    return [
        {
            "id": str(a["accountId"]),
            "address": a.get("primaryEmailAddress", a.get("mailboxAddress", "")),
        }
        for a in data["accounts"]
    ]


class Selection(BaseModel):
    account_ids: list[str]


@app.post("/api/v1/connections/zoho/discovery/{token}")
def select_mailboxes(
    token: str, body: Selection, user=Depends(authenticated), db=Depends(db_session)
):
    raw = redis.get("discovery:" + token)
    if not raw:
        raise HTTPException(404)
    data = json.loads(raw)
    if data["owner"] != user.id:
        raise HTTPException(404)
    valid = {str(a["accountId"]): a for a in data["accounts"]}
    if not body.account_ids or any(x not in valid for x in body.account_ids):
        raise HTTPException(422, "invalid_mailboxes")
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:owner))"), {"owner": user.id}
    )
    connected_ids = []
    for aid in dict.fromkeys(body.account_ids):
        a = valid[aid]
        address = a.get("primaryEmailAddress", a.get("mailboxAddress", ""))
        c = db.scalar(
            select(Connection)
            .where(
                Connection.owner == user.id,
                Connection.provider == "zoho",
                Connection.region == data["region"],
                Connection.account_id == aid,
            )
            .with_for_update()
        )
        if c:
            c.credentials, c.status, c.error = data["credentials"], "ready", ""
            c.can_read = c.can_send = True
            connected_ids.append(c.id)
            continue
        c = Connection(
            owner=user.id,
            provider="zoho",
            label=address,
            address=address,
            region=data["region"],
            account_id=aid,
            credentials=data["credentials"],
        )
        db.add(c)
        db.flush()
        connected_ids.append(c.id)
    db.commit()
    if connected_ids:
        redis.delete(*["mail-profile:" + id for id in connected_ids])
    redis.delete("discovery:" + token)
    return {"ok": True}


@app.get("/api/v1/email/mailboxes/{id}/folders")
def folders(id: str, user=Depends(authenticated), db=Depends(db_session)):
    c = mailbox(db, user, id)
    from .mail_provider import profile

    try:
        return profile(c, db)["folders"]
    except Exception:
        raise HTTPException(503, "Could not load provider folders.") from None


@app.post("/api/v1/email/mailboxes/{id}/sync")
def request_sync(id: str, user=Depends(authenticated), db=Depends(db_session)):
    c = mailbox(db, user, id)
    rate("sync-request:" + c.id, 2)
    sync.delay(id)
    return {"status": "queued"}


@app.get("/api/v1/email/messages")
def messages(
    folder: str = "inbox",
    account: str = "",
    q: str = "",
    unread: bool = False,
    starred: bool = False,
    cursor: str = "",
    limit: int = 40,
    user=Depends(authenticated),
    db=Depends(db_session),
):
    statement = (
        select(Message, Connection)
        .join(Connection, Message.mailbox == Connection.id)
        .where(
            Connection.owner == user.id,
            Connection.status != "disconnected",
        )
    )
    if folder == "all":
        statement = statement.where(
            Message.folder.notin_(["trash", "spam", "provider-drafts"])
        )
    elif folder == "starred":
        statement = statement.where(Message.starred == True)
    else:
        statement = statement.where(Message.folder == folder)
    if account:
        statement = statement.where(Message.mailbox == account)
    if q:
        statement = statement.where(
            or_(
                Message.subject.ilike("%" + q[:200] + "%"),
                Message.sender.ilike("%" + q[:200] + "%"),
                Message.sender_name.ilike("%" + q[:200] + "%"),
                Message.recipients.ilike("%" + q[:200] + "%"),
                Message.body.ilike("%" + q[:200] + "%"),
            )
        )
    if unread:
        statement = statement.where(Message.unread == True)
    if starred:
        statement = statement.where(Message.starred == True)
    signature = hashlib.sha256(
        json.dumps([user.id, folder, account, q, unread, starred]).encode()
    ).hexdigest()
    if cursor:
        try:
            data = json.loads(cipher.decrypt(cursor.encode(), ttl=86400))
            assert data["filter"] == signature
            date = datetime.fromisoformat(data["date"])
            mid = data["id"]
            statement = statement.where(
                or_(Message.date < date, (Message.date == date) & (Message.id < mid))
            )
        except Exception:
            raise HTTPException(400, "invalid_cursor")
    size = min(max(limit, 1), 100)
    rows = db.execute(
        statement.order_by(Message.date.desc(), Message.id.desc()).limit(size + 1)
    ).all()
    next_cursor = None
    if len(rows) > size:
        m = rows[size - 1][0]
        next_cursor = cipher.encrypt(
            json.dumps(
                {"date": m.date.isoformat(), "id": m.id, "filter": signature}
            ).encode()
        ).decode()
    return {
        "items": [message_json(m, c) for m, c in rows[:size]],
        "next_cursor": next_cursor,
        "search_scope": "Synced messages",
    }


@app.get("/api/v1/email/mailboxes/{id}/messages/{message_id}")
def read_message(
    id: str, message_id: str, user=Depends(authenticated), db=Depends(db_session)
):
    c = mailbox(db, user, id)
    m = db.get(Message, message_id)
    if not m or m.mailbox != c.id:
        raise HTTPException(404)
    try:
        from .mail_client import render_message

        content = render_message(c, db, m)
    except Exception:
        raise HTTPException(
            503,
            "Message body is temporarily unavailable. Check the account connection and retry.",
        )
    data = message_json(m, c)
    data.update(content)
    return data


class Compose(BaseModel):
    mailbox: str
    to: list[EmailStr] = Field(default_factory=list, max_length=100)
    cc: list[EmailStr] = Field(default_factory=list, max_length=100)
    bcc: list[EmailStr] = Field(default_factory=list, max_length=100)
    subject: str = Field(default="", max_length=998)
    body: str = Field(default="", max_length=200000)
    version: int = 1
    from_address: str = Field(default="", max_length=320)
    attachments: list[str] = Field(default_factory=list, max_length=10)
    reply_to_message: str = Field(default="", max_length=100)


@app.get("/api/v1/email/drafts")
def drafts(user=Depends(authenticated), db=Depends(db_session)):
    return [
        {"id": d.id, "version": d.version, **json.loads(d.payload)}
        for d in db.scalars(
            select(Draft).where(Draft.owner == user.id).order_by(Draft.date.desc())
        )
    ]


@app.post("/api/v1/email/drafts")
def create_draft(body: Compose, user=Depends(authenticated), db=Depends(db_session)):
    mailbox(db, user, body.mailbox, True)
    d = Draft(
        owner=user.id, mailbox=body.mailbox, payload=json.dumps(body.model_dump())
    )
    db.add(d)
    db.commit()
    return {"id": d.id, "version": d.version}


@app.patch("/api/v1/email/drafts/{id}")
def update_draft(
    id: str, body: Compose, user=Depends(authenticated), db=Depends(db_session)
):
    mailbox(db, user, body.mailbox, True)
    d = db.scalar(
        select(Draft).where(Draft.id == id, Draft.owner == user.id).with_for_update()
    )
    if not d:
        raise HTTPException(404)
    if d.version != body.version:
        raise HTTPException(409, "draft_version_conflict")
    d.payload = json.dumps(body.model_dump())
    d.mailbox = body.mailbox
    d.version += 1
    d.date = now()
    db.commit()
    return {"id": d.id, "version": d.version}


@app.delete("/api/v1/email/drafts/{id}")
def delete_draft(id: str, user=Depends(authenticated), db=Depends(db_session)):
    d = db.get(Draft, id)
    if not d or d.owner != user.id:
        raise HTTPException(404)
    db.delete(d)
    db.commit()
    return {"ok": True}


@app.post("/api/v1/email/mailboxes/{id}/send")
def send_mail(
    id: str,
    body: Compose,
    idempotency_key: str = Header(alias="Idempotency-Key"),
    user=Depends(authenticated),
    db=Depends(db_session),
):
    c = mailbox(db, user, id, True)
    if body.mailbox != id or not body.to:
        raise HTTPException(422, "invalid_recipient_or_sender")
    if any(
        "\r" in s or "\n" in s for s in [body.subject, *body.to, *body.cc, *body.bcc]
    ):
        raise HTTPException(422, "invalid_header")
    if len(idempotency_key) > 100:
        raise HTTPException(422)
    payload = json.dumps(body.model_dump(), sort_keys=True)
    digest = hashlib.sha256(payload.encode()).hexdigest()
    existing = db.scalar(
        select(SendAttempt).where(
            SendAttempt.owner == user.id, SendAttempt.key == idempotency_key
        )
    )
    if existing:
        if existing.payload_hash != digest:
            raise HTTPException(409, "idempotency_payload_conflict")
        return {"id": existing.id, "status": existing.status}
    from .mail_client import validate_sender, upload_rows

    try:
        validate_sender(c, db, body.from_address)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            503, "Could not verify sender addresses. Check the account connection."
        ) from None
    upload_rows(c, db, body.attachments)
    if body.reply_to_message:
        original = db.get(Message, body.reply_to_message)
        if not original or original.mailbox != c.id:
            raise HTTPException(422, "Reply message unavailable.")
    rate("send:" + user.id, 10)
    a = SendAttempt(
        owner=user.id,
        mailbox=c.id,
        key=idempotency_key,
        payload_hash=digest,
        payload=payload,
    )
    db.add(a)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(
            select(SendAttempt).where(
                SendAttempt.owner == user.id, SendAttempt.key == idempotency_key
            )
        )
        if not existing or existing.payload_hash != digest:
            raise HTTPException(409, "idempotency_payload_conflict")
        return {"id": existing.id, "status": existing.status}
    audit(db, user, "send_queued", a.id)
    db.commit()
    try:
        send.delay(a.id)
    except Exception:
        pass  # Durable dispatcher recovers queued records.
    return {"id": a.id, "status": a.status}


@app.get("/api/v1/email/send-attempts/{id}")
def attempt(id: str, user=Depends(authenticated), db=Depends(db_session)):
    a = db.get(SendAttempt, id)
    if not a or a.owner != user.id:
        raise HTTPException(404)
    return {"id": a.id, "status": a.status, "receipt": a.receipt}


@app.get("/api/v1/email/send-attempts")
def send_history(user=Depends(authenticated), db=Depends(db_session)):
    attempts = db.scalars(
        select(SendAttempt)
        .where(SendAttempt.owner == user.id)
        .order_by(SendAttempt.date.desc())
        .limit(100)
    )
    output = []
    for attempt in attempts:
        payload = json.loads(attempt.payload)
        connection = db.get(Connection, attempt.mailbox)
        if not connection or connection.status == "disconnected":
            continue
        output.append(
            {
                "id": attempt.id,
                "mailbox": attempt.mailbox,
                "address": connection.address,
                "to": payload.get("to", []),
                "subject": payload.get("subject", ""),
                "status": attempt.status,
                "receipt": attempt.receipt,
                "date": attempt.date,
            }
        )
    return output


app.include_router(build_router(authenticated, db_session, rate))
app.include_router(build_settings_router(authenticated, db_session))
from .calendars import build_calendar_router

app.include_router(build_calendar_router(authenticated, db_session))
from .mail_client import build_mail_router

app.include_router(build_mail_router(authenticated, db_session, mailbox))
from .health import build_health_router

app.include_router(build_health_router(authenticated, db_session, rate))


STATIC_DIR = Path(os.getenv("STATIC_DIR", "/app/static")).resolve()


@app.get("/{path:path}", include_in_schema=False)
def frontend(path: str):
    if path == "api" or path.startswith("api/"):
        raise HTTPException(404)
    candidate = (STATIC_DIR / path).resolve()
    if candidate.is_relative_to(STATIC_DIR) and candidate.is_file():
        return FileResponse(candidate)
    index = STATIC_DIR / "index.html"
    if not index.is_file():
        raise HTTPException(503, "Frontend build is missing.")
    return FileResponse(index)
