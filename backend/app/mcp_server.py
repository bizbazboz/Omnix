"""OpenAPI-derived MCP tools with per-request personal token forwarding."""

from contextlib import asynccontextmanager
from copy import deepcopy

import httpx2
from fastmcp import FastMCP
from fastmcp.server.auth import AccessToken, TokenVerifier
from fastmcp.server.dependencies import get_access_token
from mcp.types import ToolAnnotations
from starlette.concurrency import run_in_threadpool

from .api_tokens import personal_operation, verify_personal_token
from .core import Session


class AccountTokenVerifier(TokenVerifier):
    async def verify_token(self, token: str) -> AccessToken | None:
        def lookup():
            with Session() as db:
                result = verify_personal_token(db, token)
                if not result:
                    return None
                row, user = result
                return AccessToken(
                    token=token,
                    client_id=row.id,
                    subject=user.id,
                    scopes=["read", "write"] if row.permission == "write" else ["read"],
                    expires_at=int(row.expires_at.timestamp()),
                    claims={"sub": user.id, "iss": "omnix"},
                )

        return await run_in_threadpool(lookup)


class AccountTransport(httpx2.ASGITransport):
    async def handle_async_request(self, request):
        token = get_access_token()
        if not token or not personal_operation(request.url.path, request.method):
            return httpx2.Response(403, json={"detail": "token_access_not_allowed"})
        # Never trust identity-bearing tool parameters or a shared client's headers.
        # Each call gets the current credential; the API revalidates it and applies
        # its regular owner checks, including if the token was just revoked.
        for header in ("authorization", "cookie", "origin", "x-csrf-token"):
            request.headers.pop(header, None)
        request.headers["authorization"] = "Bearer " + token.token
        return await super().handle_async_request(request)


def create_mcp(app):
    spec = deepcopy(app.openapi())
    spec["paths"] = {
        path: {
            method: operation
            for method, operation in methods.items()
            if personal_operation(path, method.upper())
            # File upload/download and archive endpoints are for REST clients.
            and not any(
                part in path
                for part in (
                    "/assets",
                    "/uploads",
                    "/attachments",
                    "/export",
                    "/import",
                )
            )
        }
        for path, methods in spec["paths"].items()
    }
    spec["paths"] = {
        path: methods for path, methods in spec["paths"].items() if methods
    }
    client = httpx2.AsyncClient(
        transport=AccountTransport(app=app),
        base_url="http://omnix.internal",
        timeout=60,
        follow_redirects=False,
    )

    def annotate(route, component):
        component.annotations = ToolAnnotations(
            readOnlyHint=route.method.upper() == "GET",
            destructiveHint=route.method.upper() != "GET",
            openWorldHint=True,
        )

    server = FastMCP.from_openapi(
        openapi_spec=spec,
        client=client,
        name="Omnix",
        mcp_component_fn=annotate,
        auth=AccountTokenVerifier(),
        instructions="Use the signed-in token owner's private workspace. Write operations require a read/write token. Email sends and deletions change real data; confirm intent before using them.",
    )
    mcp_app = server.http_app(
        path="/", stateless_http=True, json_response=True, host_origin_protection="auto"
    )
    # Authentication is mandatory for every request. Browser cross-origin calls
    # have no CORS grant; the external hostname is provided by the user's tunnel.
    return server, mcp_app, client


def mount_mcp(app):
    original_lifespan = app.router.lifespan_context

    @asynccontextmanager
    async def lifespan(application):
        async with original_lifespan(application):
            server, mcp_app, client = create_mcp(application)
            application.state.mcp = server
            application.state.mcp_http = mcp_app
            async with mcp_app.lifespan(application):
                try:
                    yield
                finally:
                    await client.aclose()

    async def dispatch(scope, receive, send):
        await app.state.mcp_http(scope, receive, send)

    app.router.lifespan_context = lifespan
    app.mount("/mcp", dispatch)
