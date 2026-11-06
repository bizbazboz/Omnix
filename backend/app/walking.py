"""Account-owned Health walks computed locally from an imported OSM graph."""

import json
import ssl
import time
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit, urljoin
from xml.etree.ElementTree import Element, SubElement, tostring
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field, model_validator
from .core import redis, now
from .calendar_fetch import normalize_url, PublicHTTPS
from .workspace_settings import load_setting, store_setting
from .walking_map import (
    MAP_PATH,
    DEFAULT_EXTRACT,
    generate_loop,
    import_map,
    map_status,
    search_places,
)


class WalkInput(BaseModel):
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    start_label: str = Field(default="Selected location", max_length=200)
    mode: str = Field(default="distance", pattern="^(distance|time)$")
    distance_km: float = Field(default=5, ge=0.5, le=30, allow_inf_nan=False)
    speed_kmh: float = Field(default=5, ge=1, le=12, allow_inf_nan=False)
    duration_minutes: float = Field(default=60, ge=10, le=360, allow_inf_nan=False)
    seed: int = Field(default=1, ge=0, le=2147483647)

    def target(self):
        return (
            self.distance_km * 1000
            if self.mode == "distance"
            else self.speed_kmh * self.duration_minutes / 60 * 1000
        )

    @model_validator(mode="after")
    def valid_target(self):
        if not 500 <= self.target() <= 30000:
            raise ValueError(
                "Choose a distance or speed/time combination between 0.5 and 30 km"
            )
        return self


class MapConfig(BaseModel):
    name: str = Field(default="Greater London", min_length=1, max_length=100)
    url: str = Field(default=DEFAULT_EXTRACT, max_length=4096)


def installed_status():
    result = map_status()
    raw = redis.get("walking-map-progress")
    result["import_status"] = (
        json.loads(raw) if raw else {"state": "idle", "message": ""}
    )
    return result


def download_and_import():
    with redis.lock("walking-map-import", timeout=900, blocking_timeout=1):
        config = load_setting("walking-map", MapConfig().model_dump())
        folder = MAP_PATH.parent
        folder.mkdir(parents=True, exist_ok=True)
        target = folder / "source.osm.pbf"
        partial = folder / "source.osm.pbf.part"

        def progress(state, message):
            redis.set(
                "walking-map-progress",
                json.dumps({"state": state, "message": message}),
                ex=900,
            )

        try:
            progress("downloading", "Downloading regional OpenStreetMap data")
            url = config["url"]
            deadline = time.monotonic() + 300
            for _ in range(4):
                url = normalize_url(url)
                parsed = urlsplit(url)
                connection = PublicHTTPS(
                    parsed.hostname, timeout=20, context=ssl.create_default_context()
                )
                try:
                    connection.request(
                        "GET",
                        urlunsplit(("", "", parsed.path, parsed.query, "")),
                        headers={
                            "User-Agent": "Omnix/1.0 OSM map import",
                            "Accept-Encoding": "identity",
                        },
                    )
                    response = connection.getresponse()
                    if response.status in (301, 302, 303, 307, 308):
                        url = urljoin(url, response.getheader("Location", ""))
                        continue
                    if (
                        response.status != 200
                        or response.getheader("Content-Encoding", "identity")
                        != "identity"
                    ):
                        raise ValueError("Map download failed")
                    total = 0
                    with partial.open("wb") as output:
                        while chunk := response.read(1024 * 1024):
                            total += len(chunk)
                            if total > 512 * 1024 * 1024 or time.monotonic() > deadline:
                                raise ValueError("Map download exceeds limits")
                            output.write(chunk)
                    partial.replace(target)
                    break
                finally:
                    connection.close()
            else:
                raise ValueError("Too many map redirects")
            progress("importing", "Building the local walking graph and location index")
            result = import_map(target, config["name"])
            progress("ready", "Map ready")
            return result
        except Exception:
            partial.unlink(missing_ok=True)
            progress(
                "error",
                "Map import failed. Check the extract URL or import a smaller regional file.",
            )
            raise RuntimeError("Walking map import failed") from None


def saved_walk(owner):
    return load_setting("health-walk:" + owner) or load_setting("daily-walk:" + owner)


