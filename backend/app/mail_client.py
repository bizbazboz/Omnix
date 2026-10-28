"""Authenticated mail operations with provider confirmation before local changes."""

import base64
import re
from typing import Literal
from urllib.parse import quote
from fastapi import APIRouter, Depends, HTTPException, Request, Response, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from .core import (
    Session,
    Connection,
    Message,
    MailUpload,
    User,
    encrypt,
    decrypt,
    redis,
)
from . import providers
from .mail_provider import profile, change_message, attachment_info, download_attachment
from .mail_render import sanitize_email


def validate_sender(c, db, value, fresh=False):
    sender = value or c.address
    # Primary SMTP identities do not need IMAP discovery.
    allowed = (
        [c.address]
        if c.provider != "zoho"
        else [i["address"] for i in profile(c, db, fresh)["identities"]]
    )
    if sender.lower() not in {a.lower() for a in allowed}:
        raise HTTPException(422, "Choose a confirmed sender address from this account.")
    return next(a for a in allowed if a.lower() == sender.lower())


def upload_rows(c, db, ids):
    rows = []
    for id in dict.fromkeys(ids):
        row = db.get(MailUpload, id)
        if not row or row.owner != c.owner or row.mailbox != c.id:
            raise HTTPException(422, "An attachment is unavailable for this account.")
        rows.append(row)
    if sum(r.size for r in rows) > 20 * 1024 * 1024:
        raise HTTPException(422, "Attachments must total at most 20 MiB.")
    return rows


def prepare_send(c, db, payload):
    result = {
        **payload,
        "from_address": validate_sender(
            c, db, payload.get("from_address", ""), fresh=True
        ),
    }
    attachments = []
    for row in upload_rows(c, db, payload.get("attachments", [])):
        content = decrypt(row.content)["content"]
        if c.provider == "zoho":
            value = providers.zoho_request(
                c,
                db,
                "POST",
                "/messages/attachments",
                params={"fileName": row.name, "isInline": "false"},
                content=base64.b64decode(content),
            )
            if isinstance(value, list):
                value = value[0]
            attachments.append(
                {k: value[k] for k in ("attachmentName", "attachmentPath", "storeName")}
            )
        else:
            attachments.append(
                {"name": row.name, "content_type": row.content_type, "content": content}
            )
    result["_attachments"] = attachments
    if payload.get("reply_to_message"):
        message = db.get(Message, payload["reply_to_message"])
        if not message or message.mailbox != c.id:
            raise HTTPException(422, "Reply message unavailable.")
        if c.provider == "zoho":
            result["_reply_provider_id"] = message.provider_id.split(":", 1)[1]
        elif message.rfc_id and not any(x in message.rfc_id for x in "\r\n"):
            result["_reply_rfc_id"] = message.rfc_id
    return result


def render_message(c, db, message):
    content = providers.fetch_body(c, db, message)
    attachments = []
    notice = ""
    try:
        attachments = attachment_info(c, db, message)
        budget = 0
        for item in attachments:
            cid = item.get("cid", "").strip("<>")
            if (
                cid
                and "cid:" + cid in content["html"]
                and item["size"] < 512000
                and budget + item["size"] < 2 * 1024 * 1024
            ):
                raw = download_attachment(c, db, message, item["id"])
                budget += len(raw)
                mime = (
                    "image/png"
                    if raw.startswith(b"\x89PNG")
                    else "image/jpeg"
                    if raw.startswith(b"\xff\xd8")
                    else "image/gif"
                    if raw.startswith(b"GIF8")
                    else "image/webp"
                    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP"
                    else None
                )
                if mime:
                    content["html"] = content["html"].replace(
                        "cid:" + cid,
                        "data:" + mime + ";base64," + base64.b64encode(raw).decode(),
                    )
    except Exception:
        notice = "Attachments could not be loaded. Try refreshing this message."
    return {
        **content,
        "html": sanitize_email(content["html"]),
        "attachments": attachments,
        "attachment_notice": notice,
    }


