"""Account-scoped live invalidation, notification inbox and opt-in push delivery."""

import hashlib
import json
import re
import secrets
import time
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, ConfigDict, field_validator, model_validator
from typing import Literal
from email.utils import parseaddr
from redis.asyncio import Redis as AsyncRedis
from sqlalchemy import select, func, delete, text, update
from sqlalchemy.dialects.postgresql import insert
from starlette.concurrency import run_in_threadpool

from .core import (
    Session,
    User,
    Notification,
    PushDevice,
    PushDelivery,
    redis,
    REDIS_URL,
    encrypt,
    decrypt,
    uid,
    now,
)
from .workspace_settings import load_setting, store_setting

_LEASE = """
for i = 1, 2 do redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', ARGV[1]) end
if redis.call('ZCARD', KEYS[1]) >= 3 or redis.call('ZCARD', KEYS[2]) >= 12 then return 0 end
for i = 1, 2 do
  redis.call('ZADD', KEYS[i], ARGV[2], ARGV[3])
  redis.call('EXPIRE', KEYS[i], 75)
end
return 1
"""


def signal(owner, scope):
    # No private message content is sent over the live channel. Polling is a fallback.
    try:
        key = "live:" + owner
        redis.xadd(key, {"scope": scope}, maxlen=100, approximate=False)
        redis.expire(key, 3600)
    except Exception:
        pass


def notification_preferences(owner):
    return {
        "email": True,
        "news": False,
        "previews": False,
        "email_default": True,
        "email_content": "sender_subject",
        "email_rules": [],
        **load_setting("notifications:" + owner, {}),
    }


def email_allowed(prefs, message):
    if not prefs["email"]:
        return False
    sender = parseaddr(message.sender)[1].casefold()
    for rule in prefs.get("email_rules", []):
        if rule.get("mailbox_id") and rule["mailbox_id"] != message.mailbox:
            continue
        match = rule.get("sender", "").casefold()
        if match and not (
            sender.endswith(match) if match.startswith("@") else sender == match
        ):
            continue
        if (
            rule.get("subject")
            and rule["subject"].casefold() not in message.subject.casefold()
        ):
            continue
        return rule["action"] == "notify"
    return prefs.get("email_default", True)


def email_content(message, mailbox, detail="full"):
    from html.parser import HTMLParser
    import html

    class Preview(HTMLParser):
        def __init__(self):
            super().__init__()
            self.hidden = 0
            self.parts = []

        def handle_starttag(self, tag, attrs):
            if tag in ("script", "style", "head"):
                self.hidden += 1
            elif tag in ("br", "p", "div", "tr"):
                self.parts.append(" ")

        def handle_endtag(self, tag):
            if tag in ("script", "style", "head"):
                self.hidden = max(0, self.hidden - 1)

        def handle_data(self, value):
            if not self.hidden:
                self.parts.append(value)

    subject = message.subject.strip() or "No subject"
    sender = message.sender_name.strip() or message.sender
    title = subject if detail == "subject" else sender + " · " + subject
    body = mailbox.label or mailbox.address
    if detail == "full":
        raw = message.body.strip()
        if not raw and message.html:
            parser = Preview()
            parser.feed(message.html[:100000])
            raw = " ".join(parser.parts)
        snippet = " ".join(html.unescape(raw).split())[:280]
        body += " · To " + message.recipients[:120]
        if snippet:
            body += "\n" + snippet
    return title[:300], body[:500]


def email_read(db, owner, message_id):
    db.execute(
        update(Notification)
        .where(
            Notification.owner == owner,
            Notification.kind == "email",
            Notification.dedup == message_id,
        )
        .values(read=True)
    )


def record(db, owner, kind, dedup, title, body, href):
    """Insert in the same transaction as the synced data, once per source item."""
    if not notification_preferences(owner).get(kind, False):
        return
    if kind == "email":
        from .core import Message, Connection

        message = db.get(Message, dedup)
        mailbox = db.get(Connection, message.mailbox) if message else None
        if message and mailbox:
            if mailbox.owner != owner or not email_allowed(
                notification_preferences(owner), message
            ):
                return
            title, body = email_content(message, mailbox)
    id = db.scalar(
        insert(Notification)
        .values(
            id=uid(),
            owner=owner,
            kind=kind,
            dedup=dedup,
            title=title[:300],
            body=body[:500],
            href=href,
            created_at=now(),
            read=False,
        )
        .on_conflict_do_nothing(index_elements=["owner", "kind", "dedup"])
        .returning(Notification.id)
    )
    if id:
        for device in db.scalars(select(PushDevice).where(PushDevice.owner == owner)):
            db.add(PushDelivery(notification=id, device=device.id))


