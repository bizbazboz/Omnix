"""Owner-scoped Govee light control and at-most-once calendar triggers."""

import hashlib
import json
import uuid
from datetime import timedelta
from typing import Any, Literal
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, SecretStr
from sqlalchemy import select, delete
from sqlalchemy.exc import IntegrityError
from .core import (
    CalendarFeed,
    IoTRule,
    IoTRun,
    Session,
    SystemSetting,
    decrypt,
    encrypt,
    now,
    redis,
)
from .workspace_settings import load_setting, store_setting
from .calendar_identity import event_identity

HOST = "https://openapi.api.govee.com/router/api/v1/"
INSTANCES = {
    "powerSwitch",
    "brightness",
    "colorRgb",
    "colorTemperatureK",
    "lightScene",
    "diyScene",
    "snapshot",
}


def config(owner):
    return load_setting("govee:" + owner, {})


def request(owner, path, payload=None):
    key = config(owner).get("api_key")
    if not key:
        raise HTTPException(409, "Connect Govee in Integrations first.")
    try:
        with httpx.Client(timeout=12, follow_redirects=False) as client:
            method = "GET" if payload is None else "POST"
            body = (
                {"requestId": str(uuid.uuid4()), "payload": payload}
                if payload is not None
                else None
            )
            with client.stream(
                method, HOST + path, headers={"Govee-API-Key": key}, json=body
            ) as response:
                if response.status_code == 429:
                    raise HTTPException(
                        429,
                        "Govee is busy. Try again shortly.",
                        headers={"Retry-After": "30"},
                    )
                if response.status_code in {401, 403}:
                    raise HTTPException(
                        502, "Govee rejected the API key. Reconnect in Integrations."
                    )
                response.raise_for_status()
                raw = bytearray()
                for chunk in response.iter_bytes():
                    raw.extend(chunk)
                    if len(raw) > 4 * 1024 * 1024:
                        raise ValueError("response too large")
                value = json.loads(raw)
                if value.get("code") != 200:
                    raise ValueError("provider rejected request")
                return value
    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError, TypeError):
        # Never expose a provider response or credential in errors or job logs.
        raise HTTPException(
            502, "Govee did not confirm the request. Check the device before retrying."
        ) from None


def devices(owner):
    return config(owner).get("devices", [])


def device_for(owner, id):
    item = next((d for d in devices(owner) if d["id"] == id), None)
    if item is None:
        raise HTTPException(404, "Device not found.")
    return item


def discover(owner, db):
    found = request(owner, "user/devices").get("data", [])
    if not isinstance(found, list):
        raise HTTPException(502, "Govee returned an invalid device list.")
    result = []
    for device in found[:100]:
        caps = [
            c for c in device.get("capabilities", []) if c.get("instance") in INSTANCES
        ]
        if (
            not caps
            or device.get("type", "devices.types.light") != "devices.types.light"
        ):
            continue
        result.append(
            {
                "id": hashlib.sha256(
                    (device["sku"] + ":" + device["device"]).encode()
                ).hexdigest()[:24],
                "sku": device["sku"],
                "device": device["device"],
                "name": device.get("deviceName") or device["sku"],
                "capabilities": caps,
            }
        )
    value = config(owner)
    value.update(devices=result, discovered_at=now().isoformat())
    store_setting(db, "govee:" + owner, value)
    return result


class Command(BaseModel):
    instance: Literal[
        "powerSwitch",
        "brightness",
        "colorRgb",
        "colorTemperatureK",
        "lightScene",
        "diyScene",
        "snapshot",
    ]
    value: Any


def capability(device, command):
    item = next(
        (c for c in device["capabilities"] if c["instance"] == command.instance), None
    )
    if not item:
        raise HTTPException(422, "That control is not supported by this device.")
    parameters = item.get("parameters", {})
    options = parameters.get("options")
    value = command.value
    if options is not None:
        if not any(
            type(value) is type(o.get("value")) and value == o.get("value")
            for o in options
        ):
            raise HTTPException(422, "Choose an available device option.")
    elif parameters.get("dataType") == "INTEGER":
        limits = parameters.get("range", {})
        if type(value) is not int or not limits.get("min", 0) <= value <= limits.get(
            "max", 0
        ):
            raise HTTPException(422, "Choose a value within the device range.")
    else:
        raise HTTPException(422, "This capability is unavailable.")
    return {"type": item["type"], "instance": item["instance"], "value": value}


