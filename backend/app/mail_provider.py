"""Mail folders, sender identities, MIME data and provider-backed actions."""

import base64
import email
import email.policy
import html
import json
import re
from datetime import datetime, timezone
from email.header import decode_header, make_header
from email.utils import parseaddr, parsedate_to_datetime
from urllib.parse import quote
import httpx
from . import providers as transport
from .core import decrypt, encrypt, redis, now
from .mail_render import plain_text

MAX_ATTACHMENT = 20 * 1024 * 1024
KINDS = {
    "inbox": "inbox",
    "sent": "sent",
    "sent mail": "sent",
    "sent items": "sent",
    "trash": "trash",
    "deleted items": "trash",
    "junk": "spam",
    "spam": "spam",
    "archive": "archive",
    "drafts": "provider-drafts",
}


def folder_kind(name, flags=""):
    for flag, kind in [
        ("\\sent", "sent"),
        ("\\trash", "trash"),
        ("\\junk", "spam"),
        ("\\archive", "archive"),
        ("\\drafts", "provider-drafts"),
    ]:
        if flag in flags.lower():
            return kind
    return KINDS.get(name.lower())


def profile(c, db, fresh=False):
    key = "mail-profile:" + str(getattr(c, "id", ""))
    cached = redis.get(key) if getattr(c, "id", None) and not fresh else None
    if cached:
        return decrypt(cached)
    identities = [
        {"address": c.address, "name": getattr(c, "label", ""), "primary": True}
    ]
    scopes = (
        decrypt(c.credentials).get("scopes", [])
        if getattr(c, "credentials", "")
        else []
    )
    if c.provider == "zoho":
        folders = transport.zoho_request(c, db, "GET", "/folders")
        result = []
        for f in folders:
            name = str(f.get("folderName", "Folder"))
            id = str(f["folderId"])
            kind = folder_kind(str(f.get("path", name)).split("/")[-1])
            result.append(
                {
                    "id": id,
                    "name": name,
                    "key": kind or "folder:" + id,
                    "kind": kind or "custom",
                }
            )
        account = transport.zoho_request(c, db, "GET", "")
        if not any(f["key"] == "archive" for f in result):
            result.append(
                {"id": "", "name": "Archive", "key": "archive", "kind": "archive"}
            )
        if isinstance(account, dict):
            addresses = []
            for a in account.get("emailAddress", []):
                if a.get("mailId") and (
                    a.get("isConfirmed") is True or a.get("isPrimary") is True
                ):
                    addresses.append(
                        {
                            "address": a["mailId"],
                            "name": account.get("displayName", ""),
                            "primary": a.get("isPrimary", False),
                        }
                    )
            for a in account.get("sendMailDetails", []):
                if (
                    a.get("fromAddress")
                    and (a.get("validated") is True or a.get("status") is True)
                    and a.get("status") is not False
                ):
                    addresses.append(
                        {
                            "address": a["fromAddress"],
                            "name": a.get("displayName", ""),
                            "primary": False,
                        }
                    )
            seen = {c.address.lower()}
            for a in addresses:
                if a["address"].lower() not in seen:
                    seen.add(a["address"].lower())
                    identities.append(a)
    else:
        result = []
        with transport.imap_client(decrypt(c.credentials)) as client:
            status, rows = client.list()
            if status != "OK":
                raise transport.ProviderError("Could not list folders")
            for raw in rows:
                if not raw:
                    continue
                match = re.match(rb'\((.*?)\)\s+(?:"[^"]*"|NIL)\s+(.+)', raw)
                if not match or b"\\Noselect" in match[1]:
                    continue
                id = (
                    match[2]
                    .decode("ascii")
                    .strip('"')
                    .replace('\\"', '"')
                    .replace("\\\\", "\\")
                )
                name = decode_folder(id)
                kind = folder_kind(name, match[1].decode())
                result.append(
                    {
                        "id": id,
                        "name": name,
                        "key": kind or "folder:" + id,
                        "kind": kind or "custom",
                    }
                )
    value = {
        "identities": identities,
        "folders": result,
        "needs_reconnect": c.provider == "zoho"
        and not any(
            s in scopes for s in ["ZohoMail.messages.UPDATE", "ZohoMail.messages.ALL"]
        ),
    }
    if getattr(c, "id", None):
        redis.setex(key, 600, encrypt(value))
    return value


