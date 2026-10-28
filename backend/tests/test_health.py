import base64
import hashlib
import json
import time
from datetime import date, timedelta
from types import SimpleNamespace
from urllib.parse import urlparse, parse_qs
from unittest.mock import Mock
import pytest
import httpx
from sqlalchemy import select
from app.core import (
    Session,
    User,
    HealthConnection,
    SystemSetting,
    encrypt,
    decrypt,
    redis,
    now,
)
from app.google_health import (
    GROUPS,
    METRICS,
    rollup,
    observations,
    collect_statistics,
    HealthProviderError,
    number,
)
from app.health import sync_health


@pytest.fixture
def admin_health(signed_client, user):
    with Session() as db:
        db.get(User, user.id).is_admin = True
        db.commit()
    return signed_client


def register(client):
    response = client.put(
        "/api/v1/health/google/registration",
        json={
            "client_id": "123-client.apps.googleusercontent.com",
            "client_secret": "private-google-secret",
        },
    )
    assert response.status_code == 200, response.text


def credentials(scopes=None):
    return {
        "access_token": "private-access-token",
        "refresh_token": "private-refresh-token",
        "expires_at": time.time() + 3600,
        "scopes": scopes if scopes is not None else list(GROUPS.values()),
        "generation": "generation",
        "oauth_client": {
            "client_id": "123-client.apps.googleusercontent.com",
            "client_secret": "private-google-secret",
        },
    }


def connection(user, statistics=None):
    with Session() as db:
        row = HealthConnection(
            owner=user.id,
            credentials=encrypt(credentials()),
            statistics=encrypt(statistics) if statistics else "",
        )
        db.add(row)
        db.commit()
        return row.id


def authorize(client, groups=None):
    response = client.post(
        "/api/v1/health/google/authorize",
        json={"groups": groups or ["activity", "sleep", "measurements"]},
    )
    assert response.status_code == 200, response.text
    return parse_qs(urlparse(response.json()["url"]).query)


def fake_exchange(monkeypatch, scopes=None, during=None):
    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def post(self, url, **kwargs):
            if during:
                during()
            return SimpleNamespace(
                raise_for_status=lambda: None,
                json=lambda: {
                    **credentials(scopes),
                    "expires_in": 3600,
                    "scope": " ".join(
                        scopes if scopes is not None else GROUPS.values()
                    ),
                },
            )

    monkeypatch.setattr("app.health.httpx.AsyncClient", lambda **kwargs: Client())
    monkeypatch.setattr("app.tasks.health_sync.delay", Mock())


def test_health_requires_auth_and_admin(client):
    for path in ("status", "statistics", "google/registration"):
        assert client.get("/api/v1/health/" + path).status_code == 401


def test_registration_is_admin_only_and_secrets_masked(signed_client, admin_health):
    # admin_health shares this client; explicitly remove the role for the first assertion.
    with Session() as db:
        user = db.scalar(select(User).where(User.subject == "alice"))
        user.is_admin = False
        db.commit()
        id = user.id
    assert (
        signed_client.put(
            "/api/v1/health/google/registration",
            json={"client_id": "x", "client_secret": "private"},
        ).status_code
        == 403
    )
    with Session() as db:
        db.get(User, id).is_admin = True
        db.commit()
    register(admin_health)
    response = admin_health.get("/api/v1/health/google/registration")
    assert (
        response.json()["redirect_uri"]
        == "https://app.example.test/api/v1/health/google/callback"
    )
    assert (
        "private-google-secret" not in response.text and response.json()["secret_saved"]
    )
    with Session() as db:
        row = db.get(SystemSetting, "google_health")
        assert "private-google-secret" not in row.value
        assert decrypt(row.value)["client_secret"] == "private-google-secret"
    assert (
        admin_health.put(
            "/api/v1/health/google/registration",
            json={
                "client_id": "123-client.apps.googleusercontent.com",
                "client_secret": "",
            },
        ).status_code
        == 200
    )
    assert (
        admin_health.put(
            "/api/v1/health/google/registration",
            json={
                "client_id": "changed.apps.googleusercontent.com",
                "client_secret": "",
            },
        ).status_code
        == 422
    )


