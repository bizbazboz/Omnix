from datetime import timedelta
import json
from sqlalchemy import select
from app.core import (
    Session,
    Connection,
    Message,
    CalendarFeed,
    NotePage,
    NoteProject,
    User,
    encrypt,
    decrypt,
    now,
)
from app.calendar_identity import event_identity

BASE = "/api/v1/notes"


def seed(user):
    with Session() as db:
        account = Connection(
            owner=user.id,
            provider="imap",
            label="Work",
            address="me@example.test",
            credentials=encrypt({}),
            status="ready",
        )
        db.add(account)
        db.flush()
        message = Message(
            mailbox=account.id,
            provider_id="ref-one",
            sender="sender@example.test",
            sender_name="Sender",
            recipients="me@example.test",
            subject="Reference email",
            body="Cached body",
            html="<style>.secret{display:none}</style><script>secret()</script><p>Safe preview</p>",
        )
        date = now() + timedelta(days=2)
        event = {
            "uid": "recurring-ref",
            "title": "Reference meeting",
            "description": "Agenda",
            "location": "Studio",
            "start": date.isoformat(),
            "end": (date + timedelta(hours=1)).isoformat(),
            "start_ts": date.timestamp(),
            "end_ts": (date + timedelta(hours=1)).timestamp(),
            "all_day": False,
        }
        feed = CalendarFeed(
            owner=user.id,
            label="Work calendar",
            url=encrypt({"url": "https://example.test/private"}),
            events=encrypt([event]),
        )
        db.add_all([message, feed])
        db.commit()
        return account.id, message.id, feed.id, event


