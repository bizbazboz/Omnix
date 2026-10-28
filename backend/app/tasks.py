import os, json
from celery import Celery
from sqlalchemy import select, or_
from .core import Session, Connection, Message, SendAttempt, now, redis, REDIS_URL
from .providers import fetch_messages, send_message
from .pipeline_history import execution, prune_history
from .workspace_settings import load_setting

celery = Celery("omnix", broker=REDIS_URL)
celery.conf.update(
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    broker_connection_retry_on_startup=True,
    task_soft_time_limit=240,
    task_time_limit=270,
    beat_schedule={
        "sync-dispatch": {"task": "app.tasks.dispatch_sync", "schedule": 60.0},
        "outbox-dispatch": {"task": "app.tasks.dispatch_outbox", "schedule": 15.0},
        "recovery": {"task": "app.tasks.recover", "schedule": 60.0},
        "calendar-dispatch": {"task": "app.tasks.dispatch_calendars", "schedule": 60.0},
        "health-dispatch": {"task": "app.tasks.dispatch_health", "schedule": 60.0},
    },
)


@celery.task(name="app.tasks.health_sync")
def health_sync(id):
    from .health import sync_health

    with execution("health-sync", id):
        if not sync_health(id):
            raise RuntimeError("Health refresh failed; check the connection.")


@celery.task(name="app.tasks.dispatch_health")
def dispatch_health():
    from datetime import timedelta
    from .core import HealthConnection

    with (
        redis.lock("scheduler:health", timeout=50, blocking_timeout=1),
        Session() as db,
    ):
        ids = list(
            db.scalars(
                select(HealthConnection.id).where(
                    HealthConnection.status != "reconnect",
                    or_(
                        HealthConnection.last_attempt.is_(None),
                        HealthConnection.last_attempt < now() - timedelta(minutes=30),
                    ),
                )
            )
        )
        for id in ids:
            health_sync.delay(id)


@celery.task(name="app.tasks.calendar_sync")
def calendar_sync(feed_id):
    from .calendars import sync_feed

    with execution("calendar-sync", feed_id):
        if not sync_feed(feed_id):
            raise RuntimeError("Calendar refresh failed; check its subscription.")


@celery.task(name="app.tasks.dispatch_calendars")
def dispatch_calendars():
    from datetime import timedelta
    from .core import CalendarFeed

    with (
        redis.lock("scheduler:calendars", timeout=50, blocking_timeout=1),
        Session() as db,
    ):
        for id in db.scalars(
            select(CalendarFeed.id).where(
                or_(
                    CalendarFeed.last_attempt.is_(None),
                    CalendarFeed.last_attempt <= now() - timedelta(minutes=15),
                )
            )
        ):
            calendar_sync.delay(id)


@celery.task(
    name="app.tasks.sync",
    autoretry_for=(Exception,),
    retry_backoff=30,
    retry_backoff_max=300,
    max_retries=3,
)
def sync(connection_id):
    with (
        execution("mail-sync", connection_id),
        redis.lock("sync:" + connection_id, timeout=300, blocking_timeout=1),
    ):
        with Session() as db:
            c = db.get(Connection, connection_id)
            if not c or c.status == "disconnected" or not c.can_read:
                return
            try:
                for item in fetch_messages(c, db):
                    existing = db.scalar(
                        select(Message).where(
                            Message.mailbox == c.id,
                            Message.provider_id == item["provider_id"],
                        )
                    )
                    if not existing and c.provider == "zoho":
                        existing = db.scalar(
                            select(Message).where(
                                Message.mailbox == c.id,
                                Message.provider_id.endswith(
                                    ":" + item["provider_id"].split(":", 1)[1],
                                    autoescape=True,
                                ),
                            )
                        )
                    if existing:
                        for key, value in item.items():
                            setattr(existing, key, value)
                    else:
                        db.add(Message(mailbox=c.id, **item))
                c.status = "ready"
                c.last_sync = now()
                c.error = ""
                db.commit()
            except Exception:
                db.rollback()
                c = db.get(Connection, connection_id)
                c.status = "degraded"
                c.error = "Sync failed. Check credentials, permissions and provider connectivity."
                db.commit()
                raise RuntimeError(
                    "Mail sync failed; check connection status."
                ) from None