class MessageAction(BaseModel):
    action: Literal[
        "read", "unread", "star", "unstar", "archive", "spam", "trash", "move"
    ]
    destination: str = Field(default="", max_length=300)


class FolderInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)


def build_mail_router(authenticated, db_session, mailbox):
    router = APIRouter(prefix="/api/v1/email/mailboxes")

    def owned(db, c, id):
        message = db.get(Message, id)
        if not message or message.mailbox != c.id:
            raise HTTPException(404, "Message not found.")
        return message

    @router.get("/{id}/profile")
    def get_profile(id: str, user=Depends(authenticated), db=Depends(db_session)):
        c = mailbox(db, user, id)
        try:
            return profile(c, db)
        except Exception:
            raise HTTPException(
                503,
                "Could not load account folders and aliases. Check the connection and retry.",
            ) from None

    @router.post("/{id}/folders", status_code=201)
    def create_folder(
        id: str, value: FolderInput, user=Depends(authenticated), db=Depends(db_session)
    ):
        c = mailbox(db, user, id)
        name = value.name.strip()
        if not name or any(ord(ch) < 32 for ch in name):
            raise HTTPException(422, "Enter a valid folder name.")
        try:
            if c.provider == "zoho":
                providers.zoho_request(
                    c, db, "POST", "/folders", json={"folderName": name}
                )
            else:
                # Modified UTF-7 is required by IMAP4rev1 for non-ASCII mailbox names.
                encoded = "".join(
                    ch
                    if 0x20 <= ord(ch) <= 0x7E and ch != "&"
                    else "&-"
                    if ch == "&"
                    else "&"
                    + base64.b64encode(ch.encode("utf-16-be"))
                    .decode()
                    .rstrip("=")
                    .replace("/", ",")
                    + "-"
                    for ch in name
                )
                with providers.imap_client(decrypt(c.credentials)) as client:
                    status, _ = client.create('"' + encoded.replace('"', '\\"') + '"')
                    if status != "OK":
                        raise ValueError()
            redis.delete("mail-profile:" + c.id)
            return {"created": True}
        except Exception:
            raise HTTPException(
                409,
                "Folder could not be created. Check its name and provider permissions.",
            ) from None

    @router.post("/{id}/messages/{mid}/action")
    def action(
        id: str,
        mid: str,
        value: MessageAction,
        user=Depends(authenticated),
        db=Depends(db_session),
    ):
        c = mailbox(db, user, id)
        message = owned(db, c, mid)
        try:
            destination = None
            if value.action in ("trash", "spam", "archive", "move"):
                folders = profile(c, db)["folders"]
                target = value.destination if value.action == "move" else value.action
                destination = next((f for f in folders if f["key"] == target), None)
                if not destination and (
                    c.provider != "zoho" or value.action not in ("archive", "spam")
                ):
                    raise HTTPException(
                        422, "Destination folder is unavailable for this account."
                    )
            change_message(c, db, message, value.action, destination)
            db.commit()
            if c.provider != "zoho" and destination:
                # IMAP assigns a new UID on MOVE. Drop the old index entry and sync its destination.
                db.delete(message)
                db.commit()
                from .tasks import sync

                sync.delay(c.id)
            return {"ok": True}
        except HTTPException:
            raise
        except Exception:
            db.rollback()
            raise HTTPException(
                409,
                "The provider could not confirm this change. Refresh to check its state; reconnect Zoho if write permissions are missing.",
            ) from None

    @router.post("/{id}/older", status_code=202)
    def older(
        id: str,
        folder: str = Query(max_length=300),
        user=Depends(authenticated),
        db=Depends(db_session),
    ):
        c = mailbox(db, user, id)
        try:
            valid = any(f["key"] == folder for f in profile(c, db)["folders"])
        except Exception:
            raise HTTPException(503, "Folders are temporarily unavailable.") from None
        if not valid:
            raise HTTPException(422, "Choose a provider folder.")
        if not redis.set("older:" + c.id + ":" + folder, "1", nx=True, ex=60):
            raise HTTPException(429, "Older messages are already queued.")
        from .tasks import sync_older

        sync_older.delay(c.id, folder)
        return {"queued": True}

    @router.get("/{id}/messages/{mid}/attachments/{aid}")
    def download(
        id: str, mid: str, aid: str, user=Depends(authenticated), db=Depends(db_session)
    ):
        c = mailbox(db, user, id)
        message = owned(db, c, mid)
        try:
            info = next(
                (a for a in attachment_info(c, db, message) if a["id"] == aid), None
            )
            if not info:
                raise HTTPException(404, "Attachment not found.")
            data = download_attachment(c, db, message, aid)
            return Response(
                data,
                media_type="application/octet-stream",
                headers={
                    "Content-Disposition": "attachment; filename*=UTF-8''"
                    + quote(info["name"], safe=""),
                    "X-Content-Type-Options": "nosniff",
                },
            )
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(503, "Attachment is temporarily unavailable.") from None

    @router.post("/{id}/uploads", status_code=201)
    async def upload(
        id: str,
        request: Request,
        name: str = Query(max_length=255),
        user=Depends(authenticated),
        db=Depends(db_session),
    ):
        c = mailbox(db, user, id, True)
        name = name.replace("\\", "/").split("/")[-1]
        if not name or any(ord(ch) < 32 for ch in name):
            raise HTTPException(422, "Invalid filename.")
        content = await request.body()
        if not content or len(content) > 10 * 1024 * 1024:
            raise HTTPException(413, "Files must be between 1 byte and 10 MiB.")
        db.scalar(select(User).where(User.id == user.id).with_for_update())
        size = db.scalar(
            select(func.coalesce(func.sum(MailUpload.size), 0)).where(
                MailUpload.owner == user.id
            )
        )
        if size + len(content) > 50 * 1024 * 1024:
            raise HTTPException(
                413,
                "Attachment storage is full. Remove unused attachments or old drafts.",
            )
        mime = request.headers.get("content-type", "application/octet-stream").split(
            ";"
        )[0]
        if not re.fullmatch(r"[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+", mime):
            mime = "application/octet-stream"
        row = MailUpload(
            owner=user.id,
            mailbox=c.id,
            name=name,
            content_type=mime,
            size=len(content),
            content=encrypt({"content": base64.b64encode(content).decode()}),
        )
        db.add(row)
        db.commit()
        return {"id": row.id, "name": row.name, "size": row.size}

    @router.get("/{id}/uploads/{uid}")
    def get_upload(
        id: str, uid: str, user=Depends(authenticated), db=Depends(db_session)
    ):
        c = mailbox(db, user, id, True)
        row = upload_rows(c, db, [uid])[0]
        return {"id": row.id, "name": row.name, "size": row.size}

    @router.delete("/{id}/uploads/{uid}", status_code=204)
    def remove_upload(
        id: str, uid: str, user=Depends(authenticated), db=Depends(db_session)
    ):
        c = mailbox(db, user, id, True)
        row = upload_rows(c, db, [uid])[0]
        from .core import SendAttempt

        pending = list(
            db.scalars(
                select(SendAttempt).where(
                    SendAttempt.owner == user.id,
                    SendAttempt.status.in_(["queued", "sending"]),
                )
            )
        )
        import json

        if any(uid in json.loads(a.payload).get("attachments", []) for a in pending):
            raise HTTPException(409, "This attachment is in a queued message.")
        from .core import Draft

        if any(
            uid in json.loads(d.payload).get("attachments", [])
            for d in db.scalars(select(Draft).where(Draft.owner == user.id))
        ):
            raise HTTPException(
                409, "Save the draft without this attachment before deleting it."
            )
        db.delete(row)
        db.commit()

    return router
