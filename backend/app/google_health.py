"""Read-only Google Health v4 data normalization. No diagnosis or inferred readings."""

import math
import json
import time
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
import httpx
from .core import decrypt, encrypt
from .workspace_settings import load_setting

SCOPE_ROOT = "https://www.googleapis.com/auth/googlehealth."
GROUPS = {
    "activity": SCOPE_ROOT + "activity_and_fitness.readonly",
    "nutrition": SCOPE_ROOT + "nutrition.readonly",
    "sleep": SCOPE_ROOT + "sleep.readonly",
    "measurements": SCOPE_ROOT + "health_metrics_and_measurements.readonly",
}
METRICS = {
    "steps": {
        "label": "Steps",
        "unit": "steps",
        "group": "activity",
        "type": "steps",
        "field": "steps",
        "value": "countSum",
        "factor": 1,
    },
    "distance": {
        "label": "Distance",
        "unit": "km",
        "group": "activity",
        "type": "distance",
        "field": "distance",
        "value": "millimetersSum",
        "factor": 1 / 1000000,
    },
    "calories": {
        "label": "Energy",
        "unit": "kcal",
        "group": "activity",
        "type": "total-calories",
        "field": "totalCalories",
        "value": "kcalSum",
        "factor": 1,
    },
    "zone_minutes": {
        "label": "Zone minutes",
        "unit": "min",
        "group": "activity",
        "type": "active-zone-minutes",
        "field": "activeZoneMinutes",
    },
    "sleep": {"label": "Sleep", "unit": "h", "group": "sleep", "type": "sleep"},
    "resting_heart_rate": {
        "label": "Resting heart rate",
        "unit": "bpm",
        "group": "measurements",
        "type": "daily-resting-heart-rate",
    },
    "weight": {
        "label": "Weight",
        "unit": "kg",
        "group": "measurements",
        "type": "weight",
        "field": "weight",
        "value": "weightGramsAvg",
        "factor": 0.001,
    },
}

# Daily summaries only: never fetch location, raw ECG or continuous sensor streams.
def roll_metric(label, unit, group, type, field, value, factor=1, **extra):
    return dict(label=label, unit=unit, group=group, type=type, field=field,
                value=value, factor=factor, **extra)


def daily_metric(label, unit, group, type, field, value):
    return roll_metric(label, unit, group, type, field, value, kind="daily")


METRICS.update({
    "active_energy": roll_metric("Active energy", "kcal", "activity", "active-energy-burned", "activeEnergyBurned", "kcalSum"),
    "floors": roll_metric("Floors climbed", "floors", "activity", "floors", "floors", "countSum"),
    "elevation": roll_metric("Elevation gain", "m", "activity", "altitude", "altitude", "gainMillimetersSum", .001),
    "vo2_max": daily_metric("VO₂ max", "ml/kg/min", "activity", "daily-vo2-max", "dailyVo2Max", "vo2Max"),
    "hrv": daily_metric("Heart rate variability", "ms", "measurements", "daily-heart-rate-variability", "dailyHeartRateVariability", "averageHeartRateVariabilityMilliseconds"),
    "oxygen": daily_metric("Blood oxygen", "%", "measurements", "daily-oxygen-saturation", "dailyOxygenSaturation", "averagePercentage"),
    "breathing": daily_metric("Breathing rate", "br/min", "measurements", "daily-respiratory-rate", "dailyRespiratoryRate", "breathsPerMinute"),
    "skin_temperature": daily_metric("Night skin temperature", "°C", "measurements", "daily-sleep-temperature-derivations", "dailySleepTemperatureDerivations", "nightlyTemperatureCelsius"),
    "body_fat": roll_metric("Body fat", "%", "measurements", "body-fat", "bodyFat", "bodyFatPercentageAvg"),
    "glucose": roll_metric("Blood glucose", "mg/dL", "measurements", "blood-glucose", "bloodGlucose", "bloodGlucoseMilligramsPerDeciliterAvg"),
    "calories_in": roll_metric("Food energy", "kcal", "nutrition", "nutrition-log", "nutritionLog", "energy.kcalSum"),
    "carbs": roll_metric("Carbohydrates", "g", "nutrition", "nutrition-log", "nutritionLog", "totalCarbohydrate.gramsSum"),
    "fat": roll_metric("Fat", "g", "nutrition", "nutrition-log", "nutritionLog", "totalFat.gramsSum"),
    "water": roll_metric("Water logged", "L", "nutrition", "hydration-log", "hydrationLog", "amountConsumed.millilitersSum", .001),
})
for key, label, value in [("heart_rate", "Average heart rate", "beatsPerMinuteAvg"),
                          ("heart_rate_min", "Minimum heart rate", "beatsPerMinuteMin"),
                          ("heart_rate_max", "Maximum heart rate", "beatsPerMinuteMax")]:
    METRICS[key] = roll_metric(label, "bpm", "measurements", "heart-rate", "heartRate", value)
