from datetime import datetime, timedelta, timezone
from unittest.mock import Mock
import json
import pytest
from sqlalchemy import select
from app.core import CalendarFeed, Session, User, encrypt, decrypt, now
from app.calendar_parse import parse_events
from app.calendar_fetch import normalize_url, PublicHTTPS, fetch_calendar, MAX_BYTES
from app.calendars import sync_feed


ICAL = """BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Omnix//Test//EN
BEGIN:VEVENT
UID:recurring
DTSTART;TZID=Europe/London:20261024T100000
DTEND;TZID=Europe/London:20261024T110000
RRULE:FREQ=DAILY;COUNT=4
EXDATE;TZID=Europe/London:20261025T100000
SUMMARY:Daily meeting
END:VEVENT
BEGIN:VEVENT
UID:all-day
DTSTART;VALUE=DATE:20261026
DTEND;VALUE=DATE:20261028
SUMMARY:Away
END:VEVENT
BEGIN:VEVENT
UID:cancelled
DTSTART:20261027T120000Z
STATUS:CANCELLED
SUMMARY:Cancelled
END:VEVENT
END:VCALENDAR"""


def test_recurrence_exclusions_dst_and_all_day():
    events = parse_events(
        ICAL, "Europe/London", datetime(2026, 10, 23, tzinfo=timezone.utc)
    )
    repeated = [e for e in events if e["uid"] == "recurring"]
    assert [e["start"] for e in repeated] == [
        "2026-10-24T10:00:00+01:00",
        "2026-10-26T10:00:00+00:00",
        "2026-10-27T10:00:00+00:00",
    ]
    all_day = next(e for e in events if e["all_day"])
    assert all_day["start"] == "2026-10-26" and all_day["end"] == "2026-10-28"
    assert not any(e["uid"] == "cancelled" for e in events)


def test_recurrence_override_and_floating_time():
    raw = ICAL.replace("EXDATE;TZID=Europe/London:20261025T100000", "")
    raw = raw.replace(
        "END:VCALENDAR",
        """BEGIN:VEVENT
UID:recurring
RECURRENCE-ID;TZID=Europe/London:20261026T100000
DTSTART;TZID=Europe/London:20261026T140000
DTEND;TZID=Europe/London:20261026T150000
SUMMARY:Moved
END:VEVENT
BEGIN:VEVENT
UID:floating
DTSTART:20261026T160000
DTEND:20261026T170000
SUMMARY:Floating
END:VEVENT
END:VCALENDAR""",
    )
    events = parse_events(
        raw, "Europe/London", datetime(2026, 10, 23, tzinfo=timezone.utc)
    )
    assert any(e["title"] == "Moved" and "T14:00:" in e["start"] for e in events)
    assert not any(
        e["uid"] == "recurring" and e["start"].startswith("2026-10-26T10:")
        for e in events
    )
    assert next(e for e in events if e["uid"] == "floating")["start"].endswith("+00:00")


@pytest.mark.parametrize(
    "url",
    [
        "http://example.com/a",
        "https://u:p@example.com/a",
        "https://example.com:8000/a",
        "file:///etc/passwd",
        "https://example.com/a\nheader",
    ],
)
def test_invalid_subscription_urls(url):
    with pytest.raises(ValueError):
        normalize_url(url)


def test_webcal_and_private_dns_pinning(monkeypatch):
    assert normalize_url("webcal://example.com/secret") == "https://example.com/secret"
    monkeypatch.setattr(
        "socket.getaddrinfo", lambda *a, **k: [(2, 1, 6, "", ("127.0.0.1", 443))]
    )
    connect = Mock()
    monkeypatch.setattr("socket.create_connection", connect)
    with pytest.raises(ValueError):
        PublicHTTPS("calendar.example").connect()
    connect.assert_not_called()


