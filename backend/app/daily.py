"""Private configurable news, weather, TfL status and weather-location search."""

import copy
import hashlib
import json
import math
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from typing import Literal
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode, urljoin

import bleach
from defusedxml.ElementTree import fromstring
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, SecretStr, model_validator
from .core import Session, now, redis, uid, encrypt, decrypt
from .calendar_fetch import normalize_url
from .daily_fetch import fetch_json, fetch_public
from .workspace_settings import load_setting, store_setting

TFL = "https://api.tfl.gov.uk/Line/Mode/tube,dlr,overground,elizabeth-line,tram/Status"
WEATHER = "https://api.open-meteo.com/v1/forecast"


class NewsSource(BaseModel):
    id: str = Field(default_factory=uid, pattern=r"^[a-zA-Z0-9_-]{1,80}$")
    name: str = Field(min_length=1, max_length=80)
    url: str = Field(min_length=1, max_length=4096)


class WeatherSource(BaseModel):
    enabled: bool = False
    label: str = Field(default="", max_length=80)
    latitude: float | None = Field(default=None, ge=-90, le=90, allow_inf_nan=False)
    longitude: float | None = Field(default=None, ge=-180, le=180, allow_inf_nan=False)
    endpoint: str = Field(default=WEATHER, max_length=4096)
    api_key: SecretStr = SecretStr("")
    temperature_unit: Literal["celsius", "fahrenheit"] = "celsius"

    @model_validator(mode="after")
    def location(self):
        if self.enabled and (
            self.latitude is None or self.longitude is None or not self.label.strip()
        ):
            raise ValueError("Choose a location name, latitude and longitude")
        return self


class TransportSource(BaseModel):
    enabled: bool = True
    endpoint: str = Field(default=TFL, max_length=4096)
    api_key: SecretStr = SecretStr("")
    lines: list[str] = Field(default_factory=list, max_length=50)
    all_lines: bool = True


class DailySettings(BaseModel):
    news: list[NewsSource] = Field(default_factory=list, max_length=12)
    weather: WeatherSource = Field(default_factory=WeatherSource)
    transport: TransportSource = Field(default_factory=TransportSource)
    widgets: list[Literal["news", "weather", "transport"]] = Field(
        default_factory=lambda: ["news", "weather", "transport"], max_length=3
    )
    clear_keys: list[Literal["weather", "transport"]] = Field(
        default_factory=list, max_length=3
    )


def defaults():
    value = DailySettings().model_dump(exclude={"clear_keys"})
    for name in ("weather", "transport"):
        value[name]["api_key"] = ""
    return value


def settings(owner):
    value = load_setting("daily:" + owner, defaults())
    value.pop("walks", None)
    value["widgets"] = [
        name
        for name in value.get("widgets", [])
        if name in ("news", "weather", "transport")
    ]
    return value


def public_settings(value):
    value = copy.deepcopy(value)
    for name in ("weather", "transport"):
        value[name]["key_configured"] = bool(value[name].pop("api_key", ""))
    return value


def query_url(url, params):
    parsed = urlsplit(url)
    return urlunsplit(
        (
            parsed.scheme,
            parsed.netloc,
            parsed.path,
            urlencode(dict(parse_qsl(parsed.query)) | params),
            "",
        )
    )


def text(value, limit=500):
    return re.sub(
        r"\s+", " ", unescape(bleach.clean(str(value or ""), tags=[], strip=True))
    ).strip()[:limit]


def link(value, base=""):
    value = urljoin(base, value or "")
    parsed = urlsplit(value)
    return (
        value
        if parsed.scheme in ("https", "http")
        and parsed.hostname
        and not parsed.username
        and not parsed.password
        else ""
    )


