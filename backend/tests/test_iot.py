from datetime import timedelta
import pytest
from fastapi import HTTPException
from sqlalchemy import select
from app import iot
from app.core import (
    Session,
    User,
    CalendarFeed,
    IoTRule,
    IoTRun,
    SystemSetting,
    encrypt,
    decrypt,
    now,
)
from app.workspace_settings import store_setting


@pytest.fixture
def govee(signed_client, user, monkeypatch):
    calls = []
    device = {
        "sku": "H70B1",
        "device": "curtain-private-id",
        "deviceName": "Curtain lights",
        "type": "devices.types.light",
        "capabilities": [
            {
                "type": "devices.capabilities.on_off",
                "instance": "powerSwitch",
                "parameters": {
                    "dataType": "ENUM",
                    "options": [
                        {"name": "On", "value": 1},
                        {"name": "Off", "value": 0},
                    ],
                },
            },
            {
                "type": "devices.capabilities.range",
                "instance": "brightness",
                "parameters": {"dataType": "INTEGER", "range": {"min": 1, "max": 100}},
            },
            {
                "type": "devices.capabilities.dynamic_scene",
                "instance": "lightScene",
                "parameters": {
                    "dataType": "ENUM",
                    "options": [{"name": "Aurora", "value": {"id": 2, "paramId": 4}}],
                },
            },
        ],
    }

    def request(owner, path, payload=None):
        assert owner == user.id
        calls.append((path, payload))
        return (
            {"code": 200, "data": [device]}
            if path == "user/devices"
            else {"code": 200, "payload": {"capabilities": []}}
        )

    monkeypatch.setattr(iot, "request", request)
    assert (
        signed_client.put(
            "/api/v1/settings/govee", json={"api_key": "private-api-key"}
        ).status_code
        == 200
    )
    result = signed_client.post("/api/v1/iot/devices/discover")
    assert result.status_code == 200
    return result.json()[0], calls


def test_govee_private_registration_and_supported_controls(signed_client, user, govee):
    device, calls = govee
    assert "private-api-key" not in signed_client.get("/api/v1/settings/govee").text
    with Session() as db:
        assert "private-api-key" not in db.get(SystemSetting, "govee:" + user.id).value
    result = signed_client.post(
        f"/api/v1/iot/devices/{device['id']}/control",
        json={"instance": "lightScene", "value": {"id": 2, "paramId": 4}},
    )
    assert result.status_code == 200 and result.json()["accepted"]
    assert calls[-1][1]["capability"]["value"] == {"id": 2, "paramId": 4}
    for command in [
        {"instance": "brightness", "value": 101},
        {"instance": "lightScene", "value": {"id": 7}},
        {"instance": "snapshot", "value": 1},
        {"instance": "powerSwitch", "value": True},
    ]:
        assert (
            signed_client.post(
                f"/api/v1/iot/devices/{device['id']}/control", json=command
            ).status_code
            == 422
        )
    assert (
        signed_client.post(
            "/api/v1/iot/devices/not-owned/control",
            json={"instance": "powerSwitch", "value": 1},
        ).status_code
        == 404
    )


def make_rule(signed_client, user, device):
    stamp = now()
    event = {
        "uid": "meeting",
        "title": "Planning meeting",
        "start": (stamp - timedelta(seconds=10)).isoformat(),
        "end": (stamp + timedelta(hours=1)).isoformat(),
        "start_ts": stamp.timestamp() - 10,
        "end_ts": stamp.timestamp() + 3600,
        "all_day": False,
    }
    with Session() as db:
        feed = CalendarFeed(
            owner=user.id,
            label="Work",
            url=encrypt({"url": "https://example.test/calendar.ics"}),
            events=encrypt([event]),
            status="ready",
            last_sync=stamp,
        )
        db.add(feed)
        db.commit()
        feed_id = feed.id
    value = {
        "name": "Meeting lights",
        "device_id": device["id"],
        "feed_id": feed_id,
        "title_contains": "planning",
        "command": {"instance": "powerSwitch", "value": 1},
    }
    response = signed_client.post("/api/v1/iot/rules", json=value)
    assert response.status_code == 201, response.text
    rule_id = response.json()["id"]
    with Session() as db:
        rule = db.get(IoTRule, rule_id)
        rule.activated_at = stamp - timedelta(minutes=2)
        db.commit()
    return rule_id, feed_id, value


