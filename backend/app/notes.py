"""Private encrypted notes and project tasks. Trash is recoverable; no automatic purge."""

import base64
import json
from urllib.parse import quote, urlsplit, urlunsplit, parse_qsl, urlencode
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from datetime import date
from sqlalchemy import select, func
from .core import (
    User,
    NotePage,
    NoteRevision,
    NoteAsset,
    NoteProject,
    ProjectTask,
    IssueComment,
    IssueActivity,
    encrypt,
    decrypt,
    now,
    uid,
)

from .workspace_urls import canonical_document_links

BLOCKS = {
    "paragraph",
    "heading",
    "bulletListItem",
    "numberedListItem",
    "checkListItem",
    "toggleListItem",
    "quote",
    "codeBlock",
    "table",
    "image",
    "file",
    "divider",
    "callout",
    "workspaceEmbed",
}


def document(value):
    value = canonical_document_links(value)
    if not isinstance(value, list) or not value:
        raise HTTPException(422, "A note needs at least one block.")
    if len(json.dumps(value).encode()) > 800000:
        raise HTTPException(413, "Notes must be smaller than 800 KB.")
    count = 0

    def walk(item, depth=0):
        nonlocal count
        count += 1
        if count > 20000 or depth > 64:
            raise HTTPException(422, "Document structure is too complex.")
        if isinstance(item, dict):
            for key, child in item.items():
                if key in ("url", "href") and isinstance(child, str) and child:
                    try:
                        parsed = urlsplit(child.strip())
                    except ValueError:
                        raise HTTPException(422, "Invalid link URL.") from None
                    if parsed.scheme.lower() not in (
                        "http",
                        "https",
                        "mailto",
                    ) and not child.startswith(
                        (
                            "/notes/pages/",
                            "/notes/projects/",
                            "/email",
                            "/calendar",
                            "/api/v1/notes/pages/",
                            "#",
                        )
                    ):
                        raise HTTPException(
                            422, "Use HTTP, HTTPS, mail or workspace links."
                        )
                walk(child, depth + 1)
        elif isinstance(item, list):
            for child in item:
                walk(child, depth + 1)

    seen_blocks = set()

    def blocks(items, depth=0):
        if depth > 32:
            raise HTTPException(422, "Block nesting exceeds 32 levels.")
        for block in items:
            if (
                not isinstance(block, dict)
                or block.get("type") not in BLOCKS
                or not isinstance(block.get("children", []), list)
            ):
                raise HTTPException(422, "Unsupported note block.")
            if block.get("type") == "codeBlock":
                language = block.get("props", {}).get("language", "auto")
                if not isinstance(language, str) or len(language) > 50:
                    raise HTTPException(422, "Invalid code language.")
            if block.get("type") == "workspaceEmbed":
                props = block.get("props", {})
                if (
                    not isinstance(props, dict)
                    or props.get("kind")
                    not in ("mail", "event", "issue", "project", "page")
                    or not isinstance(props.get("itemId"), str)
                    or not 0 < len(props["itemId"]) <= 200
                    or not isinstance(props.get("containerId", ""), str)
                    or len(props.get("containerId", "")) > 200
                ):
                    raise HTTPException(422, "Invalid workspace reference.")
            if "id" in block:
                identifier = block["id"]
                if (
                    not isinstance(identifier, str)
                    or not identifier
                    or len(identifier) > 100
                    or identifier in seen_blocks
                ):
                    raise HTTPException(
                        422, "Block identifiers must be unique strings."
                    )
                seen_blocks.add(identifier)
            blocks(block.get("children", []), depth + 1)

    blocks(value)
    walk(value)
    return value


def blank():
    return [
        {"id": uid(), "type": "paragraph", "props": {}, "content": [], "children": []}
    ]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PageCreate(Input):
    title: str = Field(default="Untitled", max_length=300)
    parent_id: str | None = None
    project_id: str | None = None
    is_folder: bool = False
    document: list[dict] | None = None


class PagePatch(Input):
    expected_revision: int = Field(ge=1)
    title: str | None = Field(default=None, max_length=300)
    document: list[dict] | None = None
    parent_id: str | None = None
    project_id: str | None = None
    position: int | None = Field(default=None, ge=0, le=1000000)
    favorite: bool | None = None


class RevisionInput(Input):
    expected_revision: int = Field(ge=1)


class ProjectCreate(Input):
    key: str = Field(default="", pattern=r"^(?:[A-Z][A-Z0-9]{1,9})?$")
    title: str = Field(default="Untitled project", min_length=1, max_length=300)


class ProjectPatch(ProjectCreate):
    expected_revision: int = Field(ge=1)


class CommentInput(Input):
    body: str = Field(min_length=1, max_length=5000)


class TaskInput(Input):
    title: str = Field(min_length=1, max_length=300)
    description: str = Field(default="", max_length=20000)
    issue_type: str = "task"
    labels: list[str] = Field(default_factory=list, max_length=20)
    sprint: str = Field(default="", max_length=100)
    estimate: int | None = Field(default=None, ge=0, le=1000)
    status: str = "todo"
    priority: str = "normal"
    start: date | None = None
    end: date | None = None
    progress: int = Field(default=0, ge=0, le=100)
    milestone: bool = False
    position: int = Field(default=0, ge=0, le=1000000)
    parent_id: str | None = None
    page_id: str | None = None
    dependencies: list[str] = Field(default_factory=list, max_length=100)


class TaskPatch(TaskInput):
    expected_revision: int = Field(ge=1)


def owned(db, model, id, user, lock=False, deleted=False):
    query = select(model).where(model.id == id, model.owner == user.id)
    if not deleted and hasattr(model, "deleted_at"):
        query = query.where(model.deleted_at.is_(None))
    row = db.scalar(query.with_for_update() if lock else query)
    if not row:
        raise HTTPException(404, "Item not found.")
    return row


def revision(row, expected):
    if row.revision != expected:
        raise HTTPException(
            409,
            "This item changed in another tab. Keep your edits, reload the remote version or save a copy.",
        )