def news_items(source, raw):
    root = fromstring(raw, forbid_dtd=True)
    atom = "{http://www.w3.org/2005/Atom}"
    if root.tag == atom + "feed":
        entries = root.findall(atom + "entry")
    elif root.tag in ("rss", "{http://purl.org/rss/1.0/}RDF"):
        entries = root.findall("./channel/item") or root.findall(
            "{http://purl.org/rss/1.0/}item"
        )
    else:
        raise ValueError("Use an RSS or Atom feed")
    result = []
    for entry in entries[:60]:

        def field(*names):
            for name in names:
                child = entry.find(name)
                if child is not None:
                    return "".join(child.itertext())
            return ""

        href = field("link", "{http://purl.org/rss/1.0/}link")
        for child in entry.findall(atom + "link"):
            if child.get("rel", "alternate") == "alternate":
                href = child.get("href", "")
                break
        href = link(href, source["url"])
        title = text(
            field("title", atom + "title", "{http://purl.org/rss/1.0/}title"), 250
        )
        if not href or not title:
            continue
        published = field(
            "pubDate",
            atom + "published",
            atom + "updated",
            "{http://purl.org/dc/elements/1.1/}date",
        )
        try:
            date = (
                parsedate_to_datetime(published)
                if "," in published
                else datetime.fromisoformat(published.replace("Z", "+00:00"))
            )
            published = (
                date.replace(tzinfo=date.tzinfo or timezone.utc)
                .astimezone(timezone.utc)
                .isoformat()
            )
        except (ValueError, TypeError, OverflowError):
            published = None
        result.append(
            {
                "id": hashlib.sha256(href.encode()).hexdigest()[:24],
                "source_id": source["id"],
                "source": source["name"],
                "title": title,
                "url": href,
                "summary": text(
                    field("description", atom + "summary", atom + "content"), 400
                ),
                "published": published,
            }
        )
    return result


def load_news(config):
    def read(source):
        try:
            return {
                "id": source["id"],
                "name": source["name"],
                "items": news_items(
                    source,
                    fetch_public(
                        source["url"],
                        accept="application/rss+xml, application/atom+xml, application/xml",
                    ),
                ),
                "error": "",
            }
        except Exception:
            return {
                "id": source["id"],
                "name": source["name"],
                "items": [],
                "error": "Feed could not refresh",
            }

    with ThreadPoolExecutor(max_workers=4) as pool:
        return {"feeds": list(pool.map(read, config))}


def load_weather(config):
    params = {
        "latitude": config["latitude"],
        "longitude": config["longitude"],
        "current": "temperature_2m,apparent_temperature,weather_code,wind_speed_10m",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
        "forecast_days": 7,
        "timezone": "auto",
        "temperature_unit": config["temperature_unit"],
        "wind_speed_unit": "kmh",
    }
    if config["api_key"]:
        params["apikey"] = config["api_key"]
    data = fetch_json(query_url(config["endpoint"], params))
    current, daily = data["current"], data["daily"]
    if not isinstance(current.get("temperature_2m"), (int, float)) or not isinstance(
        daily.get("time"), list
    ):
        raise ValueError("Invalid forecast response")

    def number(value):
        return (
            value if isinstance(value, (int, float)) and math.isfinite(value) else None
        )

    return {
        "label": config["label"],
        "source": urlsplit(config["endpoint"]).hostname,
        "unit": "°F" if config["temperature_unit"] == "fahrenheit" else "°C",
        "temperature": number(current["temperature_2m"]),
        "feels_like": number(current.get("apparent_temperature")),
        "code": number(current.get("weather_code")),
        "wind": number(current.get("wind_speed_10m")),
        "time": text(current.get("time"), 40),
        "days": [
            {
                "date": day,
                **{
                    name: number(daily.get(key, [None] * len(daily["time"]))[i])
                    for name, key in [
                        ("high", "temperature_2m_max"),
                        ("low", "temperature_2m_min"),
                        ("rain", "precipitation_probability_max"),
                        ("code", "weather_code"),
                    ]
                },
            }
            for i, day in enumerate(daily["time"][:7])
        ],
    }


