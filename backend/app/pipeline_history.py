"""Bounded, secret-free operational history shared by independently run jobs."""

from contextlib import contextmanager
from sqlalchemy import delete, select
from .core import Session, PipelineRun, now


@contextmanager
def execution(pipeline, target=""):
    with Session() as db:
        record = PipelineRun(pipeline=pipeline, target=target)
        db.add(record)
        db.commit()
        identifier = record.id
    try:
        yield
    except Exception:
        finish(
            identifier,
            "failed",
            "Execution failed; inspect connection status and retry.",
        )
        raise
    else:
        finish(identifier, "succeeded", "Completed")


def finish(identifier, status, detail):
    with Session() as db:
        record = db.get(PipelineRun, identifier)
        record.status, record.detail, record.finished_at = status, detail, now()
        db.commit()


def prune_history():
    from datetime import timedelta

    with Session() as db:
        db.execute(
            delete(PipelineRun).where(
                PipelineRun.started_at < now() - timedelta(days=14)
            )
        )
        for record in db.scalars(
            select(PipelineRun).where(
                PipelineRun.status == "running",
                PipelineRun.started_at < now() - timedelta(minutes=15),
            )
        ):
            record.status = "interrupted"
            record.detail = "Worker interrupted; safe jobs can be retried."
            record.finished_at = now()
        db.commit()
