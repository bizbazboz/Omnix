"""Canonical internal URLs, including documents created before public routes moved."""

import re
from urllib.parse import unquote, urlsplit
from fastapi import HTTPException


def canonical_workspace_url(value):
    if isinstance(value, str) and re.match(r"^/app(?:/|[?#]|$)", value):
        suffix = value[4:]
        if suffix.startswith(("?", "#")):
            return "/" + suffix
        return "/" + suffix.replace("\\", "/").lstrip("/")
    return value


def sign_in_destination(value):
    """Only relative UI destinations, including their search and fragment."""
    if not isinstance(value, str) or len(value) > 2048:
        return "/"
    candidate = canonical_workspace_url(value)
    decoded = candidate
    try:
        for _ in range(4):
            if (
                not decoded.startswith("/")
                or decoded.startswith("//")
                or "\\" in decoded
                or any(ord(c) < 32 or ord(c) == 127 for c in decoded)
            ):
                return "/"
            parsed = urlsplit(decoded)
            if (
                parsed.scheme
                or parsed.netloc
                or re.match(r"^/(?:api|mcp)(?:/|$)", parsed.path)
            ):
                return "/"
            next_value = unquote(decoded)
            if next_value == decoded:
                return candidate
            decoded = next_value
    except ValueError:
        pass
    return "/"


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
