import json
import uuid
from types import SimpleNamespace
from email.message import EmailMessage
import pytest
from app.core import (
    Session,
    User,
    Message,
    Connection,
    MailUpload,
    SendAttempt,
    encrypt,
)
from app.mail_render import sanitize_email, plain_text
from app.mail_provider import profile, mime_data, change_message
from app.mail_client import validate_sender, prepare_send
from app import providers


def test_html_email_keeps_layout_without_exposing_css_text():
    raw = """<html><head><style>.brand {color: #333; padding: 24px} @media(max-width:600px){.brand{width:100%}} @import url(https://tracker.invalid/a);</style></head><body><table role="presentation" width="600" cellpadding="0"><tr><td class="brand" style="padding:20px;color:#333;background-image:url(https://tracker.invalid/bg)">Hello <b>Alex</b></td></tr></table><script>window.top.location='evil'</script><img src="https://tracker.invalid/pixel" onerror="alert(1)"><a href="javascript:alert(1)">Unsafe</a><form>Hidden form</form></body></html>"""
    result = sanitize_email(raw)
    assert (
        "<table" in result and 'cellpadding="0"' in result and "padding:20px" in result
    )
    assert "<style>" in result and "@media" in result
    assert "@import" not in result and "background-image" not in result
    assert (
        "<script" not in result
        and "window.top" not in result
        and "onerror" not in result
    )
    assert "javascript:" not in result and "Hidden form" not in result
    assert plain_text(result).startswith("Hello Alex")
    assert ".brand" not in plain_text(result)


def test_escaped_html_and_injection_are_handled():
    assert "<table" in sanitize_email(
        "&lt;table&gt;&lt;tr&gt;&lt;td&gt;Mail&lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;"
    )
    result = sanitize_email(
        '<svg><script>bad()</script></svg><p style="width:expression(alert(1));color:red">Safe</p><iframe src="/app">Hidden</iframe>'
    )
    assert (
        "bad()" not in result and "expression" not in result and "<iframe" not in result
    )
    assert "Safe" in result


def test_mime_plain_html_inline_and_attachment():
    msg = EmailMessage()
    msg["Cc"] = "Team <team@example.com>"
    msg["Reply-To"] = "reply@example.com"
    msg["Message-ID"] = "<original@example.com>"
    msg.set_content("Plain café")
    msg.add_alternative(
        '<table><tr><td>HTML café<img src="cid:logo"></td></tr></table>', subtype="html"
    )
    msg.get_payload()[1].add_related(
        b"\x89PNGfake", maintype="image", subtype="png", cid="<logo>"
    )
    msg.add_attachment(
        b"PDF bytes", maintype="application", subtype="pdf", filename="report.pdf"
    )
    value = mime_data(msg.as_bytes())
    assert "Plain café" in value["body"] and "data:image/png;base64," in value["html"]
    assert any(a["name"] == "report.pdf" for a in value["attachments"])
    assert (
        value["reply_to"] == "reply@example.com"
        and value["rfc_id"] == "<original@example.com>"
    )


def test_zoho_only_exposes_confirmed_aliases(monkeypatch):
    c = SimpleNamespace(
        id="aliases-test",
        provider="zoho",
        address="primary@example.com",
        label="Work",
        credentials=encrypt({"scopes": ["ZohoMail.messages.UPDATE"]}),
    )

    def request(c, db, method, path, **kwargs):
        if path == "/folders":
            return [
                {"folderId": "in", "folderName": "Inbox"},
                {"folderId": "sent", "folderName": "Sent"},
                {"folderId": "custom", "folderName": "Projects"},
            ]
        return {
            "emailAddress": [
                {"mailId": "alias@example.com", "isConfirmed": True},
                {"mailId": "unconfirmed@example.com", "isConfirmed": False},
            ],
            "sendMailDetails": [
                {
                    "fromAddress": "external@example.net",
                    "validated": True,
                    "status": True,
                },
                {
                    "fromAddress": "blocked@example.com",
                    "validated": True,
                    "status": False,
                },
            ],
        }

    monkeypatch.setattr(providers, "zoho_request", request)
    value = profile(c, None)
    assert {i["address"] for i in value["identities"]} == {
        "primary@example.com",
        "alias@example.com",
        "external@example.net",
    }
    assert not value["needs_reconnect"]
    assert any(f["key"] == "folder:custom" for f in value["folders"])
    assert validate_sender(c, None, "ALIAS@example.com") == "alias@example.com"
    with pytest.raises(Exception):
        validate_sender(c, None, "unconfirmed@example.com")


