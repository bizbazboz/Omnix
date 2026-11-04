import pytest
from app.workspace_urls import sign_in_destination


@pytest.mark.parametrize(
    "value",
    [
        "",
        "https://attacker.invalid",
        "//attacker.invalid",
        "///attacker.invalid",
        "/%2fattacker.invalid",
        "/%252fattacker.invalid",
        "/\\attacker.invalid",
        "/%5cattacker.invalid",
        "/%255cattacker.invalid",
        "/notes\r\nLocation: https://attacker.invalid",
        "/notes?x=%0d%0aLocation:bad",
        "javascript:alert(1)",
        "/api/v1/auth/logout",
        "/%61pi/v1/auth/login",
        "/mcp?accesstoken=secret",
        "/notes/" + "x" * 2048,
    ],
)
def test_sign_in_destination_rejects_external_and_sensitive_routes(value):
    assert sign_in_destination(value) == "/"


@pytest.mark.parametrize(
    "value",
    ["/", "/email?folder=inbox#message", "/notes/projects/a?view=board#issue-3"],
)
def test_sign_in_destination_preserves_internal_search_and_fragment(value):
    assert sign_in_destination(value) == value
