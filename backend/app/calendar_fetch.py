"""Bounded HTTPS downloads pinned to validated public addresses."""

import http.client
import ipaddress
import socket
import ssl
import time
from urllib.parse import urlsplit, urlunsplit, urljoin
from .download_deadline import DownloadDeadline, remaining, resolve, read_chunk

MAX_BYTES = 2 * 1024 * 1024


def normalize_url(value):
    value = value.strip()
    if value.lower().startswith("webcal://"):
        value = "https://" + value[9:]
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.fragment
        or parsed.port not in (None, 443)
        or any(ord(c) < 33 for c in value)
        or len(value) > 4096
    ):
        raise ValueError("Use an HTTPS or webcal subscription URL.")
    return urlunsplit(
        ("https", parsed.netloc.lower(), parsed.path or "/", parsed.query, "")
    )


class PublicHTTPS(http.client.HTTPSConnection):
    def connect(self):
        deadline = getattr(self, "deadline", time.monotonic() + 35)
        addresses = resolve(self.host, deadline)
        if not addresses or any(
            not ipaddress.ip_address(a[4][0]).is_global for a in addresses
        ):
            raise ValueError("Private calendar hosts are not permitted.")
        sock = socket.create_connection(
            (addresses[0][4][0], 443), timeout=min(self.timeout, remaining(deadline))
        )
        self.deadline_socket = sock
        try:
            remaining(deadline)
            self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
            self.deadline_socket = self.sock
            remaining(deadline)
        except Exception:
            sock.close()
            raise


def fetch_calendar(url):
    deadline = time.monotonic() + 35
    for _ in range(4):
        url = normalize_url(url)
        parsed = urlsplit(url)
        connection = PublicHTTPS(
            parsed.hostname, timeout=10, context=ssl.create_default_context()
        )
        with DownloadDeadline(connection, deadline):
            connection.request(
                "GET",
                urlunsplit(("", "", parsed.path, parsed.query, "")),
                headers={
                    "Accept": "text/calendar",
                    "Accept-Encoding": "identity",
                    "User-Agent": "Omnix/1.0",
                },
            )
            response = connection.getresponse()
            if response.status in (301, 302, 303, 307, 308):
                url = urljoin(url, response.getheader("Location", ""))
                continue
            if (
                response.status != 200
                or response.getheader("Content-Encoding", "identity") != "identity"
            ):
                raise ValueError("Calendar download failed.")
            data = bytearray()
            while chunk := read_chunk(response, deadline):
                data.extend(chunk)
                if len(data) > MAX_BYTES or time.monotonic() > deadline:
                    raise ValueError("Calendar exceeds download limits.")
            return bytes(data)
    raise ValueError("Too many calendar redirects.")
