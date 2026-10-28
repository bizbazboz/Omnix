"""Owner-scoped live previews from locally cached workspace data; never fetch providers."""

import heapq
import json
from typing import Literal
from urllib.parse import urlencode
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, or_
from sqlalchemy.orm import load_only
from .core import (
    Message,
    Connection,
    CalendarFeed,
    NotePage,
    NoteProject,
    ProjectTask,
    decrypt,
    now,
)
from .calendar_identity import event_identity
from .mail_render import plain_text

Kind = Literal["mail", "event", "issue", "project", "page"]


def result(kind, id, container, title, subtitle, excerpt, href, date=None, **extra):
    return {
        "kind": kind,
        "id": id,
        "container_id": container,
        "title": title,
        "subtitle": subtitle,
        "excerpt": excerpt[:500],
        "href": href,
        "date": date,
        **extra,
    }


def mail_ref(message, account):
    return result(
        "mail",
        message.id,
        account.id,
        message.subject or "No subject",
        message.sender_name or message.sender,
        plain_text(message.html[:100000]) if message.html else message.body,
        "/email/all?" + urlencode({"account": account.id, "message": message.id}),
        message.date.isoformat(),
    )


def page_ref(page):
    return result(
        "page",
        page.id,
        "",
        decrypt(page.title),
        "Folder" if page.is_folder else "Page",
        "",
        "/notes/pages/" + page.id,
    )


def project_ref(project):
    return result(
        "project",
        project.id,
        "",
        decrypt(project.title),
        project.issue_prefix,
        "",
        "/notes/projects/" + project.id,
    )


def issue_ref(task, project):
    return result(
        "issue",
        task.id,
        project.id,
        decrypt(task.title),
        project.issue_prefix + "-" + str(task.issue_number),
        decrypt(task.description),
        "/notes/projects/" + project.id + "?" + urlencode({"issue": task.id}),
        task.end,
        status=task.status.replace("_", " "),
    )


def calendar_ref(event, feed):
    id = event_identity(feed.id, event)
    return result(
        "event",
        id,
        feed.id,
        event.get("title", "Untitled event"),
        feed.label,
        event.get("description", ""),
        "/calendar?"
        + urlencode({"view": "month", "date": event["start"][:10], "event": id}),
        event["start"],
        end=event.get("end"),
        all_day=event.get("all_day", False),
        location=event.get("location", ""),
    )


