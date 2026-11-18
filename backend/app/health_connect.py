"""Account-scoped daily Health Connect snapshots; previously saved history remains read-only."""

import hashlib
import json
from datetime import date, datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, ConfigDict, field_validator, model_validator
from sqlalchemy import text
from .core import SystemSetting, encrypt, decrypt, now

KINDS = {
    "steps": ("Steps", "steps", "activity", 1000000),
    "distance": ("Distance", "km", "activity", 2000),
    "workout_minutes": ("Exercise duration", "min", "activity", 1440),
    "sleep": ("Sleep", "h", "sleep", 24),
}
Kind = Literal["steps", "distance", "workout_minutes", "sleep"]


def saved(db, owner):
    row = db.get(SystemSetting, "health-connect:" + owner)
    return (
        decrypt(row.value)
        if row
        else {
            "revision": 0,
            "enabled": False,
            "metrics": [],
            "permissions": [],
            "history": {},
        }
    )


def write(db, owner, value):
    key = "health-connect:" + owner
    row = db.get(SystemSetting, key)
    if row is None:
        row = SystemSetting(key=key, value="")
        db.add(row)
    row.value = encrypt(value)
    row.updated_at = now()
    db.commit()


def lock(db, owner):
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
        {"key": "health-connect:" + owner},
    )


def summary(value, owner):
    return {
        key: value.get(key)
        for key in (
            "revision",
            "enabled",
            "device_id",
            "metrics",
            "permissions",
            "timezone",
            "last_sync",
            "captured_at",
            "changes_token",
            "preferred",
        )
    } | {"user_id": owner}


