"""Private configurable news, weather, TfL status and road-following walking loops."""

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
from xml.etree.ElementTree import Element, SubElement, tostring

import bleach
from defusedxml.ElementTree import fromstring
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, SecretStr, model_validator
from .core import Session, now, redis, uid
from .calendar_fetch import normalize_url
from .daily_fetch import fetch_json, fetch_public
from .workspace_settings import load_setting, store_setting

TFL = "https://api.tfl.gov.uk/Line/Mode/tube,dlr,overground,elizabeth-line,tram/Status"
WEATHER = "https://api.open-meteo.com/v1/forecast"
WALKS = "https://api.openrouteservice.org/v2/directions/foot-walking/geojson"


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


class WalkSource(BaseModel):
    endpoint: str = Field(default=WALKS, max_length=4096)
    api_key: SecretStr = SecretStr("")


class DailySettings(BaseModel):
    news: list[NewsSource] = Field(default_factory=list, max_length=12)
    weather: WeatherSource = Field(default_factory=WeatherSource)
    transport: TransportSource = Field(default_factory=TransportSource)
    walks: WalkSource = Field(default_factory=WalkSource)
    widgets: list[Literal["news", "weather", "transport", "walks"]] = Field(
        default_factory=lambda: ["news", "weather", "transport", "walks"], max_length=4
    )
    clear_keys: list[Literal["weather", "transport", "walks"]] = Field(
        default_factory=list, max_length=3
    )


def defaults():
    value = DailySettings().model_dump(exclude={"clear_keys"})
    for name in ("weather", "transport", "walks"):
        value[name]["api_key"] = ""
    return value


def settings(owner):
    return load_setting("daily:" + owner, defaults())


def public_settings(value):
    value = copy.deepcopy(value)
    for name in ("weather", "transport", "walks"):
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


class WalkInput(BaseModel):
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    distance_km: float = Field(default=5, ge=1, le=30, allow_inf_nan=False)
    seed: int = Field(default=1, ge=0, le=2147483647)


def generate_walk(config, value):
    payload = {
        "coordinates": [[value.longitude, value.latitude]],
        "instructions": True,
        "options": {
            "round_trip": {
                "length": round(value.distance_km * 1000),
                "points": 3,
                "seed": value.seed,
            }
        },
    }
    data = fetch_json(
        config["endpoint"],
        payload=payload,
        headers={"Authorization": config["api_key"]} if config["api_key"] else {},
    )
    feature = data["features"][0]
    coordinates = feature["geometry"]["coordinates"]
    summary = feature["properties"]["summary"]
    if (
        feature["geometry"]["type"] != "LineString"
        or not 4 <= len(coordinates) <= 50000
    ):
        raise ValueError("Invalid walking geometry")
    coords = []
    for point in coordinates:
        lon, lat = point[:2]
        if (
            not isinstance(lon, (int, float))
            or not isinstance(lat, (int, float))
            or not math.isfinite(lon)
            or not math.isfinite(lat)
            or not -180 <= lon <= 180
            or not -90 <= lat <= 90
        ):
            raise ValueError("Invalid coordinates")
        coords.append([lon, lat])

    def metres(a, b):
        lat1, lat2 = math.radians(a[1]), math.radians(b[1])
        dlat, dlon = lat2 - lat1, math.radians(b[0] - a[0])
        hav = (
            math.sin(dlat / 2) ** 2
            + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
        )
        return 6371000 * 2 * math.asin(math.sqrt(min(1, hav)))

    # Allow snapping to a nearby path, but never accept a loop elsewhere.
    if (
        metres(coords[0], coords[-1]) > 100
        or metres(coords[0], [value.longitude, value.latitude]) > 500
    ):
        raise ValueError("Provider did not return a loop")
    distance, duration = float(summary["distance"]), float(summary["duration"])
    if not 0 < distance <= 100000 or not 0 < duration <= 172800:
        raise ValueError("Invalid walking summary")
    steps = [
        text(step.get("instruction"), 500)
        for segment in feature["properties"].get("segments", [])
        for step in segment.get("steps", [])
    ][:500]
    return {
        "coordinates": coords,
        "distance_m": distance,
        "duration_s": duration,
        "steps": steps,
        "created_at": now().isoformat(),
        "requested_km": value.distance_km,
        "attribution": text(
            data.get("metadata", {}).get("attribution")
            or "openrouteservice · OpenStreetMap contributors",
            500,
        ),
    }


def build_daily_router(authenticated, db_session):
    router = APIRouter(prefix="/api/v1")

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
            for name in ("weather", "transport", "walks"):
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
            "walks": load_setting("daily-walk:" + user.id),
            "walks_configured": bool(
                config["walks"]["api_key"] or config["walks"]["endpoint"] != WALKS
            ),
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
            if result["walks"]:
                result["walks"] = {**result["walks"], "coordinates": [], "steps": []}
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

    @router.post("/daily/walks")
    def walk(value: WalkInput, user=Depends(authenticated), db=Depends(db_session)):
        config = settings(user.id)["walks"]
        if config["endpoint"] == WALKS and not config["api_key"]:
            raise HTTPException(422, "Configure your walking provider in Integrations.")
        if not redis.set("daily-walk-limit:" + user.id, "1", ex=15, nx=True):
            raise HTTPException(429, "Wait 15 seconds before generating another route.")
        try:
            route = generate_walk(config, value)
        except Exception:
            raise HTTPException(
                502,
                "The walking provider could not generate a loop. Check the source, start point and distance.",
            ) from None
        store_setting(db, "daily-walk:" + user.id, route)
        return route

    @router.get("/daily/walks/gpx")
    def gpx(created_at: str = "", user=Depends(authenticated)):
        route = load_setting("daily-walk:" + user.id)
        if not route:
            raise HTTPException(404, "Generate a walking route first.")
        if created_at and created_at != route["created_at"]:
            raise HTTPException(
                409, "The saved route changed. Reload before downloading."
            )
        root = Element(
            "gpx",
            {
                "version": "1.1",
                "creator": "Omnix",
                "xmlns": "http://www.topografix.com/GPX/1/1",
            },
        )
        track = SubElement(root, "trk")
        SubElement(track, "name").text = "Omnix walking loop"
        segment = SubElement(track, "trkseg")
        for lon, lat in route["coordinates"]:
            SubElement(segment, "trkpt", {"lat": str(lat), "lon": str(lon)})
        return Response(
            tostring(root, encoding="utf-8", xml_declaration=True),
            media_type="application/gpx+xml",
            headers={
                "Content-Disposition": 'attachment; filename="omnix-walking-loop.gpx"'
            },
        )

    return router