def page_json(row, full=False):
    result = {
        "id": row.id,
        "title": decrypt(row.title),
        "parent_id": row.parent_id,
        "is_folder": row.is_folder,
        "project_id": row.project_id,
        "position": row.position,
        "favorite": row.favorite,
        "revision": row.revision,
        "updated_at": row.updated_at.isoformat(),
        "deleted_at": row.deleted_at.isoformat() if row.deleted_at else None,
    }
    if full:
        result.update(
            document=canonical_document_links(decrypt(row.document)), schema_version=1
        )
    return result


def issue_prefix(id):
    return "PRJ" + id.replace("-", "")[:8].upper()


def project_json(row):
    return {
        "id": row.id,
        "title": decrypt(row.title),
        "issue_prefix": row.issue_prefix,
        "revision": row.revision,
        "updated_at": row.updated_at.isoformat(),
        "deleted_at": row.deleted_at.isoformat() if row.deleted_at else None,
    }


def task_json(row):
    return {
        "id": row.id,
        "project_id": row.project_id,
        "title": decrypt(row.title),
        "description": decrypt(row.description),
        "issue_number": row.issue_number,
        "issue_key": row.project.issue_prefix + "-" + str(row.issue_number),
        "issue_type": row.issue_type,
        "labels": decrypt(row.labels),
        "sprint": decrypt(row.sprint),
        "estimate": row.estimate,
        "parent_id": row.parent_id,
        "page_id": row.page_id,
        "status": row.status,
        "priority": row.priority,
        "start": row.start,
        "end": row.end,
        "progress": row.progress,
        "milestone": row.milestone,
        "position": row.position,
        "dependencies": json.loads(row.dependencies),
        "revision": row.revision,
    }


def snapshot(db, page, force=False):
    last = db.scalar(
        select(NoteRevision)
        .where(NoteRevision.page_id == page.id)
        .order_by(NoteRevision.created_at.desc())
        .limit(1)
    )
    if last and (
        last.revision == page.revision
        or (not force and (now() - last.created_at).total_seconds() < 60)
    ):
        return
    used = db.scalar(
        select(func.coalesce(func.sum(func.length(NoteRevision.snapshot)), 0))
        .join(NotePage, NotePage.id == NoteRevision.page_id)
        .where(NotePage.owner == page.owner)
    )
    if used + len(page.document) + len(page.title) > 64 * 1024 * 1024:
        if force:
            raise HTTPException(
                413,
                "The version-history quota has been reached. Current notes can still save; export a backup before requesting more checkpoints.",
            )
        return
    db.add(
        NoteRevision(
            page_id=page.id,
            revision=page.revision,
            snapshot=encrypt(
                {"title": decrypt(page.title), "document": decrypt(page.document)}
            ),
        )
    )
    db.flush()


def storage_quota(db, user):
    used = db.scalar(
        select(
            func.coalesce(
                func.sum(func.length(NotePage.document) + func.length(NotePage.title)),
                0,
            )
        ).where(NotePage.owner == user.id)
    )
    if used > 32 * 1024 * 1024:
        raise HTTPException(
            413, "The 32 MiB encrypted note-storage quota has been reached."
        )


def structural_lock(db, user):
    db.scalar(select(User).where(User.id == user.id).with_for_update())


def check_parent(db, user, id, parent):
    seen = {id}
    depth = 0
    while parent:
        if parent in seen:
            raise HTTPException(
                422, "A page cannot be nested inside itself or its descendants."
            )
        seen.add(parent)
        depth += 1
        if depth >= 32:
            raise HTTPException(422, "Page nesting exceeds 32 levels.")
        parent = owned(db, NotePage, parent, user).parent_id
    if id != "new":
        rows = list(db.scalars(select(NotePage).where(NotePage.owner == user.id)))
        pending = [(id, depth)]
        while pending:
            node, level = pending.pop()
            if level >= 32:
                raise HTTPException(422, "The moved subtree would exceed 32 levels.")
            pending.extend((row.id, level + 1) for row in rows if row.parent_id == node)


def validate_task(db, user, project, value, id=None):
    if value.status not in (
        "backlog",
        "todo",
        "in_progress",
        "in_review",
        "blocked",
        "done",
    ) or value.priority not in ("low", "normal", "high", "urgent"):
        raise HTTPException(422, "Choose a valid status and priority.")
    if value.issue_type not in ("epic", "story", "task", "bug", "subtask"):
        raise HTTPException(422, "Choose a valid issue type.")
    if any(not label.strip() or len(label) > 40 for label in value.labels):
        raise HTTPException(422, "Labels must contain 1 to 40 characters.")
    if value.issue_type == "subtask" and not value.parent_id:
        raise HTTPException(422, "Subtasks need a parent issue.")
    if value.issue_type == "epic" and value.parent_id:
        raise HTTPException(422, "Epics cannot have a parent issue.")
    if value.start and value.end and value.end < value.start:
        raise HTTPException(422, "End date must not precede start date.")
    if value.milestone and (not value.start or value.start != value.end):
        raise HTTPException(422, "Milestones need the same start and end date.")
    if value.page_id:
        owned(db, NotePage, value.page_id, user)
    rows = list(
        db.scalars(
            select(ProjectTask).where(
                ProjectTask.project_id == project.id, ProjectTask.owner == user.id
            )
        )
    )
    by_id = {row.id: row for row in rows}
    parent = value.parent_id
    seen = {id}
    while parent:
        if parent in seen or parent not in by_id:
            raise HTTPException(422, "Invalid task parent.")
        seen.add(parent)
        parent = by_id[parent].parent_id
    if any(dep == id or dep not in by_id for dep in value.dependencies):
        raise HTTPException(422, "Dependencies must be other tasks in this project.")
    graph = {row.id: json.loads(row.dependencies) for row in rows}
    graph[id or "new"] = list(dict.fromkeys(value.dependencies))
    # Kahn's algorithm avoids recursion limits for long dependency chains.
    waiting = {key: set(deps) for key, deps in graph.items()}
    ready = [key for key, deps in waiting.items() if not deps]
    visited = set()
    while ready:
        key = ready.pop()
        if key in visited:
            continue
        visited.add(key)
        for other, deps in waiting.items():
            if key in deps:
                deps.remove(key)
                if not deps:
                    ready.append(other)
    if len(visited) != len(waiting):
        raise HTTPException(422, "Task dependencies cannot form a cycle.")


