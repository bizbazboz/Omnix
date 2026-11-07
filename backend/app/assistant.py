"""Bounded, private retrieval only. Model inference happens entirely in the browser."""

import re
from datetime import timedelta, datetime, time
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from .core import NotePage, NoteProject, ProjectTask, CalendarFeed, decrypt, now
from .calendar_identity import event_identity
from .workspace_settings import preferences
from urllib.parse import urlencode

STOP = set(
    "a an and are as at be can do for from how i in is it me my of on or please s tell that the this to what when where which who with you about notes calendar events projects upcoming today tomorrow next week summarise summarize summary recent latest still open tasks task project all list have has".split()
)


def text_of(value):
    # Do not include URLs, asset metadata, styling, or hidden embed identifiers.
    output = []

    def walk(item):
        if isinstance(item, list):
            for child in item:
                walk(child)
        elif isinstance(item, dict):
            if item.get("type") == "workspaceEmbed":
                return
            if isinstance(item.get("text"), str):
                output.append(item["text"])
            for key in ("content", "children", "rows", "cells"):
                if key in item:
                    walk(item[key])

    walk(value)
    return " ".join(output)[:12000]


def build_assistant_router(authenticated, db_session):
    router = APIRouter(prefix="/api/v1/assistant")

    @router.get("/context")
    def context(
        question: str = Query(min_length=1, max_length=500),
        sources: str = "notes,calendar,projects",
        days: int = Query(default=14, ge=1, le=90),
        user=Depends(authenticated),
        db=Depends(db_session),
    ):
        selected = set(sources.split(","))
        if selected - {"notes", "calendar", "projects"}:
            raise HTTPException(422, "Unknown context source.")
        tokens = set(re.findall(r"\w+", question.casefold())) - STOP
        candidates = []
        scanned = 0

        def add(kind, title, text, href, order=0):
            words = set(re.findall(r"\w+", (title + " " + text).casefold()))
            relevance = len(tokens & words) + 2 * len(
                tokens & set(re.findall(r"\w+", title.casefold()))
            )
            if tokens and not relevance:
                return
            candidates.append(
                (
                    {"kind": kind, "title": title, "text": text[:1800], "href": href},
                    relevance,
                    order,
                )
            )

        if "notes" in selected:
            for page in db.scalars(
                select(NotePage)
                .where(
                    NotePage.owner == user.id,
                    NotePage.deleted_at.is_(None),
                    NotePage.is_folder == False,
                )
                .order_by(NotePage.updated_at.desc())
                .limit(251)
            ):
                scanned += 1
                if scanned > 250:
                    break
                title, text = decrypt(page.title), text_of(decrypt(page.document))
                # Keep the passage nearest the question rather than always the note's opening.
                at = min(
                    (text.casefold().find(t) for t in tokens if t in text.casefold()),
                    default=0,
                )
                add(
                    "note",
                    title,
                    text[max(0, at - 200) : max(0, at - 200) + 1800],
                    "/notes/pages/" + page.id,
                )
        stamp, stop = now().timestamp(), (now() + timedelta(days=days)).timestamp()
        local = now().astimezone(ZoneInfo(preferences(user).get("timezone") or "UTC"))
        if re.search(r"\btomorrow\b", question, re.I):
            stamp = datetime.combine(
                local.date() + timedelta(days=1), time(), local.tzinfo
            ).timestamp()
            stop = datetime.combine(
                local.date() + timedelta(days=2), time(), local.tzinfo
            ).timestamp()
        elif re.search(r"\btoday\b", question, re.I):
            stamp = datetime.combine(local.date(), time(), local.tzinfo).timestamp()
            stop = datetime.combine(
                local.date() + timedelta(days=1), time(), local.tzinfo
            ).timestamp()
        elif re.search(r"\bthis week\b", question, re.I):
            stop = min(
                stop,
                datetime.combine(
                    local.date() + timedelta(days=7 - local.weekday()),
                    time(),
                    local.tzinfo,
                ).timestamp(),
            )
        if "calendar" in selected:
            for feed in db.scalars(
                select(CalendarFeed).where(CalendarFeed.owner == user.id)
            ):
                for event in decrypt(feed.events) if feed.events else []:
                    if event["start_ts"] < stop and event["end_ts"] >= stamp:
                        text = f"{event['start']} to {event['end']}. Calendar: {feed.label}. Location: {event.get('location','')}. {event.get('description','')}"
                        if feed.status != "ready":
                            text += " [Saved calendar data; refresh failed.]"
                        add(
                            "event",
                            event["title"],
                            text,
                            "/calendar?"
                            + urlencode(
                                {
                                    "date": event["start"][:10],
                                    "event": event_identity(feed.id, event),
                                }
                            ),
                            event["start_ts"],
                        )
        if "projects" in selected:
            for task, project in db.execute(
                select(ProjectTask, NoteProject)
                .join(NoteProject, ProjectTask.project_id == NoteProject.id)
                .where(
                    ProjectTask.owner == user.id,
                    NoteProject.owner == user.id,
                    NoteProject.deleted_at.is_(None),
                )
                .order_by(ProjectTask.updated_at.desc())
                .limit(200)
            ):
                if (
                    re.search(
                        r"\b(open|unfinished|still|outstanding)\b", question, re.I
                    )
                    and task.status == "done"
                ):
                    continue
                add(
                    "issue",
                    decrypt(task.title),
                    f"Project: {decrypt(project.title)}. Status: {task.status}. Priority: {task.priority}. Due: {task.end or 'Not set'}. {decrypt(task.description)}",
                    "/notes/projects/" + project.id + "?view=issues&issue=" + task.id,
                )
        # Diversify so a busy calendar cannot silently crowd all matching notes out.
        ranked = sorted(candidates, key=lambda c: (-c[1], c[2]))
        chosen = []
        for kind in ("note", "event", "issue"):
            chosen.extend([row[0] for row in ranked if row[0]["kind"] == kind][:3])
        return {
            "items": chosen[:8],
            "notes_partial": scanned > 250,
            "calendar_days": days,
            "as_of": now().isoformat(),
        }

    return router