def control(owner, device, command):
    value = capability(device, command)
    if not redis.set("iot-control:" + owner + ":" + device["id"], "1", ex=1, nx=True):
        raise HTTPException(
            429, "Wait a moment between device commands.", headers={"Retry-After": "1"}
        )
    request(
        owner,
        "device/control",
        {"sku": device["sku"], "device": device["device"], "capability": value},
    )
    return {
        "accepted": True,
        "message": "Govee accepted the command. Refresh to confirm device state.",
    }


class Registration(BaseModel):
    api_key: SecretStr = Field(min_length=1, max_length=300)


class RuleInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    device_id: str = Field(min_length=1, max_length=100)
    feed_id: str = Field(min_length=1, max_length=100)
    title_contains: str = Field(default="", max_length=200)
    timing: Literal["start", "end"] = "start"
    offset_minutes: int = Field(default=0, ge=-120, le=120)
    include_all_day: bool = False
    enabled: bool = True
    command: Command


def rule_json(rule):
    return {"id": rule.id, "enabled": rule.enabled, **decrypt(rule.payload)}


def execute_rule(id):
    lock = redis.lock("iot-rule:" + id, timeout=55, blocking_timeout=0)
    if not lock.acquire(blocking=False):
        return
    try:
        with Session() as db:
            rule = db.get(IoTRule, id)
            if not rule or not rule.enabled or not config(rule.owner).get("api_key"):
                return
            value = decrypt(rule.payload)
            feed = db.get(CalendarFeed, value["feed_id"])
            stamp = now()
            if (
                not feed
                or feed.owner != rule.owner
                or feed.status != "ready"
                or not feed.events
                or not feed.last_sync
                or stamp - feed.last_sync > timedelta(days=1)
            ):
                return
            for event in decrypt(feed.events)[:5000]:
                if event.get("all_day") and not value["include_all_day"]:
                    continue
                if (
                    value["title_contains"].casefold()
                    not in event.get("title", "").casefold()
                ):
                    continue
                due = event[value["timing"] + "_ts"] + value["offset_minutes"] * 60
                if (
                    not max(rule.activated_at.timestamp(), stamp.timestamp() - 120)
                    <= due
                    <= stamp.timestamp()
                ):
                    continue
                receipt = hashlib.sha256(
                    (
                        rule.id
                        + ":"
                        + event_identity(feed.id, event)
                        + ":"
                        + value["timing"]
                    ).encode()
                ).hexdigest()
                existing = db.get(IoTRun, receipt)
                if existing and existing.status != "deferred":
                    continue
                run = existing or IoTRun(
                    id=receipt,
                    owner=rule.owner,
                    rule_id=rule.id,
                    status="sending",
                    detail=encrypt({"event": event.get("title", "Untitled event")}),
                )
                run.status = "sending"
                db.add(run)
                try:
                    db.commit()  # Durable claim before sending; never replay an uncertain action.
                except IntegrityError:
                    db.rollback()
                    continue
                try:
                    control(
                        rule.owner,
                        device_for(rule.owner, value["device_id"]),
                        Command.model_validate(value["command"]),
                    )
                    run.status = "accepted"
                except HTTPException as error:
                    run.status = (
                        "deferred"
                        if error.status_code == 429
                        else (
                            "not_sent"
                            if error.status_code in {404, 409, 422}
                            else "unconfirmed"
                        )
                    )
                db.commit()
    finally:
        lock.release()


