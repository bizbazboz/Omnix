"""Private homepage layouts and isolated user-supplied widget documents."""

import html
from typing import Literal
from urllib.parse import urlsplit
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field, ConfigDict, field_validator, model_validator
from sqlalchemy import text
from .core import SystemSetting, encrypt, decrypt, now

BUILTINS = ["clock", "unread", "steps", "calendar", "weather", "transport", "news"]
DEFAULT_COLUMNS = {
    "clock": 8,
    "unread": 2,
    "steps": 2,
    "calendar": 6,
    "weather": 3,
    "transport": 3,
    "news": 12,
}
WidgetKind = Literal[
    "clock",
    "unread",
    "steps",
    "calendar",
    "weather",
    "transport",
    "news",
    "html",
    "webview",
]


class HomeWidget(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[a-z][a-z0-9_-]{0,63}$")
    kind: WidgetKind
    columns: int = 6
    title: str = Field(default="", max_length=80)
    height: int = Field(default=260, ge=120, le=900)
    html: str = Field(default="", max_length=20000)
    url: str = Field(default="", max_length=4096)

    @field_validator("columns")
    @classmethod
    def valid_columns(cls, value):
        if value not in (2, 3, 4, 6, 8, 12):
            raise ValueError("Choose a supported widget width.")
        return value

    @model_validator(mode="after")
    def validate_widget(self):
        if self.kind in BUILTINS:
            if self.id != self.kind or self.html or self.url:
                raise ValueError("Built-in widgets use their own IDs and content.")
        elif self.id in BUILTINS:
            raise ValueError("Custom widgets need a unique ID.")
        elif self.kind == "html":
            if not self.html.strip() or self.url:
                raise ValueError("Enter HTML for this widget.")
        elif self.kind == "webview":
            parsed = urlsplit(self.url)
            if (
                parsed.scheme != "https"
                or not parsed.hostname
                or parsed.username
                or parsed.password
                or self.html
            ):
                raise ValueError("Enter an HTTPS website URL without credentials.")
            try:
                parsed.port
            except ValueError:
                raise ValueError("Enter a valid HTTPS website URL.") from None
        return self


class HomeInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    widgets: list[
        Literal["clock", "unread", "steps", "calendar", "weather", "transport", "news"]
    ] = Field(default_factory=lambda: BUILTINS.copy(), max_length=7)
    layout: list[HomeWidget] | None = Field(default=None, max_length=20)
    expected_revision: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def unique_widgets(self):
        if len(self.widgets) != len(set(self.widgets)):
            raise ValueError("Choose each home section only once.")
        if self.layout is not None and len(
            {widget.id for widget in self.layout}
        ) != len(self.layout):
            raise ValueError("Each widget needs a unique ID.")
        return self


def default_layout(widgets=None):
    return [
        HomeWidget(id=kind, kind=kind, columns=DEFAULT_COLUMNS[kind]).model_dump()
        for kind in (BUILTINS if widgets is None else widgets)
    ]


def home_preferences(user, db):
    row = db.get(SystemSetting, "home:" + user.id)
    stored = decrypt(row.value) if row else {}
    layout = stored.get("layout")
    if layout is None:
        layout = default_layout(stored.get("widgets"))
        legacy_daily = db.get(SystemSetting, "daily:" + user.id)
        if legacy_daily:
            enabled = decrypt(legacy_daily.value).get(
                "widgets", ["weather", "transport", "news"]
            )
            layout = [
                widget
                for widget in layout
                if widget["kind"] not in ("weather", "transport", "news")
                or widget["kind"] in enabled
            ]
    return {
        "widgets": [widget["kind"] for widget in layout if widget["kind"] in BUILTINS],
        "layout": layout,
        "revision": stored.get("revision", 0),
    }


def build_home_router(authenticated, db_session):
    router = APIRouter(prefix="/api/v1/settings/home")

    @router.get("")
    def get_home(user=Depends(authenticated), db=Depends(db_session)):
        return home_preferences(user, db)

    @router.put("")
    def put_home(body: HomeInput, user=Depends(authenticated), db=Depends(db_session)):
        key = "home:" + user.id
        # Serialize first writes as well as existing-row edits for this account.
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": key})
        current = home_preferences(user, db)
        if (
            body.expected_revision is not None
            and body.expected_revision != current["revision"]
        ):
            raise HTTPException(
                409,
                "Your homepage changed in another window. Reload the saved layout or explicitly replace it with this one.",
            )
        layout = (
            [widget.model_dump() for widget in body.layout]
            if body.layout is not None
            else default_layout(body.widgets)
        )
        value = {
            "widgets": [
                widget["kind"] for widget in layout if widget["kind"] in BUILTINS
            ],
            "layout": layout,
            "revision": current["revision"] + 1,
        }
        row = db.get(SystemSetting, key)
        if row is None:
            row = SystemSetting(key=key, value="")
            db.add(row)
        row.value = encrypt(value)
        row.updated_at = now()
        db.commit()
        return value

    @router.get("/widgets/{id}/frame", include_in_schema=False)
    def widget_frame(id: str, user=Depends(authenticated), db=Depends(db_session)):
        widget = next(
            (
                item
                for item in home_preferences(user, db)["layout"]
                if item["id"] == id and item["kind"] in ("html", "webview")
            ),
            None,
        )
        if not widget:
            raise HTTPException(404, "Widget not found.")
        content = (
            widget["html"]
            if widget["kind"] == "html"
            else (
                '<iframe title="'
                + html.escape(widget["title"] or "Website", quote=True)
                + '" src="'
                + html.escape(widget["url"], quote=True)
                + '" sandbox="allow-scripts" referrerpolicy="no-referrer" style="width:100%;height:100vh;border:0"></iframe>'
            )
        )
        return HTMLResponse(
            '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;min-height:100%;background:#000;color:#e8e8e8;font:14px/1.5 system-ui,sans-serif}*{box-sizing:border-box}</style></head><body>'
            + content
            + "</body></html>",
            headers={"Referrer-Policy": "no-referrer"},
        )

    return router
