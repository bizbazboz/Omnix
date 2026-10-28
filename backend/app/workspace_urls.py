"""Canonical internal URLs, including documents created before public routes moved."""

import re
from fastapi import HTTPException


def canonical_workspace_url(value):
    if isinstance(value, str) and re.match(r"^/app(?:/|[?#]|$)", value):
        suffix = value[4:]
        if suffix.startswith(("?", "#")):
            return "/" + suffix
        return "/" + suffix.replace("\\", "/").lstrip("/")
    return value


def canonical_document_links(value, depth=0):
    if depth > 64:
        raise HTTPException(422, "Document structure is too complex.")
    if isinstance(value, list):
        return [canonical_document_links(item, depth + 1) for item in value]
    if isinstance(value, dict):
        return {
            key: (
                canonical_workspace_url(item)
                if key in ("url", "href") and isinstance(item, str)
                else canonical_document_links(item, depth + 1)
            )
            for key, item in value.items()
        }
    return value