@celery.task(name="app.tasks.sync_older")
def sync_older(connection_id, folder):
    from .mail_provider import fetch_recent
    from sqlalchemy import func

    with (
        execution("mail-history", connection_id),
        redis.lock("sync:" + connection_id, timeout=300, blocking_timeout=1),
        Session() as db,
    ):
        c = db.get(Connection, connection_id)
        if not c or c.status == "disconnected" or not c.can_read:
            return
        count = db.scalar(
            select(func.count())
            .select_from(Message)
            .where(Message.mailbox == c.id, Message.folder == folder)
        )
        for item in fetch_recent(c, db, only=folder, start=max(1, count - 49)):
            existing = db.scalar(
                select(Message).where(
                    Message.mailbox == c.id, Message.provider_id == item["provider_id"]
                )
            )
            if not existing and c.provider == "zoho":
                existing = db.scalar(
                    select(Message).where(
                        Message.mailbox == c.id,
                        Message.provider_id.endswith(
                            ":" + item["provider_id"].split(":", 1)[1], autoescape=True
                        ),
                    )
                )
            if existing:
                for k, v in item.items():
                    setattr(existing, k, v)
            else:
                db.add(Message(mailbox=c.id, **item))
        db.commit()


@celery.task(name="app.tasks.send", acks_late=True, reject_on_worker_lost=False)
def send(attempt_id):
    with (
        execution("mail-send", attempt_id),
        redis.lock("send-prepare:" + attempt_id, timeout=300, blocking_timeout=1),
        Session() as db,
    ):
        a = db.scalar(
            select(SendAttempt).where(SendAttempt.id == attempt_id).with_for_update()
        )
        if not a or a.status != "queued":
            return
        c = db.get(Connection, a.mailbox)
        if not c or c.status == "disconnected" or not c.can_send:
            a.status = "failed"
            a.receipt = "sender_unavailable"
            db.commit()
            return
        from .mail_client import prepare_send

        try:
            payload = prepare_send(c, db, json.loads(a.payload))
        except Exception:
            a.status = "failed"
            a.receipt = "Sender or attachments could not be verified. Check the account before trying again."
            db.commit()
            return
        a.status = "sending"
        db.commit()
        try:
            result = send_message(c, db, payload, a.id)
        except Exception:
            # Submission may have succeeded. Never retry the provider automatically.
            a.status = "outcome_unknown"
            a.receipt = "Check the provider Sent folder before retrying."
            db.commit()
            return
        a.status = "accepted"
        a.receipt = json.dumps(result)
        db.commit()


@celery.task(name="app.tasks.dispatch_sync")
def dispatch_sync():
    redis.set("heartbeat:worker", "1", ex=180)
    config = load_setting("pipelines", {"sync_enabled": True, "sync_interval": 120})
    if not config["sync_enabled"]:
        return
    with (
        execution("sync-dispatch"),
        redis.lock("scheduler:sync", timeout=50, blocking_timeout=1),
    ):
        with Session() as db:
            for c in db.scalars(
                select(Connection).where(
                    Connection.status != "disconnected", Connection.can_read == True
                )
            ):
                if (
                    not c.last_sync
                    or (now() - c.last_sync).total_seconds() > config["sync_interval"]
                ):
                    sync.delay(c.id)


@celery.task(name="app.tasks.dispatch_outbox")
def dispatch_outbox():
    # Persisted queued records recover after broker failure. Sending is never retried.
    with (
        execution("outbox-dispatch"),
        redis.lock("scheduler:outbox", timeout=12, blocking_timeout=1),
    ):
        with Session() as db:
            for a in db.scalars(
                select(SendAttempt).where(SendAttempt.status == "queued")
            ):
                send.delay(a.id)


@celery.task(name="app.tasks.recover")
def recover():
    redis.set("heartbeat:scheduler", "1", ex=180)
    with (
        execution("recovery"),
        redis.lock("scheduler:recovery", timeout=50, blocking_timeout=1),
    ):
        with Session() as db:
            from datetime import timedelta

            for a in db.scalars(
                select(SendAttempt).where(
                    SendAttempt.status == "sending",
                    SendAttempt.date < now() - timedelta(minutes=10),
                )
            ):
                a.status = "outcome_unknown"
                a.receipt = "Worker interrupted. Reconcile Sent before retrying."
            db.commit()
        prune_history()


@celery.task(name="app.tasks.dispatch")
def dispatch():
    """Compatibility entry point for jobs queued before the upgrade."""
    dispatch_sync.delay()
    dispatch_outbox.delay()
    recover.delay()