for key, label, nutrient, factor, unit in [
    ("protein", "Protein", "PROTEIN", 1, "g"),
    ("fibre", "Fibre", "DIETARY_FIBER", 1, "g"),
    ("sugar", "Sugar", "SUGAR", 1, "g"),
    ("sodium", "Sodium", "SODIUM", 1000, "mg"),
]:
    METRICS[key] = roll_metric(label, unit, "nutrition", "nutrition-log", "nutritionLog", "quantity.gramsSum", factor, nutrient=nutrient)
for key, label, summary, stage in [
    ("sleep_period", "Time in sleep period", "minutesInSleepPeriod", None),
    ("sleep_awake", "Awake during sleep", "minutesAwake", None),
    ("sleep_deep", "Deep sleep", None, "DEEP"),
    ("sleep_light", "Light sleep", None, "LIGHT"),
    ("sleep_rem", "REM sleep", None, "REM"),
    ("sleep_restless", "Restless sleep", None, "RESTLESS"),
]:
    METRICS[key] = dict(label=label, unit="h", group="sleep", type="sleep", summary=summary, stage=stage)
METRICS["workouts"] = dict(label="Workouts", unit="sessions", group="activity", type="exercise", kind="exercise")
METRICS["workout_minutes"] = dict(label="Workout time", unit="min", group="activity", type="exercise", kind="exercise")


def nested(value, path):
    for key in path.split("."):
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


class CachedHealthClient:
    """One sync's bounded in-memory cache; related metrics share one provider read."""
    def __init__(self, client):
        self.client = client
        self.responses = {}
        self.deadline = time.monotonic() + 180

    def request(self, method, url, **kwargs):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise HealthProviderError("limit")
        key = json.dumps([method, url, kwargs], sort_keys=True)
        if key not in self.responses:
            self.responses[key] = self.client.request(method, url, timeout=min(20, remaining), **kwargs)
        return self.responses[key]



class HealthProviderError(Exception):
    def __init__(self, kind="unavailable"):
        self.kind = kind
        super().__init__("Google Health access is unavailable.")


def number(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        result = float(value)
        return result if math.isfinite(result) and result >= 0 else None
    except (ValueError, TypeError):
        return None


def day_key(value):
    try:
        return date(
            int(value["year"]), int(value["month"]), int(value["day"])
        ).isoformat()
    except (ValueError, TypeError, KeyError):
        return None


def civil(value):
    return {"date": {"year": value.year, "month": value.month, "day": value.day}}


def access_token(connection, db):
    creds = decrypt(connection.credentials)
    if creds.get("expires_at", 0) > time.time() + 90:
        return creds["access_token"]
    registration = load_setting("google_health")
    client = creds["oauth_client"]
    if registration and registration["client_id"] == client["client_id"]:
        client = registration
    try:
        response = httpx.post(
            "https://oauth2.googleapis.com/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": creds["refresh_token"],
                "client_id": client["client_id"],
                "client_secret": client["client_secret"],
            },
            timeout=15,
            follow_redirects=False,
        )
        if response.status_code in (400, 401):
            raise HealthProviderError("reconnect")
        response.raise_for_status()
        result = response.json()
        if not result.get("access_token"):
            raise HealthProviderError("reconnect")
        creds.update(
            access_token=result["access_token"],
            expires_at=time.time() + int(result.get("expires_in", 3600)),
            oauth_client={
                "client_id": client["client_id"],
                "client_secret": client["client_secret"],
            },
        )
        if result.get("refresh_token"):
            creds["refresh_token"] = result["refresh_token"]
        db.refresh(connection, with_for_update=True)
        if decrypt(connection.credentials)["generation"] != creds["generation"]:
            raise HealthProviderError("changed")
        connection.credentials = encrypt(creds)
        db.commit()
        return creds["access_token"]
    except HealthProviderError:
        raise
    except Exception:
        raise HealthProviderError() from None


