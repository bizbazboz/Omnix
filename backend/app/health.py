"""Private Google Health OAuth connections and encrypted cached statistics."""

import base64
import hashlib
import json
import secrets
import time
from datetime import timedelta
from typing import Literal
from urllib.parse import urlencode
from zoneinfo import ZoneInfo
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field, SecretStr
from sqlalchemy import select
from .core import Session, User, HealthConnection, encrypt, decrypt, redis, now
from .workspace_settings import load_setting, store_setting, preferences
from .auth_settings import configured_origin
from .google_health import (
    GROUPS,
    access_token,
    collect_statistics,
    HealthProviderError,
)

CALLBACK = "/api/v1/health/google/callback"


def sync_health(id):
    with (
        redis.lock("health-sync:" + id, timeout=300, blocking_timeout=1),
        Session() as db,
    ):
        connection = db.scalar(
            select(HealthConnection).where(HealthConnection.id == id).with_for_update()
        )
        if not connection:
            return True
        if (
            connection.last_attempt
            and (now() - connection.last_attempt).total_seconds() < 55
        ):
            return True
        connection.last_attempt = now()
        connection.status = "syncing"
        db.commit()
        generation = decrypt(connection.credentials)["generation"]
        try:
            user = db.get(User, connection.owner)
            zone = preferences(user).get("timezone") or "UTC"
            today = now().astimezone(ZoneInfo(zone)).date()
            start = today - timedelta(days=27)
            end = today + timedelta(days=1)
            token = access_token(connection, db)
            scopes = decrypt(connection.credentials)["scopes"]
            previous = decrypt(connection.statistics) if connection.statistics else {}
            metrics, failures = collect_statistics(
                token, scopes, start, end, zone, previous.get("metrics")
            )
            # A disconnect or a newer Google consent must never resurrect old private data.
            db.expire_all()
            current = db.scalar(
                select(HealthConnection)
                .where(HealthConnection.id == id)
                .with_for_update()
            )
            if not current or decrypt(current.credentials)["generation"] != generation:
                return True
            days = [(start + timedelta(days=i)).isoformat() for i in range(28)]
            current.statistics = encrypt(
                {"dates": days, "timezone": zone, "metrics": metrics}
            )
            succeeded = any(
                metric["status"] in ("ready", "empty") for metric in metrics.values()
            )
            if succeeded:
                current.last_sync = now()
            current.status = (
                ("partial" if succeeded else "error") if failures else "ready"
            )
            current.error = (
                (
                    "Some readings could not refresh. Saved readings are marked as stale."
                    if succeeded
                    else "Google Health readings could not refresh. Saved data is stale."
                )
                if failures
                else ""
            )
            db.commit()
            return failures == 0
        except Exception as error:
            db.rollback()
            db.expire_all()
            current = db.scalar(
                select(HealthConnection)
                .where(HealthConnection.id == id)
                .with_for_update()
            )
            if current and decrypt(current.credentials)["generation"] == generation:
                current.status = (
                    "reconnect"
                    if isinstance(error, HealthProviderError)
                    and error.kind == "reconnect"
                    else "error"
                )
                current.error = (
                    "Reconnect Google Health to renew access."
                    if current.status == "reconnect"
                    else "Could not refresh Google Health. Check access, API setup and connectivity."
                )
                db.commit()
            return False


class Registration(BaseModel):
    client_id: str = Field(min_length=1, max_length=500)
    client_secret: SecretStr = Field(default=SecretStr(""), max_length=2000)


class Consent(BaseModel):
    groups: list[Literal["activity", "sleep", "measurements", "nutrition"]] = Field(
        min_length=1, max_length=4
    )