class EmailRule(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    mailbox_id: str = Field(default="", max_length=100)
    sender: str = Field(default="", max_length=254)
    subject: str = Field(default="", max_length=150)
    action: Literal["notify", "mute"] = "notify"

    @field_validator("sender")
    @classmethod
    def sender_address(cls, value):
        value = value.strip().casefold()
        if value and not re.fullmatch(
            r"(?:[^\s@<>]+)?@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}", value
        ):
            raise ValueError("Enter an email address or @domain.example.")
        return value

    @model_validator(mode="after")
    def meaningful(self):
        self.subject = self.subject.strip()
        if not any((self.mailbox_id, self.sender, self.subject)):
            raise ValueError("Choose a mailbox, sender or subject for this rule.")
        return self


class NotificationPreferences(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: bool = True
    news: bool = False
    previews: bool = False
    email_default: bool = True
    email_content: Literal["subject", "sender_subject", "full"] = "sender_subject"
    email_rules: list[EmailRule] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def unique_rules(self):
        if len({rule.id for rule in self.email_rules}) != len(self.email_rules):
            raise ValueError("Rule IDs must be unique.")
        return self


class DeviceInput(BaseModel):
    kind: str = Field(default="fcm", pattern="^fcm$")
    endpoint: str = Field(min_length=32, max_length=4096, pattern=r"^[A-Za-z0-9_:.-]+$")


def device_data(body):
    from .workspace_settings import load_setting

    if not load_setting("firebase-push"):
        raise HTTPException(
            409, "Configure Firebase in Integrations before enabling app notifications."
        )
    return {"token": body.endpoint}


def build_notification_router(authenticated, db_session):
    router = APIRouter(prefix="/api/v1")

    @router.get("/notifications")
    def inbox(user=Depends(authenticated), db=Depends(db_session)):
        rows = db.scalars(
            select(Notification)
            .where(Notification.owner == user.id)
            .order_by(Notification.created_at.desc())
            .limit(100)
        )
        return {
            "items": [
                {
                    "id": n.id,
                    "kind": n.kind,
                    "title": n.title,
                    "body": n.body,
                    "href": n.href,
                    "read": n.read,
                    "created_at": n.created_at,
                }
                for n in rows
            ],
            "unread": db.scalar(
                select(func.count())
                .select_from(Notification)
                .where(Notification.owner == user.id, Notification.read == False)
            ),
        }

    @router.post("/notifications/read", status_code=204)
    def read_all(user=Depends(authenticated), db=Depends(db_session)):
        from sqlalchemy import update

        db.execute(
            update(Notification).where(Notification.owner == user.id).values(read=True)
        )
        db.commit()
        signal(user.id, "notifications")

    @router.post("/notifications/{id}/read", status_code=204)
    def read_one(id: str, user=Depends(authenticated), db=Depends(db_session)):
        n = db.get(Notification, id)
        if not n or n.owner != user.id:
            raise HTTPException(404)
        n.read = True
        db.commit()
        signal(user.id, "notifications")

    @router.get("/notifications/preferences")
    def preferences(user=Depends(authenticated)):
        return notification_preferences(user.id)

    @router.put("/notifications/preferences")
    def save_preferences(
        body: NotificationPreferences,
        user=Depends(authenticated),
        db=Depends(db_session),
    ):
        from .core import Connection

        for rule in body.email_rules:
            if rule.mailbox_id:
                mailbox = db.get(Connection, rule.mailbox_id)
                if not mailbox or mailbox.owner != user.id:
                    raise HTTPException(422, "Choose one of your connected mailboxes.")
        store_setting(db, "notifications:" + user.id, body.model_dump())
        return body.model_dump()

    @router.post("/notifications/devices")
    def register(
        body: DeviceInput,
        request: Request,
        user=Depends(authenticated),
        db=Depends(db_session),
    ):
        sid = getattr(request.state, "sid", "")
        if not sid:
            raise HTTPException(400, "Browser session required")
        data = device_data(body)
        data["_session"] = sid
        digest = hashlib.sha256(body.endpoint.encode()).hexdigest()
        db.execute(text("SELECT pg_advisory_xact_lock(683415240)"))
        # Token rotation replaces the previous token for this companion session.
        db.execute(
            delete(PushDevice).where(
                PushDevice.owner == user.id,
                PushDevice.session_digest == hashlib.sha256(sid.encode()).hexdigest(),
                PushDevice.digest != digest,
            )
        )
        device = db.scalar(select(PushDevice).where(PushDevice.digest == digest))
        if device and device.owner != user.id:
            # A browser/device can change accounts. Drop queued private pushes first.
            db.execute(delete(PushDelivery).where(PushDelivery.device == device.id))
        if not device:
            if (
                db.scalar(
                    select(func.count())
                    .select_from(PushDevice)
                    .where(PushDevice.owner == user.id)
                )
                >= 20
            ):
                raise HTTPException(409, "Device limit reached")
            device = PushDevice(
                owner=user.id, kind=body.kind, digest=digest, subscription=""
            )
            db.add(device)
        device.owner, device.kind, device.subscription = (
            user.id,
            body.kind,
            encrypt(data),
        )
        device.session_digest = hashlib.sha256(sid.encode()).hexdigest() if sid else ""
        db.commit()
        return {"id": device.id}

    @router.get("/notifications/devices")
    def devices(user=Depends(authenticated), db=Depends(db_session)):
        return [
            {
                "id": d.id,
                "kind": d.kind,
                "latest": db.scalar(
                    select(PushDelivery.status)
                    .join(Notification, Notification.id == PushDelivery.notification)
                    .where(PushDelivery.device == d.id)
                    .order_by(Notification.created_at.desc())
                    .limit(1)
                ),
            }
            for d in db.scalars(select(PushDevice).where(PushDevice.owner == user.id))
        ]

    @router.delete("/notifications/devices/{id}", status_code=204)
    def unregister(id: str, user=Depends(authenticated), db=Depends(db_session)):
        device = db.get(PushDevice, id)
        if not device or device.owner != user.id:
            raise HTTPException(404)
        db.delete(device)
        db.commit()

    @router.post("/notifications/test", status_code=202)
    def test_push(user=Depends(authenticated), db=Depends(db_session)):
        id = uid()
        n = Notification(
            id=id,
            owner=user.id,
            kind="test",
            dedup=id,
            title="Notifications connected",
            body="",
            href="/settings/notifications",
        )
        db.add(n)
        db.flush()
        for d in db.scalars(select(PushDevice).where(PushDevice.owner == user.id)):
            db.add(PushDelivery(notification=id, device=d.id))
        db.commit()
        signal(user.id, "notifications")
        return {"queued": True}

    @router.get("/live", include_in_schema=False)
    async def live(
        request: Request, user=Depends(authenticated), db=Depends(db_session)
    ):
        # Stream credentials are cookies only, never tokens in URLs.
        if "authorization" in request.headers:
            raise HTTPException(400, "Browser session required")
        sid = request.state.sid
        db.close()  # Never hold a database pool connection for the stream's lifetime.
        lease = "live-lease:" + user.id
        global_lease = "live-global-lease"
        lease_id = secrets.token_hex(16)
        client = AsyncRedis.from_url(REDIS_URL, decode_responses=True)
        # Reserve capacity for ordinary API traffic under Uvicorn's 32-request cap.
        stamp = time.time()
        acquired = await client.eval(
            _LEASE, 2, lease, global_lease, stamp, stamp + 70, lease_id
        )
        if not acquired:
            await client.aclose()
            raise HTTPException(429, "Too many open live connections")

        async def events():
            try:
                key = "live:" + user.id
                latest = await client.xrevrange(key, count=1)
                cursor = latest[0][0] if latest else "0-0"
                # Also refresh after reconnect, covering trimmed/missed events.
                yield 'retry: 3000\nevent: update\ndata: {"scope":"all"}\n\n'
                started = time.monotonic()
                while time.monotonic() - started < 55:
                    if await request.is_disconnected():
                        break
                    from .sessions import read_session
                    from .admission import session_admitted

                    def valid():
                        try:
                            data = read_session(sid)
                            return data["user"] == user.id and session_admitted(data)
                        except HTTPException:
                            return False

                    if not await run_in_threadpool(valid):
                        break
                    rows = await client.xread({key: cursor}, block=10000, count=50)
                    for _, entries in rows:
                        for cursor, fields in entries:
                            yield "event: update\ndata: " + json.dumps(fields) + "\n\n"
                    yield ": keepalive\n\n"
            finally:
                await client.zrem(lease, lease_id)
                await client.zrem(global_lease, lease_id)
                await client.aclose()

        return StreamingResponse(
            events(),
            media_type="text/event-stream",
            headers={"X-Accel-Buffering": "no", "Cache-Control": "no-store"},
        )

    return router


def deliver_pending():
    """Bounded durable retries; no provider failure can roll back a mail sync."""
    from .admission import admitted
    from .auth_settings import load_oidc
    from .firebase_push import send_firebase, FirebaseError

    with redis.lock("push-delivery", timeout=250, blocking_timeout=0), Session() as db:
        rows = list(
            db.scalars(
                select(PushDelivery.id)
                .where(
                    PushDelivery.status == "pending",
                    PushDelivery.next_attempt <= now(),
                )
                .limit(40)
            )
        )
        started = time.monotonic()
        for delivery_id in rows:
            if time.monotonic() - started > 180:
                break
            delivery = db.get(PushDelivery, delivery_id)
            if delivery is None:
                continue  # An expired device may have cascaded several queued deliveries.
            n, d = db.get(Notification, delivery.notification), db.get(
                PushDevice, delivery.device
            )
            if (
                not n
                or not d
                or n.owner != d.owner
                or not admitted(db.get(User, n.owner))
            ):
                delivery.status = "cancelled"
                db.commit()
                continue
            prefs = notification_preferences(n.owner)
            email_preview = None
            if n.kind == "email":
                from .core import Message, Connection

                message = db.get(Message, n.dedup)
                mailbox = db.get(Connection, message.mailbox) if message else None
                if message and mailbox and mailbox.owner == n.owner:
                    if not email_allowed(prefs, message):
                        delivery.status = "cancelled"
                        db.commit()
                        continue
                    email_preview = email_content(
                        message, mailbox, prefs["email_content"]
                    )
                elif prefs.get("email_rules") or not prefs.get("email_default", True):
                    delivery.status = "cancelled"
                    db.commit()
                    continue
            if n.read and n.kind != "test":
                delivery.status = "cancelled"
                db.commit()
                continue
            if (
                n.kind != "test" and not prefs.get(n.kind)
            ) or n.created_at < now() - timedelta(hours=24):
                delivery.status = "cancelled"
                db.commit()
                continue
            payload = {
                "id": n.id,
                "title": (
                    n.title
                    if prefs["previews"]
                    else (
                        "New email"
                        if n.kind == "email"
                        else "New headlines" if n.kind == "news" else n.title
                    )
                ),
                "body": n.body if prefs["previews"] else "Open Omnix to view.",
                "href": n.href,
            }
            if email_preview and prefs["previews"]:
                payload["title"], payload["body"] = email_preview
            delivery.attempts += 1
            # Persist attempt before IO. If interrupted, recovery retries after this lease.
            delivery.next_attempt = now() + timedelta(minutes=5)
            db.commit()
            invalid = False
            try:
                subscription = decrypt(d.subscription)
                from .sessions import read_session

                try:
                    session = read_session(subscription.pop("_session", ""))
                    if session["user"] != n.owner:
                        raise HTTPException(401)
                except HTTPException:
                    db.delete(d)
                    db.commit()
                    continue
                origin = load_oidc()["public_origin"]
                if d.kind != "fcm":
                    db.delete(d)
                    db.commit()
                    continue
                send_firebase(subscription["token"], payload, origin)
                delivery.status = "sent"
            except FirebaseError as error:
                invalid = error.invalid_token
                if error.permanent:
                    delivery.status = "failed"
            except Exception:
                pass  # Never log device endpoints, tokens or private notification content.
            if invalid:
                db.delete(d)
            elif delivery.status not in ("sent", "failed"):
                delivery.status = "failed" if delivery.attempts >= 5 else "pending"
                delivery.next_attempt = now() + timedelta(
                    seconds=min(900, 15 * 2**delivery.attempts)
                )
            db.commit()
        db.execute(
            delete(Notification).where(
                Notification.created_at < now() - timedelta(days=30)
            )
        )
        db.commit()
