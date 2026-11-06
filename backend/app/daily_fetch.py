"""Bounded public HTTPS requests for user-selected Daily sources."""

import json
import ssl
import time
from urllib.parse import urlsplit, urlunsplit, urljoin
from .calendar_fetch import PublicHTTPS, normalize_url


def fetch_public(url, *, payload=None, headers=None, accept="application/json"):
    deadline = time.monotonic() + 35
    original_host = urlsplit(normalize_url(url)).hostname
    for _ in range(4):
        url = normalize_url(url)
        parsed = urlsplit(url)
        connection = PublicHTTPS(
            parsed.hostname, timeout=10, context=ssl.create_default_context()
        )
        request_headers = {
            "Accept": accept,
            "Accept-Encoding": "identity",
            "User-Agent": "Omnix/1.0",
        }
        if parsed.hostname == original_host:
            request_headers.update(headers or {})
        body = json.dumps(payload).encode() if payload is not None else None
        if body is not None:
            request_headers["Content-Type"] = "application/json"
        try:
            connection.request(
                "POST" if body is not None else "GET",
                urlunsplit(("", "", parsed.path, parsed.query, "")),
                body=body,
                headers=request_headers,
            )
            response = connection.getresponse()
            if response.status in (301, 302, 303, 307, 308) and body is None:
                url = urljoin(url, response.getheader("Location", ""))
                continue
            if (
                response.status != 200
                or response.getheader("Content-Encoding", "identity") != "identity"
            ):
                raise ValueError("Source request failed")
            data = bytearray()
            while chunk := response.read(65536):
                data.extend(chunk)
                if len(data) > 4 * 1024 * 1024 or time.monotonic() > deadline:
                    raise ValueError("Source exceeds download limits")
            return bytes(data)
        finally:
            connection.close()
    raise ValueError("Too many source redirects")


def fetch_json(url, **kwargs):
    return json.loads(fetch_public(url, **kwargs))
