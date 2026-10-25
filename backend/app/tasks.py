import os, json
from celery import Celery
from sqlalchemy import select
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
    },
)


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


@celery.task(name="app.tasks.send", acks_late=True, reject_on_worker_lost=False)
def send(attempt_id):
    with execution("mail-send", attempt_id), Session() as db:
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
        a.status = "sending"
        db.commit()
        try:
            payload = json.loads(a.payload)
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