def decode_folder(value):
    def convert(match):
        raw = match[1]
        if not raw:
            return "&"
        try:
            return base64.b64decode(
                raw.replace(",", "/") + "=" * ((-len(raw)) % 4)
            ).decode("utf-16-be")
        except Exception:
            return match[0]

    return re.sub(r"&([^-]*)-", convert, value)


def mime_data(raw):
    msg = email.message_from_bytes(raw, policy=email.policy.default)
    text = []
    markup = []
    attachments = []
    inline = {}
    for index, part in enumerate(msg.walk()):
        if part.is_multipart():
            continue
        content = part.get_payload(decode=True) or b""
        cid = str(part.get("Content-ID", "")).strip("<>")
        if part.get_content_disposition() == "attachment" or part.get_filename() or cid:
            attachments.append(
                {
                    "id": str(index),
                    "name": part.get_filename() or "inline-image",
                    "size": len(content),
                    "content_type": part.get_content_type(),
                    "cid": cid,
                }
            )
            if (
                cid
                and part.get_content_type()
                in ("image/png", "image/jpeg", "image/gif", "image/webp")
                and len(content) < 512000
            ):
                inline[cid] = (
                    "data:"
                    + part.get_content_type()
                    + ";base64,"
                    + base64.b64encode(content).decode()
                )
            continue
        if part.get_content_type() in ("text/plain", "text/html"):
            try:
                value = content.decode(
                    part.get_content_charset() or "utf-8", errors="replace"
                )
            except LookupError:
                value = content.decode("utf-8", errors="replace")
            (text if part.get_content_type() == "text/plain" else markup).append(value)
    markup = "\n".join(markup)
    for cid, data in inline.items():
        markup = markup.replace("cid:" + cid, data)
    return {
        "body": "\n".join(text) or plain_text(markup),
        "html": markup,
        "attachments": attachments,
        "cc": str(msg.get("Cc", "")),
        "reply_to": parseaddr(str(msg.get("Reply-To", "")))[1],
        "rfc_id": str(msg.get("Message-ID", "")),
    }