def test_zoho_send_uses_selected_alias_and_reply_endpoint(monkeypatch):
    requests = []
    monkeypatch.setattr(
        providers,
        "zoho_request",
        lambda c, db, method, path, **kwargs: requests.append((path, kwargs))
        or {"messageId": "accepted"},
    )
    c = SimpleNamespace(provider="zoho", address="primary@example.com")
    payload = {
        "from_address": "alias@example.com",
        "to": ["recipient@example.com"],
        "subject": "Re: Work",
        "body": "Reply",
        "_reply_provider_id": "original",
        "_attachments": [
            {
                "storeName": "safe",
                "attachmentName": "report.pdf",
                "attachmentPath": "/stored",
            }
        ],
    }
    assert providers.send_message(c, None, payload, "attempt")["accepted"]
    assert requests[0][0] == "/messages/original"
    assert requests[0][1]["json"]["fromAddress"] == "alias@example.com"
    assert requests[0][1]["json"]["action"] == "reply"
    assert requests[0][1]["json"]["attachments"][0]["storeName"] == "safe"


def test_body_plain_text_is_not_misidentified_as_html(monkeypatch):
    c = SimpleNamespace(provider="zoho", owner="owner", id="plain-body")
    msg = SimpleNamespace(id="message", body="Preview", provider_id="folder:remote")
    monkeypatch.setattr(
        providers, "zoho_request", lambda *a, **k: {"content": "Hello &amp; goodbye"}
    )
    assert providers.fetch_body(c, None, msg) == {"body": "Hello & goodbye", "html": ""}


def test_actions_commit_only_after_provider_confirmation(
    signed_client, user, accounts, monkeypatch
):
    with Session() as db:
        message = db.query(Message).filter_by(mailbox=accounts[0].id).first()
        id = message.id
    path = "/api/v1/email/mailboxes/" + accounts[0].id + "/messages/" + id + "/action"

    def failure(*args, **kwargs):
        raise RuntimeError("provider rejected")

    monkeypatch.setattr("app.mail_client.change_message", failure)
    assert signed_client.post(path, json={"action": "read"}).status_code == 409
    with Session() as db:
        assert db.get(Message, id).unread

    def success(c, db, message, action, destination):
        message.unread = False

    monkeypatch.setattr("app.mail_client.change_message", success)
    assert signed_client.post(path, json={"action": "read"}).status_code == 200
    with Session() as db:
        assert not db.get(Message, id).unread