def load_transport(config):
    url = (
        query_url(config["endpoint"], {"app_key": config["api_key"]})
        if config["api_key"]
        else config["endpoint"]
    )
    rows = fetch_json(url)
    if not isinstance(rows, list) or len(rows) > 100:
        raise ValueError("Invalid TfL status response")
    result = []
    for row in rows:
        statuses = row.get("lineStatuses") or []
        result.append(
            {
                "id": text(row["id"], 100),
                "name": text(row["name"], 100),
                "mode": text(row.get("modeName"), 40),
                "statuses": [
                    {
                        "severity": int(s.get("statusSeverity", 0)),
                        "description": text(s.get("statusSeverityDescription"), 100),
                        "reason": text(s.get("reason"), 2000),
                    }
                    for s in statuses[:10]
                ],
            }
        )
    return {
        "lines": sorted(result, key=lambda row: row["name"]),
        "attribution": "Transport for London",
    }


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def refresh_daily(owner, force=False):
    with redis.lock("daily-sync:" + owner, timeout=230, blocking_timeout=1):
        config = settings(owner)
        cache = load_setting("daily-cache:" + owner, {})
        for name, fetch, enabled, ttl in [
            ("news", load_news, bool(config["news"]), 900),
            ("weather", load_weather, config["weather"]["enabled"], 900),
            ("transport", load_transport, config["transport"]["enabled"], 60),
        ]:
            if not enabled:
                continue
            previous = cache.get(name, {})
            stamp = now().timestamp()
            version = fingerprint(config[name])
            if (
                not force
                and previous.get("version") == version
                and stamp - previous.get("attempt", 0) < ttl
            ):
                continue
            entry = dict(previous) if previous.get("version") == version else {}
            entry.update(attempt=stamp, version=version)
            try:
                data = fetch(config[name])
                if name == "news":
                    old_feeds = {
                        feed["id"]: feed
                        for feed in entry.get("data", {}).get("feeds", [])
                    }
                    for feed in data["feeds"]:
                        if feed["error"] and feed["id"] in old_feeds:
                            feed["items"] = old_feeds[feed["id"]].get("items", [])
                    if all(feed["error"] for feed in data["feeds"]):
                        raise ValueError("Feeds unavailable")
                entry.update(data=data, last_sync=now().isoformat(), error="")
            except Exception:
                entry["error"] = (
                    "Source could not refresh. Check its configuration and availability."
                )
            # Do not publish a response for a source changed during this request.
            if fingerprint(settings(owner)[name]) != version:
                continue
            with Session() as db:
                latest = load_setting("daily-cache:" + owner, {})
                latest[name] = entry
                store_setting(db, "daily-cache:" + owner, latest)


