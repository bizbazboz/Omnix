"""Encrypted workspace, provider registration and per-user preferences."""

import secrets
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, SecretStr
from sqlalchemy import select, text, func
from .core import (
    Session,
    SystemSetting,
    Connection,
    PipelineRun,
    User,
    SendAttempt,
    redis,
    encrypt,
    decrypt,
    now,
)


def load_setting(key, default=None):
    with Session() as db:
        row = db.get(SystemSetting, key)
        return decrypt(row.value) if row else default


def store_setting(db, key, value):
    row = db.get(SystemSetting, key)
    if row is None:
        row = SystemSetting(key=key, value="")
        db.add(row)
    row.value = encrypt(value)
    row.updated_at = now()
    db.commit()


def preferences(user):
    return load_setting(
        "preferences:" + user.id,
        {
            "display_name": user.name,
            "timezone": "",
            "time_format": "24",
            "start_page": "overview",
            "default_account": "",
            "onboarding_completed": False,
        },
    )


def load_zoho():
    return load_setting("zoho")


class Preferences(BaseModel):
    display_name: str = Field(min_length=1, max_length=80)
    timezone: str = Field(default="", max_length=100)
    time_format: Literal["12", "24"] = "24"
    start_page: Literal["overview", "inbox"] = "overview"
    default_account: str = Field(default="", max_length=100)
    onboarding_completed: bool = False