def test_health_statistics_are_owner_scoped(signed_client, user):
    connection(
        user,
        {
            "dates": ["2026-10-28"],
            "metrics": {"steps": {"points": {"2026-10-28": 123}}},
        },
    )
    with Session() as db:
        other = User(
            issuer="other", subject="other", name="Other", email="other@example.com"
        )
        db.add(other)
        db.flush()
        db.add(
            HealthConnection(
                owner=other.id,
                credentials=encrypt(credentials()),
                statistics=encrypt({"private": 99999}),
            )
        )
        db.commit()
    response = signed_client.get("/api/v1/health/statistics")
    assert response.json()["metrics"]["steps"]["points"]["2026-10-28"] == 123
    assert "99999" not in response.text
    assert "private-access-token" not in signed_client.get("/api/v1/health/status").text


def test_authorize_uses_readonly_pkce_and_one_use_state(
    admin_health, user, monkeypatch
):
    register(admin_health)
    params = authorize(admin_health, ["activity"])
    assert params["scope"] == [GROUPS["activity"]]
    assert params["code_challenge_method"] == ["S256"]
    tx = json.loads(redis.get("health-oauth:" + params["state"][0]))
    expected = (
        base64.urlsafe_b64encode(hashlib.sha256(tx["verifier"].encode()).digest())
        .decode()
        .rstrip("=")
    )
    assert params["code_challenge"] == [expected] and tx["user"] == user.id
    fake_exchange(monkeypatch, [GROUPS["activity"]])
    path = (
        "/api/v1/health/google/callback?"
        + urlparse(
            "https://x?state=" + params["state"][0] + "&code=authorization"
        ).query
    )
    response = admin_health.get(path)
    assert (
        response.status_code == 303
        and response.headers["location"] == "/app/health?connect=success"
    )
    assert admin_health.get(path).status_code == 400
    with Session() as db:
        row = db.scalar(
            select(HealthConnection).where(HealthConnection.owner == user.id)
        )
        assert "private-refresh-token" not in row.credentials
        assert decrypt(row.credentials)["scopes"] == [GROUPS["activity"]]


def test_new_consent_invalidates_old_state_and_registration_changes(
    admin_health, monkeypatch
):
    register(admin_health)
    old = authorize(admin_health)
    new = authorize(admin_health)
    fake_exchange(monkeypatch)
    assert (
        admin_health.get(
            "/api/v1/health/google/callback",
            params={"state": old["state"][0], "code": "code"},
        ).status_code
        == 400
    )
    register(admin_health)
    assert (
        admin_health.get(
            "/api/v1/health/google/callback",
            params={"state": new["state"][0], "code": "code"},
        ).status_code
        == 400
    )


def test_consent_session_binding_and_cancel(admin_health, monkeypatch):
    register(admin_health)
    params = authorize(admin_health)
    key = "health-oauth:" + params["state"][0]
    value = json.loads(redis.get(key))
    value["session"] = "different-session"
    redis.set(key, json.dumps(value))
    assert (
        admin_health.get(
            "/api/v1/health/google/callback",
            params={"state": params["state"][0], "code": "code"},
        ).status_code
        == 400
    )
    params = authorize(admin_health)
    response = admin_health.get(
        "/api/v1/health/google/callback",
        params={"state": params["state"][0], "error": "access_denied"},
    )
    assert response.headers["location"] == "/app/health?connect=cancelled"


def test_disconnect_deletes_readings_even_if_revoke_fails(
    signed_client, user, monkeypatch
):
    id = connection(user, {"private_readings": "sensitive"})
    monkeypatch.setattr("app.health.httpx.post", Mock(side_effect=TimeoutError()))
    response = signed_client.delete("/api/v1/health/connection")
    assert response.status_code == 200 and response.json() == {
        "disconnected": True,
        "remote_revoked": False,
    }
    assert signed_client.get("/api/v1/health/statistics").json() == {
        "dates": [],
        "metrics": {},
    }
    with Session() as db:
        assert db.get(HealthConnection, id) is None


