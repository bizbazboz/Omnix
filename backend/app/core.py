import os, uuid, json
from datetime import datetime, timezone
from sqlalchemy import (
    create_engine,
    String,
    Text,
    DateTime,
    ForeignKey,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from redis import Redis
from cryptography.fernet import Fernet


def now():
    return datetime.now(timezone.utc)


def uid():
    return str(uuid.uuid4())


from .runtime import (
    SESSION_COOKIE,
    OIDC_COOKIE,
    DATABASE_URL,
    REDIS_URL,
    ENCRYPTION_KEY,
    BOOTSTRAP_TOKEN_FILE,
)

engine = create_engine(DATABASE_URL, pool_pre_ping=True, hide_parameters=True)
Session = sessionmaker(engine, expire_on_commit=False)
redis = Redis.from_url(REDIS_URL, decode_responses=True)
cipher = Fernet(ENCRYPTION_KEY.encode())


def encrypt(data):
    return cipher.encrypt(json.dumps(data).encode()).decode()


def decrypt(data):
    return json.loads(cipher.decrypt(data.encode()))


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    issuer: Mapped[str] = mapped_column(String)
    subject: Mapped[str] = mapped_column(String)
    name: Mapped[str] = mapped_column(String)
    email: Mapped[str] = mapped_column(String)
    tenant: Mapped[str] = mapped_column(String, default="internal")
    is_admin: Mapped[bool] = mapped_column(default=False, server_default="false")
    __table_args__ = (UniqueConstraint("issuer", "subject"),)


class Connection(Base):
    __tablename__ = "connections"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    provider: Mapped[str] = mapped_column(String)
    label: Mapped[str] = mapped_column(String)
    address: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="ready")
    region: Mapped[str] = mapped_column(String, default="eu")
    credentials: Mapped[str] = mapped_column(Text, default="")
    account_id: Mapped[str] = mapped_column(String, default="")
    can_read: Mapped[bool] = mapped_column(default=True)
    can_send: Mapped[bool] = mapped_column(default=True)
    last_sync: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    error: Mapped[str] = mapped_column(String, default="")


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    mailbox: Mapped[str] = mapped_column(ForeignKey("connections.id"), index=True)
    provider_id: Mapped[str] = mapped_column(String)
    folder: Mapped[str] = mapped_column(String, default="inbox")
    sender: Mapped[str] = mapped_column(String)
    sender_name: Mapped[str] = mapped_column(String, default="")
    recipients: Mapped[str] = mapped_column(Text)
    cc: Mapped[str] = mapped_column(Text, default="", server_default="")
    reply_to: Mapped[str] = mapped_column(Text, default="", server_default="")
    rfc_id: Mapped[str] = mapped_column(Text, default="", server_default="")
    subject: Mapped[str] = mapped_column(String)
    body: Mapped[str] = mapped_column(Text, default="")
    html: Mapped[str] = mapped_column(Text, default="")
    unread: Mapped[bool] = mapped_column(default=True)
    starred: Mapped[bool] = mapped_column(default=False)
    date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now, index=True
    )
    __table_args__ = (UniqueConstraint("mailbox", "provider_id"),)


class Draft(Base):
    __tablename__ = "drafts"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    mailbox: Mapped[str] = mapped_column(ForeignKey("connections.id"))
    payload: Mapped[str] = mapped_column(Text)
    version: Mapped[int] = mapped_column(default=1)
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class SendAttempt(Base):
    __tablename__ = "send_attempts"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(ForeignKey("users.id"))
    mailbox: Mapped[str] = mapped_column(ForeignKey("connections.id"))
    key: Mapped[str] = mapped_column(String)
    payload_hash: Mapped[str] = mapped_column(String)
    payload: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String, default="queued")
    receipt: Mapped[str] = mapped_column(Text, default="")
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    __table_args__ = (UniqueConstraint("owner", "key"),)


class Audit(Base):
    __tablename__ = "audit_events"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(String)
    action: Mapped[str] = mapped_column(String)
    target: Mapped[str] = mapped_column(String)
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class SystemSetting(Base):
    __tablename__ = "system_settings"
    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class PipelineRun(Base):
    __tablename__ = "pipeline_runs"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    pipeline: Mapped[str] = mapped_column(String, index=True)
    target: Mapped[str] = mapped_column(String, default="")
    status: Mapped[str] = mapped_column(String, default="running")
    detail: Mapped[str] = mapped_column(String, default="")
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now, index=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class CalendarFeed(Base):
    __tablename__ = "calendar_feeds"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    label: Mapped[str] = mapped_column(String)
    url: Mapped[str] = mapped_column(Text)
    events: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String, default="pending")
    error: Mapped[str] = mapped_column(String, default="")
    last_sync: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_attempt: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class MailUpload(Base):
    __tablename__ = "mail_uploads"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    mailbox: Mapped[str] = mapped_column(ForeignKey("connections.id"), index=True)
    name: Mapped[str] = mapped_column(String)
    content_type: Mapped[str] = mapped_column(String)
    size: Mapped[int] = mapped_column()
    content: Mapped[str] = mapped_column(Text)


class HealthConnection(Base):
    __tablename__ = "health_connections"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(ForeignKey("users.id"), unique=True, index=True)
    credentials: Mapped[str] = mapped_column(Text)
    statistics: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String, default="pending")
    error: Mapped[str] = mapped_column(String, default="")
    last_sync: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_attempt: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