class Configuration(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0)
    enabled: bool = True
    preferred: bool = Field(
        default=True, exclude=True
    )  # Compatibility only; phone readings always win.
    device_id: str = Field(pattern=r"^[A-Za-z0-9_-]{32,64}$")
    metrics: list[Kind] = Field(min_length=1, max_length=4)
    timezone: str = Field(max_length=100)

    @field_validator("timezone")
    @classmethod
    def zone(cls, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("Choose an IANA timezone.") from None
        return value

    @field_validator("metrics")
    @classmethod
    def unique(cls, value):
        if len(set(value)) != len(value):
            raise ValueError("Choose each reading once.")
        return value


class Snapshot(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    expected_revision: int = Field(ge=1)
    device_id: str = Field(pattern=r"^[A-Za-z0-9_-]{32,64}$")
    batch_id: str = Field(pattern=r"^[A-Za-z0-9_-]{16,64}$")
    captured_at: datetime
    timezone: str = Field(max_length=100)
    permissions: list[Kind] = Field(max_length=4)
    dates: list[date] = Field(min_length=28, max_length=28)
    points: dict[str, dict[str, float]] = Field(max_length=4)
    changes_token: str = Field(default="", max_length=10000)

    @model_validator(mode="after")
    def valid(self):
        if (
            not self.captured_at.tzinfo
            or abs((now() - self.captured_at).total_seconds()) > 1800
        ):
            raise ValueError("Refresh the phone snapshot before syncing.")
        try:
            zone = ZoneInfo(self.timezone)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("Use an IANA timezone.") from None
        today = self.captured_at.astimezone(zone).date()
        if self.dates != [today - timedelta(days=i) for i in range(27, -1, -1)]:
            raise ValueError("Supply the latest 28 complete daily buckets.")
        if len(set(self.permissions)) != len(self.permissions):
            raise ValueError("Duplicate permission.")
        valid_dates = {d.isoformat() for d in self.dates}
        if set(self.points) != set(self.permissions):
            raise ValueError("Only permitted categories may be uploaded.")
        for kind, points in self.points.items():
            if kind not in KINDS or len(points) > 28 or not set(points) <= valid_dates:
                raise ValueError("Invalid daily readings.")
            for value in points.values():
                if not 0 <= value <= KINDS[kind][3] or (
                    kind == "steps" and value != int(value)
                ):
                    raise ValueError("Reading outside the supported range.")
        return self


def phone_statistics(value, archive):
    if not value.get("enabled") and not value.get("history"):
        return archive
    result = json.loads(json.dumps(archive or {"dates": [], "metrics": {}}))
    metrics = result.setdefault("metrics", {})
    for metric in metrics.values():
        metric.update(stale=True, source="history")
    archive_zone = archive.get("timezone", "UTC")
    phone_zone = value.get("timezone") or archive_zone
    for metric in metrics.values():
        metric.setdefault("timezone", archive_zone)
    for kind, history in value.get("history", {}).items():
        if kind not in KINDS:
            continue
        points = dict(metrics.get(kind, {}).get("points", {}))
        if archive_zone != phone_zone:
            points = {}
        # Never sum overlapping sources; retain fallback data outside phone coverage.
        for day in value.get("coverage", {}).get(kind, []):
            points.pop(day, None)
        points.update(history)
        label, unit, group, _ = KINDS[kind]
        shared = (
            value.get("enabled")
            and kind in value.get("permissions", [])
            and kind in value.get("metrics", [])
        )
        metrics[kind] = {
            "label": label,
            "unit": unit,
            "group": group,
            "status": "ready" if points else "empty",
            "points": points,
            "source": (
                "mixed"
                if archive_zone == phone_zone
                and archive.get("metrics", {}).get(kind, {}).get("points")
                else "health_connect"
            ),
            "timezone": phone_zone,
            "stale": not shared
            or not value.get("last_sync")
            or (now() - datetime.fromisoformat(value["last_sync"])).total_seconds()
            > 86400,
        }
    result["timezone"] = phone_zone
    result["dates"] = sorted(
        set(result.get("dates", []))
        | {day for metric in metrics.values() for day in metric.get("points", {})}
    )
    return result


def build_health_connect_router(authenticated, db_session, rate):
    router = APIRouter(prefix="/api/v1/health/connect", include_in_schema=False)

    def browser(request):
        if not getattr(request.state, "sid", None):
            raise HTTPException(403, "Use the signed-in companion session.")

    @router.get("")
    def get(user=Depends(authenticated), db=Depends(db_session)):
        return summary(saved(db, user.id), user.id)

    @router.put("")
    def configure(
        body: Configuration,
        request: Request,
        user=Depends(authenticated),
        db=Depends(db_session),
    ):
        browser(request)
        lock(db, user.id)
        value = saved(db, user.id)
        if value["revision"] != body.expected_revision:
            raise HTTPException(409, "Health settings changed. Reload before syncing.")
        if (
            value.get("device_id") != body.device_id
            or value.get("metrics") != body.metrics
            or value.get("timezone") != body.timezone
        ):
            value["changes_token"] = ""
        value.update(body.model_dump(exclude={"expected_revision"}))
        value["revision"] += 1
        write(db, user.id, value)
        return summary(value, user.id)

    @router.post("/sync")
    def sync(
        body: Snapshot,
        request: Request,
        user=Depends(authenticated),
        db=Depends(db_session),
    ):
        browser(request)
        rate("health-connect:" + user.id, 60)
        lock(db, user.id)
        value = saved(db, user.id)
        digest = hashlib.sha256(body.model_dump_json().encode()).hexdigest()
        if value.get("batch_id") == body.batch_id:
            if value.get("batch_digest") != digest:
                raise HTTPException(409, "That batch ID was already used.")
            return summary(value, user.id)
        if not value.get("enabled") or value.get("device_id") != body.device_id:
            raise HTTPException(409, "Enable this phone before syncing.")
        if value["revision"] != body.expected_revision:
            raise HTTPException(409, "Health settings changed. Refresh before syncing.")
        if value["timezone"] != body.timezone or not set(body.permissions) <= set(
            value["metrics"]
        ):
            raise HTTPException(422, "Only selected readings may be synced.")
        if value.get("captured_at") and body.captured_at < datetime.fromisoformat(
            value["captured_at"]
        ):
            raise HTTPException(409, "A newer phone snapshot is already saved.")
        history = value.setdefault("history", {})
        coverage = value.setdefault("coverage", {})
        for kind in body.permissions:
            points = history.setdefault(kind, {})
            for day in body.dates:
                points.pop(day.isoformat(), None)
            points.update(body.points[kind])
            coverage[kind] = sorted(
                set(coverage.get(kind, [])) | {day.isoformat() for day in body.dates}
            )
        value.update(
            permissions=body.permissions,
            captured_at=body.captured_at.isoformat(),
            last_sync=now().isoformat(),
            batch_id=body.batch_id,
            batch_digest=digest,
            changes_token=body.changes_token,
            revision=value["revision"] + 1,
        )
        write(db, user.id, value)
        from .notifications import signal

        signal(user.id, "health")
        return summary(value, user.id)

    @router.delete("", status_code=204)
    def forget(request: Request, user=Depends(authenticated), db=Depends(db_session)):
        browser(request)
        lock(db, user.id)
        value = saved(db, user.id)
        write(
            db,
            user.id,
            {
                "revision": value["revision"] + 1,
                "enabled": False,
                "metrics": [],
                "permissions": [],
                "history": {},
            },
        )
        from .notifications import signal

        signal(user.id, "health")

    return router