def test_rollups_use_civil_windows_and_preserve_true_zero(monkeypatch):
    calls = []

    def request(client, token, method, path, **kwargs):
        calls.append(kwargs["json"])
        value = kwargs["json"]["range"]["start"]["date"]
        return {
            "rollupDataPoints": [
                {"civilStartTime": {"date": value}, "steps": {"countSum": "0"}},
                {"civilStartTime": {"date": {"year": 2026, "month": 10, "day": 2}}},
            ]
        }

    monkeypatch.setattr("app.google_health.request_data", request)
    result = rollup(
        None, "token", METRICS["steps"], date(2026, 10, 1), date(2026, 10, 29)
    )
    assert result == {"2026-10-01": 0, "2026-10-15": 0}
    assert len(calls) == 2 and calls[0]["windowSizeDays"] == 1
    assert calls[0]["dataSourceFamily"] == "users/me/dataSourceFamilies/all-sources"


@pytest.mark.parametrize(
    "key,field,payload,expected",
    [
        ("distance", "distance", {"millimetersSum": "1500000"}, 1.5),
        ("weight", "weight", {"weightGramsAvg": 72500}, 72.5),
        ("calories", "totalCalories", {"kcalSum": 2100}, 2100),
        (
            "zone_minutes",
            "activeZoneMinutes",
            {
                "sumInFatBurnHeartZone": "10",
                "sumInCardioHeartZone": "20",
                "sumInPeakHeartZone": "4",
            },
            34,
        ),
    ],
)
def test_health_units_are_normalized_once(monkeypatch, key, field, payload, expected):
    monkeypatch.setattr(
        "app.google_health.request_data",
        lambda *a, **k: {
            "rollupDataPoints": [
                {
                    "civilStartTime": {"date": {"year": 2026, "month": 10, "day": 1}},
                    field: payload,
                }
            ]
        },
    )
    assert (
        rollup(None, "token", METRICS[key], date(2026, 10, 1), date(2026, 10, 2))[
            "2026-10-01"
        ]
        == expected
    )


def test_sleep_uses_minutes_asleep_and_wake_day_not_session_duration(monkeypatch):
    responses = [
        {
            "dataPoints": [
                {
                    "dataPointName": "sleep-1",
                    "sleep": {
                        "interval": {
                            "startTime": "2026-10-27T22:00:00Z",
                            "endTime": "2026-10-28T07:00:00Z",
                            "civilEndTime": {
                                "date": {"year": 2026, "month": 10, "day": 28}
                            },
                        },
                        "summary": {"minutesAsleep": "420"},
                    },
                }
            ],
            "nextPageToken": "next",
        },
        {
            "dataPoints": [
                {
                    "dataPointName": "nap",
                    "sleep": {
                        "interval": {
                            "startTime": "2026-10-28T12:00:00Z",
                            "endTime": "2026-10-28T13:00:00Z",
                            "civilEndTime": {
                                "date": {"year": 2026, "month": 10, "day": 28}
                            },
                        },
                        "summary": {"minutesAsleep": "30"},
                    },
                }
            ]
        },
    ]

    def request(*args, **kwargs):
        assert "sleep.interval.civil_end_time" in kwargs["params"]["filter"]
        return responses.pop(0)

    monkeypatch.setattr("app.google_health.request_data", request)
    values = observations(
        None,
        "token",
        METRICS["sleep"],
        date(2026, 10, 1),
        date(2026, 10, 29),
        "Europe/London",
    )
    assert values == {"2026-10-28": 7.5}


def test_partial_permissions_and_failed_refresh_never_fabricate_zero(monkeypatch):
    monkeypatch.setattr(
        "app.google_health.rollup", Mock(side_effect=HealthProviderError("permission"))
    )
    monkeypatch.setattr("app.google_health.observations", Mock(side_effect=HealthProviderError("permission")))
    monkeypatch.setattr("app.google_health.exercise_records", Mock(side_effect=HealthProviderError("permission")))
    previous = {"steps": {"points": {"2026-10-28": 8000}}}
    result, failures = collect_statistics(
        "token",
        [GROUPS["activity"]],
        date(2026, 10, 1),
        date(2026, 10, 29),
        "Europe/London",
        previous,
    )
    assert failures == sum(metric["group"] == "activity" for metric in METRICS.values())
    assert (
        result["steps"]["points"] == previous["steps"]["points"]
        and result["steps"]["stale"]
    )
    assert result["sleep"]["status"] == "not_shared" and result["sleep"]["points"] == {}
    assert (
        result["distance"]["points"] == {} and result["distance"]["status"] == "error"
    )
    assert number(float("nan")) is None and number("inf") is None and number(-1) is None


