"""Private subscription feeds and a cached, merged agenda."""

import json
import heapq
import subprocess
import sys
from datetime import timedelta, date, datetime, time
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from urllib.parse import urlsplit
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, SecretStr
from sqlalchemy import select
from sqlalchemy.orm import load_only
from .core import CalendarFeed, User, Session, encrypt, decrypt, now, redis
from .calendar_identity import event_identity
from .calendar_fetch import normalize_url, fetch_calendar
from .workspace_settings import preferences


def feed_json(feed):
    return {
        "id": feed.id,
        "label": feed.label,
        "host": urlsplit(decrypt(feed.url)["url"]).hostname,
        "status": feed.status,
        "error": feed.error,
        "last_sync": feed.last_sync,
    }


def sync_feed(feed_id):
    with (
        redis.lock("calendar-sync:" + feed_id, timeout=100, blocking_timeout=1),
        Session() as db,
    ):
        feed = db.get(CalendarFeed, feed_id)
        if not feed:
            return True
        if feed.last_attempt and (now() - feed.last_attempt).total_seconds() < 55:
            return True
        feed.last_attempt = now()
        try:
            raw = fetch_calendar(decrypt(feed.url)["url"])
            user = db.get(User, feed.owner)
            payload = {
                "ical": raw.decode("utf-8-sig"),
                "timezone": preferences(user).get("timezone") or "UTC",
                "start": (now() - timedelta(days=370)).isoformat(),
                "end": (now() + timedelta(days=370)).isoformat(),
            }
            parsed = subprocess.run(
                [sys.executable, "-m", "app.calendar_parse"],
                input=json.dumps(payload),
                text=True,
                capture_output=True,
                timeout=18,
                check=True,
            )
            feed.events = encrypt(json.loads(parsed.stdout))
            feed.status = "ready"
            feed.last_sync = now()
            feed.error = ""
        except Exception:
            feed.status = "error"
            feed.error = "Could not refresh this feed. Check its URL and availability."
        db.commit()
        return feed.status == "ready"


class FeedInput(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    url: SecretStr = Field(min_length=1, max_length=4096)


def build_calendar_router(authenticated, db_session):
    router = APIRouter(prefix="/api/v1/calendar")

    def owned(db, user, id):
        feed = db.get(CalendarFeed, id)
        if not feed or feed.owner != user.id:
            raise HTTPException(404, "Calendar not found")
        return feed

    @router.get("/feeds")
    def feeds(user=Depends(authenticated), db=Depends(db_session)):
        return [
            feed_json(f)
            for f in db.scalars(
                select(CalendarFeed)
                .options(
                    load_only(
                        CalendarFeed.id,
                        CalendarFeed.label,
                        CalendarFeed.url,
                        CalendarFeed.status,
                        CalendarFeed.error,
                        CalendarFeed.last_sync,
                    )
                )
                .where(CalendarFeed.owner == user.id)
                .order_by(CalendarFeed.label)
            )
        ]

    @router.post("/feeds", status_code=201)
    def add(value: FeedInput, user=Depends(authenticated), db=Depends(db_session)):
        from .tasks import calendar_sync

        try:
            url = normalize_url(value.url.get_secret_value())
        except ValueError:
            raise HTTPException(
                422, "Use an HTTPS or webcal subscription URL."
            ) from None
        label = value.label.strip()
        if not label:
            raise HTTPException(422, "Enter a calendar name.")
        # Serialize concurrent additions to keep per-user limits and duplicate checks reliable.
        db.scalar(select(User).where(User.id == user.id).with_for_update())
        current = list(
            db.scalars(
                select(CalendarFeed)
                .options(load_only(CalendarFeed.url))
                .where(CalendarFeed.owner == user.id)
            )
        )
        if len(current) >= 30:
            raise HTTPException(422, "Maximum 30 calendars.")
        if any(decrypt(f.url)["url"] == url for f in current):
            raise HTTPException(409, "This calendar is already subscribed.")
        feed = CalendarFeed(owner=user.id, label=label, url=encrypt({"url": url}))
        db.add(feed)
        db.commit()
        calendar_sync.delay(feed.id)
        return feed_json(feed)

    @router.delete("/feeds/{id}", status_code=204)
    def remove(id: str, user=Depends(authenticated), db=Depends(db_session)):
        db.delete(owned(db, user, id))
        db.commit()

    @router.post("/feeds/{id}/refresh", status_code=202)
    def refresh(id: str, user=Depends(authenticated), db=Depends(db_session)):
        from .tasks import calendar_sync

        feed = owned(db, user, id)
        if not redis.set("calendar-refresh:" + id, "1", ex=60, nx=True):
            raise HTTPException(429, "Wait a minute before refreshing again.")
        calendar_sync.delay(feed.id)
        return {"queued": True}

    @router.get("/events")
    def events(
        days: int = Query(default=30, ge=1, le=90),
        start: date | None = None,
        end: date | None = None,
        timezone: str = Query(default="", max_length=100),
        user=Depends(authenticated),
        db=Depends(db_session),
    ):
        if (start is None) != (end is None):
            raise HTTPException(422, "Provide both start and end dates.")
        if start is not None:
            if not 0 < (end - start).days <= 93:
                raise HTTPException(422, "Choose a calendar range of 1–93 days.")
            try:
                zone = ZoneInfo(timezone or preferences(user).get("timezone") or "UTC")
            except (ZoneInfoNotFoundError, ValueError):
                raise HTTPException(422, "Invalid calendar timezone.") from None
            stop = datetime.combine(end, time(), zone).timestamp()
            start = datetime.combine(start, time(), zone).timestamp()
        else:
            start = now().timestamp()
            stop = (now() + timedelta(days=days)).timestamp()

        def candidates():
            query = (
                select(CalendarFeed)
                .where(CalendarFeed.owner == user.id)
                .options(
                    load_only(CalendarFeed.id, CalendarFeed.label, CalendarFeed.events)
                )
                .execution_options(yield_per=1)
            )
            for feed in db.scalars(query):
                if feed.events:
                    for event in decrypt(feed.events):
                        if event["start_ts"] < stop and (
                            event["end_ts"] > start or event["start_ts"] >= start
                        ):
                            yield {
                                **event,
                                "id": event_identity(feed.id, event),
                                "feed_id": feed.id,
                                "calendar": feed.label,
                            }

        return heapq.nsmallest(
            5000, candidates(), key=lambda event: (event["start_ts"], event["id"])
        )

    return router
