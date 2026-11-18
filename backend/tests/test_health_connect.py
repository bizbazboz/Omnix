from copy import deepcopy
from datetime import timedelta
from zoneinfo import ZoneInfo
from sqlalchemy import select
from app.core import Session, SystemSetting, User, encrypt, now

DEVICE = "test_phone_device_identifier_123456789012345"


def test_phone_overrides_archive_without_summing_or_mixing_timezones():
    from app.health_connect import phone_statistics

    phone = {
        "enabled": True,
        "preferred": False,
        "permissions": ["steps"],
        "metrics": ["steps"],
        "last_sync": now().isoformat(),
        "history": {"steps": {"2026-01-01": 100, "2026-01-02": 200}},
        "coverage": {"steps": ["2026-01-01", "2026-01-02"]},
    }
    cloud = {
        "dates": ["2026-01-01"],
        "metrics": {"steps": {"points": {"2026-01-01": 999}}},
    }
    phone["preferred"] = True
    assert phone_statistics(phone, cloud)["metrics"]["steps"]["points"] == {
        "2026-01-01": 100,
        "2026-01-02": 200,
    }
    assert cloud["metrics"]["steps"]["points"] == {"2026-01-01": 999}
    phone["timezone"] = "Europe/London"
    cloud["timezone"] = "America/New_York"
    assert (
        phone_statistics(phone, cloud)["metrics"]["steps"]["timezone"]
        == "Europe/London"
    )


