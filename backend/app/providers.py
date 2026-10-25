"""Mail transports. Blocking protocol I/O runs in worker processes, never API loops."""

import os, socket, ipaddress, ssl, imaplib, smtplib, email, hashlib, re
from email.message import EmailMessage
from email.header import decode_header, make_header
from email.utils import parsedate_to_datetime, parseaddr
import httpx
from .core import decrypt, encrypt, redis, now

REGIONS = {
    "us": ("https://accounts.zoho.com", "https://mail.zoho.com"),
    "eu": ("https://accounts.zoho.eu", "https://mail.zoho.eu"),
    "in": ("https://accounts.zoho.in", "https://mail.zoho.in"),
    "au": ("https://accounts.zoho.com.au", "https://mail.zoho.com.au"),
}
SCOPES = "ZohoMail.accounts.READ,ZohoMail.folders.READ,ZohoMail.messages.READ,ZohoMail.messages.CREATE"


class ProviderError(Exception):
    pass


def checked_host(host, port):
    if not host or port not in (993, 465, 587):
        raise ProviderError("Use IMAP 993 or SMTP 465/587 with verified TLS")
    from .workspace_settings import load_setting

    allowed = load_setting("workspace", {}).get("private_mail_hosts", [])
    addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    if not addresses:
        raise ProviderError("Host not found")
    for entry in addresses:
        ip = ipaddress.ip_address(entry[4][0])
        if not ip.is_global and host not in allowed:
            raise ProviderError("Mail host is blocked by outbound policy")
    # Connect to the validated IP; retain original hostname for certificate checks.
    return addresses[0][4][0]


class PinnedIMAP(imaplib.IMAP4_SSL):
    def _create_socket(self, timeout):
        sock = socket.create_connection((self.pinned, self.port), timeout)
        return self.ssl_context.wrap_socket(sock, server_hostname=self.host)


class PinnedSMTP(smtplib.SMTP):
    def _get_socket(self, host, port, timeout):
        return socket.create_connection((self.pinned, port), timeout)


class PinnedSMTPSSL(smtplib.SMTP_SSL):
    def _get_socket(self, host, port, timeout):
        return self.context.wrap_socket(
            socket.create_connection((self.pinned, port), timeout), server_hostname=host
        )


def imap_client(config):
    cls = type(
        "CheckedIMAP", (PinnedIMAP,), {"pinned": checked_host(config["imap_host"], 993)}
    )
    c = cls(
        config["imap_host"], 993, ssl_context=ssl.create_default_context(), timeout=15
    )
    c.login(config["imap_user"], config["imap_password"])
    return c


def smtp_client(config):
    port = int(config.get("smtp_port", 465))
    host = config["smtp_host"]
    base = PinnedSMTPSSL if port == 465 else PinnedSMTP
    cls = type("CheckedSMTP", (base,), {"pinned": checked_host(host, port)})
    c = cls(
        host,
        port,
        timeout=15,
        **({"context": ssl.create_default_context()} if port == 465 else {}),
    )
    if port == 587:
        c.ehlo()
        c.starttls(context=ssl.create_default_context())
        c.ehlo()
    c.login(config["smtp_user"], config["smtp_password"])
    return c


def validate_protocol(config):
    if config.get("imap_host"):
        with imap_client(config) as client:
            client.list()
    if config.get("smtp_host"):
        with smtp_client(config) as client:
            client.noop()


def zoho_token(connection, db):
    with redis.lock("refresh:" + connection.id, timeout=40, blocking_timeout=20):
        db.refresh(connection)
        creds = decrypt(connection.credentials)
        import time

        if creds.get("expires_at", 0) > time.time() + 90:
            return creds["access_token"]
        auth, _ = REGIONS[connection.region]
        from .workspace_settings import load_zoho

        registration = load_zoho()
        if not registration:
            raise ProviderError("Zoho registration missing; ask an administrator")
        # Existing grants retain the client used to issue their refresh token.
        client = creds.get("oauth_client", registration)
        if client["client_id"] == registration["client_id"]:
            client = registration
        r = httpx.post(
            auth + "/oauth/v2/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": creds["refresh_token"],
                "client_id": client["client_id"],
                "client_secret": client["client_secret"],
            },
            timeout=15,
        )
        data = r.json()
        if "access_token" not in data:
            raise ProviderError("Consent expired; reconnect account")
        creds.update(
            access_token=data["access_token"],
            expires_at=time.time() + data.get("expires_in", 3600),
        )
        if data.get("refresh_token"):
            creds["refresh_token"] = data["refresh_token"]
        creds["oauth_client"] = {
            "client_id": client["client_id"],
            "client_secret": client["client_secret"],
        }
        connection.credentials = encrypt(creds)
        db.commit()
        return creds["access_token"]


def zoho_request(c, db, method, path, **kwargs):
    token = zoho_token(c, db)
    base = REGIONS[c.region][1]
    response = httpx.request(
        method,
        base + "/api/accounts/" + c.account_id + path,
        headers={"Authorization": "Zoho-oauthtoken " + token},
        timeout=20,
        **kwargs,
    )
    if response.status_code == 429:
        raise ProviderError("Provider rate limited; retry later")
    if response.status_code in (401, 403):
        raise ProviderError("Permissions missing; reconnect account")
    response.raise_for_status()
    return response.json().get("data", {})