def test_sync_encrypts_cache_and_does_not_resurrect_disconnected_data(
    signed_client, user, monkeypatch
):
    id = connection(user)

    def collect(*args):
        return {
            "steps": {
                "label": "Steps",
                "unit": "steps",
                "group": "activity",
                "status": "ready",
                "points": {now().date().isoformat(): 4321},
            }
        }, 0

    monkeypatch.setattr("app.health.collect_statistics", collect)
    assert sync_health(id)
    with Session() as db:
        row = db.get(HealthConnection, id)
        assert (
            "4321" not in row.statistics
            and decrypt(row.statistics)["metrics"]["steps"]["points"]
        )
        row.last_attempt = now() - timedelta(minutes=31)
        db.commit()

    def deleted(*args):
        with Session() as db:
            db.delete(db.get(HealthConnection, id))
            db.commit()
        return collect()

    monkeypatch.setattr("app.health.collect_statistics", deleted)
    assert sync_health(id)
    with Session() as db:
        assert db.get(HealthConnection, id) is None


def test_manual_refresh_and_scheduler_are_scoped(signed_client, user, monkeypatch):
    from app.tasks import dispatch_health

    id = connection(user)
    queued = Mock()
    monkeypatch.setattr("app.tasks.health_sync.delay", queued)
    assert signed_client.post("/api/v1/health/refresh").status_code == 202
    assert signed_client.post("/api/v1/health/refresh").status_code == 429
    queued.assert_called_once_with(id)
    queued.reset_mock()
    dispatch_health()
    queued.assert_called_once_with(id)


def test_disconnect_during_google_exchange_cannot_reconnect(
    admin_health, user, monkeypatch
):
    register(admin_health)
    params = authorize(admin_health)
    fake_exchange(
        monkeypatch, during=lambda: redis.incr("health:oauth-epoch:" + user.id)
    )
    response = admin_health.get(
        "/api/v1/health/google/callback",
        params={"state": params["state"][0], "code": "code"},
    )
    assert response.status_code == 400
    with Session() as db:
        assert (
            db.scalar(select(HealthConnection).where(HealthConnection.owner == user.id))
            is None
        )


def test_token_refresh_cannot_overwrite_a_new_google_grant(user, monkeypatch):
    from app.google_health import access_token

    id = connection(user)
    with Session() as db:
        row = db.get(HealthConnection, id)
        value = decrypt(row.credentials)
        value["expires_at"] = 0
        row.credentials = encrypt(value)
        db.commit()

    def refreshed(*args, **kwargs):
        with Session() as db:
            row = db.get(HealthConnection, id)
            value = credentials()
            value["generation"] = "new-consent"
            value["access_token"] = "new-access"
            row.credentials = encrypt(value)
            db.commit()
        return SimpleNamespace(
            status_code=200,
            raise_for_status=lambda: None,
            json=lambda: {"access_token": "old-refreshed-token", "expires_in": 3600},
        )

    monkeypatch.setattr("app.google_health.httpx.post", refreshed)
    with Session() as db:
        with pytest.raises(HealthProviderError):
            access_token(db.get(HealthConnection, id), db)
    with Session() as db:
        assert (
            decrypt(db.get(HealthConnection, id).credentials)["access_token"]
            == "new-access"
        )


