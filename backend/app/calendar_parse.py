"""Parse untrusted iCalendar in a separate, resource-limited worker subprocess."""

import json
import sys
from datetime import datetime, date, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from icalendar import Calendar
import recurring_ical_events


def parse_events(raw, zone, start, stop=None):
    calendar = Calendar.from_ical(raw)
    if calendar.name != "VCALENDAR":
        raise ValueError("Not a calendar")
    try:
        tz = ZoneInfo(str(calendar.get("X-WR-TIMEZONE", zone)))
    except ZoneInfoNotFoundError:
        tz = ZoneInfo(zone)
    stop = stop or start + timedelta(days=185)

    def instant(value):
        if not isinstance(value, datetime):
            return datetime.combine(value, time(), tz)
        return value if value.tzinfo else value.replace(tzinfo=tz)

    results = []
    for event in recurring_ical_events.of(calendar).after(start):
        begin = event.decoded("DTSTART")
        end = event.decoded("DTEND", begin)
        if instant(begin) >= stop:
            break
        if str(event.get("STATUS", "")).upper() == "CANCELLED":
            continue
        all_day = isinstance(begin, date) and not isinstance(begin, datetime)
        results.append(
            {
                "uid": str(event.get("UID", ""))[:500],
                "title": str(event.get("SUMMARY", "Untitled event"))[:500],
                "location": str(event.get("LOCATION", ""))[:500],
                "description": str(event.get("DESCRIPTION", ""))[:4000],
                "start": begin.isoformat() if all_day else instant(begin).isoformat(),
                "end": end.isoformat() if all_day else instant(end).isoformat(),
                "all_day": all_day,
                "start_ts": instant(begin).timestamp(),
                "end_ts": instant(end).timestamp(),
            }
        )
        if len(results) > 5000:
            raise ValueError("Too many events")
    return results


if __name__ == "__main__":
    import resource

    resource.setrlimit(resource.RLIMIT_CPU, (12, 12))
    resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
    payload = json.load(sys.stdin)
    try:
        print(
            json.dumps(
                parse_events(
                    payload["ical"],
                    payload["timezone"],
                    datetime.fromisoformat(payload["start"]),
                    datetime.fromisoformat(payload["end"])
                    if payload.get("end")
                    else None,
                )
            )
        )
    except Exception:
        sys.exit(1)
