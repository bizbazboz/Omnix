"""OpenAPI-derived MCP tools with per-request personal token forwarding."""

from contextlib import asynccontextmanager
from copy import deepcopy
from urllib.parse import parse_qs

import httpx2
from fastmcp import FastMCP
from fastmcp.server.auth import AccessToken, TokenVerifier
from fastmcp.server.dependencies import get_access_token
from mcp.types import ToolAnnotations
from mcp.server.auth.middleware.auth_context import AuthContextMiddleware
from mcp.server.auth.middleware.bearer_auth import AuthenticatedUser
from starlette.authentication import AuthCredentials
from starlette.concurrency import run_in_threadpool
from starlette.middleware import Middleware
from fastapi import HTTPException
from starlette.responses import JSONResponse
from starlette.routing import Route

from .api_tokens import personal_operation, verify_personal_token
from .core import Session
from . import rate_limits


class AccountTokenVerifier(TokenVerifier):
    def get_middleware(self):
        return [
            Middleware(QueryTokenAuthentication, verifier=self),
            Middleware(AuthContextMiddleware),
        ]

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


class QueryTokenAuthentication:
    """Query credentials only; cookies and Authorization cannot override identity."""

    def __init__(self, app, verifier):
        self.app = app
        self.verifier = verifier

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        scope = dict(scope)
        try:
            values = parse_qs(
                scope.get("query_string", b"").decode("ascii"),
                keep_blank_values=True,
                max_num_fields=20,
            ).get("accesstoken", [])
        except (ValueError, UnicodeError):
            values = []
        # Downstream URLs, logs and error messages must not retain credentials.
        scope["query_string"] = b""
        scope["headers"] = [
            (key, value)
            for key, value in scope.get("headers", [])
            if key.lower() not in (b"authorization", b"cookie")
        ]
        token = (
            await self.verifier.verify_token(values[0]) if len(values) == 1 else None
        )
        if not token:
            try:
                await run_in_threadpool(rate_limits.failed_auth, scope)
            except HTTPException as error:
                return await JSONResponse(
                    {"detail": error.detail},
                    status_code=error.status_code,
                    headers=error.headers,
                )(scope, receive, send)
            response = JSONResponse(
                {"detail": "invalid_api_token"},
                status_code=401,
                headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"},
            )
            return await response(scope, receive, send)
        try:
            await run_in_threadpool(rate_limits.account, scope, token.subject)
        except HTTPException as error:
            return await JSONResponse(
                {"detail": error.detail},
                status_code=error.status_code,
                headers=error.headers,
            )(scope, receive, send)
        scope["auth"] = AuthCredentials(token.scopes)
        scope["user"] = AuthenticatedUser(token)
        # FastMCP's authorization gate requires an internal credential header.
        # It is derived solely from the verified query token, never the client header.
        scope["headers"].append((b"authorization", ("Bearer " + token.token).encode()))
        await self.app(scope, receive, send)


class AccountTransport(httpx2.ASGITransport):
    def __init__(self, app):
        async def internal(scope, receive, send):
            # Trusted in-process scope, never a client-controlled HTTP header.
            await app({**scope, "omnix.mcp_internal": True}, receive, send)

        super().__init__(app=internal)

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

    class Dispatch:
        async def __call__(self, scope, receive, send):
            # Accept /mcp directly without a redirect containing its secret query.
            if scope.get("path") == scope.get("root_path", "") + "/mcp":
                scope = {
                    **scope,
                    "path": scope["path"] + "/",
                    "raw_path": scope.get("raw_path", b"/mcp") + b"/",
                    "root_path": scope.get("root_path", "") + "/mcp",
                }
            await app.state.mcp_http(scope, receive, send)

    app.router.lifespan_context = lifespan
    dispatch = Dispatch()
    app.router.routes.append(
        Route("/mcp", dispatch, methods=["GET", "POST", "DELETE", "HEAD", "OPTIONS"])
    )
    app.mount("/mcp", dispatch)
