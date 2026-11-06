"""Check credential handling at the public HTTP boundary without live requests."""

import pytest
from app import daily_fetch


def test_redirect_never_forwards_authorization_to_a_different_host(monkeypatch):
    calls = []

    class Response:
        def __init__(self, redirect):
            self.status = 302 if redirect else 200
            self.sent = False

        def getheader(self, name, default=None):
            return "https://other.example.test/news" if name == "Location" else default

        def read(self, size):
            if self.sent:
                return b""
            self.sent = True
            return b'{"ok":true}'

    class Connection:
        def __init__(self, host, **kwargs):
            self.host = host

        def request(self, method, path, **kwargs):
            calls.append((self.host, method, kwargs["headers"]))

        def getresponse(self):
            return Response(self.host == "source.example.test")

        def close(self):
            pass

    monkeypatch.setattr(daily_fetch, "PublicHTTPS", Connection)
    assert daily_fetch.fetch_json(
        "https://source.example.test/news", headers={"Authorization": "private-key"}
    ) == {"ok": True}
    assert calls[0][2]["Authorization"] == "private-key"
    assert "Authorization" not in calls[1][2]
    calls.clear()
    with pytest.raises(ValueError):
        daily_fetch.fetch_json(
            "https://source.example.test/news",
            payload={"point": [0, 0]},
            headers={"Authorization": "private-key"},
        )
    assert len(calls) == 1 and calls[0][1] == "POST"