def build_iot_router(authenticated, db_session):
    router = APIRouter(prefix="/api/v1")

    @router.get("/settings/govee")
    def registration(user=Depends(authenticated)):
        value = config(user.id)
        return {
            "configured": bool(value.get("api_key")),
            "devices": len(value.get("devices", [])),
            "discovered_at": value.get("discovered_at"),
        }

    @router.put("/settings/govee")
    def register(
        value: Registration, user=Depends(authenticated), db=Depends(db_session)
    ):
        # Saving a key does not control devices or execute existing automations.
        key = value.api_key.get_secret_value().strip()
        if not key:
            raise HTTPException(422, "Enter a Govee API key.")
        for rule in db.scalars(select(IoTRule).where(IoTRule.owner == user.id)):
            rule.enabled = False
        store_setting(db, "govee:" + user.id, {"api_key": key, "devices": []})
        return {"configured": True}

    @router.delete("/settings/govee")
    def disconnect(user=Depends(authenticated), db=Depends(db_session)):
        db.execute(delete(IoTRule).where(IoTRule.owner == user.id))
        db.execute(delete(SystemSetting).where(SystemSetting.key == "govee:" + user.id))
        db.commit()
        return {"disconnected": True}

    @router.post("/iot/devices/discover")
    def refresh(user=Depends(authenticated), db=Depends(db_session)):
        if not redis.set("iot-discover:" + user.id, "1", ex=10, nx=True):
            raise HTTPException(
                429, "Wait before discovering again.", headers={"Retry-After": "10"}
            )
        return discover(user.id, db)

    @router.get("/iot/devices")
    def listing(user=Depends(authenticated)):
        return {
            "configured": bool(config(user.id).get("api_key")),
            "items": devices(user.id),
        }

    @router.post("/iot/devices/{id}/scenes")
    def scenes(id: str, user=Depends(authenticated), db=Depends(db_session)):
        device = device_for(user.id, id)
        if not redis.set("iot-scenes:" + user.id + ":" + id, "1", ex=10, nx=True):
            raise HTTPException(
                429, "Wait before refreshing scenes.", headers={"Retry-After": "10"}
            )
        caps = {c["instance"]: c for c in device["capabilities"]}
        for path, instance in (
            ("device/scenes", "lightScene"),
            ("device/diy-scenes", "diyScene"),
        ):
            if instance not in caps:
                continue
            found = request(
                user.id, path, {"sku": device["sku"], "device": device["device"]}
            )
            for item in found.get("payload", {}).get("capabilities", []):
                if item.get("instance") in {"lightScene", "diyScene"}:
                    caps[item["instance"]] = item
        device["capabilities"] = list(caps.values())
        value = config(user.id)
        value["devices"] = [device if d["id"] == id else d for d in value["devices"]]
        store_setting(db, "govee:" + user.id, value)
        return device

    @router.post("/iot/devices/{id}/state")
    def state(id: str, user=Depends(authenticated)):
        device = device_for(user.id, id)
        if not redis.set("iot-state:" + user.id + ":" + id, "1", ex=5, nx=True):
            raise HTTPException(
                429,
                "Wait before refreshing device state.",
                headers={"Retry-After": "5"},
            )
        return request(
            user.id, "device/state", {"sku": device["sku"], "device": device["device"]}
        ).get("payload", {})

    @router.post("/iot/devices/{id}/control")
    def send(id: str, value: Command, user=Depends(authenticated)):
        return control(user.id, device_for(user.id, id), value)

    @router.get("/iot/rules")
    def rules(user=Depends(authenticated), db=Depends(db_session)):
        return [
            rule_json(r)
            for r in db.scalars(
                select(IoTRule)
                .where(IoTRule.owner == user.id)
                .order_by(IoTRule.activated_at)
            )
        ]

    def validate_rule(value, user, db):
        device = device_for(user.id, value.device_id)
        capability(device, value.command)
        feed = db.get(CalendarFeed, value.feed_id)
        if not feed or feed.owner != user.id:
            raise HTTPException(404, "Calendar not found.")

    @router.post("/iot/rules", status_code=201)
    def add_rule(value: RuleInput, user=Depends(authenticated), db=Depends(db_session)):
        validate_rule(value, user, db)
        if (
            len(list(db.scalars(select(IoTRule.id).where(IoTRule.owner == user.id))))
            >= 30
        ):
            raise HTTPException(422, "Limit reached: 30 calendar rules.")
        row = IoTRule(
            owner=user.id,
            enabled=value.enabled,
            payload=encrypt(value.model_dump(exclude={"enabled"})),
        )
        db.add(row)
        db.commit()
        return rule_json(row)

    @router.put("/iot/rules/{id}")
    def edit_rule(
        id: str, value: RuleInput, user=Depends(authenticated), db=Depends(db_session)
    ):
        row = db.get(IoTRule, id)
        if not row or row.owner != user.id:
            raise HTTPException(404, "Rule not found.")
        validate_rule(value, user, db)
        row.payload = encrypt(value.model_dump(exclude={"enabled"}))
        row.enabled = value.enabled
        row.activated_at = now()
        db.commit()
        return rule_json(row)

    @router.delete("/iot/rules/{id}")
    def remove_rule(id: str, user=Depends(authenticated), db=Depends(db_session)):
        row = db.get(IoTRule, id)
        if not row or row.owner != user.id:
            raise HTTPException(404, "Rule not found.")
        db.delete(row)
        db.commit()
        return {"deleted": True}

    @router.get("/iot/history")
    def history(user=Depends(authenticated), db=Depends(db_session)):
        return [
            {
                "id": r.id,
                "rule_id": r.rule_id,
                "status": r.status,
                "created_at": r.created_at,
                **decrypt(r.detail),
            }
            for r in db.scalars(
                select(IoTRun)
                .where(IoTRun.owner == user.id)
                .order_by(IoTRun.created_at.desc())
                .limit(50)
            )
        ]

    return router
