"""Exercise real HTTP MCP calls and owner isolation, not mocked auth."""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import hashlib
import json
import re
import secrets

from app.core import (
    ApiToken,
    Connection,
    Message,
    NotePage,
    Session,
    User,
    encrypt,
    now,
)
from app.main import app

TOKENS = "/api/v1/settings/api-tokens"
PAGES = "/api/v1/notes/pages"


def create_token(client, **values):
    response = client.post(TOKENS, json={"name": "Test client", **values})
    assert response.status_code == 201, response.text
    return response.json()


def bearer(raw):
    return {"Authorization": "Bearer " + raw}


def rpc(client, raw, method, params=None):
    return client.post(
        "/mcp",
        params={"accesstoken": raw},
        headers={
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": "2025-06-18",
        },
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params or {},
        },
    )


def tool_name(path, method="get"):
    operation = app.openapi()["paths"][path][method]["operationId"]
    return re.sub(r"_+", "_", operation.split("__")[0])[:56]


def call(client, raw, path, arguments=None, method="get"):
    response = rpc(
        client,
        raw,
        "tools/call",
        {
            "name": tool_name(path, method),
            "arguments": arguments or {},
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["result"]


def other_workspace():
    raw = "omnix_" + secrets.token_urlsafe(32)
    with Session() as db:
        user = User(issuer="test", subject="bob", name="Bob", email="bob@example.test")
        db.add(user)
        db.flush()
        page = NotePage(
            owner=user.id, title=encrypt("Bob private"), document=encrypt([])
        )
        account = Connection(
            owner=user.id,
            label="Bob mailbox",
            address=user.email,
            provider="imap",
            credentials=encrypt({}),
        )
        db.add_all([page, account])
        db.flush()
        message = Message(
            mailbox=account.id,
            provider_id="bob",
            sender=user.email,
            recipients=user.email,
            subject="Bob secret",
            body="Never Alice",
        )
        token = ApiToken(
            owner=user.id,
            name="Bob",
            prefix=raw[:14],
            digest=hashlib.sha256(raw.encode()).hexdigest(),
            permission="write",
            expires_at=now() + timedelta(days=1),
        )
        db.add_all([message, token])
        db.commit()
        return raw, page.id, account.id, message.id


def test_token_lifecycle_and_browser_only_management(signed_client):
    client = signed_client
    token = create_token(client)
    with Session() as db:
        row = db.get(ApiToken, token["id"])
        assert row.digest == hashlib.sha256(token["token"].encode()).hexdigest()
        assert token["token"] not in row.digest
    assert "token" not in client.get(TOKENS).json()[0]
    assert client.get(PAGES, headers=bearer(token["token"])).status_code == 200
    assert client.get(TOKENS, headers=bearer(token["token"])).status_code == 403
    assert (
        client.post(
            TOKENS, headers=bearer(token["token"]), json={"name": "Escalation"}
        ).status_code
        == 403
    )
    assert client.delete(TOKENS + "/" + token["id"]).status_code == 204
    assert client.get(PAGES, headers=bearer(token["token"])).status_code == 401
    assert rpc(client, token["token"], "tools/list").status_code == 401


def test_no_cookie_fallback_no_csrf_bypass(signed_client):
    client = signed_client
    assert client.get(PAGES, headers=bearer("invalid")).status_code == 401
    assert client.post(PAGES, headers=bearer("invalid"), json={}).status_code == 401
    assert (
        client.post(
            TOKENS, headers={"X-CSRF-Token": ""}, json={"name": "No csrf"}
        ).status_code
        == 403
    )
    assert client.post("/mcp/", json={}).status_code == 401
    assert rpc(client, "invalid", "initialize").status_code == 401


def test_mcp_requires_one_query_token_and_never_redirects(signed_client):
    client = signed_client
    raw = create_token(client)["token"]
    bob, _, _, _ = other_workspace()
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
    headers = {"Accept": "application/json, text/event-stream"}
    for path in ("/mcp", "/mcp/"):
        for params in (
            {},
            {"accesstoken": ""},
            {"accesstoken": "invalid"},
            [("accesstoken", raw), ("accesstoken", bob)],
        ):
            response = client.post(
                path, params=params, headers={**headers, **bearer(raw)}, json=body
            )
            assert response.status_code == 401
            assert "location" not in response.headers
            assert "www-authenticate" not in response.headers
            assert raw not in response.text and bob not in response.text
        response = client.post(
            path, params={"accesstoken": raw}, headers=headers, json=body
        )
        assert response.status_code == 200, response.text
        assert "location" not in response.headers
        assert raw not in response.text
    own = client.post(PAGES, json={"title": "Query owner's page"}).json()
    response = client.post(
        "/mcp",
        params={"accesstoken": raw},
        headers={**headers, **bearer(bob)},
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": tool_name(PAGES + "/{id}"),
                "arguments": {"id": own["id"]},
            },
        },
    )
    assert response.status_code == 200 and "Query owner's page" in response.text


