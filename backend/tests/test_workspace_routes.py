import pytest
from app.core import Session, NotePage, NoteRevision, encrypt, decrypt


@pytest.mark.parametrize(
    "old,new",
    [
        ("/app", "/"),
        ("/app/", "/"),
        ("/app/notes/pages/one?view=history", "/notes/pages/one?view=history"),
        ("/app/settings", "/settings"),
        ("/app//external.example", "/external.example"),
    ],
)
def test_legacy_routes_redirect_to_canonical(client, old, new):
    response = client.get(old)
    assert response.status_code == 308
    assert response.headers["location"] == new
    assert not response.headers["location"].startswith("//")


def test_old_note_and_revision_links_are_read_without_rewriting_storage(
    signed_client, user
):
    doc = [
        {
            "type": "paragraph",
            "content": [
                {
                    "type": "link",
                    "href": "/app/notes/pages/target?view=history#block",
                    "content": "Target",
                }
            ],
        }
    ]
    with Session() as db:
        page = NotePage(
            owner=user.id, title=encrypt("Old links"), document=encrypt(doc)
        )
        db.add(page)
        db.flush()
        revision = NoteRevision(
            page_id=page.id,
            revision=1,
            snapshot=encrypt({"title": "Old links", "document": doc}),
        )
        db.add(revision)
        db.commit()
        id = page.id
        version = revision.id
        raw = page.document
    value = signed_client.get("/api/v1/notes/pages/" + id).json()
    assert (
        value["document"][0]["content"][0]["href"]
        == "/notes/pages/target?view=history#block"
    )
    history = signed_client.get(
        "/api/v1/notes/pages/" + id + "/revisions/" + version
    ).json()
    assert history["document"][0]["content"][0]["href"].startswith("/notes/")
    with Session() as db:
        assert db.get(NotePage, id).document == raw


def test_public_product_routes_are_canonical(signed_client):
    products = signed_client.get("/api/v1/products").json()
    assert {item["path"] for item in products} == {
        "/email",
        "/calendar",
        "/health",
        "/notes",
    }


def test_notebook_sandbox_policy_does_not_weaken_the_app(client):
    page = client.get("/")
    assert "unsafe-eval" not in page.headers["content-security-policy"]
    runtime = client.get("/notebook/runtime.html")
    assert runtime.status_code == 200
    csp = runtime.headers["content-security-policy"]
    assert "sandbox allow-scripts;" in csp and "allow-same-origin" not in csp
    assert "worker-src blob:" in csp and "wasm-unsafe-eval" in csp
    assert runtime.headers["x-frame-options"] == "SAMEORIGIN"
    asset = client.get("/notebook/python/pyodide.mjs")
    assert (
        asset.status_code == 200 and asset.headers["access-control-allow-origin"] == "*"
    )
    assert "access-control-allow-origin" not in client.get("/api/health/ready").headers


def test_code_source_remains_data_and_has_no_server_execution_api(signed_client):
    source = 'print("Hello World")\nvalue = 42\nvalue'
    doc = [
        {
            "type": "codeBlock",
            "props": {"language": "auto"},
            "content": [{"type": "text", "text": source, "styles": {}}],
        }
    ]
    response = signed_client.post(
        "/api/v1/notes/pages", json={"title": "Notebook", "document": doc}
    )
    assert response.status_code == 201, response.text
    assert response.json()["document"] == doc
    assert signed_client.post(
        "/api/v1/notes/execute", json={"code": source}
    ).status_code in (404, 405)
    doc[0]["props"]["language"] = {"invalid": True}
    assert (
        signed_client.post("/api/v1/notes/pages", json={"document": doc}).status_code
        == 422
    )


def test_backlog_status_can_move_to_board_without_a_dedicated_action(signed_client):
    project = signed_client.post(
        "/api/v1/notes/projects", json={"title": "Board", "key": "BRD"}
    ).json()
    base = "/api/v1/notes/projects/" + project["id"] + "/tasks"
    issue = signed_client.post(
        base, json={"title": "Promote", "status": "backlog"}
    ).json()
    response = signed_client.put(
        base + "/" + issue["id"],
        json={
            "title": "Promote",
            "status": "todo",
            "expected_revision": issue["revision"],
        },
    )
    assert response.status_code == 200 and response.json()["status"] == "todo"