def build_daily_router(authenticated, db_session):
    router = APIRouter(prefix="/api/v1")

    @router.get("/daily/locations")
    def locations(
        q: str = Query(min_length=3, max_length=100), user=Depends(authenticated)
    ):
        key = (
            "weather-location:"
            + hashlib.sha256(q.strip().casefold().encode()).hexdigest()
        )
        cached = redis.get(key)
        if cached:
            return json.loads(cached)
        try:
            data = fetch_json(
                query_url(
                    "https://geocoding-api.open-meteo.com/v1/search",
                    {"name": q, "count": 8, "language": "en", "format": "json"},
                )
            )
            items = []
            for row in data.get("results", [])[:8]:
                lat, lon = float(row["latitude"]), float(row["longitude"])
                if not -90 <= lat <= 90 or not -180 <= lon <= 180:
                    continue
                label = ", ".join(
                    dict.fromkeys(
                        str(row.get(name, ""))
                        for name in ("name", "admin1", "country")
                        if row.get(name)
                    )
                )
                items.append(
                    {
                        "id": str(row["id"]),
                        "label": label,
                        "name": str(row["name"]),
                        "detail": str(row.get("country", "")),
                        "latitude": lat,
                        "longitude": lon,
                    }
                )
        except Exception:
            raise HTTPException(
                502, "Location search is unavailable. Try again shortly."
            ) from None
        result = {"items": items, "attribution": "GeoNames / Open-Meteo"}
        redis.set(key, json.dumps(result), ex=86400)
        return result

    @router.get("/daily/transport/catalog")
    def transport_catalog(user=Depends(authenticated)):
        config = settings(user.id)["transport"]
        key = "tfl-catalog:" + user.id + ":" + fingerprint(config)
        cached = redis.get(key)
        if cached:
            return decrypt(cached)
        try:
            rows = load_transport(config)["lines"]
        except Exception:
            raise HTTPException(
                502,
                "Line choices could not load. Check the transport source and try again.",
            ) from None
        result = {"items": [{"id": row["id"], "name": row["name"]} for row in rows]}
        redis.set(key, encrypt(result), ex=900)
        return result

    @router.get("/settings/daily")
    def get_settings(user=Depends(authenticated)):
        return public_settings(settings(user.id))

    @router.put("/settings/daily")
    def put_settings(
        value: DailySettings, user=Depends(authenticated), db=Depends(db_session)
    ):
        old = settings(user.id)
        result = value.model_dump(exclude={"clear_keys"})
        try:
            for feed in result["news"]:
                feed["url"] = normalize_url(feed["url"])
                feed["name"] = feed["name"].strip()
                if not feed["name"]:
                    raise ValueError("Feed name required")
            if len({feed["id"] for feed in result["news"]}) != len(
                result["news"]
            ) or len({feed["url"] for feed in result["news"]}) != len(result["news"]):
                raise ValueError("Duplicate feeds")
            for name in ("weather", "transport"):
                result[name]["endpoint"] = normalize_url(result[name]["endpoint"])
                submitted = getattr(value, name).api_key.get_secret_value()
                if len(submitted) > 4096 or "\r" in submitted or "\n" in submitted:
                    raise ValueError("Invalid API key")
                result[name]["api_key"] = (
                    ""
                    if name in value.clear_keys
                    else submitted
                    or (
                        old[name].get("api_key", "")
                        if result[name]["endpoint"] == old[name]["endpoint"]
                        else ""
                    )
                )
            if any(
                not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", line)
                for line in result["transport"]["lines"]
            ):
                raise ValueError("Invalid line ID")
        except ValueError:
            raise HTTPException(
                422,
                "Use unique named feeds, public HTTPS source URLs and valid API keys/line IDs.",
            ) from None
        store_setting(db, "daily:" + user.id, result)
        from .tasks import daily_sync

        daily_sync.delay(user.id)
        return public_settings(result)

    @router.get("/daily")
    def overview(summary: bool = False, user=Depends(authenticated)):
        config = settings(user.id)
        cache = load_setting("daily-cache:" + user.id, {})
        result = {
            "widgets": config["widgets"],
            "configured": bool(load_setting("daily:" + user.id)),
        }
        for name in ("news", "weather", "transport"):
            entry = cache.get(name, {})
            if entry.get("version") != fingerprint(config[name]):
                entry = {}
            result[name] = {
                "data": entry.get("data"),
                "last_sync": entry.get("last_sync"),
                "error": entry.get("error", ""),
                "enabled": (
                    bool(config["news"]) if name == "news" else config[name]["enabled"]
                ),
            }
        if result["transport"]["data"]:
            data = copy.deepcopy(result["transport"]["data"])
            data["available_lines"] = [
                {"id": line["id"], "name": line["name"]} for line in data["lines"]
            ]
            if not config["transport"].get("all_lines", True):
                data["lines"] = [
                    line
                    for line in data["lines"]
                    if line["id"] in config["transport"]["lines"]
                ]
            result["transport"]["data"] = data
        if summary:
            if result["news"]["data"]:
                result["news"]["data"] = copy.deepcopy(result["news"]["data"])
                for feed in result["news"]["data"]["feeds"]:
                    feed["items"] = sorted(
                        feed["items"],
                        key=lambda item: item.get("published") or "",
                        reverse=True,
                    )[:3]
            if result["transport"]["data"]:
                result["transport"]["data"]["available_lines"] = []
                for line in result["transport"]["data"]["lines"]:
                    for status in line["statuses"]:
                        status["reason"] = ""
        return result

    @router.post("/daily/refresh", status_code=202)
    def refresh(user=Depends(authenticated)):
        if not redis.set("daily-refresh:" + user.id, "1", ex=60, nx=True):
            raise HTTPException(429, "Wait a minute before refreshing again.")
        from .tasks import daily_sync

        daily_sync.delay(user.id, True)
        return {"queued": True}

    return router