def test_read_write_expiry_and_admin_boundary(signed_client, user):
    client = signed_client
    read = create_token(client)
    write = create_token(client, permission="write")
    client.cookies.clear()
    client.headers.pop("Origin", None)
    client.headers.pop("X-CSRF-Token", None)
    assert client.post(PAGES, headers=bearer(read["token"]), json={}).status_code == 403
    assert (
        client.post(
            PAGES, headers=bearer(write["token"]), json={"title": "From token"}
        ).status_code
        == 201
    )
    with Session() as db:
        db.get(User, user.id).is_admin = True
        db.get(ApiToken, read["id"]).expires_at = now() - timedelta(seconds=1)
        db.commit()
    assert client.get(PAGES, headers=bearer(read["token"])).status_code == 401
    assert rpc(client, read["token"], "tools/list").status_code == 401
    for path in (
        "/api/v1/settings/users",
        "/api/v1/settings/oidc",
        "/api/v1/me",
        TOKENS,
    ):
        assert client.get(path, headers=bearer(write["token"])).status_code == 403


def test_mcp_generated_tools_and_two_users(signed_client):
    client = signed_client
    alice = create_token(client, permission="write")["token"]
    alice_page = client.post(PAGES, json={"title": "Alice private"}).json()
    bob, bob_page, mailbox, message = other_workspace()
    initialized = rpc(
        client,
        alice,
        "initialize",
        {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "isolation-test", "version": "1"},
        },
    )
    assert initialized.status_code == 200, initialized.text
    tools = rpc(client, alice, "tools/list")
    assert tools.status_code == 200, tools.text
    names = {item["name"] for item in tools.json()["result"]["tools"]}
    assert tool_name(PAGES) in names
    assert tool_name("/api/v1/calendar/events") in names
    assert tool_name("/api/v1/health/statistics") in names
    assert not any(
        "settings" in name or "authorize" in name or "callback" in name
        for name in names
    )

    # A browser's Alice cookie is intentionally present during Bob's calls.
    def check(raw, own, hidden):
        result = call(client, raw, PAGES)
        assert own in json.dumps(result) and hidden not in json.dumps(result)

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [
            pool.submit(check, alice, "Alice private", "Bob private"),
            pool.submit(check, bob, "Bob private", "Alice private"),
        ]
        for future in futures:
            future.result()
    for raw, page_id in ((alice, bob_page), (bob, alice_page["id"])):
        denied = call(client, raw, PAGES + "/{id}", {"id": page_id})
        assert denied["isError"] and "404" in json.dumps(denied)
    assert (
        client.get(
            f"/api/v1/email/mailboxes/{mailbox}/messages/{message}",
            headers=bearer(alice),
        ).status_code
        == 404
    )
    assert (
        client.patch(
            PAGES + "/" + bob_page,
            headers=bearer(alice),
            json={"expected_revision": 1, "title": "Stolen"},
        ).status_code
        == 404
    )
    assert (
        call(client, alice, PAGES, {"title": "Via MCP"}, "post").get("isError")
        is not True
    )
    assert "Via MCP" in json.dumps(call(client, alice, PAGES))


def test_read_only_mcp_and_foreign_revocation(signed_client):
    client = signed_client
    token = create_token(client)
    bob, _, _, _ = other_workspace()
    with Session() as db:
        foreign = (
            db.query(ApiToken)
            .filter(ApiToken.digest == hashlib.sha256(bob.encode()).hexdigest())
            .one()
        )
        foreign_id = foreign.id
    assert client.delete(TOKENS + "/" + foreign_id).status_code == 404
    assert call(client, token["token"], PAGES, {"title": "Denied"}, "post")["isError"]
    assert client.get(PAGES).json()["items"] == []
    assert client.delete(TOKENS + "/" + token["id"]).status_code == 204
    assert rpc(client, token["token"], "tools/list").status_code == 401
