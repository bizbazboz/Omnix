from types import SimpleNamespace
from email.message import EmailMessage
from app.core import encrypt
import app.providers as providers


def test_imap_uidvalidity_mime_and_peek(monkeypatch):
    msg = EmailMessage()
    msg["From"] = "Maya <maya@example.com>"
    msg["To"] = "alex@example.com"
    msg["Subject"] = "A café in London"
    msg["Date"] = "Mon, 26 Oct 2026 10:00:00 +0000"
    msg.set_content("A plain text body with café.")
    raw = msg.as_bytes()
    calls = []

    class FakeIMAP:
        validity = b"99"

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def select(self, *args, **kwargs):
            assert kwargs["readonly"] is True
            return "OK", [b"1"]

        def list(self):
            return "OK", [b'(\\HasNoChildren) "/" "INBOX"']

        def response(self, name):
            return name, [self.validity]

        def uid(self, command, *args):
            calls.append((command, args))
            if command == "search":
                return "OK", [b"41"]
            if args[1] == "(RFC822.SIZE)":
                return "OK", [b"1 (RFC822.SIZE 700)"]
            assert "BODY.PEEK[]" in args[1]
            return "OK", [(b"1 (FLAGS (\\Seen) BODY[] {700}", raw)]

    client = FakeIMAP()
    monkeypatch.setattr(providers, "imap_client", lambda config: client)
    c = SimpleNamespace(
        provider="imap", credentials=encrypt({}), address="alex@example.com"
    )
    first = list(providers.fetch_messages(c, None))[0]
    assert first["provider_id"] == "INBOX:99:41"
    assert first["subject"] == "A café in London"
    assert "café" in first["body"]
    assert first["unread"] is False
    client.validity = b"100"
    assert list(providers.fetch_messages(c, None))[0]["provider_id"] == "INBOX:100:41"


def test_smtp_partial_refusal_keeps_bcc_out_of_headers(monkeypatch):
    captured = {}

    class FakeSMTP:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def send_message(self, msg, from_addr, to_addrs):
            captured.update(message=msg, envelope=to_addrs, sender=from_addr)
            return {"refused@example.com": (550, b"no such user")}

    monkeypatch.setattr(providers, "smtp_client", lambda config: FakeSMTP())
    c = SimpleNamespace(
        provider="imap", address="alex@example.com", credentials=encrypt({})
    )
    payload = {
        "to": ["accepted@example.com", "refused@example.com"],
        "cc": [],
        "bcc": ["private@example.com"],
        "subject": "Hello",
        "body": "Plain text",
    }
    result = providers.send_message(c, None, payload, "stable-attempt-id")
    assert result["accepted"] is True
    assert result["refused"] == ["refused@example.com"]
    assert captured["message"]["Bcc"] is None
    assert "private@example.com" in captured["envelope"]
    assert captured["sender"] == "alex@example.com"
    assert captured["message"]["Message-ID"] == "<stable-attempt-id@omnix.local>"


def test_zoho_discovers_inbox_and_uses_authorized_account(monkeypatch):
    calls = []

    def request(c, db, method, path, **kwargs):
        calls.append((path, kwargs))
        if path == "/folders":
            return [{"folderId": "folder-one", "folderName": "Inbox"}]
        if path == "":
            return {}
        if path == "/messages/search":
            return []
        return [
            {
                "messageId": "message-one",
                "subject": "Hello",
                "receivedTime": "1793000000000",
                "fromAddress": "maya@example.com",
            }
        ]

    monkeypatch.setattr(providers, "zoho_request", request)
    c = SimpleNamespace(provider="zoho", address="alex@example.com")
    messages = list(providers.fetch_messages(c, None))
    assert messages[0]["provider_id"] == "folder-one:message-one"
    assert (
        next(kw for path, kw in calls if path == "/messages/view")["params"]["folderId"]
        == "folder-one"
    )