def build_health_router(authenticated, db_session, rate):
    router = APIRouter(prefix="/api/v1/health")

    def administrator(user=Depends(authenticated)):
        if not user.is_admin:
            raise HTTPException(403, "Administrator access required.")
        return user

    def connection_for(db, user):
        return db.scalar(
            select(HealthConnection).where(HealthConnection.owner == user.id)
        )

    @router.get("/google/registration")
    def get_registration(user=Depends(administrator)):
        value = load_setting("google_health", {})
        return {
            "client_id": value.get("client_id", ""),
            "secret_saved": bool(value.get("client_secret")),
            "redirect_uri": configured_origin() + CALLBACK,
        }

    @router.put("/google/registration")
    def put_registration(
        value: Registration, user=Depends(administrator), db=Depends(db_session)
    ):
        previous = load_setting("google_health", {})
        id = value.client_id.strip()
        secret = value.client_secret.get_secret_value().strip()
        if not id.endswith(".apps.googleusercontent.com") or any(
            c.isspace() for c in id
        ):
            raise HTTPException(422, "Use a Google web application OAuth client ID.")
        if not secret and previous.get("client_id") == id:
            secret = previous.get("client_secret", "")
        if not secret:
            raise HTTPException(422, "Enter the Google OAuth client secret.")
        store_setting(
            db,
            "google_health",
            {
                "client_id": id,
                "client_secret": secret,
                "version": secrets.token_hex(16),
            },
        )
        return {"saved": True}

    @router.get("/status")
    def status(user=Depends(authenticated), db=Depends(db_session)):
        connection = connection_for(db, user)
        scopes = decrypt(connection.credentials).get("scopes", []) if connection else []
        return {
            "configured": bool(load_setting("google_health")),
            "can_configure": user.is_admin,
            "connected": bool(connection),
            "status": connection.status if connection else "disconnected",
            "last_sync": connection.last_sync if connection else None,
            "error": connection.error if connection else "",
            "groups": [group for group, scope in GROUPS.items() if scope in scopes],
        }

    @router.get("/statistics")
    def statistics(user=Depends(authenticated), db=Depends(db_session)):
        connection = connection_for(db, user)
        if not connection:
            return {"dates": [], "metrics": {}}
        if not connection.statistics:
            return {"dates": [], "metrics": {}}
        return decrypt(connection.statistics)

    @router.post("/google/authorize")
    def authorize(
        value: Consent,
        request: Request,
        user=Depends(authenticated),
        db=Depends(db_session),
    ):
        registration = load_setting("google_health")
        if not registration:
            raise HTTPException(
                503, "An administrator must configure Google Health first."
            )
        rate("health-authorize:" + user.id, 3)
        db.scalar(select(User).where(User.id == user.id).with_for_update())
        epoch = redis.incr("health:oauth-epoch:" + user.id)
        state = secrets.token_urlsafe(32)
        verifier = secrets.token_urlsafe(48)
        scopes = [GROUPS[group] for group in dict.fromkeys(value.groups)]
        redirect = configured_origin() + CALLBACK
        transaction = {
            "user": user.id,
            "session": request.state.sid,
            "epoch": epoch,
            "version": registration["version"],
            "redirect": redirect,
            "verifier": verifier,
            "scopes": scopes,
        }
        redis.setex("health-oauth:" + state, 600, json.dumps(transaction))
        challenge = (
            base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
            .decode()
            .rstrip("=")
        )
        return {
            "url": "https://accounts.google.com/o/oauth2/v2/auth?"
            + urlencode(
                {
                    "client_id": registration["client_id"],
                    "redirect_uri": redirect,
                    "response_type": "code",
                    "scope": " ".join(scopes),
                    "access_type": "offline",
                    "prompt": "consent",
                    "state": state,
                    "code_challenge": challenge,
                    "code_challenge_method": "S256",
                }
            )
        }

    @router.get("/google/callback")
    async def callback(
        request: Request,
        state: str = "",
        code: str = "",
        error: str = "",
        user=Depends(authenticated),
        db=Depends(db_session),
    ):
        raw = redis.getdel("health-oauth:" + state)
        if not raw:
            raise HTTPException(
                400,
                "Google connection expired or was already used. Try connecting again.",
            )
        transaction = json.loads(raw)
        registration = load_setting("google_health")
        if (
            transaction["user"] != user.id
            or transaction["session"] != request.state.sid
            or not registration
            or transaction["version"] != registration["version"]
            or transaction["redirect"] != configured_origin() + CALLBACK
            or str(transaction["epoch"]) != redis.get("health:oauth-epoch:" + user.id)
        ):
            raise HTTPException(400, "Google connection changed. Try connecting again.")
        if error:
            return RedirectResponse("/app/health?connect=cancelled", status_code=303)
        if not code:
            raise HTTPException(400, "Missing Google authorization code.")
        try:
            async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
                response = await client.post(
                    "https://oauth2.googleapis.com/token",
                    data={
                        "grant_type": "authorization_code",
                        "code": code,
                        "code_verifier": transaction["verifier"],
                        "redirect_uri": transaction["redirect"],
                        "client_id": registration["client_id"],
                        "client_secret": registration["client_secret"],
                    },
                )
                response.raise_for_status()
                tokens = response.json()
                scopes = tokens.get("scope", " ".join(transaction["scopes"])).split()
                expires = int(tokens.get("expires_in", 3600))
                if not 0 < expires <= 86400:
                    raise ValueError()
                if not tokens.get("access_token"):
                    raise ValueError()
                if not tokens.get("refresh_token"):
                    raise HTTPException(
                        502,
                        "Google did not grant offline access. Remove Omnix from your Google account connections, then connect again and approve access.",
                    )
                if not any(scope in scopes for scope in GROUPS.values()):
                    raise HTTPException(
                        502,
                        "No Google Health permissions were granted. Connect again and select at least one Health category.",
                    )
        except HTTPException:
            raise
        except httpx.HTTPStatusError as failure:
            # Never expose Google's raw body: it may contain credentials or user data.
            try:
                reason = failure.response.json().get("error")
            except (ValueError, AttributeError):
                reason = None
            messages = {
                "invalid_client": "Google rejected the OAuth client ID or secret. Check the matching web client credentials in Google app setup, save them, then connect again.",
                "deleted_client": "This Google OAuth client was deleted. Save an active web client in Google app setup, then connect again.",
                "unauthorized_client": "Google does not allow this client to use web OAuth. Use a Web application client in Google app setup.",
                "invalid_grant": "Google rejected the authorization code because it expired, was already used, or did not match this connection. Return to Health and start a new connection.",
                "redirect_uri_mismatch": "The Google callback URL does not match. Copy the exact callback from Google app setup into the client's authorized redirect URIs, then connect again.",
                "invalid_scope": "Google rejected the requested Health permissions. Check the Health API and consent scopes in Google Cloud, then connect again.",
                "access_denied": "Google denied access. Check the app's test users and your account policies, then connect again.",
            }
            message = messages.get(reason if isinstance(reason, str) else "")
            raise HTTPException(
                502,
                message or "Google could not complete the token exchange. Check Google OAuth availability and app setup, then connect again.",
            ) from None
        except httpx.RequestError:
            raise HTTPException(
                502, "Omnix could not reach Google's token service. Check server connectivity, then connect again."
            ) from None
        except (ValueError, TypeError, AttributeError):
            raise HTTPException(
                502, "Google returned an incomplete token response. Return to Health and connect again."
            ) from None
        db.scalar(select(User).where(User.id == user.id).with_for_update())
        current_registration = load_setting("google_health", {})
        if (
            str(transaction["epoch"]) != redis.get("health:oauth-epoch:" + user.id)
            or current_registration.get("version") != transaction["version"]
            or not redis.exists("session:" + request.state.sid)
        ):
            raise HTTPException(
                400,
                "Google connection changed while authorizing. Try connecting again.",
            )
        connection = connection_for(db, user)
        if connection is None:
            connection = HealthConnection(owner=user.id, credentials="")
            db.add(connection)
        connection.credentials = encrypt(
            {
                "access_token": tokens["access_token"],
                "refresh_token": tokens["refresh_token"],
                "expires_at": time.time() + expires,
                "scopes": scopes,
                "generation": secrets.token_hex(16),
                "oauth_client": {
                    "client_id": registration["client_id"],
                    "client_secret": registration["client_secret"],
                },
            }
        )
        connection.statistics = ""
        connection.status = "pending"
        connection.error = ""
        connection.last_attempt = None
        connection.last_sync = None
        db.commit()
        from .tasks import health_sync

        try:
            health_sync.delay(connection.id)
        except Exception:
            pass  # The durable scheduled dispatcher recovers a pending connection.
        return RedirectResponse("/app/health?connect=success", status_code=303)

    @router.post("/refresh", status_code=202)
    def refresh(user=Depends(authenticated), db=Depends(db_session)):
        connection = connection_for(db, user)
        if not connection:
            raise HTTPException(404, "Connect Google Health first.")
        if (
            connection.last_attempt
            and (now() - connection.last_attempt).total_seconds() < 60
        ):
            raise HTTPException(429, "Wait a minute before refreshing again.")
        if not redis.set("health-manual:" + connection.id, "1", ex=60, nx=True):
            raise HTTPException(429, "A refresh is already queued.")
        from .tasks import health_sync

        health_sync.delay(connection.id)
        return {"queued": True}

    @router.delete("/connection")
    def disconnect(user=Depends(authenticated), db=Depends(db_session)):
        db.scalar(select(User).where(User.id == user.id).with_for_update())
        redis.incr("health:oauth-epoch:" + user.id)
        connection = connection_for(db, user)
        if not connection:
            raise HTTPException(404, "No health account is connected.")
        creds = decrypt(connection.credentials)
        db.delete(connection)
        db.commit()
        revoked = False
        try:
            response = httpx.post(
                "https://oauth2.googleapis.com/revoke",
                data={"token": creds["refresh_token"]},
                timeout=15,
                follow_redirects=False,
            )
            revoked = response.status_code == 200
        except Exception:
            pass
        return {"disconnected": True, "remote_revoked": revoked}

    return router
