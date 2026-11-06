"""Daily sources never cross account boundaries or require a live provider in CI."""

import copy
import json
import pytest
from defusedxml.common import DefusedXmlException
from app import daily
from app.core import Session, SystemSetting, User, encrypt, decrypt
from app.workspace_settings import store_setting, load_setting

RSS = b"""<rss version="2.0"><channel><item><title>Headline</title><link>https://news.example.test/story</link><description>&lt;b&gt;Summary&lt;/b&gt;</description><pubDate>Thu, 05 Nov 2026 12:00:00 GMT</pubDate></item><item><title>Unsafe</title><link>javascript:alert(1)</link></item></channel></rss>"""


@pytest.fixture(autouse=True)
def no_broker(monkeypatch):
    from app.tasks import daily_sync

    monkeypatch.setattr(daily_sync, "delay", lambda *args: None)


def configured(signed_client):
    value = daily.defaults()
    value["news"] = [
        {"id": "feed-one", "name": "My news", "url": "https://news.example.test/feed"}
    ]
    value["weather"].update(
        enabled=True, label="London", latitude=51.5, longitude=-0.12
    )
    value["weather"]["api_key"] = "private-routing-key"
    assert signed_client.put("/api/v1/settings/daily", json=value).status_code == 200
    return value


def test_rss_atom_and_unsafe_links():
    source = {"id": "a", "name": "News", "url": "https://news.example.test/feed"}
    items = daily.news_items(source, RSS)
    assert len(items) == 1 and items[0]["summary"] == "Summary"
    assert items[0]["published"].startswith("2026-11-05T12:00")
    atom = b'<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom</title><link href="/article"/><updated>2026-11-05T12:00:00Z</updated></entry></feed>'
    assert (
        daily.news_items(source, atom)[0]["url"] == "https://news.example.test/article"
    )
    with pytest.raises(DefusedXmlException):
        daily.news_items(
            source,
            b'<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss><channel/></rss>',
        )
    with pytest.raises(ValueError):
        daily.news_items(source, b"<html/>")


def test_settings_are_encrypted_redacted_and_private(signed_client, user):
    configured(signed_client)
    with Session() as db:
        row = db.get(SystemSetting, "daily:" + user.id)
        assert "private-routing-key" not in row.value
        assert decrypt(row.value)["weather"]["api_key"] == "private-routing-key"
        other = User(
            issuer="test", subject="other", name="Other", email="other@example.test"
        )
        db.add(other)
        db.commit()
        hidden = daily.defaults()
        hidden["news"] = [
            {
                "id": "hidden",
                "name": "Other private feed",
                "url": "https://hidden.example.test/rss",
            }
        ]
        store_setting(db, "daily:" + other.id, hidden)
    result = signed_client.get("/api/v1/settings/daily").json()
    assert result["weather"]["key_configured"] is True
    assert "api_key" not in result["weather"]
    assert "Other private feed" not in json.dumps(result)
    assert signed_client.get("/api/v1/health/walks/gpx").status_code == 404


def test_key_retained_cleared_and_not_forwarded_to_changed_source(signed_client):
    value = configured(signed_client)
    value["weather"]["api_key"] = ""
    assert signed_client.put("/api/v1/settings/daily", json=value).json()["weather"][
        "key_configured"
    ]
    value["weather"]["endpoint"] = "https://router.example.test/route"
    assert not signed_client.put("/api/v1/settings/daily", json=value).json()[
        "weather"
    ]["key_configured"]
    value["weather"]["api_key"] = "new-key"
    assert signed_client.put("/api/v1/settings/daily", json=value).json()["weather"][
        "key_configured"
    ]
    value["clear_keys"] = ["weather"]
    assert not signed_client.put("/api/v1/settings/daily", json=value).json()[
        "weather"
    ]["key_configured"]


@pytest.mark.parametrize(
    "url",
    [
        "http://example.test/rss",
        "https://user:secret@example.test/rss",
        "https://example.test:8080/rss",
        "file:///etc/passwd",
    ],
)
def test_source_url_constraints(signed_client, url):
    value = daily.defaults()
    value["news"] = [{"id": "one", "name": "News", "url": url}]
    assert signed_client.put("/api/v1/settings/daily", json=value).status_code == 422


