"""Personal access tokens: browser-managed, hashed at rest, account-scoped."""

import hashlib
import re
import secrets
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from .core import ApiToken, User, now
from . import rate_limits


def personal_operation(path: str, method: str) -> bool:
    """The same boundary applies to REST tokens and generated MCP tools.

    Configuration, OAuth, sessions, token management and administrator APIs are
    deliberately outside this boundary, including for an administrator's token.
    """
    if method.upper() not in {"GET", "POST", "PATCH", "PUT", "DELETE"}:
        return False
    return bool(
        re.fullmatch(r"/api/v1/(notes|email|calendar|daily)(/[^?]*)?", path)
        or (
            method == "GET"
            and path
            in {
                "/api/v1/overview",
                "/api/v1/products",
                "/api/v1/connections",
                "/api/v1/health/status",
                "/api/v1/health/statistics",
            }
        )
        or (method == "POST" and path == "/api/v1/health/refresh")
    )


def verify_personal_token(db, raw: str):
    if not re.fullmatch(r"omnix_[A-Za-z0-9_-]{43}", raw):
        return None
    token = db.scalar(
        select(ApiToken).where(
            ApiToken.digest == hashlib.sha256(raw.encode()).hexdigest(),
            ApiToken.revoked_at.is_(None),
            ApiToken.expires_at > now(),
        )
    )
    if not token or not (user := db.get(User, token.owner)):
        return None
    from .admission import admitted

    if not admitted(user):
        return None
    if token.last_used_at is None or token.last_used_at < now() - timedelta(minutes=1):
        token.last_used_at = now()
        db.commit()
    return token, user


def authorize_request(request: Request, db):
    scheme, _, raw = request.headers.get("authorization", "").partition(" ")
    result = verify_personal_token(db, raw) if scheme.lower() == "bearer" else None
    if not result:
        rate_limits.failed_auth(request.scope)
        raise HTTPException(
            401, "invalid_api_token", headers={"WWW-Authenticate": "Bearer"}
        )
    token, user = result
    rate_limits.account(request.scope, user.id, write=request.method != "GET")
    if not personal_operation(request.url.path, request.method):
        raise HTTPException(403, "token_access_not_allowed")
    if request.method != "GET" and token.permission != "write":
        raise HTTPException(403, "read_only_token")
    request.state.api_token = token.id
    return user


class TokenCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    permission: Literal["read", "write"] = "read"
    expires_in_days: int = Field(default=30, ge=1, le=365)


def token_json(token):
    return {
        key: getattr(token, key)
        for key in (
            "id",
            "name",
            "prefix",
            "permission",
            "created_at",
            "expires_at",
            "last_used_at",
            "revoked_at",
        )
    }


def build_token_router(authenticated, db_session):
    router = APIRouter(prefix="/api/v1/settings/api-tokens", tags=["API access"])

    def browser_user(request: Request, user=Depends(authenticated)):
        if request.headers.get("authorization"):
            raise HTTPException(403, "browser_login_required")
        return user

    @router.get("")
    def tokens(user=Depends(browser_user), db=Depends(db_session)):
        return [
            token_json(row)
            for row in db.scalars(
                select(ApiToken)
                .where(
                    ApiToken.owner == user.id,
                )
                .order_by(ApiToken.created_at.desc())
            )
        ]

    @router.post("", status_code=201)
    def create(data: TokenCreate, user=Depends(browser_user), db=Depends(db_session)):
        name = data.name.strip()
        if not name:
            raise HTTPException(422, "token_name_required")
        active = db.scalars(
            select(ApiToken).where(
                ApiToken.owner == user.id,
                ApiToken.revoked_at.is_(None),
                ApiToken.expires_at > now(),
            )
        ).all()
        if len(active) >= 25:
            raise HTTPException(409, "active_token_limit")
        raw = "omnix_" + secrets.token_urlsafe(32)
        row = ApiToken(
            owner=user.id,
            name=name,
            prefix=raw[:14],
            digest=hashlib.sha256(raw.encode()).hexdigest(),
            permission=data.permission,
            expires_at=now() + timedelta(days=data.expires_in_days),
        )
        db.add(row)
        db.commit()
        return {**token_json(row), "token": raw}

    @router.delete("/{id}", status_code=204)
    def revoke(id: str, user=Depends(browser_user), db=Depends(db_session)):
        row = db.get(ApiToken, id)
        if not row or row.owner != user.id:
            raise HTTPException(404, "token_not_found")
        row.revoked_at = now()
        db.commit()

    return router
