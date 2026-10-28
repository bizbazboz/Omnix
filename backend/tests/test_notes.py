import pytest
from sqlalchemy import select
from app.core import (
    Session,
    User,
    NotePage,
    NoteProject,
    ProjectTask,
    NoteRevision,
    decrypt,
)

BASE = "/api/v1/notes"


def create(client, **values):
    response = client.post(BASE + "/pages", json=values)
    assert response.status_code == 201, response.text
    return response.json()


def project(client, title="Launch"):
    response = client.post(BASE + "/projects", json={"title": title})
    assert response.status_code == 201, response.text
    return response.json()


def task(client, project, **values):
    response = client.post(
        BASE + "/projects/" + project["id"] + "/tasks", json={"title": "Task", **values}
    )
    assert response.status_code == 201, response.text
    return response.json()


def body(text):
    return [
        {
            "type": "paragraph",
            "content": [{"type": "text", "text": text, "styles": {}}],
            "children": [],
        }
    ]


def test_notes_require_auth(client):
    for path in (
        "/pages",
        "/projects",
        "/overview",
        "/pages/missing",
        "/projects/missing/tasks",
    ):
        assert client.get(BASE + path).status_code == 401


def test_notes_encrypt_and_cas(signed_client):
    page = create(signed_client, title="Private heading", document=body("Private body"))
    with Session() as db:
        row = db.get(NotePage, page["id"])
        assert "Private" not in row.title and "Private" not in row.document
        assert decrypt(row.document) == body("Private body")
    response = signed_client.patch(
        BASE + "/pages/" + page["id"],
        json={"expected_revision": 1, "document": body("New content")},
    )
    assert response.status_code == 200 and response.json()["revision"] == 2
    assert (
        signed_client.patch(
            BASE + "/pages/" + page["id"],
            json={"expected_revision": 1, "title": "Overwrite"},
        ).status_code
        == 409
    )
    assert signed_client.get(BASE + "/pages/" + page["id"]).json()["document"] == body(
        "New content"
    )


def test_notes_owner_isolation(signed_client, user):
    with Session() as db:
        other = User(
            issuer="other", subject="other", name="Other", email="other@example.test"
        )
        db.add(other)
        db.flush()
        from app.core import encrypt

        page = NotePage(
            owner=other.id, title=encrypt("Hidden"), document=encrypt(body("secret"))
        )
        pr = NoteProject(owner=other.id, title=encrypt("Hidden project"))
        db.add_all([page, pr])
        db.commit()
        ids = (page.id, pr.id)
    assert signed_client.get(BASE + "/pages/" + ids[0]).status_code == 404
    assert (
        signed_client.get(BASE + "/pages/" + ids[0] + "/revisions").status_code == 404
    )
    assert (
        signed_client.post(BASE + "/pages", json={"parent_id": ids[0]}).status_code
        == 404
    )
    assert signed_client.get(BASE + "/projects/" + ids[1] + "/tasks").status_code == 404
    assert signed_client.get(BASE + "/pages").json()["items"] == []


def test_nested_cycles_trash_restore(signed_client):
    root = create(signed_client, title="Root")
    child = create(signed_client, title="Child", parent_id=root["id"])
    assert (
        signed_client.patch(
            BASE + "/pages/" + root["id"],
            json={"expected_revision": 1, "parent_id": child["id"]},
        ).status_code
        == 422
    )
    assert (
        signed_client.request(
            "DELETE", BASE + "/pages/" + root["id"], json={"expected_revision": 1}
        ).status_code
        == 200
    )
    assert signed_client.get(BASE + "/pages/" + child["id"]).status_code == 404
    assert len(signed_client.get(BASE + "/pages?trash=true").json()["items"]) == 2
    assert (
        signed_client.post(BASE + "/pages/" + root["id"] + "/restore").status_code
        == 200
    )
    assert (
        signed_client.get(BASE + "/pages/" + child["id"]).json()["parent_id"]
        == root["id"]
    )


def test_history_restore_keeps_revisions(signed_client):
    page = create(signed_client, title="First", document=body("Before"))
    history = signed_client.get(BASE + "/pages/" + page["id"] + "/revisions").json()
    signed_client.patch(
        BASE + "/pages/" + page["id"],
        json={"expected_revision": 1, "title": "Second", "document": body("After")},
    )
    response = signed_client.post(
        BASE + "/pages/" + page["id"] + "/revisions/" + history[0]["id"] + "/restore",
        json={"expected_revision": 2},
    )
    assert (
        response.status_code == 200
        and response.json()["title"] == "First"
        and response.json()["revision"] == 3
    )
    assert (
        len(signed_client.get(BASE + "/pages/" + page["id"] + "/revisions").json()) == 3
    )