def fetch_messages(c, db):
    if c.provider == "zoho":
        folders = zoho_request(c, db, "GET", "/folders")
        inbox = next(
            (
                str(f["folderId"])
                for f in folders
                if f.get("folderName", "").lower() == "inbox"
            ),
            None,
        )
        if not inbox:
            raise ProviderError("Inbox folder was not discovered")
        data = zoho_request(
            c,
            db,
            "GET",
            "/messages/view",
            params={"folderId": inbox, "start": 1, "limit": 100},
        )
        return [
            {
                "provider_id": inbox + ":" + str(m["messageId"]),
                "sender": m.get("fromAddress", ""),
                "sender_name": m.get("sender", ""),
                "recipients": m.get("toAddress", c.address),
                "subject": m.get("subject", "(No subject)"),
                "body": m.get("summary", ""),
                "unread": str(m.get("status", "0")) == "0",
                "date": __import__("datetime").datetime.fromtimestamp(
                    int(m.get("receivedTime", 0)) / 1000,
                    __import__("datetime").timezone.utc,
                ),
            }
            for m in data
        ]
    config = decrypt(c.credentials)
    out = []
    with imap_client(config) as client:
        client.select("INBOX", readonly=True)
        validity = client.response("UIDVALIDITY")[1][0].decode()
        status, data = client.uid("search", None, "ALL")
        if status != "OK":
            raise ProviderError("Unable to list inbox")
        for item in data[0].split()[-100:]:
            status, sizes = client.uid("fetch", item, "(RFC822.SIZE)")
            match = (
                re.search(
                    rb"RFC822.SIZE (\d+)",
                    b" ".join(x for x in sizes if isinstance(x, bytes)),
                )
                if status == "OK"
                else None
            )
            if not match or int(match.group(1)) > 2_000_000:
                continue
            status, raw = client.uid("fetch", item, "(BODY.PEEK[] FLAGS)")
            if status != "OK":
                continue
            parts = [p for p in raw if isinstance(p, tuple)]
            if not parts or len(parts[0][1]) > 2_000_000:
                continue
            msg = email.message_from_bytes(parts[0][1])
            body = ""
            html = ""
            for part in msg.walk():
                if part.get_content_disposition() == "attachment":
                    continue
                if part.get_content_type() in ("text/plain", "text/html"):
                    value = (part.get_payload(decode=True) or b"").decode(
                        part.get_content_charset() or "utf-8", errors="replace"
                    )
                    if part.get_content_type() == "text/plain":
                        body += value
                    else:
                        html += value
            try:
                date = parsedate_to_datetime(msg.get("Date", ""))
            except Exception:
                date = now()
            out.append(
                {
                    "provider_id": "INBOX:" + validity + ":" + item.decode(),
                    "sender": parseaddr(msg.get("From", ""))[1],
                    "sender_name": str(
                        make_header(decode_header(parseaddr(msg.get("From", ""))[0]))
                    ),
                    "recipients": msg.get("To", ""),
                    "subject": str(
                        make_header(decode_header(msg.get("Subject", "(No subject)")))
                    ),
                    "body": body[:200000],
                    "html": html[:200000],
                    "date": date,
                    "unread": b"\\Seen" not in parts[0][0],
                }
            )
    return out


def send_message(c, db, payload, attempt_id):
    if c.provider == "zoho":
        response = zoho_request(
            c,
            db,
            "POST",
            "/messages",
            json={
                "fromAddress": c.address,
                "toAddress": ",".join(payload["to"]),
                "ccAddress": ",".join(payload.get("cc", [])),
                "bccAddress": ",".join(payload.get("bcc", [])),
                "subject": payload["subject"],
                "content": payload["body"],
                "mailFormat": "plaintext",
            },
        )
        return {"accepted": True, "receipt": str(response.get("messageId", "accepted"))}
    config = decrypt(c.credentials)
    msg = EmailMessage()
    msg["From"] = c.address
    msg["To"] = ", ".join(payload["to"])
    msg["Subject"] = payload["subject"]
    msg["Message-ID"] = "<" + attempt_id + "@omnix.local>"
    if payload.get("cc"):
        msg["Cc"] = ", ".join(payload["cc"])
    msg.set_content(payload["body"])
    with smtp_client(config) as client:
        refused = client.send_message(
            msg,
            from_addr=c.address,
            to_addrs=payload["to"] + payload.get("cc", []) + payload.get("bcc", []),
        )
    return {
        "accepted": True,
        "receipt": str(msg["Message-ID"]),
        "refused": list(refused),
        "sent_copy": "not_configured",
    }


def fetch_body(c, db, message):
    if c.provider != "zoho":
        return {"body": message.body, "html": message.html}
    key = "body:" + c.owner + ":" + c.id + ":" + message.id
    cached = redis.get(key)
    import json

    if cached:
        return json.loads(cached)
    folder_id, provider_id = message.provider_id.split(":", 1)
    data = zoho_request(
        c, db, "GET", "/folders/" + folder_id + "/messages/" + provider_id + "/content"
    )
    content = str(data.get("content", ""))[:200000]
    result = {"body": message.body, "html": content}
    redis.setex(key, 300, json.dumps(result))
    return result