def put_task(row, value):
    row.title = encrypt(value.title.strip() or "Untitled task")
    row.description = encrypt(value.description)
    row.labels = encrypt(list(dict.fromkeys(label.strip() for label in value.labels)))
    row.sprint = encrypt(value.sprint.strip())
    row.issue_type = value.issue_type
    row.estimate = value.estimate
    for key in (
        "status",
        "priority",
        "progress",
        "milestone",
        "position",
        "parent_id",
        "page_id",
    ):
        setattr(row, key, getattr(value, key))
    row.start = value.start.isoformat() if value.start else None
    row.end = value.end.isoformat() if value.end else None
    row.dependencies = json.dumps(list(dict.fromkeys(value.dependencies)))
    if value.status == "done":
        row.progress = 100
    row.updated_at = now()


def activity(db, task, summary):
    db.add(IssueActivity(task_id=task.id, owner=task.owner, summary=encrypt(summary)))


def build_notes_router(authenticated, db_session):
    router = APIRouter(prefix="/api/v1/notes")
    from .note_references import build_reference_router

    router.include_router(build_reference_router(authenticated, db_session))

    @router.get("/pages")
    def pages(
        q: str = Query(default="", max_length=200),
        offset: int = Query(default=0, ge=0),
        limit: int = Query(default=200, ge=1, le=500),
        trash: bool = False,
        user=Depends(authenticated),
        db=Depends(db_session),
    ):
        query = select(NotePage).where(NotePage.owner == user.id)
        query = query.where(
            NotePage.deleted_at.is_not(None) if trash else NotePage.deleted_at.is_(None)
        )
        rows = list(
            db.scalars(
                query.order_by(NotePage.updated_at.desc(), NotePage.id)
                .offset(offset)
                .limit(limit + 1)
            )
        )
        more = len(rows) > limit
        result = []
        for row in rows[:limit]:
            item = page_json(row)
            if (
                q
                and q.casefold()
                not in (
                    item["title"]
                    + " "
                    + json.dumps(decrypt(row.document), ensure_ascii=False)
                ).casefold()
            ):
                continue
            result.append(item)
        return {
            "items": result,
            "next_offset": offset + limit if more else None,
            "search_partial": bool(q and more),
        }

    @router.post("/pages", status_code=201)
    def create_page(
        value: PageCreate, user=Depends(authenticated), db=Depends(db_session)
    ):
        structural_lock(db, user)
        if (
            db.scalar(
                select(func.count())
                .select_from(NotePage)
                .where(NotePage.owner == user.id)
            )
            >= 5000
        ):
            raise HTTPException(413, "Page limit reached.")
        check_parent(db, user, "new", value.parent_id)
        if value.project_id:
            owned(db, NoteProject, value.project_id, user)
        total = db.scalar(
            select(func.coalesce(func.sum(func.length(NotePage.document)), 0)).where(
                NotePage.owner == user.id
            )
        )
        if total > 32 * 1024 * 1024:
            raise HTTPException(
                413, "Note storage quota reached. Export notes before adding more."
            )
        page = NotePage(
            owner=user.id,
            parent_id=value.parent_id,
            is_folder=value.is_folder,
            project_id=value.project_id,
            title=encrypt(value.title.strip() or "Untitled"),
            document=encrypt(
                document(value.document) if value.document is not None else blank()
            ),
            position=(
                db.scalar(
                    select(func.coalesce(func.max(NotePage.position), -1)).where(
                        NotePage.owner == user.id,
                        NotePage.parent_id == value.parent_id,
                        NotePage.deleted_at.is_(None),
                    )
                )
                + 1
            ),
        )
        db.add(page)
        db.flush()
        storage_quota(db, user)
        snapshot(db, page, True)
        db.commit()
        return page_json(page, True)

    @router.get("/pages/{id}")
    def get_page(id: str, user=Depends(authenticated), db=Depends(db_session)):
        return page_json(owned(db, NotePage, id, user), True)

    @router.patch("/pages/{id}")
    def patch_page(
        id: str, value: PagePatch, user=Depends(authenticated), db=Depends(db_session)
    ):
        structural_lock(db, user)
        page = owned(db, NotePage, id, user, True)
        revision(page, value.expected_revision)
        if "parent_id" in value.model_fields_set:
            check_parent(db, user, id, value.parent_id)
            page.parent_id = value.parent_id
        if "project_id" in value.model_fields_set:
            if value.project_id:
                owned(db, NoteProject, value.project_id, user)
            page.project_id = value.project_id
        if value.title is not None:
            page.title = encrypt(value.title.strip() or "Untitled")
        if value.document is not None:
            page.document = encrypt(document(value.document))
        if "parent_id" in value.model_fields_set or value.position is not None:
            siblings = list(
                db.scalars(
                    select(NotePage)
                    .where(
                        NotePage.owner == user.id,
                        NotePage.parent_id == page.parent_id,
                        NotePage.deleted_at.is_(None),
                        NotePage.id != page.id,
                    )
                    .order_by(NotePage.position, NotePage.id)
                )
            )
            index = min(
                value.position if value.position is not None else len(siblings),
                len(siblings),
            )
            siblings.insert(index, page)
            for position, sibling in enumerate(siblings):
                sibling.position = position
        if value.favorite is not None:
            page.favorite = value.favorite
        page.revision += 1
        page.updated_at = now()
        storage_quota(db, user)
        snapshot(db, page)
        db.commit()
        return page_json(page, True)

    @router.post("/pages/{id}/duplicate", status_code=201)
    def duplicate(id: str, user=Depends(authenticated), db=Depends(db_session)):
        structural_lock(db, user)
        source = owned(db, NotePage, id, user)
        if (
            db.scalar(
                select(func.count())
                .select_from(NotePage)
                .where(NotePage.owner == user.id)
            )
            >= 5000
        ):
            raise HTTPException(413, "Page limit reached.")
        assets = list(
            db.scalars(
                select(NoteAsset).where(
                    NoteAsset.page_id == id, NoteAsset.owner == user.id
                )
            )
        )
        used = db.scalar(
            select(func.coalesce(func.sum(NoteAsset.size), 0)).where(
                NoteAsset.owner == user.id
            )
        )
        if used + sum(asset.size for asset in assets) > 20 * 1024 * 1024:
            raise HTTPException(
                413, "Duplicating attachments would exceed the storage quota."
            )
        page = NotePage(
            owner=user.id,
            parent_id=source.parent_id,
            project_id=source.project_id,
            title=encrypt(decrypt(source.title) + " (copy)"),
            document=source.document,
            position=source.position,
            is_folder=source.is_folder,
        )
        db.add(page)
        db.flush()
        raw = json.dumps(decrypt(source.document))
        for asset in assets:
            copy = NoteAsset(
                owner=user.id,
                page_id=page.id,
                name=asset.name,
                content_type=asset.content_type,
                size=asset.size,
                content=asset.content,
            )
            db.add(copy)
            db.flush()
            raw = raw.replace(
                f"/api/v1/notes/pages/{id}/assets/{asset.id}",
                f"/api/v1/notes/pages/{page.id}/assets/{copy.id}",
            )
        page.document = encrypt(json.loads(raw))
        storage_quota(db, user)
        snapshot(db, page, True)
        db.commit()
        return page_json(page, True)

    @router.delete("/pages/{id}")
    def trash_page(
        id: str,
        value: RevisionInput,
        user=Depends(authenticated),
        db=Depends(db_session),
    ):
        structural_lock(db, user)
        root = owned(db, NotePage, id, user, True)
        revision(root, value.expected_revision)
        rows = list(db.scalars(select(NotePage).where(NotePage.owner == user.id)))
        targets = set()
        todo = [id]
        while todo:
            current = todo.pop()
            if current in targets:
                continue
            targets.add(current)
            todo.extend(row.id for row in rows if row.parent_id == current)
        batch, stamp = uid(), now()
        for row in rows:
            if row.id in targets and row.deleted_at is None:
                row.deleted_at = stamp
                row.trash_batch = batch
                row.revision += 1
        db.commit()
        return {"trashed": list(targets)}

    @router.post("/pages/{id}/restore")
    def restore(id: str, user=Depends(authenticated), db=Depends(db_session)):
        structural_lock(db, user)
        root = owned(db, NotePage, id, user, True, True)
        if root.deleted_at is None:
            return page_json(root)
        rows = list(
            db.scalars(
                select(NotePage).where(
                    NotePage.owner == user.id, NotePage.trash_batch == root.trash_batch
                )
            )
        )
        restoring = {row.id for row in rows}
        for row in rows:
            parent = db.get(NotePage, row.parent_id) if row.parent_id else None
            if parent and parent.deleted_at and parent.id not in restoring:
                row.parent_id = None
            row.deleted_at = None
            row.trash_batch = ""
            row.revision += 1
            row.updated_at = now()
        db.commit()
        return page_json(root)

    @router.get("/pages/{id}/revisions")
    def history(id: str, user=Depends(authenticated), db=Depends(db_session)):
        owned(db, NotePage, id, user)
        return [
            {
                "id": row.id,
                "revision": row.revision,
                "created_at": row.created_at.isoformat(),
            }
            for row in db.scalars(
                select(NoteRevision)
                .where(NoteRevision.page_id == id)
                .order_by(NoteRevision.created_at.desc())
                .limit(100)
            )
        ]

    @router.post("/pages/{id}/revisions")
    def save_version(id: str, user=Depends(authenticated), db=Depends(db_session)):
        page = owned(db, NotePage, id, user, True)
        snapshot(db, page, True)
        db.commit()
        return {"saved": True}

    @router.get("/pages/{id}/revisions/{version}")
    def get_version(
        id: str, version: str, user=Depends(authenticated), db=Depends(db_session)
    ):
        owned(db, NotePage, id, user)
        row = db.scalar(
            select(NoteRevision).where(
                NoteRevision.id == version, NoteRevision.page_id == id
            )
        )
        if not row:
            raise HTTPException(404, "Version not found.")
        snapshot_value = decrypt(row.snapshot)
        snapshot_value["document"] = canonical_document_links(
            snapshot_value["document"]
        )
        return {"revision": row.revision, **snapshot_value}

    @router.post("/pages/{id}/revisions/{version}/restore")
    def restore_version(
        id: str,
        version: str,
        value: RevisionInput,
        user=Depends(authenticated),
        db=Depends(db_session),
    ):
        page = owned(db, NotePage, id, user, True)
        revision(page, value.expected_revision)
        old = get_version(id, version, user, db)
        snapshot(db, page, True)
        page.title = encrypt(old["title"])
        page.document = encrypt(old["document"])
        page.revision += 1
        page.updated_at = now()
        snapshot(db, page, True)
        db.commit()
        return page_json(page, True)

    @router.get("/pages/{id}/backlinks")
    def backlinks(
        id: str,
        offset: int = Query(default=0, ge=0),
        user=Depends(authenticated),
        db=Depends(db_session),
    ):
        owned(db, NotePage, id, user)
        rows = list(
            db.scalars(
                select(NotePage)
                .where(NotePage.owner == user.id, NotePage.deleted_at.is_(None))
                .order_by(NotePage.id)
                .offset(offset)
                .limit(201)
            )
        )

        def references_page(document):
            pending = [document]
            while pending:
                value = pending.pop()
                if isinstance(value, str) and "/notes/pages/" + id in value:
                    return True
                if isinstance(value, dict):
                    if (
                        value.get("type") == "workspaceEmbed"
                        and value.get("props", {}).get("kind") == "page"
                        and value.get("props", {}).get("itemId") == id
                    ):
                        return True
                    pending.extend(value.values())
                elif isinstance(value, list):
                    pending.extend(value)
            return False

        return {
            "items": [
                page_json(row)
                for row in rows[:200]
                if row.id != id and references_page(decrypt(row.document))
            ],
            "next_offset": offset + 200 if len(rows) > 200 else None,
        }

    @router.post("/pages/{id}/assets", status_code=201)
    async def upload(
        id: str,
        request: Request,
        name: str = Query(max_length=180),
        user=Depends(authenticated),
        db=Depends(db_session),
    ):
        structural_lock(db, user)
        owned(db, NotePage, id, user)
        content = await request.body()
        if not content or len(content) > 5 * 1024 * 1024:
            raise HTTPException(413, "Files must be between 1 byte and 5 MiB.")
        used = db.scalar(
            select(func.coalesce(func.sum(NoteAsset.size), 0)).where(
                NoteAsset.owner == user.id
            )
        )
        if used + len(content) > 20 * 1024 * 1024:
            raise HTTPException(
                413, "The 20 MiB note attachment quota has been reached."
            )
        mime = (
            "image/png"
            if content.startswith(b"\x89PNG\r\n\x1a\n")
            else (
                "image/jpeg"
                if content.startswith(b"\xff\xd8\xff")
                else (
                    "image/gif"
                    if content.startswith((b"GIF87a", b"GIF89a"))
                    else (
                        "image/webp"
                        if content.startswith(b"RIFF") and content[8:12] == b"WEBP"
                        else "application/octet-stream"
                    )
                )
            )
        )
        asset = NoteAsset(
            owner=user.id,
            page_id=id,
            name=name.replace("/", "_").replace("\\", "_")[:180],
            content_type=mime,
            size=len(content),
            content=encrypt(base64.b64encode(content).decode()),
        )
        db.add(asset)
        db.commit()
        return {
            "id": asset.id,
            "name": asset.name,
            "url": f"/api/v1/notes/pages/{id}/assets/{asset.id}",
            "content_type": mime,
            "size": asset.size,
        }

    @router.get("/pages/{id}/assets")
    def assets(id: str, user=Depends(authenticated), db=Depends(db_session)):
        owned(db, NotePage, id, user)
        return [
            {
                "id": row.id,
                "name": row.name,
                "size": row.size,
                "url": f"/api/v1/notes/pages/{id}/assets/{row.id}",
            }
            for row in db.scalars(
                select(NoteAsset).where(
                    NoteAsset.page_id == id, NoteAsset.owner == user.id
                )
            )
        ]

    @router.get("/pages/{id}/assets/{asset_id}")
    def asset(
        id: str, asset_id: str, user=Depends(authenticated), db=Depends(db_session)
    ):
        owned(db, NotePage, id, user)
        row = db.scalar(
            select(NoteAsset).where(
                NoteAsset.id == asset_id,
                NoteAsset.page_id == id,
                NoteAsset.owner == user.id,
            )
        )
        if not row:
            raise HTTPException(404, "File not found.")
        disposition = (
            "inline" if row.content_type.startswith("image/") else "attachment"
        )
        return Response(
            base64.b64decode(decrypt(row.content)),
            media_type=row.content_type,
            headers={
                "Content-Disposition": disposition
                + "; filename*=UTF-8''"
                + quote(row.name),
                "Content-Security-Policy": "default-src 'none'; sandbox",
                "X-Content-Type-Options": "nosniff",
            },
        )

    @router.get("/projects")
    def projects(
        trash: bool = False, user=Depends(authenticated), db=Depends(db_session)
    ):
        query = select(NoteProject).where(NoteProject.owner == user.id)
        query = query.where(
            NoteProject.deleted_at.is_not(None)
            if trash
            else NoteProject.deleted_at.is_(None)
        )
        return [
            project_json(row)
            for row in db.scalars(
                query.order_by(NoteProject.updated_at.desc()).limit(500)
            )
        ]

    @router.post("/projects", status_code=201)
    def new_project(
        value: ProjectCreate, user=Depends(authenticated), db=Depends(db_session)
    ):
        structural_lock(db, user)
        if (
            db.scalar(
                select(func.count())
                .select_from(NoteProject)
                .where(NoteProject.owner == user.id)
            )
            >= 500
        ):
            raise HTTPException(413, "Project limit reached.")
        project = NoteProject(
            owner=user.id, title=encrypt(value.title.strip() or "Untitled project")
        )
        db.add(project)
        db.flush()
        project.issue_prefix = value.key or issue_prefix(project.id)
        if db.scalar(
            select(NoteProject.id).where(
                NoteProject.owner == user.id,
                NoteProject.issue_prefix == project.issue_prefix,
                NoteProject.id != project.id,
            )
        ):
            raise HTTPException(
                409, "Choose a different project key; this one is already in use."
            )
        db.commit()
        return project_json(project)

    @router.get("/projects/{id}")
    def project(id: str, user=Depends(authenticated), db=Depends(db_session)):
        return project_json(owned(db, NoteProject, id, user))

    @router.patch("/projects/{id}")
    def rename_project(
        id: str,
        value: ProjectPatch,
        user=Depends(authenticated),
        db=Depends(db_session),
    ):
        row = owned(db, NoteProject, id, user, True)
        revision(row, value.expected_revision)
        row.title = encrypt(value.title.strip() or "Untitled project")
        row.revision += 1
        row.updated_at = now()
        db.commit()
        return project_json(row)

    @router.delete("/projects/{id}")
    def trash_project(
        id: str,
        value: RevisionInput,
        user=Depends(authenticated),
        db=Depends(db_session),
    ):
        row = owned(db, NoteProject, id, user, True)
        revision(row, value.expected_revision)
        row.deleted_at = now()
        row.revision += 1
        db.commit()
        return {"deleted": True}

    @router.post("/projects/{id}/restore")
    def restore_project(id: str, user=Depends(authenticated), db=Depends(db_session)):
        row = owned(db, NoteProject, id, user, True, True)
        row.deleted_at = None
        row.revision += 1
        db.commit()
        return project_json(row)

    @router.get("/projects/{id}/tasks")
    def tasks(id: str, user=Depends(authenticated), db=Depends(db_session)):
        owned(db, NoteProject, id, user)
        return [
            task_json(row)
            for row in db.scalars(
                select(ProjectTask)
                .where(ProjectTask.project_id == id, ProjectTask.owner == user.id)
                .order_by(ProjectTask.position, ProjectTask.id)
                .limit(1000)
            )
        ]

    @router.post("/projects/{id}/tasks", status_code=201)
    def create_task(
        id: str, value: TaskInput, user=Depends(authenticated), db=Depends(db_session)
    ):
        project = owned(db, NoteProject, id, user, True)
        if (
            db.scalar(
                select(func.count())
                .select_from(ProjectTask)
                .where(ProjectTask.project_id == id)
            )
            >= 1000
        ):
            raise HTTPException(413, "This project has reached its 1,000 task limit.")
        validate_task(db, user, project, value)
        task = ProjectTask(
            owner=user.id, project_id=id, issue_number=project.next_issue_number
        )
        project.next_issue_number += 1
        put_task(task, value)
        db.add(task)
        db.flush()
        activity(db, task, "Created issue")
        project.updated_at = now()
        db.commit()
        return task_json(task)

    @router.put("/projects/{id}/tasks/{task_id}")
    def update_task(
        id: str,
        task_id: str,
        value: TaskPatch,
        user=Depends(authenticated),
        db=Depends(db_session),
    ):
        project = owned(db, NoteProject, id, user, True)
        task = owned(db, ProjectTask, task_id, user, True)
        if task.project_id != id:
            raise HTTPException(404, "Task not found.")
        revision(task, value.expected_revision)
        validate_task(db, user, project, value, task.id)
        before = task_json(task)
        put_task(task, value)
        changed = [
            key.replace("_", " ")
            for key in TaskInput.model_fields
            if key in before and before[key] != task_json(task).get(key)
        ]
        if changed:
            activity(db, task, "Updated " + ", ".join(changed))
        task.revision += 1
        project.updated_at = now()
        db.commit()
        return task_json(task)

    @router.delete("/projects/{id}/tasks/{task_id}")
    def delete_task(
        id: str,
        task_id: str,
        value: RevisionInput,
        user=Depends(authenticated),
        db=Depends(db_session),
    ):
        owned(db, NoteProject, id, user, True)
        task = owned(db, ProjectTask, task_id, user, True)
        if task.project_id != id:
            raise HTTPException(404, "Task not found.")
        revision(task, value.expected_revision)
        for row in db.scalars(
            select(ProjectTask).where(
                ProjectTask.project_id == id, ProjectTask.owner == user.id
            )
        ):
            deps = json.loads(row.dependencies)
            if task_id in deps:
                row.dependencies = json.dumps([key for key in deps if key != task_id])
                row.revision += 1
            if row.parent_id == task_id:
                row.parent_id = None
                if row.issue_type == "subtask":
                    row.issue_type = "task"
                row.revision += 1
        db.delete(task)
        db.commit()
        return {"deleted": True}

    def issue_for(id, task_id, user, db):
        owned(db, NoteProject, id, user)
        task = owned(db, ProjectTask, task_id, user)
        if task.project_id != id:
            raise HTTPException(404, "Issue not found.")
        return task

    @router.get("/projects/{id}/tasks/{task_id}/discussion")
    def discussion(
        id: str, task_id: str, user=Depends(authenticated), db=Depends(db_session)
    ):
        issue_for(id, task_id, user, db)
        return {
            "comments": [
                {
                    "id": row.id,
                    "body": decrypt(row.body),
                    "created_at": row.created_at.isoformat(),
                }
                for row in db.scalars(
                    select(IssueComment)
                    .where(
                        IssueComment.task_id == task_id, IssueComment.owner == user.id
                    )
                    .order_by(IssueComment.created_at)
                    .limit(500)
                )
            ],
            "activity": [
                {
                    "id": row.id,
                    "summary": decrypt(row.summary),
                    "created_at": row.created_at.isoformat(),
                }
                for row in db.scalars(
                    select(IssueActivity)
                    .where(
                        IssueActivity.task_id == task_id, IssueActivity.owner == user.id
                    )
                    .order_by(IssueActivity.created_at.desc())
                    .limit(100)
                )
            ],
        }

    @router.post("/projects/{id}/tasks/{task_id}/comments", status_code=201)
    def add_comment(
        id: str,
        task_id: str,
        value: CommentInput,
        user=Depends(authenticated),
        db=Depends(db_session),
    ):
        task = issue_for(id, task_id, user, db)
        structural_lock(db, user)
        if not value.body.strip():
            raise HTTPException(422, "Write a comment first.")
        count = db.scalar(
            select(func.count())
            .select_from(IssueComment)
            .where(IssueComment.task_id == task_id)
        )
        if count >= 500:
            raise HTTPException(413, "This issue has reached its comment limit.")
        row = IssueComment(
            task_id=task.id, owner=user.id, body=encrypt(value.body.strip())
        )
        db.add(row)
        db.commit()
        return {
            "id": row.id,
            "body": value.body.strip(),
            "created_at": row.created_at.isoformat(),
        }

    @router.get("/export")
    def export(
        page_id: str | None = None, user=Depends(authenticated), db=Depends(db_session)
    ):
        if page_id:
            owned(db, NotePage, page_id, user)
        pages = list(
            db.scalars(
                select(NotePage).where(
                    NotePage.owner == user.id,
                    NotePage.deleted_at.is_(None),
                    *([NotePage.id == page_id] if page_id else []),
                )
            )
        )
        ids = [page.id for page in pages]
        projects = (
            []
            if page_id
            else list(
                db.scalars(
                    select(NoteProject).where(
                        NoteProject.owner == user.id, NoteProject.deleted_at.is_(None)
                    )
                )
            )
        )
        project_ids = [project.id for project in projects]
        result = {
            "format": "omnix-notes",
            "version": 1,
            "pages": [page_json(page, True) for page in pages],
            "projects": [project_json(project) for project in projects],
            "tasks": [
                task_json(task)
                for task in db.scalars(
                    select(ProjectTask).where(
                        ProjectTask.owner == user.id,
                        ProjectTask.project_id.in_(project_ids),
                    )
                )
            ],
            "comments": [
                {"id": row.id, "task_id": row.task_id, "body": decrypt(row.body)}
                for row in db.scalars(
                    select(IssueComment)
                    .join(ProjectTask, ProjectTask.id == IssueComment.task_id)
                    .where(
                        IssueComment.owner == user.id,
                        ProjectTask.project_id.in_(project_ids),
                    )
                )
            ],
            "assets": [
                {
                    "id": asset.id,
                    "page_id": asset.page_id,
                    "name": asset.name,
                    "content": decrypt(asset.content),
                }
                for asset in db.scalars(
                    select(NoteAsset).where(
                        NoteAsset.owner == user.id, NoteAsset.page_id.in_(ids)
                    )
                )
            ],
        }
        if len(json.dumps(result).encode()) > 32 * 1024 * 1024:
            raise HTTPException(
                413, "Export exceeds 32 MiB. Export individual notes instead."
            )
        return result

    @router.post("/import", status_code=201)
    async def import_archive(
        request: Request, user=Depends(authenticated), db=Depends(db_session)
    ):
        structural_lock(db, user)
        try:
            archive = await request.json()
        except (ValueError, RecursionError):
            raise HTTPException(422, "Choose a valid Omnix JSON archive.") from None
        if (
            not isinstance(archive, dict)
            or archive.get("format") != "omnix-notes"
            or archive.get("version") != 1
        ):
            raise HTTPException(422, "Unsupported notes archive.")
        groups = {
            key: archive.get(key, [])
            for key in ("pages", "projects", "tasks", "assets", "comments")
        }
        if any(
            not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows)
            for rows in groups.values()
        ):
            raise HTTPException(422, "Invalid archive records.")

        def ids(rows):
            values = [row.get("id") for row in rows]
            if any(
                not isinstance(value, str) or not value or len(value) > 120
                for value in values
            ) or len(set(values)) != len(values):
                raise HTTPException(422, "Archive identifiers must be unique strings.")
            return {value: uid() for value in values}

        maps = {key: ids(rows) for key, rows in groups.items()}
        if (
            len(groups["pages"])
            + db.scalar(
                select(func.count())
                .select_from(NotePage)
                .where(NotePage.owner == user.id)
            )
            > 5000
            or len(groups["projects"])
            + db.scalar(
                select(func.count())
                .select_from(NoteProject)
                .where(NoteProject.owner == user.id)
            )
            > 500
        ):
            raise HTTPException(413, "Archive exceeds workspace limits.")
        page_inputs = {}
        project_rows = {}
        page_rows = {}
        task_rows = {}
        try:
            for item in groups["projects"]:
                value = ProjectCreate(title=item.get("title", "Untitled project"))
                row = NoteProject(
                    id=maps["projects"][item["id"]],
                    owner=user.id,
                    title=encrypt(value.title),
                    issue_prefix=issue_prefix(maps["projects"][item["id"]]),
                )
                db.add(row)
                project_rows[item["id"]] = row
            db.flush()
            for item in groups["pages"]:
                value = PageCreate(
                    title=item.get("title", "Untitled"),
                    document=item.get("document"),
                    is_folder=item.get("is_folder", False),
                )
                page_inputs[item["id"]] = value
                row = NotePage(
                    id=maps["pages"][item["id"]],
                    owner=user.id,
                    title=encrypt(value.title),
                    is_folder=value.is_folder,
                    document=encrypt(
                        document(value.document)
                        if value.document is not None
                        else blank()
                    ),
                    project_id=maps["projects"].get(item.get("project_id")),
                    position=max(0, min(1000000, int(item.get("position", 0)))),
                )
                db.add(row)
                page_rows[item["id"]] = row
            db.flush()
            size = 0
            replacements = {}
            for item in groups["assets"]:
                if item.get("page_id") not in page_rows:
                    raise HTTPException(422, "Archive asset has no page.")
                try:
                    raw = base64.b64decode(item.get("content", ""), validate=True)
                except (ValueError, TypeError):
                    raise HTTPException(422, "Invalid archive file encoding.") from None
                if not raw or len(raw) > 5 * 1024 * 1024:
                    raise HTTPException(413, "Archive file exceeds the 5 MiB limit.")
                size += len(raw)
                old_page = item["page_id"]
                new_page = page_rows[old_page].id
                asset_id = maps["assets"][item["id"]]
                mime = (
                    "image/png"
                    if raw.startswith(b"\x89PNG\r\n\x1a\n")
                    else (
                        "image/jpeg"
                        if raw.startswith(b"\xff\xd8\xff")
                        else (
                            "image/gif"
                            if raw.startswith((b"GIF87a", b"GIF89a"))
                            else (
                                "image/webp"
                                if raw.startswith(b"RIFF") and raw[8:12] == b"WEBP"
                                else "application/octet-stream"
                            )
                        )
                    )
                )
                db.add(
                    NoteAsset(
                        id=asset_id,
                        owner=user.id,
                        page_id=new_page,
                        name=str(item.get("name", "file")).replace("/", "_")[:180],
                        content_type=mime,
                        size=len(raw),
                        content=encrypt(base64.b64encode(raw).decode()),
                    )
                )
                replacements[f"/api/v1/notes/pages/{old_page}/assets/{item['id']}"] = (
                    f"/api/v1/notes/pages/{new_page}/assets/{asset_id}"
                )
            used = db.scalar(
                select(func.coalesce(func.sum(NoteAsset.size), 0)).where(
                    NoteAsset.owner == user.id
                )
            )
            # Pending assets are included by SQLAlchemy autoflush.
            if used > 20 * 1024 * 1024:
                raise HTTPException(413, "Archive exceeds the attachment quota.")
            for item in groups["pages"]:
                row = page_rows[item["id"]]
                row.parent_id = maps["pages"].get(item.get("parent_id"))
                raw = json.dumps(decrypt(row.document))
                for old, new in replacements.items():
                    raw = raw.replace(old, new)
                for old, new in maps["pages"].items():
                    raw = raw.replace(
                        "/notes/pages/" + old + '"', "/notes/pages/" + new + '"'
                    )
                imported_document = json.loads(raw)

                def remap_embeds(value):
                    if isinstance(value, dict):
                        for field in ("href", "url"):
                            href = value.get(field)
                            if isinstance(href, str) and href.startswith("/notes/"):
                                parsed = urlsplit(href)
                                parts = parsed.path.split("/")
                                if len(parts) == 4 and parts[2] in (
                                    "pages",
                                    "projects",
                                ):
                                    parts[3] = maps[parts[2]].get(parts[3], parts[3])
                                    query = [
                                        (
                                            key,
                                            (
                                                maps["tasks"].get(item, item)
                                                if key == "issue"
                                                else item
                                            ),
                                        )
                                        for key, item in parse_qsl(
                                            parsed.query, keep_blank_values=True
                                        )
                                    ]
                                    value[field] = urlunsplit(
                                        (
                                            "",
                                            "",
                                            "/".join(parts),
                                            urlencode(query),
                                            parsed.fragment,
                                        )
                                    )
                        if value.get("type") == "workspaceEmbed":
                            props = value.get("props", {})
                            kind = props.get("kind")
                            if kind in ("page", "issue", "project"):
                                group = (
                                    "pages"
                                    if kind == "page"
                                    else "projects" if kind == "project" else "tasks"
                                )
                                props["itemId"] = maps[group].get(
                                    props.get("itemId"), props.get("itemId")
                                )
                                if kind == "issue":
                                    props["containerId"] = maps["projects"].get(
                                        props.get("containerId"),
                                        props.get("containerId"),
                                    )
                        for child in value.values():
                            remap_embeds(child)
                    elif isinstance(value, list):
                        for child in value:
                            remap_embeds(child)

                remap_embeds(imported_document)
                row.document = encrypt(document(imported_document))
            db.flush()
            for row in page_rows.values():
                check_parent(db, user, row.id, row.parent_id)
            for item in groups["tasks"]:
                pr = project_rows.get(item.get("project_id"))
                if not pr:
                    raise HTTPException(422, "Archive task has no project.")
                payload = {
                    key: value
                    for key, value in item.items()
                    if key in TaskInput.model_fields
                }
                original_type = payload.get("issue_type", "task")
                payload.update(
                    issue_type="task" if original_type == "subtask" else original_type,
                    parent_id=None,
                    page_id=maps["pages"].get(item.get("page_id")),
                    dependencies=[],
                )
                value = TaskInput(**payload)
                row = ProjectTask(
                    id=maps["tasks"][item["id"]],
                    owner=user.id,
                    project_id=pr.id,
                    issue_number=pr.next_issue_number,
                )
                pr.next_issue_number += 1
                put_task(row, value)
                db.add(row)
                task_rows[item["id"]] = row
            db.flush()
            for item in groups["tasks"]:
                row = task_rows[item["id"]]
                payload = task_json(row)
                for key in (
                    "id",
                    "project_id",
                    "revision",
                    "issue_number",
                    "issue_key",
                ):
                    payload.pop(key)
                payload.update(
                    issue_type=item.get("issue_type", "task"),
                    parent_id=maps["tasks"].get(item.get("parent_id")),
                    dependencies=[
                        maps["tasks"].get(key, "missing")
                        for key in item.get("dependencies", [])
                    ],
                )
                value = TaskInput(**payload)
                validate_task(db, user, project_rows[item["project_id"]], value, row.id)
                put_task(row, value)
            for project_row in project_rows.values():
                if (
                    db.scalar(
                        select(func.count())
                        .select_from(ProjectTask)
                        .where(ProjectTask.project_id == project_row.id)
                    )
                    > 1000
                ):
                    raise HTTPException(413, "Archive project exceeds the task limit.")
            for item in groups["comments"]:
                task = task_rows.get(item.get("task_id"))
                if not task:
                    raise HTTPException(422, "Archive comment has no issue.")
                value = CommentInput(body=item.get("body", ""))
                if not value.body.strip():
                    raise HTTPException(422, "Archive comments must not be blank.")
                db.add(
                    IssueComment(
                        owner=user.id, task_id=task.id, body=encrypt(value.body)
                    )
                )
            for task in task_rows.values():
                if (
                    sum(
                        1
                        for item in groups["comments"]
                        if maps["tasks"].get(item.get("task_id")) == task.id
                    )
                    > 500
                ):
                    raise HTTPException(413, "Archive issue exceeds the comment limit.")
                activity(db, task, "Imported issue")
            storage_quota(db, user)
            for row in page_rows.values():
                snapshot(db, row, True)
            db.commit()
        except (ValueError, TypeError, KeyError) as error:
            db.rollback()
            raise HTTPException(422, "The archive contains invalid data.") from None
        return {
            "pages": list(maps["pages"].values()),
            "projects": list(maps["projects"].values()),
        }

    @router.get("/overview")
    def overview(user=Depends(authenticated), db=Depends(db_session)):
        recent = db.scalars(
            select(NotePage)
            .where(NotePage.owner == user.id, NotePage.deleted_at.is_(None))
            .order_by(NotePage.updated_at.desc())
            .limit(4)
        )
        due = db.scalars(
            select(ProjectTask)
            .join(NoteProject)
            .where(
                ProjectTask.owner == user.id,
                NoteProject.deleted_at.is_(None),
                ProjectTask.status != "done",
                ProjectTask.end.is_not(None),
            )
            .order_by(ProjectTask.end)
            .limit(5)
        )
        return {
            "recent": [page_json(row) for row in recent],
            "tasks": [task_json(row) for row in due],
        }

    return router