def fetch_recent(c, db, only=None, start=1):
    folders = profile(c, db)["folders"]
    if only:
        folders = [f for f in folders if f["key"] == only]
    else:
        folders = [f for f in folders if f["kind"] != "provider-drafts"]
    if c.provider == "zoho":
        for folder in folders:
            if folder["key"] == "archive" and not folder["id"]:
                rows = transport.zoho_request(
                    c,
                    db,
                    "GET",
                    "/messages/search",
                    params={"searchKey": "in:archive", "start": start, "limit": 200},
                )
            else:
                rows = transport.zoho_request(
                    c,
                    db,
                    "GET",
                    "/messages/view",
                    params={
                        "folderId": folder["id"],
                        "start": start,
                        "limit": 200,
                        "includeto": "true",
                        "fields": "subject,messageId,folderId,fromAddress,toAddress,ccAddress,receivedTime,sender,status,flagid,summary",
                    },
                )
            for m in rows:
                remote = str(m.get("folderId") or folder["id"])
                if not remote:
                    continue
                yield {
                    "provider_id": remote + ":" + str(m["messageId"]),
                    "folder": folder["key"],
                    "sender": html.unescape(m.get("fromAddress", "")),
                    "sender_name": html.unescape(m.get("sender", "")),
                    "recipients": html.unescape(m.get("toAddress", c.address)),
                    "cc": html.unescape(m.get("ccAddress", "")),
                    "subject": html.unescape(m.get("subject", "(No subject)")),
                    "body": plain_text(m.get("summary", "")),
                    "unread": str(m.get("status", "0")) == "0",
                    "starred": str(m.get("flagid", "0"))
                    not in ("0", "", "flag_not_set"),
                    "date": datetime.fromtimestamp(
                        int(m.get("receivedTime", 0)) / 1000, timezone.utc
                    ),
                }
        return
    with transport.imap_client(decrypt(c.credentials)) as client:
        for folder in folders:
            status, _ = client.select(
                '"' + folder["id"].replace("\\", "\\\\").replace('"', '\\"') + '"',
                readonly=True,
            )
            if status != "OK":
                continue
            validity = client.response("UIDVALIDITY")[1][0].decode()
            status, data = client.uid("search", None, "ALL")
            if status != "OK":
                continue
            ids = list(reversed(data[0].split()))[start - 1 : start + 199]
            for id in ids:
                status, size = client.uid("fetch", id, "(RFC822.SIZE)")
                match = (
                    re.search(
                        rb"RFC822.SIZE (\d+)",
                        b" ".join(x for x in size if isinstance(x, bytes)),
                    )
                    if status == "OK"
                    else None
                )
                if not match or int(match[1]) > MAX_ATTACHMENT:
                    continue
                status, parts = client.uid("fetch", id, "(BODY.PEEK[] FLAGS)")
                parts = [p for p in parts if isinstance(p, tuple)]
                if status != "OK" or not parts or len(parts[0][1]) > MAX_ATTACHMENT:
                    continue
                raw = parts[0][1]
                msg = email.message_from_bytes(raw, policy=email.policy.default)
                data = mime_data(raw)
                try:
                    date = parsedate_to_datetime(msg.get("Date", ""))
                except Exception:
                    date = now()
                if date.tzinfo is None:
                    date = date.replace(tzinfo=timezone.utc)
                yield {
                    "provider_id": folder["id"] + ":" + validity + ":" + id.decode(),
                    "folder": folder["key"],
                    "sender": parseaddr(str(msg.get("From", "")))[1],
                    "sender_name": parseaddr(str(msg.get("From", "")))[0],
                    "recipients": str(msg.get("To", "")),
                    "subject": str(msg.get("Subject", "(No subject)")),
                    "body": data["body"][:200000],
                    "html": data["html"][:1000000],
                    "cc": data["cc"],
                    "reply_to": data["reply_to"],
                    "rfc_id": data["rfc_id"],
                    "date": date,
                    "unread": b"\\Seen" not in parts[0][0],
                    "starred": b"\\Flagged" in parts[0][0],
                }


def message_parts(message):
    return (
        message.provider_id.rsplit(":", 2)
        if message.provider_id.count(":") >= 2
        else message.provider_id.split(":", 1)
    )


def imap_raw(c, message):
    folder, validity, id = message_parts(message)
    with transport.imap_client(decrypt(c.credentials)) as client:
        status, _ = client.select('"' + folder.replace('"', '\\"') + '"', readonly=True)
        if status != "OK" or client.response("UIDVALIDITY")[1][0].decode() != validity:
            raise transport.ProviderError("Message no longer available")
        status, size = client.uid("fetch", id, "(RFC822.SIZE)")
        match = (
            re.search(
                rb"RFC822.SIZE (\d+)",
                b" ".join(x for x in size if isinstance(x, bytes)),
            )
            if status == "OK"
            else None
        )
        if not match or int(match[1]) > MAX_ATTACHMENT:
            raise transport.ProviderError("Message exceeds download limit")
        status, parts = client.uid("fetch", id, "(BODY.PEEK[])")
        if status != "OK":
            raise transport.ProviderError("Message unavailable")
        return next(p[1] for p in parts if isinstance(p, tuple))


def attachment_info(c, db, message):
    if c.provider != "zoho":
        return mime_data(imap_raw(c, message))["attachments"]
    folder, id = message.provider_id.split(":", 1)
    data = transport.zoho_request(
        c,
        db,
        "GET",
        "/folders/"
        + quote(folder, safe="")
        + "/messages/"
        + quote(id, safe="")
        + "/attachmentinfo",
        params={"includeInline": "true"},
    )
    return [
        {
            "id": str(a["attachmentId"]),
            "name": a.get("attachmentName", "Attachment"),
            "size": int(a.get("attachmentSize", 0)),
            "cid": a.get("cid", ""),
        }
        for a in data.get("attachments", []) + data.get("inline", [])
    ]