def test_old_sync_cannot_overwrite_new_consent_cache(user, monkeypatch):
    id = connection(user)

    def changed(*args):
        with Session() as db:
            row = db.get(HealthConnection, id)
            value = credentials()
            value["generation"] = "new-consent"
            row.credentials = encrypt(value)
            row.statistics = encrypt({"new-consent": True})
            row.status = "pending"
            db.commit()
        return {"steps": {"status": "ready", "points": {"2026-10-28": 999}}}, 0

    monkeypatch.setattr("app.health.collect_statistics", changed)
    assert sync_health(id)
    with Session() as db:
        row = db.get(HealthConnection, id)
        assert (
            decrypt(row.statistics) == {"new-consent": True} and row.status == "pending"
        )


def test_google_registration_trims_pasted_credentials(admin_health):
    response = admin_health.put(
        "/api/v1/health/google/registration",
        json={"client_id": " 123-client.apps.googleusercontent.com\n", "client_secret": " private-google-secret \r\n"},
    )
    assert response.status_code == 200
    with Session() as db:
        value = decrypt(db.get(SystemSetting, "google_health").value)
        assert value["client_secret"] == "private-google-secret"
        assert value["client_id"] == "123-client.apps.googleusercontent.com"


@pytest.mark.parametrize("reason,expected", [
    ("invalid_client", "client ID or secret"),
    ("invalid_grant", "start a new connection"),
    ("redirect_uri_mismatch", "exact callback"),
    ("invalid_scope", "Health permissions"),
    ("private-unknown-error", "could not complete the token exchange"),
])
def test_callback_explains_allowlisted_errors_without_leaking_provider_body(
    admin_health, user, monkeypatch, reason, expected
):
    register(admin_health)
    params = authorize(admin_health)
    fake_exchange(monkeypatch)
    response = httpx.Response(
        400,
        json={"error": reason, "error_description": "private-provider-secret"},
        request=httpx.Request("POST", "https://oauth2.googleapis.com/token"),
    )
    class Client:
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            pass
        async def post(self, *args, **kwargs):
            return response
    monkeypatch.setattr("app.health.httpx.AsyncClient", lambda **kwargs: Client())
    result = admin_health.get(
        "/api/v1/health/google/callback",
        params={"state": params["state"][0], "code": "private-authorization-code"},
    )
    assert result.status_code == 502 and expected in result.json()["detail"]
    for private in ("private-provider-secret", "private-authorization-code", "private-google-secret", "private-unknown-error"):
        assert private not in result.text
    with Session() as db:
        assert db.scalar(select(HealthConnection).where(HealthConnection.owner == user.id)) is None


@pytest.mark.parametrize("key,payload,expected", [
    ("active_energy", {"activeEnergyBurned": {"kcalSum": 420}}, 420),
    ("floors", {"floors": {"countSum": "0"}}, 0),
    ("elevation", {"altitude": {"gainMillimetersSum": "150000"}}, 150),
    ("body_fat", {"bodyFat": {"bodyFatPercentageAvg": 23.4}}, 23.4),
    ("glucose", {"bloodGlucose": {"bloodGlucoseMilligramsPerDeciliterAvg": 97}}, 97),
    ("heart_rate_max", {"heartRate": {"beatsPerMinuteMax": 145}}, 145),
    ("calories_in", {"nutritionLog": {"energy": {"kcalSum": 1900}}}, 1900),
    ("carbs", {"nutritionLog": {"totalCarbohydrate": {"gramsSum": 210}}}, 210),
    ("water", {"hydrationLog": {"amountConsumed": {"millilitersSum": 2300}}}, 2.3),
    ("protein", {"nutritionLog": {"nutrients": [{"nutrient": "PROTEIN", "quantity": {"gramsSum": 70}}]}}, 70),
    ("sodium", {"nutritionLog": {"nutrients": [{"nutrient": "SODIUM", "quantity": {"gramsSum": 1.7}}]}}, 1700),
])
def test_expanded_rollups_use_provider_units(monkeypatch, key, payload, expected):
    monkeypatch.setattr("app.google_health.request_data", lambda *args, **kwargs: {"rollupDataPoints": [{"civilStartTime": {"date": {"year":2026,"month":10,"day":28}}, **payload}]})
    assert rollup(None, "token", METRICS[key], date(2026,10,28), date(2026,10,29)) == {"2026-10-28":expected}


