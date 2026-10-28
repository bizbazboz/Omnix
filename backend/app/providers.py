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
SCOPES = "ZohoMail.accounts.READ,ZohoMail.folders.READ,ZohoMail.folders.CREATE,ZohoMail.messages.READ,ZohoMail.messages.CREATE,ZohoMail.messages.UPDATE"


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
    payload = response.json()
    if int(payload.get("status", {}).get("code", 200)) >= 400:
        raise ProviderError(
            "Zoho rejected the operation. Check permissions and reconnect if needed."
        )
    return payload.get("data", {})


def send_message(c, db, payload, attempt_id):
    sender = payload.get("from_address") or c.address
    if c.provider == "zoho":
        outgoing = {
            "fromAddress": sender,
            "toAddress": ",".join(payload["to"]),
            "ccAddress": ",".join(payload.get("cc", [])),
            "bccAddress": ",".join(payload.get("bcc", [])),
            "subject": payload["subject"],
            "content": payload["body"],
            "mailFormat": "plaintext",
        }
        if payload.get("_attachments"):
            outgoing["attachments"] = payload["_attachments"]
        path = "/messages"
        if payload.get("_reply_provider_id"):
            path += "/" + payload["_reply_provider_id"]
            outgoing["action"] = "reply"
        response = zoho_request(
            c,
            db,
            "POST",
            path,
            json=outgoing,
        )
        return {"accepted": True, "receipt": str(response.get("messageId", "accepted"))}
    config = decrypt(c.credentials)
    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = ", ".join(payload["to"])
    msg["Subject"] = payload["subject"]
    msg["Message-ID"] = "<" + attempt_id + "@omnix.local>"
    if payload.get("cc"):
        msg["Cc"] = ", ".join(payload["cc"])
    msg.set_content(payload["body"])
    if payload.get("_reply_rfc_id"):
        msg["In-Reply-To"] = payload["_reply_rfc_id"]
        msg["References"] = payload["_reply_rfc_id"]
    for item in payload.get("_attachments", []):
        import base64

        mime = item["content_type"].split("/", 1)
        msg.add_attachment(
            base64.b64decode(item["content"]),
            maintype=mime[0],
            subtype=mime[1],
            filename=item["name"],
        )
    with smtp_client(config) as client:
        refused = client.send_message(
            msg,
            from_addr=sender,
            to_addrs=payload["to"] + payload.get("cc", []) + payload.get("bcc", []),
        )
    sent_copy = "unavailable"
    try:
        from .mail_provider import profile

        folder = next(
            (f for f in profile(c, db)["folders"] if f["key"] == "sent"), None
        )
        if folder:
            with imap_client(config) as client:
                status, _ = client.append(
                    '"' + folder["id"].replace('"', '\\"') + '"',
                    "\\Seen",
                    None,
                    msg.as_bytes(),
                )
                sent_copy = "saved" if status == "OK" else "failed"
    except Exception:
        sent_copy = "failed"
    return {
        "accepted": True,
        "receipt": str(msg["Message-ID"]),
        "refused": list(refused),
        "sent_copy": sent_copy,
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
    import html as html_module
    from .mail_render import plain_text

    content = str(data.get("content", ""))[:1000000]
    if re.match(r"^\s*&lt;(?:!doctype|html|div|table|p\b)", content, re.I):
        content = html_module.unescape(content)
    is_html = bool(
        re.search(r"<(?:html|body|div|p|table|style|br|span|a)\b", content, re.I)
    )
    result = {
        "body": plain_text(content) if is_html else html_module.unescape(content),
        "html": content if is_html else "",
    }
    redis.setex(key, 300, json.dumps(result))
    return result


def fetch_messages(c, db):
    from .mail_provider import fetch_recent

    return fetch_recent(c, db)
