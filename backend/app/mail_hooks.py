"""Zoho's signed outgoing-mail webhook. Bodies are hints, never trusted mail data."""

import base64
import hashlib
import hmac
import secrets
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select, text
from .core import Connection, SystemSetting, encrypt, decrypt, now
from .auth_settings import configured_origin
from .workspace_settings import load_setting


def is_mail_hook(path):
    return path.startswith("/api/v1/hooks/zoho/")


def build_mail_hook_router(authenticated, db_session):
    router = APIRouter(prefix="/api/v1")

    @router.post("/email/mailboxes/{id}/webhook")
    def configure(
        id: str, request: Request, user=Depends(authenticated), db=Depends(db_session)
    ):
        c = db.get(Connection, id)
        if (
            not c
            or c.owner != user.id
            or c.provider != "zoho"
            or c.status == "disconnected"
        ):
            raise HTTPException(404)
        db.execute(text("SELECT pg_advisory_xact_lock(683415241)"))
        for row in db.scalars(
            select(SystemSetting).where(SystemSetting.key.like("mail-hook:%"))
        ):
            if decrypt(row.value)["connection"] == c.id:
                db.delete(row)
        token = secrets.token_urlsafe(32)
        key = "mail-hook:" + hashlib.sha256(token.encode()).hexdigest()
        db.add(SystemSetting(key=key, value=encrypt({"connection": id, "secret": ""})))
        db.commit()
        return {"url": configured_origin() + "/api/v1/hooks/zoho/" + token}

    @router.post("/hooks/zoho/{token}", include_in_schema=False)
    async def incoming(token: str, request: Request, db=Depends(db_session)):
        if len(token) != 43:
            raise HTTPException(404)
        key = "mail-hook:" + hashlib.sha256(token.encode()).hexdigest()
        # First request establishes Zoho's signing secret, bound to the one-use setup URL.
        db.execute(text("SELECT pg_advisory_xact_lock(683415241)"))
        row = db.get(SystemSetting, key)
        if not row:
            raise HTTPException(404)
        data = decrypt(row.value)
        c = db.get(Connection, data["connection"])
        if not c or c.status == "disconnected" or not c.can_read:
            raise HTTPException(404)
        raw = await request.body()
        offered = request.headers.get("x-hook-secret", "")
        secret = data["secret"] or offered
        if not 16 <= len(secret) <= 512:
            raise HTTPException(403, "Invalid webhook signature")
        signature = base64.b64encode(
            hmac.new(secret.encode(), raw, hashlib.sha256).digest()
        ).decode()
        supplied = request.headers.get("x-hook-signature", "")
        if data["secret"] or supplied:
            if not hmac.compare_digest(signature, supplied):
                raise HTTPException(403, "Invalid webhook signature")
        if not data["secret"]:
            data["secret"] = secret
            row.value, row.updated_at = encrypt(data), now()
        db.commit()
        # Ignore any user/mailbox/message IDs in the payload; sync the bound account only.
        config = load_setting("pipelines", {"sync_enabled": True})
        if config["sync_enabled"]:
            from .tasks import queue_sync

            queue_sync(c.id)
        return {"ok": True}

    return router