def test_rejects_active_links_and_large_documents(signed_client):
    assert (
        signed_client.post(
            BASE + "/pages", json={"document": [{"type": "script"}]}
        ).status_code
        == 422
    )
    assert (
        signed_client.post(
            BASE + "/pages",
            json={
                "document": [
                    {
                        "type": "paragraph",
                        "content": [
                            {
                                "type": "link",
                                "href": "javascript:alert(1)",
                                "content": [],
                            }
                        ],
                    }
                ]
            },
        ).status_code
        == 422
    )
    assert (
        signed_client.post(
            BASE + "/pages", json={"document": body("x" * 800001)}
        ).status_code
        == 413
    )


def test_search_and_backlinks(signed_client):
    page = create(signed_client, title="Target")
    ref = create(
        signed_client,
        title="Reference",
        document=body("/notes/pages/" + page["id"]),
    )
    assert (
        signed_client.get(BASE + "/pages?q=reference").json()["items"][0]["id"]
        == ref["id"]
    )
    assert (
        signed_client.get(BASE + "/pages/" + page["id"] + "/backlinks").json()["items"][
            0
        ]["id"]
        == ref["id"]
    )


def test_task_dates_dependencies_and_conflicts(signed_client):
    pr = project(signed_client)
    a = task(signed_client, pr, start="2026-03-28", end="2026-03-30")
    b = task(signed_client, pr, dependencies=[a["id"]])
    url = BASE + "/projects/" + pr["id"] + "/tasks/" + a["id"]
    assert (
        signed_client.put(
            url,
            json={"title": "Cycle", "expected_revision": 1, "dependencies": [b["id"]]},
        ).status_code
        == 422
    )
    assert (
        signed_client.put(
            url,
            json={
                "title": "Wrong dates",
                "expected_revision": 1,
                "start": "2026-10-29",
                "end": "2026-10-28",
            },
        ).status_code
        == 422
    )
    updated = signed_client.put(
        url,
        json={
            "title": "Done",
            "expected_revision": 1,
            "status": "done",
            "progress": 100,
        },
    )
    assert updated.status_code == 200 and updated.json()["progress"] == 100
    assert (
        signed_client.put(
            url, json={"title": "Old", "expected_revision": 1}
        ).status_code
        == 409
    )
    other = project(signed_client, "Other")
    assert (
        signed_client.post(
            BASE + "/projects/" + other["id"] + "/tasks",
            json={"title": "Foreign", "dependencies": [a["id"]]},
        ).status_code
        == 422
    )


def test_project_trash_hides_tasks_until_restored(signed_client):
    pr = project(signed_client)
    task(signed_client, pr)
    assert (
        signed_client.request(
            "DELETE", BASE + "/projects/" + pr["id"], json={"expected_revision": 1}
        ).status_code
        == 200
    )
    assert (
        signed_client.get(BASE + "/projects/" + pr["id"] + "/tasks").status_code == 404
    )
    signed_client.post(BASE + "/projects/" + pr["id"] + "/restore")
    assert len(signed_client.get(BASE + "/projects/" + pr["id"] + "/tasks").json()) == 1


def test_note_assets_are_encrypted_and_download_safe(signed_client):
    page = create(signed_client)
    response = signed_client.post(
        BASE + "/pages/" + page["id"] + "/assets?name=sample.html",
        content=b"<script>secret</script>",
        headers={"Content-Type": "text/html"},
    )
    assert response.status_code == 201, response.text
    asset = response.json()
    download = signed_client.get(asset["url"])
    assert download.headers["content-type"] == "application/octet-stream"
    assert download.headers["content-disposition"].startswith("attachment")
    from app.core import NoteAsset

    with Session() as db:
        assert "secret" not in db.get(NoteAsset, asset["id"]).content


def test_archive_roundtrip_remaps_private_graph(signed_client):
    pr = project(signed_client)
    root = create(signed_client, title="Root", project_id=pr["id"])
    child = create(signed_client, title="Child", parent_id=root["id"])
    a = task(signed_client, pr, page_id=child["id"])
    task(signed_client, pr, dependencies=[a["id"]])
    exported = signed_client.get(BASE + "/export").json()
    response = signed_client.post(BASE + "/import", json=exported)
    assert response.status_code == 201, response.text
    imported = response.json()
    assert len(imported["pages"]) == 2
    assert not set(imported["pages"]) & {root["id"], child["id"]}
    pages = [
        signed_client.get(BASE + "/pages/" + id).json() for id in imported["pages"]
    ]
    assert (
        next(page for page in pages if page["title"] == "Child")["parent_id"]
        == next(page for page in pages if page["title"] == "Root")["id"]
    )
    tasks = signed_client.get(
        BASE + "/projects/" + imported["projects"][0] + "/tasks"
    ).json()
    assert len(tasks) == 2 and any(task["dependencies"] for task in tasks)
    assert all(
        task["page_id"] is None or task["page_id"] in imported["pages"]
        for task in tasks
    )