def test_mail_upload_ownership_and_spoofed_sender(signed_client, user, accounts):
    root = "/api/v1/email/mailboxes/" + accounts[0].id
    uploaded = signed_client.post(
        root + "/uploads?name=report.txt",
        content=b"private attachment",
        headers={"Content-Type": "text/plain"},
    )
    assert uploaded.status_code == 201, uploaded.text
    id = uploaded.json()["id"]
    with Session() as db:
        row = db.get(MailUpload, id)
        assert "private attachment" not in row.content
    assert (
        signed_client.get(
            "/api/v1/email/mailboxes/" + accounts[1].id + "/uploads/" + id
        ).status_code
        == 422
    )
    result = signed_client.post(
        root + "/send",
        json={
            "mailbox": accounts[0].id,
            "from_address": "forged@example.com",
            "to": ["recipient@example.com"],
        },
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert result.status_code == 422
    result = signed_client.post(
        root + "/send",
        json={
            "mailbox": accounts[0].id,
            "to": ["recipient@example.com"],
            "attachments": [id],
        },
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert result.status_code == 200
    assert signed_client.delete(root + "/uploads/" + id).status_code == 409


def test_mail_actions_and_downloads_are_owner_scoped(
    signed_client, user, accounts, monkeypatch
):
    with Session() as db:
        other = User(
            issuer="other", subject="other", name="Other", email="other@example.com"
        )
        db.add(other)
        db.flush()
        connection = Connection(
            owner=other.id, provider="imap", label="Other", address=other.email
        )
        db.add(connection)
        db.flush()
        message = Message(
            mailbox=connection.id,
            provider_id="INBOX:1:1",
            sender="sender@example.com",
            recipients=other.email,
            subject="Private",
        )
        db.add(message)
        db.commit()
        mid = message.id
    root = "/api/v1/email/mailboxes/" + accounts[0].id + "/messages/" + mid
    assert (
        signed_client.post(root + "/action", json={"action": "trash"}).status_code
        == 404
    )
    assert signed_client.get(root + "/attachments/1").status_code == 404


def test_zoho_message_actions_use_documented_payloads(monkeypatch):
    calls = []
    monkeypatch.setattr(
        providers,
        "zoho_request",
        lambda c, db, method, path, **kwargs: calls.append((method, path, kwargs))
        or {},
    )
    c = SimpleNamespace(provider="zoho", owner="owner", id="connection")
    msg = SimpleNamespace(
        provider_id="inbox:remote",
        id="message",
        unread=True,
        starred=False,
        folder="inbox",
    )
    change_message(c, None, msg, "read")
    assert calls[-1][2]["json"] == {"messageId": ["remote"], "mode": "markAsRead"}
    change_message(c, None, msg, "star")
    assert calls[-1][2]["json"]["flagid"] == "important"
    change_message(c, None, msg, "trash", {"id": "trash-folder", "key": "trash"})
    assert calls[-1][2]["json"]["destfolderId"] == "trash-folder"
    assert msg.folder == "trash" and msg.provider_id == "trash-folder:remote"


def test_upgrade_from_existing_mail_schema_preserves_messages(user, accounts):
    from app.core import engine
    from sqlalchemy import text
    from alembic.config import Config
    from alembic import command

    with engine.begin() as connection:
        before = connection.execute(
            text("SELECT id,subject,body FROM messages ORDER BY id")
        ).all()
        for name in ("cc", "reply_to", "rfc_id"):
            connection.execute(text("ALTER TABLE messages DROP COLUMN " + name))
        connection.execute(text("DROP TABLE mail_uploads"))
    config = Config("alembic.ini")
    command.stamp(config, "0004")
    command.upgrade(config, "head")
    with engine.connect() as connection:
        assert (
            connection.execute(
                text("SELECT id,subject,body FROM messages ORDER BY id")
            ).all()
            == before
        )
        assert connection.execute(
            text(
                "SELECT count(*) FROM messages WHERE cc='' AND reply_to='' AND rfc_id='' "
            )
        ).scalar() == len(before)


def test_search_includes_body_and_saved_attachments_cannot_be_deleted(
    signed_client, accounts
):
    with Session() as db:
        message = db.query(Message).filter_by(mailbox=accounts[0].id).first()
        message.body = "An uncommon searchtoken in the body"
        db.commit()
    found = signed_client.get(
        "/api/v1/email/messages", params={"q": "searchtoken"}
    ).json()["items"]
    assert len(found) == 1
    root = "/api/v1/email/mailboxes/" + accounts[0].id
    uploaded = signed_client.post(
        root + "/uploads?name=note.txt",
        content=b"note",
        headers={"Content-Type": "text/plain"},
    ).json()
    payload = {"mailbox": accounts[0].id, "attachments": [uploaded["id"]]}
    draft = signed_client.post("/api/v1/email/drafts", json=payload).json()
    assert signed_client.delete(root + "/uploads/" + uploaded["id"]).status_code == 409
    signed_client.delete("/api/v1/email/drafts/" + draft["id"])
    assert signed_client.delete(root + "/uploads/" + uploaded["id"]).status_code == 204