def test_calendar_trigger_once_and_key_change_pauses_rules(signed_client, user, govee):
    device, calls = govee
    rule_id, feed_id, _ = make_rule(signed_client, user, device)
    iot.execute_rule(rule_id)
    iot.execute_rule(rule_id)
    assert len([path for path, _ in calls if path == "device/control"]) == 1
    assert signed_client.get("/api/v1/iot/history").json()[0]["status"] == "accepted"
    assert (
        signed_client.put(
            "/api/v1/settings/govee", json={"api_key": "replacement"}
        ).status_code
        == 200
    )
    assert not signed_client.get("/api/v1/iot/rules").json()[0]["enabled"]
    assert signed_client.delete("/api/v1/settings/govee").status_code == 200
    assert signed_client.get("/api/v1/iot/history").json() == []


def test_calendar_unknown_send_is_not_replayed(signed_client, user, govee, monkeypatch):
    device, _ = govee
    rule_id, _, _ = make_rule(signed_client, user, device)
    attempts = []

    def uncertain(*args):
        attempts.append(True)
        raise HTTPException(502, "Unconfirmed")

    monkeypatch.setattr(iot, "control", uncertain)
    iot.execute_rule(rule_id)
    iot.execute_rule(rule_id)
    assert len(attempts) == 1
    assert signed_client.get("/api/v1/iot/history").json()[0]["status"] == "unconfirmed"


@pytest.mark.parametrize(
    "variant", ["disabled", "stale", "all_day", "old", "nonmatching", "new_rule"]
)
def test_calendar_rule_skips_ineligible_occurrences(
    signed_client, user, govee, variant
):
    device, calls = govee
    rule_id, feed_id, _ = make_rule(signed_client, user, device)
    with Session() as db:
        rule, feed = db.get(IoTRule, rule_id), db.get(CalendarFeed, feed_id)
        events = decrypt(feed.events)
        if variant == "disabled":
            rule.enabled = False
        if variant == "stale":
            feed.last_sync = now() - timedelta(days=2)
        if variant == "all_day":
            events[0]["all_day"] = True
        if variant == "old":
            events[0]["start_ts"] = now().timestamp() - 180
        if variant == "nonmatching":
            events[0]["title"] = "Unrelated event"
        if variant == "new_rule":
            rule.activated_at = now()
        feed.events = encrypt(events)
        db.commit()
    iot.execute_rule(rule_id)
    assert not any(path == "device/control" for path, _ in calls)


def test_iot_cross_account_calendar_and_device_boundaries(signed_client, user, govee):
    device, _ = govee
    rule_id, feed_id, value = make_rule(signed_client, user, device)
    with Session() as db:
        other = User(
            issuer="https://id.example.test",
            subject="other-iot",
            name="Other",
            email="other@example.test",
        )
        db.add(other)
        db.commit()
        feed = db.get(CalendarFeed, feed_id)
        feed.owner = other.id
        db.commit()
    assert signed_client.post("/api/v1/iot/rules", json=value).status_code == 404
    from app.sessions import create_session
    from app.core import SESSION_COOKIE

    signed_client.cookies.set(SESSION_COOKIE, create_session(other.id))
    signed_client.headers["X-CSRF-Token"] = signed_client.get("/api/v1/me").json()[
        "csrf"
    ]
    assert signed_client.get("/api/v1/iot/devices").json()["items"] == []
    assert signed_client.get("/api/v1/iot/rules").json() == []
    assert signed_client.delete("/api/v1/iot/rules/" + rule_id).status_code == 404


def test_calendar_throttling_defers_only_unsent_commands(
    signed_client, user, govee, monkeypatch
):
    device, _ = govee
    rule_id, _, _ = make_rule(signed_client, user, device)
    attempts = []

    def control(*args):
        attempts.append(True)
        if len(attempts) == 1:
            raise HTTPException(429, "Throttled")

    monkeypatch.setattr(iot, "control", control)
    iot.execute_rule(rule_id)
    assert signed_client.get("/api/v1/iot/history").json()[0]["status"] == "deferred"
    iot.execute_rule(rule_id)
    iot.execute_rule(rule_id)
    assert len(attempts) == 2
    assert signed_client.get("/api/v1/iot/history").json()[0]["status"] == "accepted"


@pytest.mark.parametrize("timing,offset", [("start", -1), ("end", 1)])
def test_calendar_start_end_and_offsets(signed_client, user, govee, timing, offset):
    device, calls = govee
    rule_id, feed_id, value = make_rule(signed_client, user, device)
    value.update(timing=timing, offset_minutes=offset)
    assert (
        signed_client.put("/api/v1/iot/rules/" + rule_id, json=value).status_code == 200
    )
    stamp = now()
    with Session() as db:
        rule, feed = db.get(IoTRule, rule_id), db.get(CalendarFeed, feed_id)
        rule.activated_at = stamp - timedelta(minutes=2)
        events = decrypt(feed.events)
        events[0][timing + "_ts"] = stamp.timestamp() - 10 - offset * 60
        feed.events = encrypt(events)
        db.commit()
    iot.execute_rule(rule_id)
    assert any(path == "device/control" for path, _ in calls)