def test_redirect_revalidation_and_size_limit(monkeypatch):
    response = Mock(status=302)
    response.getheader.return_value = "http://127.0.0.1/metadata"
    connection = Mock()
    connection.getresponse.return_value = response
    monkeypatch.setattr("app.calendar_fetch.PublicHTTPS", lambda *a, **k: connection)
    with pytest.raises(ValueError):
        fetch_calendar("https://example.com/feed")
    response.status = 200
    response.getheader.return_value = "identity"
    response.read.return_value = b"x" * 65536
    with pytest.raises(ValueError):
        fetch_calendar("https://example.com/feed")
    assert response.read.call_count <= MAX_BYTES // 65536 + 1


def test_feed_crud_is_private_and_encrypted(signed_client, user, monkeypatch):
    queued = Mock()
    monkeypatch.setattr("app.tasks.calendar_sync.delay", queued)
    payload = {"label": "Work", "url": "webcal://example.com/private-token.ics"}
    created = signed_client.post("/api/v1/calendar/feeds", json=payload)
    assert created.status_code == 201, created.text
    feed = created.json()
    assert "private-token" not in created.text and "url" not in feed
    with Session() as db:
        stored = db.get(CalendarFeed, feed["id"])
        assert "private-token" not in stored.url
        assert decrypt(stored.url)["url"].startswith("https://")
        other = User(
            issuer="id", subject="other", name="Other", email="other@example.com"
        )
        db.add(other)
        db.flush()
        private = CalendarFeed(
            owner=other.id,
            label="Private",
            url=encrypt({"url": "https://example.com/other"}),
        )
        db.add(private)
        db.commit()
        other_id = private.id
    assert len(signed_client.get("/api/v1/calendar/feeds").json()) == 1
    assert signed_client.post("/api/v1/calendar/feeds", json=payload).status_code == 409
    assert signed_client.delete("/api/v1/calendar/feeds/" + other_id).status_code == 404
    assert (
        signed_client.post(
            "/api/v1/calendar/feeds/" + other_id + "/refresh"
        ).status_code
        == 404
    )
    assert (
        signed_client.post(
            "/api/v1/calendar/feeds/" + feed["id"] + "/refresh"
        ).status_code
        == 202
    )
    assert (
        signed_client.post(
            "/api/v1/calendar/feeds/" + feed["id"] + "/refresh"
        ).status_code
        == 429
    )
    assert (
        signed_client.delete("/api/v1/calendar/feeds/" + feed["id"]).status_code == 204
    )
    assert signed_client.get("/api/v1/calendar/feeds").json() == []


def test_calendar_requires_auth(client):
    assert client.get("/api/v1/calendar/feeds").status_code == 401
    assert client.get("/api/v1/calendar/events").status_code == 401


def test_calendar_date_ranges_include_history_and_timezone_overlap(signed_client, user):
    start = datetime(2026, 10, 24, 23, 30, tzinfo=timezone.utc)
    end = start + timedelta(hours=2)
    item = {
        "title": "Overnight",
        "start": start.isoformat(),
        "end": end.isoformat(),
        "start_ts": start.timestamp(),
        "end_ts": end.timestamp(),
        "all_day": False,
    }
    with Session() as db:
        db.add(
            CalendarFeed(
                owner=user.id,
                label="Work",
                url=encrypt({"url": "https://example.com/feed"}),
                events=encrypt([item]),
            )
        )
        db.commit()
    path = "/api/v1/calendar/events"
    response = signed_client.get(
        path,
        params={
            "start": "2026-10-25",
            "end": "2026-10-26",
            "timezone": "Europe/London",
        },
    )
    assert response.status_code == 200 and response.json()[0]["title"] == "Overnight"
    assert (
        signed_client.get(
            path,
            params={
                "start": "2026-10-26",
                "end": "2026-10-27",
                "timezone": "Europe/London",
            },
        ).json()
        == []
    )
    for params in [
        {"start": "2026-10-25"},
        {"start": "2026-10-25", "end": "2026-10-25"},
        {"start": "2026-01-01", "end": "2027-01-01"},
        {"start": "2026-10-25", "end": "2026-10-26", "timezone": "Invalid/Zone"},
    ]:
        assert signed_client.get(path, params=params).status_code == 422