def test_archive_invalid_graph_rolls_back(signed_client):
    page = create(signed_client)
    archive = signed_client.get(BASE + "/export").json()
    archive["pages"][0]["parent_id"] = page["id"]
    assert signed_client.post(BASE + "/import", json=archive).status_code == 422
    assert len(signed_client.get(BASE + "/pages").json()["items"]) == 1


def test_duplicate_copies_attachment_references(signed_client):
    page = create(signed_client)
    asset = signed_client.post(
        BASE + "/pages/" + page["id"] + "/assets?name=sample.png",
        content=b"\x89PNG\r\n\x1a\nsynthetic",
        headers={"Content-Type": "image/png"},
    ).json()
    result = signed_client.patch(
        BASE + "/pages/" + page["id"],
        json={
            "expected_revision": 1,
            "document": [{"type": "image", "props": {"url": asset["url"]}}],
        },
    )
    assert result.status_code == 200
    duplicate = signed_client.post(BASE + "/pages/" + page["id"] + "/duplicate").json()
    url = duplicate["document"][0]["props"]["url"]
    assert page["id"] not in url and duplicate["id"] in url
    signed_client.request(
        "DELETE", BASE + "/pages/" + page["id"], json={"expected_revision": 2}
    )
    assert signed_client.get(url).status_code == 200


def test_sibling_reordering_is_persisted(signed_client):
    a = create(signed_client, title="A")
    b = create(signed_client, title="B")
    c = create(signed_client, title="C")
    response = signed_client.patch(
        BASE + "/pages/" + c["id"], json={"expected_revision": 1, "position": 0}
    )
    assert response.status_code == 200
    rows = signed_client.get(BASE + "/pages").json()["items"]
    assert sorted(rows, key=lambda row: row["position"])[0]["id"] == c["id"]


def issue_payload(value, **changes):
    return {
        key: item
        for key, item in {
            **value,
            "expected_revision": value["revision"],
            **changes,
        }.items()
        if key not in ("id", "project_id", "revision", "issue_key", "issue_number")
    }


def test_folders_with_subpages_roundtrip(signed_client):
    folder = create(signed_client, title="Research", is_folder=True)
    subfolder = create(
        signed_client, title="Sources", is_folder=True, parent_id=folder["id"]
    )
    page = create(signed_client, title="Reading", parent_id=subfolder["id"])
    assert folder["is_folder"] and subfolder["is_folder"] and not page["is_folder"]
    duplicate = signed_client.post(
        BASE + "/pages/" + folder["id"] + "/duplicate"
    ).json()
    assert duplicate["is_folder"]
    archive = signed_client.get(BASE + "/export").json()
    imported = signed_client.post(BASE + "/import", json=archive)
    assert imported.status_code == 201, imported.text
    copies = [
        signed_client.get(BASE + "/pages/" + id).json()
        for id in imported.json()["pages"]
    ]
    source = next(item for item in copies if item["title"] == "Sources")
    reading = next(item for item in copies if item["title"] == "Reading")
    assert source["is_folder"] and reading["parent_id"] == source["id"]


def test_issue_keys_are_stable_and_never_reused(signed_client):
    pr = project(signed_client)
    first = task(signed_client, pr)
    second = task(signed_client, pr)
    assert first["issue_key"] == pr["issue_prefix"] + "-1"
    assert second["issue_number"] == 2
    base = BASE + "/projects/" + pr["id"] + "/tasks/"
    updated = signed_client.put(
        base + first["id"],
        json=issue_payload(
            first,
            title="Renamed",
            issue_type="bug",
            labels=["security", "security"],
            sprint="Sprint 1",
            estimate=5,
            status="in_review",
        ),
    )
    assert updated.status_code == 200, updated.text
    value = updated.json()
    assert value["issue_key"] == first["issue_key"] and value["labels"] == ["security"]
    with Session() as db:
        row = db.get(ProjectTask, first["id"])
        assert "security" not in row.labels and "Sprint 1" not in row.sprint
    assert (
        signed_client.request(
            "DELETE", base + second["id"], json={"expected_revision": 1}
        ).status_code
        == 200
    )
    assert task(signed_client, pr)["issue_number"] == 3