def test_refresh_retains_good_data_filters_lines_and_invalidates_changed_sources(
    signed_client, user, monkeypatch
):
    value = configured(signed_client)
    monkeypatch.setattr(
        daily,
        "load_news",
        lambda config: {
            "feeds": [
                {
                    "id": "feed-one",
                    "name": "My news",
                    "items": daily.news_items(config[0], RSS),
                    "error": "",
                }
            ]
        },
    )
    monkeypatch.setattr(
        daily, "load_weather", lambda config: {"temperature": 12, "label": "London"}
    )
    lines = [
        {
            "id": "central",
            "name": "Central",
            "mode": "tube",
            "statuses": [
                {
                    "severity": 9,
                    "description": "Minor delays",
                    "reason": "Earlier incident",
                }
            ],
        },
        {
            "id": "victoria",
            "name": "Victoria",
            "mode": "tube",
            "statuses": [{"severity": 10, "description": "Good service", "reason": ""}],
        },
    ]
    monkeypatch.setattr(
        daily, "load_transport", lambda config: {"lines": lines, "attribution": "TfL"}
    )
    daily.refresh_daily(user.id)
    before = signed_client.get("/api/v1/daily").json()
    assert before["news"]["data"]["feeds"][0]["items"][0]["title"] == "Headline"

    def fail(config):
        raise RuntimeError("provider-secret-must-not-escape")

    monkeypatch.setattr(daily, "load_weather", fail)
    daily.refresh_daily(user.id, force=True)
    after = signed_client.get("/api/v1/daily").json()
    assert after["weather"]["data"] == before["weather"]["data"]
    assert after["weather"]["last_sync"] == before["weather"]["last_sync"]
    assert after["weather"]["error"] and "provider-secret" not in json.dumps(after)
    # Filtering is applied to the current user's cached catalogue.
    value["transport"].update(lines=["central"], all_lines=False)
    assert signed_client.put("/api/v1/settings/daily", json=value).status_code == 200
    # A changed selection gets a new cache version, never misleading old data.
    assert signed_client.get("/api/v1/daily").json()["transport"]["data"] is None
    daily.refresh_daily(user.id, force=True)
    selected = signed_client.get("/api/v1/daily").json()["transport"]["data"]
    assert [line["id"] for line in selected["lines"]] == ["central"]
    assert len(selected["available_lines"]) == 2
    value["weather"]["label"] = "New location"
    assert signed_client.put("/api/v1/settings/daily", json=value).status_code == 200
    assert signed_client.get("/api/v1/daily").json()["weather"]["data"] is None


def test_weather_and_tfl_protocol(monkeypatch):
    calls = []

    def fake(url, **kwargs):
        calls.append(url)
        if "forecast" in url:
            return {
                "current": {"temperature_2m": 11, "weather_code": 3},
                "daily": {
                    "time": ["2026-11-05"],
                    "temperature_2m_max": [12],
                    "temperature_2m_min": [5],
                    "precipitation_probability_max": [30],
                    "weather_code": [3],
                },
            }
        return [
            {
                "id": "central",
                "name": "Central",
                "lineStatuses": [
                    {
                        "statusSeverity": 9,
                        "statusSeverityDescription": "Minor delays",
                        "reason": "<b>Incident</b>",
                    }
                ],
            }
        ]

    monkeypatch.setattr(daily, "fetch_json", fake)
    value = daily.defaults()
    value["weather"].update(latitude=51.5, longitude=-0.12, label="London")
    result = daily.load_weather(value["weather"])
    assert result["days"][0]["rain"] == 30 and result["temperature"] == 11
    assert "latitude=51.5" in calls[0] and "forecast_days=7" in calls[0]
    result = daily.load_transport(value["transport"])
    assert result["lines"][0]["statuses"][0]["reason"] == "Incident"


def test_daily_tokens_can_read_data_but_never_provider_keys(signed_client, client):
    configured(signed_client)
    token = signed_client.post(
        "/api/v1/settings/api-tokens", json={"name": "Daily reader"}
    ).json()["token"]
    headers = {"Authorization": "Bearer " + token}
    assert client.get("/api/v1/daily", headers=headers).status_code == 200
    assert client.get("/api/v1/settings/daily", headers=headers).status_code == 403
    assert client.post("/api/v1/daily/refresh", headers=headers).status_code == 403


def test_geocoding_and_line_catalog_are_bounded_and_cached(signed_client, monkeypatch):
    calls = []

    def fake(url, **kwargs):
        calls.append(url)
        if "geocoding-api" in url:
            return {
                "results": [
                    {
                        "id": 1,
                        "name": "London",
                        "admin1": "England",
                        "country": "UK",
                        "latitude": 51.5,
                        "longitude": -0.12,
                    }
                ]
            }
        return [
            {
                "id": "central",
                "name": "Central",
                "lineStatuses": [
                    {"statusSeverity": 10, "statusSeverityDescription": "Good service"}
                ],
            }
        ]

    monkeypatch.setattr(daily, "fetch_json", fake)
    assert (
        signed_client.get("/api/v1/daily/locations?q=London").json()["items"][0][
            "label"
        ]
        == "London, England, UK"
    )
    signed_client.get("/api/v1/daily/locations?q=London")
    assert len(calls) == 1
    assert signed_client.get("/api/v1/daily/transport/catalog").json()["items"] == [
        {"id": "central", "name": "Central"}
    ]
    signed_client.get("/api/v1/daily/transport/catalog")
    assert len(calls) == 2


def test_legacy_walking_config_is_never_returned_or_shown_on_home(signed_client, user):
    value = daily.defaults()
    value["widgets"] = ["news", "walks"]
    value["walks"] = {"api_key": "obsolete-key", "endpoint": "https://old.example.test"}
    with Session() as db:
        store_setting(db, "daily:" + user.id, value)
    result = signed_client.get("/api/v1/settings/daily").json()
    assert "walks" not in result and result["widgets"] == ["news"]
    result = signed_client.get("/api/v1/daily").json()
    assert "walks" not in result and result["widgets"] == ["news"]