def download_attachment(c, db, message, id):
    if c.provider != "zoho":
        raw = imap_raw(c, message)
        msg = email.message_from_bytes(raw, policy=email.policy.default)
        parts = list(msg.walk())
        if not id.isdigit() or int(id) >= len(parts):
            raise transport.ProviderError("Attachment unavailable")
        part = parts[int(id)]
        if not part.get_filename() and not part.get("Content-ID"):
            raise transport.ProviderError("Not an attachment")
        return part.get_payload(decode=True) or b""
    folder, mid = message.provider_id.split(":", 1)
    path = (
        "/folders/"
        + quote(folder, safe="")
        + "/messages/"
        + quote(mid, safe="")
        + "/attachments/"
        + quote(id, safe="")
    )
    token = transport.zoho_token(c, db)
    with httpx.stream(
        "GET",
        transport.REGIONS[c.region][1] + "/api/accounts/" + c.account_id + path,
        headers={"Authorization": "Zoho-oauthtoken " + token},
        timeout=25,
    ) as response:
        response.raise_for_status()
        data = bytearray()
        for chunk in response.iter_bytes():
            data.extend(chunk)
            if len(data) > MAX_ATTACHMENT:
                raise transport.ProviderError("Attachment exceeds 20 MiB")
        return bytes(data)


def change_message(c, db, message, action, destination=None):
    if c.provider == "zoho":
        folder, id = message.provider_id.split(":", 1)
        payload = {"messageId": [id]}
        if action in ("read", "unread"):
            payload["mode"] = "markAsRead" if action == "read" else "markAsUnread"
        elif action in ("star", "unstar"):
            payload.update(
                mode="setFlag",
                flagid="important" if action == "star" else "flag_not_set",
            )
        elif action == "archive":
            payload["mode"] = "archiveMails"
        elif action == "spam":
            payload["mode"] = "moveToSpam"
        elif destination:
            payload.update(mode="moveMessage", destfolderId=destination["id"])
        else:
            raise transport.ProviderError("Unsupported action")
        transport.zoho_request(c, db, "PUT", "/updatemessage", json=payload)
        if destination and action not in ("archive",):
            message.provider_id = destination["id"] + ":" + id
    else:
        folder, validity, id = message_parts(message)
        with transport.imap_client(decrypt(c.credentials)) as client:
            status, _ = client.select(
                '"' + folder.replace('"', '\\"') + '"', readonly=False
            )
            if (
                status != "OK"
                or client.response("UIDVALIDITY")[1][0].decode() != validity
            ):
                raise transport.ProviderError("Message moved; refresh first")
            if action in ("read", "unread", "star", "unstar"):
                status, _ = client.uid(
                    "store",
                    id,
                    "+FLAGS.SILENT" if action in ("read", "star") else "-FLAGS.SILENT",
                    "(\\Seen)" if action in ("read", "unread") else "(\\Flagged)",
                )
            elif destination:
                # MOVE avoids expunging other messages or leaving duplicate copies on failure.
                if (
                    b"MOVE" not in client.capabilities
                    and "MOVE" not in client.capabilities
                ):
                    raise transport.ProviderError(
                        "This server does not support safe IMAP MOVE"
                    )
                status, _ = client.uid(
                    "MOVE", id, '"' + destination["id"].replace('"', '\\"') + '"'
                )
            else:
                raise transport.ProviderError("Folder unavailable")
            if status != "OK":
                raise transport.ProviderError("Server rejected the change")
    if action in ("read", "unread"):
        message.unread = action == "unread"
    elif action in ("star", "unstar"):
        message.starred = action == "star"
    elif destination:
        message.folder = destination["key"]
    elif action == "archive":
        message.folder = "archive"
    elif action == "spam":
        message.folder = "spam"
    redis.delete("body:" + c.owner + ":" + c.id + ":" + message.id)