def create(client, path, payload):
    response = client.post(BASE + path, json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def test_reference_authentication(client):
    assert client.get(BASE + "/references?kind=mail").status_code == 401
    assert (
        client.get(BASE + "/references/resolve?kind=page&id=missing").status_code == 401
    )


def test_reference_search_resolve_and_no_provider_fetch(
    signed_client, user, monkeypatch
):
    mailbox, message, feed, event = seed(user)

    def no_network(*args, **kwargs):
        raise AssertionError("Preview must only use cached data")

    monkeypatch.setattr("app.providers.fetch_body", no_network)
    monkeypatch.setattr("app.mail_client.attachment_info", no_network)
    page = create(signed_client, "/pages", {"title": "Reference page"})
    project = create(
        signed_client, "/projects", {"title": "Reference project", "key": "REF"}
    )
    issue = create(
        signed_client,
        "/projects/" + project["id"] + "/tasks",
        {"title": "Reference issue"},
    )
    for kind, id, container in (
        ("mail", message, mailbox),
        ("event", event_identity(feed, event), feed),
        ("page", page["id"], ""),
        ("project", project["id"], ""),
        ("issue", issue["id"], project["id"]),
    ):
        search = signed_client.get(
            BASE + "/references", params={"kind": kind, "q": "Reference"}
        )
        assert search.status_code == 200, search.text
        item = next(item for item in search.json()["items"] if item["id"] == id)
        assert item["href"].startswith("/") and not item["href"].startswith("/app/")
        value = signed_client.get(
            BASE + "/references/resolve",
            params={"kind": kind, "id": id, "container_id": container},
        )
        assert value.status_code == 200, value.text
        assert value.json()["title"] == item["title"]
        if kind == "mail":
            assert value.json()["excerpt"] == "Safe preview"
    with Session() as db:
        assert db.get(Message, message).unread
    assert signed_client.get(BASE + "/references?kind=unknown").status_code == 422


def test_references_do_not_disclose_another_owner(signed_client, user):
    with Session() as db:
        other = User(
            issuer="other",
            subject="references",
            name="Other",
            email="other@example.test",
        )
        db.add(other)
        db.commit()
    mailbox, message, feed, event = seed(other)
    with Session() as db:
        page = NotePage(
            owner=other.id,
            title=encrypt("Reference private"),
            document=encrypt([{"type": "paragraph", "content": "Secret"}]),
        )
        project = NoteProject(owner=other.id, title=encrypt("Reference private"))
        db.add_all([page, project])
        db.commit()
        pid = page.id
        prid = project.id
    for kind, id, container in (
        ("mail", message, mailbox),
        ("event", event_identity(feed, event), feed),
        ("page", pid, ""),
        ("project", prid, ""),
    ):
        assert (
            signed_client.get(
                BASE + "/references", params={"kind": kind, "q": "Reference"}
            ).json()["items"]
            == []
        )
        assert (
            signed_client.get(
                BASE + "/references/resolve",
                params={"kind": kind, "id": id, "container_id": container},
            ).status_code
            == 404
        )


def test_reference_disconnection_and_deletion(signed_client, user):
    mailbox, message, feed, event = seed(user)
    with Session() as db:
        db.get(Connection, mailbox).status = "disconnected"
        db.commit()
    assert (
        signed_client.get(
            BASE + "/references/resolve",
            params={"kind": "mail", "id": message, "container_id": mailbox},
        ).status_code
        == 404
    )
    assert not any(
        item["id"] == message
        for item in signed_client.get(BASE + "/references?kind=mail").json()["items"]
    )
    page = create(signed_client, "/pages", {"title": "Original"})
    url = BASE + "/references/resolve"
    signed_client.patch(
        BASE + "/pages/" + page["id"], json={"expected_revision": 1, "title": "Changed"}
    )
    assert (
        signed_client.get(url, params={"kind": "page", "id": page["id"]}).json()[
            "title"
        ]
        == "Changed"
    )
    signed_client.request(
        "DELETE", BASE + "/pages/" + page["id"], json={"expected_revision": 2}
    )
    assert (
        signed_client.get(url, params={"kind": "page", "id": page["id"]}).status_code
        == 404
    )


def test_calendar_reference_identity_survives_reordering(signed_client, user):
    mailbox, message, feed, event = seed(user)
    original = event_identity(feed, event)
    another = {**event, "uid": "other", "title": "Other"}
    with Session() as db:
        db.get(CalendarFeed, feed).events = encrypt(
            [another, {**event, "description": "Updated agenda"}]
        )
        db.commit()
    items = signed_client.get("/api/v1/calendar/events?days=7").json()
    assert (
        next(item for item in items if item["title"] == "Reference meeting")["id"]
        == original
    )
    ref = signed_client.get(
        BASE + "/references/resolve",
        params={"kind": "event", "id": original, "container_id": feed},
    )
    assert ref.status_code == 200 and ref.json()["excerpt"] == "Updated agenda"
    assert event_identity(feed, {**event, "start": "2027-01-01T09:00:00Z"}) != original


def test_reference_blocks_validate_and_remap_archive(signed_client):
    project = create(signed_client, "/projects", {"title": "Source"})
    issue = create(
        signed_client,
        "/projects/" + project["id"] + "/tasks",
        {"title": "Source issue"},
    )
    page = create(signed_client, "/pages", {"title": "Source page"})

    def block(kind, id, container=""):
        return {
            "type": "workspaceEmbed",
            "props": {"kind": kind, "itemId": id, "containerId": container},
        }

    document = [
        block("issue", issue["id"], project["id"]),
        block("page", page["id"]),
        block("project", project["id"]),
        {
            "type": "paragraph",
            "content": [
                {
                    "type": "link",
                    "href": "/notes/projects/"
                    + project["id"]
                    + "?issue="
                    + issue["id"],
                    "content": "Open issue",
                }
            ],
        },
    ]
    note = create(signed_client, "/pages", {"title": "Embeds", "document": document})
    backlinks = signed_client.get(BASE + "/pages/" + page["id"] + "/backlinks").json()
    assert any(item["id"] == note["id"] for item in backlinks["items"])
    for href in (
        "/email/all?account=mail&message=one",
        "/calendar?date=2026-10-28",
        "/notes/projects/" + project["id"],
    ):
        create(
            signed_client,
            "/pages",
            {
                "title": "Workspace link",
                "document": [
                    {
                        "type": "paragraph",
                        "content": [{"type": "link", "href": href, "content": "Open"}],
                    }
                ],
            },
        )
    for bad in (block("script", "x"), block("mail", ""), block("page", "x" * 201)):
        assert (
            signed_client.post(BASE + "/pages", json={"document": [bad]}).status_code
            == 422
        )
    archive = signed_client.get(BASE + "/export").json()
    imported = signed_client.post(BASE + "/import", json=archive)
    assert imported.status_code == 201, imported.text
    pages = [
        signed_client.get(BASE + "/pages/" + id).json()
        for id in imported.json()["pages"]
    ]
    copy = next(item for item in pages if item["title"] == "Embeds")
    assert copy["document"][0]["props"]["itemId"] != issue["id"]
    assert copy["document"][0]["props"]["containerId"] == imported.json()["projects"][0]
    assert (
        copy["document"][1]["props"]["itemId"]
        == next(item for item in pages if item["title"] == "Source page")["id"]
    )
    assert copy["document"][2]["props"]["itemId"] == imported.json()["projects"][0]
    assert (
        copy["document"][3]["content"][0]["href"]
        == "/notes/projects/"
        + imported.json()["projects"][0]
        + "?issue="
        + copy["document"][0]["props"]["itemId"]
    )