def build_reference_router(authenticated, db_session):
    router = APIRouter()

    @router.get("/references")
    def search(
        kind: Kind,
        q: str = Query(default="", max_length=200),
        offset: int = Query(default=0, ge=0, le=500000),
        user=Depends(authenticated),
        db=Depends(db_session),
    ):
        size = 25
        if kind == "mail":
            query = (
                select(Message, Connection)
                .join(Connection, Message.mailbox == Connection.id)
                .where(
                    Connection.owner == user.id,
                    Connection.status != "disconnected",
                    Message.folder.notin_(["trash", "spam", "provider-drafts"]),
                )
            )
            if q:
                query = query.where(
                    or_(
                        Message.subject.ilike("%" + q + "%"),
                        Message.sender.ilike("%" + q + "%"),
                        Message.sender_name.ilike("%" + q + "%"),
                    )
                )
            rows = db.execute(
                query.order_by(Message.date.desc(), Message.id)
                .offset(offset)
                .limit(size + 1)
            ).all()
            return {
                "items": [mail_ref(*row) for row in rows[:size]],
                "next_offset": offset + size if len(rows) > size else None,
            }
        if kind == "event":

            def candidates():
                for feed in db.scalars(
                    select(CalendarFeed)
                    .where(CalendarFeed.owner == user.id)
                    .options(
                        load_only(
                            CalendarFeed.id, CalendarFeed.label, CalendarFeed.events
                        )
                    )
                    .execution_options(yield_per=1)
                ):
                    for event in decrypt(feed.events) if feed.events else []:
                        if (
                            q
                            and q.casefold()
                            not in (
                                event.get("title", "")
                                + " "
                                + event.get("location", "")
                                + " "
                                + event.get("description", "")
                            ).casefold()
                        ):
                            continue
                        if not q and event.get("end_ts", 0) < now().timestamp():
                            continue
                        yield event.get("start_ts", 0), event_identity(
                            feed.id, event
                        ), calendar_ref(event, feed)

            rows = heapq.nsmallest(
                offset + size + 1, candidates(), key=lambda row: (row[0], row[1])
            )
            return {
                "items": [row[2] for row in rows[offset : offset + size]],
                "next_offset": offset + size if len(rows) > offset + size else None,
            }
        # Encrypted text is searched in bounded batches. The picker can scan more.
        scan = 200
        if kind == "issue":
            rows = db.execute(
                select(ProjectTask, NoteProject)
                .join(NoteProject, ProjectTask.project_id == NoteProject.id)
                .where(
                    ProjectTask.owner == user.id,
                    NoteProject.owner == user.id,
                    NoteProject.deleted_at.is_(None),
                )
                .order_by(ProjectTask.updated_at.desc(), ProjectTask.id)
                .offset(offset)
                .limit(scan + 1)
            ).all()
            items = [issue_ref(*row) for row in rows[:scan]]
        elif kind == "project":
            rows = list(
                db.scalars(
                    select(NoteProject)
                    .where(
                        NoteProject.owner == user.id, NoteProject.deleted_at.is_(None)
                    )
                    .order_by(NoteProject.updated_at.desc(), NoteProject.id)
                    .offset(offset)
                    .limit(scan + 1)
                )
            )
            items = [project_ref(row) for row in rows[:scan]]
        else:
            rows = list(
                db.scalars(
                    select(NotePage)
                    .where(NotePage.owner == user.id, NotePage.deleted_at.is_(None))
                    .order_by(NotePage.updated_at.desc(), NotePage.id)
                    .offset(offset)
                    .limit(scan + 1)
                )
            )
            items = [page_ref(row) for row in rows[:scan]]
        items = [
            item
            for item in items
            if not q
            or q.casefold()
            in (
                item["title"] + " " + item["subtitle"] + " " + item["excerpt"]
            ).casefold()
        ]
        return {
            "items": items,
            "next_offset": offset + scan if len(rows) > scan else None,
        }

    @router.get("/references/resolve")
    def resolve(
        kind: Kind,
        id: str = Query(min_length=1, max_length=200),
        container_id: str = Query(default="", max_length=200),
        user=Depends(authenticated),
        db=Depends(db_session),
    ):
        if kind == "mail":
            row = db.execute(
                select(Message, Connection)
                .join(Connection, Message.mailbox == Connection.id)
                .where(
                    Message.id == id,
                    Connection.id == container_id,
                    Connection.owner == user.id,
                    Connection.status != "disconnected",
                    Message.folder.notin_(["trash", "spam", "provider-drafts"]),
                )
            ).first()
            if row:
                return mail_ref(*row)
        elif kind == "page":
            row = db.scalar(
                select(NotePage).where(
                    NotePage.id == id,
                    NotePage.owner == user.id,
                    NotePage.deleted_at.is_(None),
                )
            )
            if row:
                return page_ref(row)
        elif kind == "project":
            row = db.scalar(
                select(NoteProject).where(
                    NoteProject.id == id,
                    NoteProject.owner == user.id,
                    NoteProject.deleted_at.is_(None),
                )
            )
            if row:
                return project_ref(row)
        elif kind == "issue":
            row = db.execute(
                select(ProjectTask, NoteProject)
                .join(NoteProject, ProjectTask.project_id == NoteProject.id)
                .where(
                    ProjectTask.id == id,
                    NoteProject.id == container_id,
                    ProjectTask.owner == user.id,
                    NoteProject.owner == user.id,
                    NoteProject.deleted_at.is_(None),
                )
            ).first()
            if row:
                return issue_ref(*row)
        else:
            feed = db.scalar(
                select(CalendarFeed).where(
                    CalendarFeed.id == container_id, CalendarFeed.owner == user.id
                )
            )
            if feed:
                for event in decrypt(feed.events) if feed.events else []:
                    if event_identity(feed.id, event) == id:
                        return calendar_ref(event, feed)
        raise HTTPException(
            404, "This reference is unavailable or no longer accessible."
        )

    return router