def configure(client, **extra):
    current = client.get("/api/v1/health/connect").json()
    body = {
        "expected_revision": current["revision"],
        "device_id": DEVICE,
        "metrics": ["steps", "distance", "workout_minutes", "sleep"],
        "timezone": "Europe/London",
        **extra,
    }
    response = client.put("/api/v1/health/connect", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def snapshot(config):
    stamp = now()
    today = stamp.astimezone(ZoneInfo(config["timezone"])).date()
    dates = [(today - timedelta(days=i)).isoformat() for i in range(27, -1, -1)]
    return {
        "expected_revision": config["revision"],
        "device_id": DEVICE,
        "batch_id": "batch_snapshot_1234567890",
        "timezone": config["timezone"],
        "captured_at": stamp.isoformat(),
        "permissions": ["steps", "distance"],
        "dates": dates,
        "points": {"steps": {dates[-1]: 1234}, "distance": {dates[-1]: 1.2}},
        "changes_token": "private-change-cursor",
    }


def test_phone_health_is_private_encrypted_and_idempotent(signed_client, user):
    config = configure(signed_client)
    body = snapshot(config)
    response = signed_client.post("/api/v1/health/connect/sync", json=body)
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["revision"] == config["revision"] + 1 and saved["permissions"] == [
        "steps",
        "distance",
    ]
    assert signed_client.post("/api/v1/health/connect/sync", json=body).json() == saved
    changed = deepcopy(body)
    changed["points"]["steps"][body["dates"][-1]] = 9999
    assert (
        signed_client.post("/api/v1/health/connect/sync", json=changed).status_code
        == 409
    )
    metrics = signed_client.get("/api/v1/health/statistics").json()["metrics"]
    assert metrics["steps"]["points"][body["dates"][-1]] == 1234
    assert metrics["distance"]["unit"] == "km" and "sleep" not in metrics
    state = signed_client.get("/api/v1/health/status").json()
    assert "changes_token" not in state["health_connect"]
    assert (
        state["connected"]
        and state["source"] == "health_connect"
        and "google" not in state
    )
    with Session() as db:
        raw = db.get(SystemSetting, "health-connect:" + user.id).value
        assert "1234" not in raw and "private-change-cursor" not in raw
        other = User(
            issuer=user.issuer,
            subject="another-health-user",
            name="Other",
            email="other@example.com",
        )
        db.add(other)
        db.flush()
        db.add(
            SystemSetting(
                key="health-connect:" + other.id,
                value=encrypt(
                    {"enabled": True, "history": {"steps": {"2020-01-01": 99999}}}
                ),
            )
        )
        db.commit()
    assert (
        "2020-01-01"
        not in signed_client.get("/api/v1/health/statistics").json()["dates"]
    )


def test_phone_precedence_deletions_and_archived_history_preserved(signed_client, user):
    config = configure(signed_client)
    body = snapshot(config)
    day = body["dates"][-1]
    google = {
        "dates": ["2020-01-01", day],
        "timezone": "Europe/London",
        "metrics": {
            "steps": {
                "label": "Steps",
                "unit": "steps",
                "group": "activity",
                "status": "ready",
                "points": {"2020-01-01": 50, day: 5000},
            },
            "weight": {"points": {day: 70}, "unit": "kg"},
        },
    }
    with Session() as db:
        db.add(SystemSetting(key="health-history:" + user.id, value=encrypt(google)))
        db.commit()
    response = signed_client.post("/api/v1/health/connect/sync", json=body)
    assert response.status_code == 200
    stats = signed_client.get("/api/v1/health/statistics").json()
    assert stats["metrics"]["steps"]["points"] == {"2020-01-01": 50, day: 1234}
    assert stats["metrics"]["weight"]["points"][day] == 70
    body.update(
        expected_revision=response.json()["revision"],
        batch_id="batch_deletions_1234567890",
        points={"steps": {}, "distance": {}},
        captured_at=now().isoformat(),
    )
    assert (
        signed_client.post("/api/v1/health/connect/sync", json=body).status_code == 200
    )
    assert (
        day
        not in signed_client.get("/api/v1/health/statistics").json()["metrics"][
            "steps"
        ]["points"]
    )
    assert signed_client.delete("/api/v1/health/connect").status_code == 204
    assert signed_client.get("/api/v1/health/statistics").json() == google
    assert (
        signed_client.post("/api/v1/health/connect/sync", json=body).status_code == 409
    )


def test_phone_permission_revocation_and_stale_writes(signed_client):
    config = configure(signed_client)
    body = snapshot(config)
    initial = signed_client.post("/api/v1/health/connect/sync", json=body)
    assert initial.status_code == 200
    body.update(
        expected_revision=initial.json()["revision"],
        batch_id="batch_revoked_1234567890",
        permissions=[],
        points={},
        captured_at=now().isoformat(),
    )
    response = signed_client.post("/api/v1/health/connect/sync", json=body)
    assert response.status_code == 200, response.text
    assert signed_client.get("/api/v1/health/statistics").json()["metrics"]["steps"][
        "stale"
    ]
    disabled = configure(signed_client, enabled=False)
    cached = signed_client.get("/api/v1/health/statistics").json()["metrics"]["steps"]
    assert cached["stale"] and cached["points"][body["dates"][-1]] == 1234
    assert signed_client.get("/api/v1/health/status").json()["connected"]
    body.update(
        expected_revision=disabled["revision"], batch_id="batch_late_1234567890"
    )
    assert (
        signed_client.post("/api/v1/health/connect/sync", json=body).status_code == 409
    )


def test_phone_snapshot_validation_and_conflicts(signed_client):
    config = configure(signed_client, metrics=["steps"])
    body = snapshot(config)
    assert (
        signed_client.post("/api/v1/health/connect/sync", json=body).status_code == 422
    )
    body.update(permissions=["steps"], points={"steps": {body["dates"][-1]: 100}})
    for patch in (
        {"timezone": "Unknown/Zone"},
        {"captured_at": (now() - timedelta(days=1)).isoformat()},
        {"owner": "another-user"},
        {"dates": body["dates"][:-1]},
        {"points": {"steps": {body["dates"][-1]: -1}}},
        {"points": {"steps": {body["dates"][-1]: 1.5}}},
    ):
        assert (
            signed_client.post(
                "/api/v1/health/connect/sync", json={**body, **patch}
            ).status_code
            == 422
        )
    assert (
        signed_client.post(
            "/api/v1/health/connect/sync",
            json={**body, "device_id": "another_phone_identifier_123456789012345"},
        ).status_code
        == 409
    )
    assert (
        signed_client.put(
            "/api/v1/health/connect",
            json={
                "expected_revision": 0,
                "device_id": DEVICE,
                "metrics": ["steps"],
                "timezone": "UTC",
            },
        ).status_code
        == 409
    )