def test_issue_comments_activity_and_owner_isolation(signed_client, user):
    from app.core import IssueComment, IssueActivity

    pr = project(signed_client)
    issue = task(signed_client, pr)
    base = BASE + "/projects/" + pr["id"] + "/tasks/" + issue["id"]
    response = signed_client.post(
        base + "/comments", json={"body": "Private acceptance criteria"}
    )
    assert response.status_code == 201
    assert (
        signed_client.post(base + "/comments", json={"body": "  "}).status_code == 422
    )
    assert (
        signed_client.post(base + "/comments", json={"body": "x" * 5001}).status_code
        == 422
    )
    update = signed_client.put(base, json=issue_payload(issue, status="done"))
    assert update.status_code == 200
    discussion = signed_client.get(base + "/discussion").json()
    assert discussion["comments"][0]["body"] == "Private acceptance criteria"
    assert any("status" in row["summary"] for row in discussion["activity"])
    with Session() as db:
        row = db.scalar(select(IssueComment))
        assert "Private" not in row.body
        other = User(
            issuer="https://id.example.test",
            subject="other-notes-user",
            name="Other",
            email="other@example.test",
        )
        db.add(other)
        db.flush()
        db.get(NoteProject, pr["id"]).owner = other.id
        db.get(ProjectTask, issue["id"]).owner = other.id
        db.commit()
    assert signed_client.get(base + "/discussion").status_code == 404
    assert (
        signed_client.post(base + "/comments", json={"body": "Not yours"}).status_code
        == 404
    )


def test_issue_hierarchy_and_validation(signed_client):
    pr = project(signed_client)
    epic = task(signed_client, pr, issue_type="epic")
    story = task(signed_client, pr, issue_type="story", parent_id=epic["id"])
    child = task(signed_client, pr, issue_type="subtask", parent_id=story["id"])
    base = BASE + "/projects/" + pr["id"] + "/tasks"
    for payload in (
        {"issue_type": "subtask"},
        {"issue_type": "unknown"},
        {"labels": ["x" * 41]},
        {"estimate": -1},
        {"issue_type": "epic", "parent_id": story["id"]},
    ):
        assert (
            signed_client.post(base, json={"title": "Invalid", **payload}).status_code
            == 422
        )
    assert (
        signed_client.put(
            base + "/" + story["id"], json=issue_payload(story, parent_id=child["id"])
        ).status_code
        == 422
    )
    assert (
        signed_client.request(
            "DELETE", base + "/" + story["id"], json={"expected_revision": 1}
        ).status_code
        == 200
    )
    remaining = signed_client.get(base).json()
    assert (
        next(row for row in remaining if row["id"] == child["id"])["issue_type"]
        == "task"
    )


def test_issue_archive_preserves_comments_and_metadata(signed_client):
    pr = project(signed_client)
    parent = task(
        signed_client,
        pr,
        issue_type="story",
        labels=["release"],
        estimate=8,
        sprint="October",
    )
    child = task(signed_client, pr, issue_type="subtask", parent_id=parent["id"])
    url = BASE + "/projects/" + pr["id"] + "/tasks/" + parent["id"]
    assert (
        signed_client.post(
            url + "/comments", json={"body": "Remember rollback"}
        ).status_code
        == 201
    )
    archive = signed_client.get(BASE + "/export").json()
    response = signed_client.post(BASE + "/import", json=archive)
    assert response.status_code == 201, response.text
    new_id = response.json()["projects"][0]
    rows = signed_client.get(BASE + "/projects/" + new_id + "/tasks").json()
    imported_parent = next(row for row in rows if row["issue_type"] == "story")
    imported_child = next(row for row in rows if row["issue_type"] == "subtask")
    assert imported_parent["labels"] == ["release"] and imported_parent["estimate"] == 8
    assert (
        imported_parent["sprint"] == "October"
        and imported_child["parent_id"] == imported_parent["id"]
    )
    assert imported_parent["issue_key"] != parent["issue_key"]
    discussion = signed_client.get(
        BASE + "/projects/" + new_id + "/tasks/" + imported_parent["id"] + "/discussion"
    ).json()
    assert discussion["comments"][0]["body"] == "Remember rollback"


def test_custom_project_keys_are_owner_scoped(signed_client):
    response = signed_client.post(
        BASE + "/projects", json={"title": "Omnix", "key": "OMN"}
    )
    assert response.status_code == 201, response.text
    pr = response.json()
    assert task(signed_client, pr)["issue_key"] == "OMN-1"
    assert (
        signed_client.post(
            BASE + "/projects", json={"title": "Duplicate", "key": "OMN"}
        ).status_code
        == 409
    )
    assert (
        signed_client.post(
            BASE + "/projects", json={"title": "Bad", "key": "bad key"}
        ).status_code
        == 422
    )