def test_calendar_parser_respects_explicit_cache_window():
    start = datetime(2026, 10, 1, tzinfo=timezone.utc)
    stop = datetime(2026, 10, 26, tzinfo=timezone.utc)
    events = parse_events(ICAL, "Europe/London", start, stop)
    assert events and all(e["start_ts"] < stop.timestamp() for e in events)
    assert all(e["start"][:10] < "2026-10-26" for e in events)


def test_agenda_merges_owned_feeds_in_time_order(signed_client, user):
    def event(title, offset):
        start = now() + timedelta(days=offset)
        end = start + timedelta(hours=1)
        return {
            "title": title,
            "start_ts": start.timestamp(),
            "end_ts": end.timestamp(),
            "start": start.isoformat(),
            "end": end.isoformat(),
            "all_day": False,
        }

    with Session() as db:
        other = User(
            issuer="id", subject="private", name="Private", email="other@example.com"
        )
        db.add(other)
        db.flush()
        for owner, label, items in [
            (user.id, "Work", [event("Later", 3), event("Expired", -2)]),
            (user.id, "Home", [event("First", 1)]),
            (other.id, "Private", [event("Secret", 2)]),
        ]:
            db.add(
                CalendarFeed(
                    owner=owner,
                    label=label,
                    url=encrypt({"url": "https://example.com/feed"}),
                    events=encrypt(items),
                )
            )
        db.commit()
    result = signed_client.get("/api/v1/calendar/events?days=7").json()
    assert [e["title"] for e in result] == ["First", "Later"]
    assert [e["calendar"] for e in result] == ["Home", "Work"]


def test_scheduler_dispatches_only_due_feeds(user, monkeypatch):
    from app.tasks import dispatch_calendars

    queued = Mock()
    monkeypatch.setattr("app.tasks.calendar_sync.delay", queued)
    with Session() as db:
        recent = CalendarFeed(
            owner=user.id,
            label="Recent",
            url=encrypt({"url": "https://example.com/1"}),
            last_attempt=now(),
        )
        due = CalendarFeed(
            owner=user.id,
            label="Due",
            url=encrypt({"url": "https://example.com/2"}),
            last_attempt=now() - timedelta(minutes=16),
        )
        db.add_all([recent, due])
        db.commit()
        id = due.id
    dispatch_calendars()
    queued.assert_called_once_with(id)


def test_calendar_requires_csrf(signed_client):
    assert (
        signed_client.post(
            "/api/v1/calendar/feeds",
            headers={"X-CSRF-Token": "bad"},
            json={"label": "x", "url": "https://example.com"},
        ).status_code
        == 403
    )


def test_sync_caches_events_and_retains_them_on_failure(
    signed_client, user, monkeypatch
):
    with Session() as db:
        feed = CalendarFeed(
            owner=user.id,
            label="Work",
            url=encrypt({"url": "https://example.com/private"}),
        )
        db.add(feed)
        db.commit()
        id = feed.id
    start = now() + timedelta(days=1)
    event = {
        "uid": "one",
        "title": "Tomorrow",
        "location": "Desk",
        "all_day": False,
        "start": start.isoformat(),
        "end": (start + timedelta(hours=1)).isoformat(),
        "start_ts": start.timestamp(),
        "end_ts": (start + timedelta(hours=1)).timestamp(),
    }
    monkeypatch.setattr("app.calendars.fetch_calendar", lambda url: ICAL.encode())
    # Use the real resource-limited subprocess for the fixture calendar too.
    assert sync_feed(id)
    with Session() as db:
        feed = db.get(CalendarFeed, id)
        assert feed.status == "ready" and isinstance(decrypt(feed.events), list)
        feed.events = encrypt([event])
        feed.last_attempt = now() - timedelta(minutes=20)
        db.commit()
    monkeypatch.setattr(
        "app.calendars.fetch_calendar", Mock(side_effect=ValueError("private-token"))
    )
    assert sync_feed(id) is False
    feeds = signed_client.get("/api/v1/calendar/feeds").json()
    assert feeds[0]["status"] == "error" and "private-token" not in json.dumps(feeds)
    events = signed_client.get("/api/v1/calendar/events?days=7").json()
    assert events[0]["title"] == "Tomorrow"
    assert signed_client.get("/api/v1/calendar/events?days=365").status_code == 422