class WorkspaceInput(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    private_mail_hosts: list[str] = Field(default_factory=list, max_length=50)


class ZohoInput(BaseModel):
    client_id: str = Field(min_length=1, max_length=500)
    client_secret: SecretStr = SecretStr("")
    region: Literal["eu", "us", "in", "au"] = "eu"


class PipelineInput(BaseModel):
    sync_enabled: bool = True
    sync_interval: int = Field(default=120, ge=60, le=86400)


class RoleInput(BaseModel):
    is_admin: bool


def build_settings_router(authenticated, db_session):
    router = APIRouter(prefix="/api/v1/settings")

    def administrator(user=Depends(authenticated)):
        if not user.is_admin:
            raise HTTPException(403, "Administrator access required.")
        return user

    @router.get("/preferences")
    def get_preferences(user=Depends(authenticated)):
        return preferences(user)

    @router.put("/preferences")
    def put_preferences(
        body: Preferences, user=Depends(authenticated), db=Depends(db_session)
    ):
        if not body.display_name.strip():
            raise HTTPException(422, "Enter a display name.")
        if body.timezone:
            try:
                ZoneInfo(body.timezone)
            except (ZoneInfoNotFoundError, ValueError):
                raise HTTPException(422, "Choose a valid time zone.")
        if body.default_account:
            account = db.get(Connection, body.default_account)
            if (
                not account
                or account.owner != user.id
                or account.status == "disconnected"
                or not account.can_send
            ):
                raise HTTPException(422, "Choose one of your sending accounts.")
        value = body.model_dump()
        value["display_name"] = body.display_name.strip()
        store_setting(db, "preferences:" + user.id, value)
        return value

    @router.get("/workspace")
    def get_workspace(user=Depends(authenticated)):
        value = load_setting("workspace", {"name": "Omnix", "private_mail_hosts": []})
        return value if user.is_admin else {"name": value["name"]}

    @router.put("/workspace")
    def put_workspace(
        body: WorkspaceInput, user=Depends(administrator), db=Depends(db_session)
    ):
        import re

        hosts = [
            host.strip().lower() for host in body.private_mail_hosts if host.strip()
        ]
        if not body.name.strip() or any(
            not re.fullmatch(r"[a-z0-9][a-z0-9.-]{0,252}", host) for host in hosts
        ):
            raise HTTPException(422, "Enter a workspace name and exact mail hostnames.")
        value = {
            "name": body.name.strip(),
            "private_mail_hosts": list(dict.fromkeys(hosts)),
        }
        store_setting(db, "workspace", value)
        return value

    @router.get("/zoho")
    def get_zoho(user=Depends(administrator)):
        value = load_zoho()
        return {
            "configured": bool(value),
            "client_id": value["client_id"] if value else "",
            "region": value["region"] if value else "eu",
            "client_secret_configured": bool(value and value["client_secret"]),
        }

    @router.put("/zoho")
    def put_zoho(body: ZohoInput, user=Depends(administrator), db=Depends(db_session)):
        previous = load_zoho()
        secret = body.client_secret.get_secret_value()
        if (
            not secret
            and previous
            and previous["client_id"] == body.client_id
            and previous["region"] == body.region
        ):
            secret = previous["client_secret"]
        if not secret:
            raise HTTPException(422, "Enter the Zoho client secret.")
        store_setting(
            db,
            "zoho",
            {
                "client_id": body.client_id,
                "client_secret": secret,
                "region": body.region,
                "version": secrets.token_urlsafe(16),
            },
        )
        return get_zoho(user)

    @router.post("/zoho/probe")
    def probe_zoho(user=Depends(administrator)):
        import httpx
        from .providers import REGIONS

        registration = load_zoho()
        if not registration:
            raise HTTPException(422, "Save Zoho registration first.")
        try:
            response = httpx.get(
                REGIONS[registration["region"]][0]
                + "/.well-known/openid-configuration",
                timeout=10,
            )
            response.raise_for_status()
        except Exception:
            raise HTTPException(
                422, "Zoho could not be reached. Check network connectivity and region."
            )
        return {
            "ok": True,
            "detail": "Region reachable. Complete account authorization to validate client credentials.",
        }

    @router.get("/pipelines")
    def get_pipelines(user=Depends(administrator), db=Depends(db_session)):
        runs = db.scalars(
            select(PipelineRun).order_by(PipelineRun.started_at.desc()).limit(60)
        )
        return {
            "configuration": load_setting(
                "pipelines", {"sync_enabled": True, "sync_interval": 120}
            ),
            "runs": [
                {
                    "id": r.id,
                    "pipeline": r.pipeline,
                    "target": r.target,
                    "status": r.status,
                    "detail": r.detail,
                    "started_at": r.started_at,
                    "finished_at": r.finished_at,
                }
                for r in runs
            ],
            "outbox": dict(
                db.execute(
                    select(SendAttempt.status, func.count()).group_by(
                        SendAttempt.status
                    )
                ).all()
            ),
        }

    @router.put("/pipelines")
    def put_pipelines(
        body: PipelineInput, user=Depends(administrator), db=Depends(db_session)
    ):
        store_setting(db, "pipelines", body.model_dump())
        return {"ok": True}

    @router.post("/pipelines/{pipeline}/run")
    def run_pipeline(pipeline: str, user=Depends(administrator)):
        from .tasks import dispatch_sync, dispatch_outbox, recover

        jobs = {
            "sync-dispatch": dispatch_sync,
            "outbox-dispatch": dispatch_outbox,
            "recovery": recover,
        }
        if pipeline not in jobs:
            raise HTTPException(404, "Unknown pipeline.")
        if not redis.set("manual-pipeline:" + pipeline, "1", nx=True, ex=15):
            raise HTTPException(429, "Wait before running this pipeline again.")
        jobs[pipeline].delay()
        return {"queued": True}

    @router.get("/system")
    def system(user=Depends(administrator), db=Depends(db_session)):
        db.execute(text("SELECT 1"))
        redis.ping()
        revision = db.execute(text("SELECT version_num FROM alembic_version")).scalar()
        return {
            "version": "1.0.0",
            "database": "connected",
            "queue": "connected",
            "schema": revision,
            "encrypted_settings": True,
            "storage": "Host-mounted PostgreSQL and application data",
            "workers": bool(redis.get("heartbeat:worker")),
            "scheduler": bool(redis.get("heartbeat:scheduler")),
        }

    @router.get("/users")
    def users(user=Depends(administrator), db=Depends(db_session)):
        return [
            {"id": u.id, "name": u.name, "email": u.email, "is_admin": u.is_admin}
            for u in db.scalars(select(User).order_by(User.name))
        ]

    @router.patch("/users/{identifier}")
    def change_role(
        identifier: str,
        body: RoleInput,
        user=Depends(administrator),
        db=Depends(db_session),
    ):
        # Serialize changes so concurrent requests cannot remove the last administrator.
        db.execute(text("SELECT pg_advisory_xact_lock(817346)"))
        target = db.get(User, identifier)
        if not target:
            raise HTTPException(404, "User not found.")
        if (
            target.is_admin
            and not body.is_admin
            and db.scalar(
                select(func.count()).select_from(User).where(User.is_admin == True)
            )
            <= 1
        ):
            raise HTTPException(409, "Keep at least one administrator.")
        target.is_admin = body.is_admin
        db.commit()
        return {"ok": True}

    @router.get("/sessions")
    def sessions(request: Request, user=Depends(authenticated)):
        import json

        result = []
        for key in redis.scan_iter("session:*"):
            raw = redis.get(key)
            if raw:
                session = json.loads(raw)
                if session["user"] == user.id:
                    result.append(
                        {
                            "current": key == "session:" + request.state.sid,
                            "expires_at": session["expires"],
                        }
                    )
        return result

    @router.post("/sessions/revoke-others")
    def revoke_sessions(request: Request, user=Depends(authenticated)):
        import json

        for key in redis.scan_iter("session:*"):
            raw = redis.get(key)
            if (
                key != "session:" + request.state.sid
                and raw
                and json.loads(raw)["user"] == user.id
            ):
                redis.delete(key)
        return {"ok": True}

    return router