def build_walking_router(authenticated, db_session):
    router = APIRouter(prefix="/api/v1")

    def administrator(user=Depends(authenticated)):
        if not user.is_admin:
            raise HTTPException(403, "Administrator access required")
        return user

    @router.get("/health/walks/map")
    def status(user=Depends(authenticated)):
        return installed_status()

    @router.get("/health/walks/locations")
    def locations(
        q: str = Query(min_length=2, max_length=100), user=Depends(authenticated)
    ):
        try:
            return {
                "items": search_places(q),
                "attribution": "© OpenStreetMap contributors",
            }
        except ValueError as error:
            raise HTTPException(503, str(error)) from None

    @router.get("/health/walks")
    def get_walk(user=Depends(authenticated)):
        return {"route": saved_walk(user.id), "map": installed_status()}

    @router.post("/health/walks")
    def create(value: WalkInput, user=Depends(authenticated), db=Depends(db_session)):
        if not map_status()["ready"]:
            raise HTTPException(
                503, "Install a regional OpenStreetMap file in Integrations first."
            )
        if not redis.set("health-walk-limit:" + user.id, "1", ex=15, nx=True):
            raise HTTPException(
                429,
                "Wait before generating another loop.",
                headers={
                    "Retry-After": str(
                        max(1, redis.ttl("health-walk-limit:" + user.id))
                    )
                },
            )
        lock = redis.lock("health-walk-generation", timeout=60, blocking_timeout=0)
        if not lock.acquire(blocking=False):
            raise HTTPException(
                429,
                "Another loop is being calculated. Try again shortly.",
                headers={"Retry-After": "5"},
            )
        try:
            try:
                route = generate_loop(
                    value.latitude,
                    value.longitude,
                    value.target(),
                    value.seed,
                    value.speed_kmh,
                )
            except ValueError as error:
                raise HTTPException(422, str(error)) from None
            route.update(
                start_label=value.start_label,
                start_latitude=value.latitude,
                start_longitude=value.longitude,
                target_mode=value.mode,
                seed=value.seed,
            )
            store_setting(db, "health-walk:" + user.id, route)
            return route
        finally:
            lock.release()

    @router.get("/health/walks/gpx")
    def gpx(created_at: str = "", user=Depends(authenticated)):
        route = saved_walk(user.id)
        if not route:
            raise HTTPException(404, "Generate a walking loop first.")
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
        name = "Walking loop · " + route.get("start_label", "Selected location")
        description = (
            f"{route['distance_m'] / 1000:.1f} km · "
            f"{round(route['duration_s'] / 60)} min · "
            + route.get("attribution", "© OpenStreetMap contributors · ODbL")
        )
        metadata = SubElement(root, "metadata")
        SubElement(metadata, "name").text = name
        SubElement(metadata, "desc").text = description
        SubElement(metadata, "time").text = route["created_at"]
        coordinates = route["coordinates"]
        SubElement(
            metadata,
            "bounds",
            {
                "minlat": str(min(lat for _, lat in coordinates)),
                "minlon": str(min(lon for lon, _ in coordinates)),
                "maxlat": str(max(lat for _, lat in coordinates)),
                "maxlon": str(max(lon for lon, _ in coordinates)),
            },
        )
        lon, lat = coordinates[0]
        start = SubElement(root, "wpt", {"lat": str(lat), "lon": str(lon)})
        SubElement(start, "name").text = "Start / finish"
        SubElement(start, "desc").text = route.get("start_label", "Selected location")
        track = SubElement(root, "trk")
        SubElement(track, "name").text = name
        SubElement(track, "desc").text = description
        SubElement(track, "type").text = "walking"
        segment = SubElement(track, "trkseg")
        for lon, lat in route["coordinates"]:
            SubElement(segment, "trkpt", {"lat": str(lat), "lon": str(lon)})
        return Response(
            tostring(root, encoding="utf-8", xml_declaration=True),
            media_type="application/gpx+xml",
            headers={
                "Content-Disposition": 'attachment; filename="omnix-walking-loop.gpx"',
                "Cache-Control": "no-store",
            },
        )

    @router.get("/settings/walking-map")
    def get_config(user=Depends(administrator)):
        return {
            **load_setting("walking-map", MapConfig().model_dump()),
            **installed_status(),
        }

    @router.put("/settings/walking-map")
    def put_config(
        value: MapConfig, user=Depends(administrator), db=Depends(db_session)
    ):
        try:
            url = normalize_url(value.url)
            if not urlsplit(url).path.endswith(".osm.pbf"):
                raise ValueError()
        except ValueError:
            raise HTTPException(
                422, "Use a public HTTPS .osm.pbf regional extract URL."
            ) from None
        store_setting(db, "walking-map", {"name": value.name.strip(), "url": url})
        return {"saved": True}

    @router.post("/settings/walking-map/import", status_code=202)
    def start_import(user=Depends(administrator)):
        if not redis.set("walking-map-queued", "1", ex=900, nx=True):
            raise HTTPException(409, "A map import is already queued or running.")
        from .tasks import walking_map_import

        try:
            walking_map_import.delay()
        except Exception:
            redis.delete("walking-map-queued")
            raise HTTPException(503, "Map import could not be queued") from None
        return {"queued": True}

    return router