def request_data(client, token, method, path, **kwargs):
    try:
        response = client.request(
            method,
            "https://health.googleapis.com/v4/users/me/dataTypes/" + path,
            headers={"Authorization": "Bearer " + token},
            **kwargs,
        )
        if response.status_code == 401:
            raise HealthProviderError("reconnect")
        if response.status_code == 403:
            raise HealthProviderError("permission")
        if response.status_code == 429:
            raise HealthProviderError("rate_limit")
        response.raise_for_status()
        return response.json()
    except HealthProviderError:
        raise
    except Exception:
        raise HealthProviderError() from None


def rollup(client, token, metric, start, end):
    values = {}
    # Calories has a 14-day maximum. Use one common bounded window for all types.
    while start < end:
        stop = min(end, start + timedelta(days=14))
        page = ""
        for _ in range(8):
            payload = {
                "range": {"start": civil(start), "end": civil(stop)},
                "windowSizeDays": 1,
                "pageSize": 90,
                "dataSourceFamily": "users/me/dataSourceFamilies/all-sources",
            }
            if page:
                payload["pageToken"] = page
            data = request_data(
                client,
                token,
                "POST",
                metric["type"] + "/dataPoints:dailyRollUp",
                json=payload,
                params={
                    "fields": "rollupDataPoints(civilStartTime,"
                    + metric["field"]
                    + "),nextPageToken"
                },
            )
            for point in data.get("rollupDataPoints", []):
                key = day_key(point.get("civilStartTime", {}).get("date", {}))
                fields = point.get(metric["field"])
                if not key or not isinstance(fields, dict):
                    continue
                if metric["type"] == "active-zone-minutes":
                    parts = [
                        number(fields.get(k))
                        for k in (
                            "sumInFatBurnHeartZone",
                            "sumInCardioHeartZone",
                            "sumInPeakHeartZone",
                        )
                    ]
                    value = (
                        sum(v for v in parts if v is not None)
                        if any(v is not None for v in parts)
                        else None
                    )
                else:
                    source = fields
                    if metric.get("nutrient"):
                        source = next((item for item in fields.get("nutrients", []) if item.get("nutrient") == metric["nutrient"]), {})
                    value = number(nested(source, metric["value"]))
                    if value is not None:
                        value *= metric["factor"]
                if value is not None:
                    values[key] = round(value, 4)
            page = data.get("nextPageToken", "")
            if not page:
                break
        else:
            raise HealthProviderError("limit")
        start = stop
    return values


def observations(client, token, metric, start, end, zone):
    is_sleep = metric["type"] == "sleep"
    data_field = "sleep" if is_sleep else metric.get("field", "dailyRestingHeartRate")
    field = "sleep.interval.civil_end_time" if is_sleep else metric["type"].replace("-", "_") + ".date"
    params = {
        "filter": field
        + ' >= "'
        + start.isoformat()
        + '" AND '
        + field
        + ' < "'
        + end.isoformat()
        + '"',
        "pageSize": 25 if metric["type"] == "sleep" else 100,
        "dataSourceFamily": "users/me/dataSourceFamilies/all-sources",
        "fields": "dataPoints(dataPointName,sleep(interval,summary)),nextPageToken" if is_sleep else "dataPoints(dataPointName," + data_field + "),nextPageToken",
    }
    values = {}
    page = ""
    seen = set()
    for _ in range(16):
        if page:
            params["pageToken"] = page
        data = request_data(
            client,
            token,
            "GET",
            metric["type"] + "/dataPoints:reconcile",
            params=params,
        )
        for point in data.get("dataPoints", []):
            item = point.get(
                data_field, {}
            )
            if metric["type"] == "sleep":
                interval = item.get("interval", {})
                identity = point.get("dataPointName") or (
                    interval.get("startTime", ""),
                    interval.get("endTime", ""),
                )
                if identity in seen:
                    continue
                seen.add(identity)
                key = day_key(interval.get("civilEndTime", {}).get("date", {}))
                if not key and interval.get("endTime"):
                    key = (
                        datetime.fromisoformat(
                            interval["endTime"].replace("Z", "+00:00")
                        )
                        .astimezone(ZoneInfo(zone))
                        .date()
                        .isoformat()
                    )
                summary = item.get("summary", {})
                if metric.get("stage"):
                    stage = next((part for part in summary.get("stagesSummary", []) if part.get("type") == metric["stage"]), {})
                    value = number(stage.get("minutes"))
                else:
                    value = number(summary.get(metric.get("summary") or "minutesAsleep"))
                if key and value is not None:
                    values[key] = round(values.get(key, 0) + value / 60, 4)
            else:
                key = day_key(item.get("date", {}))
                value = number(item.get(metric.get("value", "beatsPerMinute")))
                if key and value is not None:
                    values[key] = value
        page = data.get("nextPageToken", "")
        if not page:
            return values
    raise HealthProviderError("limit")


