from datetime import timedelta
from zoneinfo import ZoneInfo
from app.core import now
from app.health_connect import KINDS


def snapshot(client):
    config = client.get("/api/v1/health/connect").json()
    response = client.put(
        "/api/v1/health/connect",
        json={
            "expected_revision": config["revision"],
            "device_id": "samsung_test_device_identifier_1234567890",
            "metrics": list(KINDS),
            "timezone": "Europe/London",
        },
    )
    assert response.status_code == 200, response.text
    stamp = now()
    today = stamp.astimezone(ZoneInfo("Europe/London")).date()
    dates = [(today - timedelta(days=i)).isoformat() for i in range(27, -1, -1)]
    return {
        "expected_revision": response.json()["revision"],
        "device_id": "samsung_test_device_identifier_1234567890",
        "batch_id": "samsung_metrics_batch_1234567890",
        "timezone": "Europe/London",
        "captured_at": stamp.isoformat(),
        "dates": dates,
        "changes_token": "private-samsung-cursor",
    }


def test_samsung_metrics_and_derived_workout_hours(signed_client):
    body = snapshot(signed_client)
    day = body["dates"][-1]
    values = {
        "steps": 7000,
        "distance": 5.25,
        "weight": 82.4,
        "calories": 480,
        "workout_minutes": 90,
        "heart_rate": 68,
        "body_fat": 21.5,
        "protein": 125,
        "sodium": 2200,
        "systolic": 120,
        "diastolic": 80,
    }
    body.update(
        permissions=list(values), points={k: {day: v} for k, v in values.items()}
    )
    response = signed_client.post("/api/v1/health/connect/sync", json=body)
    assert response.status_code == 200, response.text
    data = signed_client.get("/api/v1/health/statistics").json()["metrics"]
    for key, value in values.items():
        assert data[key]["points"][day] == value
    assert data["distance"]["unit"] == "km"
    assert data["weight"]["unit"] == "kg"
    assert data["calories"]["unit"] == "kcal"
    assert data["workout_hours"]["unit"] == "h"
    assert data["workout_hours"]["points"][day] == 1.5
    assert "oxygen" not in data and "sleep" not in data
    assert set(signed_client.get("/api/v1/health/status").json()["groups"]) == {
        "activity",
        "sleep",
        "measurements",
        "nutrition",
    }
    assert (
        signed_client.post("/api/v1/health/connect/sync", json=body).status_code == 200
    )
    assert (
        signed_client.get("/api/v1/health/statistics").json()["metrics"][
            "workout_hours"
        ]["points"][day]
        == 1.5
    )
    body.update(
        expected_revision=response.json()["revision"],
        batch_id="new_permission_batch_123456",
        permissions=["steps"],
        points={"steps": {day: 7001}},
        captured_at=now().isoformat(),
    )
    assert (
        signed_client.post("/api/v1/health/connect/sync", json=body).status_code == 200
    )
    data = signed_client.get("/api/v1/health/statistics").json()["metrics"]
    assert data["weight"]["stale"] and data["weight"]["points"][day] == 82.4


def test_samsung_upload_bounds_and_no_independent_hour_totals(signed_client):
    body = snapshot(signed_client)
    for kind, value in [
        ("weight", 1001),
        ("oxygen", 101),
        ("body_fat", 101),
        ("workout_minutes", 1441),
        ("workout_hours", 2),
    ]:
        invalid = dict(
            body, permissions=[kind], points={kind: {body["dates"][-1]: value}}
        )
        assert (
            signed_client.post("/api/v1/health/connect/sync", json=invalid).status_code
            == 422
        )