@pytest.mark.parametrize("key,field,value,expected", [
    ("hrv", "dailyHeartRateVariability", "averageHeartRateVariabilityMilliseconds", 42.7),
    ("oxygen", "dailyOxygenSaturation", "averagePercentage", 97.2),
    ("breathing", "dailyRespiratoryRate", "breathsPerMinute", 15.4),
    ("vo2_max", "dailyVo2Max", "vo2Max", 43.5),
    ("skin_temperature", "dailySleepTemperatureDerivations", "nightlyTemperatureCelsius", 33.2),
])
def test_daily_vitals_use_supported_fields(monkeypatch, key, field, value, expected):
    def request(*args, **kwargs):
        assert "dataPointName" in kwargs["params"]["fields"]
        assert kwargs["params"]["filter"].startswith(METRICS[key]["type"].replace("-", "_") + ".date")
        return {"dataPoints": [{field: {"date": {"year":2026,"month":10,"day":28}, value:expected}}]}
    monkeypatch.setattr("app.google_health.request_data", request)
    assert observations(None,"token",METRICS[key],date(2026,10,28),date(2026,10,29),"UTC") == {"2026-10-28":expected}


def test_sleep_stages_preserve_missing_and_deduplicate_sessions(monkeypatch):
    point={"dataPointName":"sleep-1","sleep":{"interval":{"civilEndTime":{"date":{"year":2026,"month":10,"day":28}}},"summary":{"minutesAsleep":"420","stagesSummary":[{"type":"DEEP","minutes":"90"},{"type":"REM","minutes":"0"}]}}}
    monkeypatch.setattr("app.google_health.request_data",lambda *args,**kwargs:{"dataPoints":[point,point]})
    assert observations(None,"token",METRICS["sleep_deep"],date(2026,10,28),date(2026,10,29),"UTC")=={"2026-10-28":1.5}
    assert observations(None,"token",METRICS["sleep_rem"],date(2026,10,28),date(2026,10,29),"UTC")=={"2026-10-28":0}
    assert observations(None,"token",METRICS["sleep_light"],date(2026,10,28),date(2026,10,29),"UTC")=={}


def test_expanded_metrics_share_reads_and_respect_deadline(monkeypatch):
    from app.google_health import CachedHealthClient
    transport=Mock()
    cached=CachedHealthClient(transport)
    cached.request("GET","https://health.googleapis.com/test",params={"a":1})
    cached.request("GET","https://health.googleapis.com/test",params={"a":1})
    transport.request.assert_called_once()
    cached.deadline=0
    with pytest.raises(HealthProviderError):
        cached.request("GET","https://health.googleapis.com/test2")


def test_workout_summaries_are_bounded_and_exclude_private_notes(monkeypatch):
    from app.google_health import exercise_records
    point={"dataPointName":"workout-1","exercise":{"displayName":"Walking","activeDuration":"1800s","notes":"private-note","interval":{"civilStartTime":{"date":{"year":2026,"month":10,"day":28}},"startTime":"2026-10-28T08:00:00Z","endTime":"2026-10-28T08:30:00Z"},"metricsSummary":{"distanceMillimeters":2500000,"caloriesKcal":150,"averageHeartRateBeatsPerMinute":"100"}}}
    def request(*args,**kwargs):
        assert "notes" not in kwargs["params"]["fields"] and "location" not in kwargs["params"]["fields"]
        return {"dataPoints":[point,point]}
    monkeypatch.setattr("app.google_health.request_data",request)
    records=exercise_records(None,"token",date(2026,10,28),date(2026,10,29),"UTC")
    assert len(records)==1 and records[0]["minutes"]==30 and records[0]["distance"]==2.5
    assert "private-note" not in json.dumps(records)


def test_nutrition_requires_explicit_consent(admin_health):
    register(admin_health)
    params=authorize(admin_health,["nutrition"])
    assert params["scope"]==[GROUPS["nutrition"]]
    response=admin_health.post("/api/v1/health/google/authorize",json={"groups":["activity","sleep","measurements","nutrition"]})
    assert response.status_code==200
