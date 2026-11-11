"""Absolute outbound deadlines, including slow headers and body reads."""

import socket
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout

_dns_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="public-dns")
_dns_slots = threading.BoundedSemaphore(4)


def remaining(deadline):
    value = deadline - time.monotonic()
    if value <= 0:
        raise ValueError("Source download deadline exceeded")
    return value


def resolve(host, deadline):
    if not _dns_slots.acquire(timeout=remaining(deadline)):
        raise ValueError("DNS resolver is busy")
    try:
        future = _dns_pool.submit(
            socket.getaddrinfo, host, 443, type=socket.SOCK_STREAM
        )
    except BaseException:
        _dns_slots.release()
        raise
    future.add_done_callback(lambda _: _dns_slots.release())
    try:
        return future.result(timeout=remaining(deadline))
    except FutureTimeout:
        raise ValueError("Source DNS deadline exceeded") from None


class DownloadDeadline:
    def __init__(self, connection, deadline):
        self.connection, self.deadline = connection, deadline
        connection.deadline = deadline
        self.timer = threading.Timer(remaining(deadline), self.abort)
        self.timer.daemon = True

    def abort(self):
        # HTTPResponse owns a file object after HTTP/1.0 closes the connection.
        # Keep the original socket reference; close() alone won't interrupt it.
        sock = getattr(self.connection, "deadline_socket", None) or getattr(
            self.connection, "sock", None
        )
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

    def __enter__(self):
        self.timer.start()
        return self

    def __exit__(self, *args):
        self.timer.cancel()
        self.connection.close()


def read_chunk(response, deadline):
    remaining(deadline)
    chunk = getattr(response, "read1", response.read)(65536)
    remaining(deadline)
    return chunk