def exercise_records(client, token, start, end, zone):
    records = []
    seen = set()
    params = {
        "filter": f'exercise.interval.civil_start_time >= "{start.isoformat()}" AND exercise.interval.civil_start_time < "{end.isoformat()}"',
        "pageSize": 25,
        "dataSourceFamily": "users/me/dataSourceFamilies/all-sources",
        "fields": "dataPoints(dataPointName,exercise(interval,displayName,exerciseType,activeDuration,metricsSummary)),nextPageToken",
    }
    for _ in range(16):
        response = request_data(client, token, "GET", "exercise/dataPoints:reconcile", params=params)
        for point in response.get("dataPoints", []):
            item = point.get("exercise", {})
            interval = item.get("interval", {})
            identity = point.get("dataPointName") or (interval.get("startTime"), interval.get("endTime"))
            if identity in seen:
                continue
            seen.add(identity)
            key = day_key(interval.get("civilStartTime", {}).get("date", {}))
            if not key and interval.get("startTime"):
                key = datetime.fromisoformat(interval["startTime"].replace("Z", "+00:00")).astimezone(ZoneInfo(zone)).date().isoformat()
            if not key or not start.isoformat() <= key < end.isoformat():
                continue
            duration = item.get("activeDuration", "")
            seconds = number(duration[:-1]) if isinstance(duration, str) and duration.endswith("s") else None
            summary = item.get("metricsSummary", {})
            records.append({
                "day": key, "start": interval.get("startTime"), "end": interval.get("endTime"),
                "name": str(item.get("displayName") or item.get("exerciseType", "Workout").replace("_", " ").title())[:160],
                "minutes": round(seconds / 60, 2) if seconds is not None else None,
                "distance": number(summary.get("distanceMillimeters")),
                "calories": number(summary.get("caloriesKcal")),
                "heart_rate": number(summary.get("averageHeartRateBeatsPerMinute")),
                "steps": number(summary.get("steps")),
            })
            if records[-1]["distance"] is not None:
                records[-1]["distance"] /= 1000000
        page = response.get("nextPageToken")
        if not page:
            return records
        params["pageToken"] = page
    raise HealthProviderError("limit")


def collect_statistics(token, scopes, start, end, zone, previous=None):
    result = {}
    failures = 0
    with httpx.Client(timeout=20, follow_redirects=False) as transport:
        client = CachedHealthClient(transport)
        for key, metric in METRICS.items():
            base = {k: metric[k] for k in ("label", "unit", "group")}
            if GROUPS[metric["group"]] not in scopes:
                result[key] = {**base, "status": "not_shared", "points": {}}
                continue
            try:
                extra = {}
                if metric.get("kind") == "exercise":
                    records = exercise_records(client, token, start, end, zone)
                    values = {}
                    for record in records:
                        value = 1 if key == "workouts" else record["minutes"]
                        if value is not None:
                            values[record["day"]] = round(values.get(record["day"], 0) + value, 4)
                    if key == "workouts":
                        extra["records"] = records
                else:
                    values = (
                        observations(client, token, metric, start, end, zone)
                        if metric["type"] in ("sleep", "daily-resting-heart-rate") or metric.get("kind") == "daily"
                        else rollup(client, token, metric, start, end)
                    )
                values = {
                    k: v
                    for k, v in values.items()
                    if start.isoformat() <= k < end.isoformat()
                }
                result[key] = {
                    **base,
                    "status": "ready" if values else "empty",
                    "points": values,
                    **extra,
                }
            except HealthProviderError as error:
                if error.kind == "reconnect":
                    raise
                old = (previous or {}).get(key, {})
                result[key] = {
                    **base,
                    "status": "error",
                    "reason": error.kind,
                    "points": old.get("points", {}),
                    "stale": bool(old.get("points")),
                    **({"records": old.get("records", [])} if key == "workouts" else {}),
                }
                failures += 1
    return result, failures
