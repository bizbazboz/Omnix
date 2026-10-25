"""Zoho code exchange; caller owns one-use state and session binding."""

import time
import httpx
from fastapi import HTTPException
from .providers import REGIONS


async def exchange(registration, region, code, redirect_uri):
    auth, mail = REGIONS[region]
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
            response = await client.post(
                auth + "/oauth/v2/token",
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "client_id": registration["client_id"],
                    "client_secret": registration["client_secret"],
                    "redirect_uri": redirect_uri,
                },
            )
            response.raise_for_status()
            data = response.json()
            if not data.get("access_token") or not data.get("refresh_token"):
                raise HTTPException(
                    400,
                    "Zoho rejected authorization or offline access. Check the client and reconnect.",
                )
            credentials = {key: data[key] for key in ("access_token", "refresh_token")}
            credentials["expires_at"] = time.time() + int(data.get("expires_in", 3600))
            credentials["oauth_client"] = {
                "client_id": registration["client_id"],
                "client_secret": registration["client_secret"],
            }
            response = await client.get(
                mail + "/api/accounts",
                headers={
                    "Authorization": "Zoho-oauthtoken " + credentials["access_token"]
                },
            )
            response.raise_for_status()
            accounts = response.json().get("data", [])
            if not isinstance(accounts, list):
                raise ValueError("Invalid accounts response")
            return credentials, accounts
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            502,
            "Zoho could not complete authorization. Check connectivity, permissions and region.",
        ) from None


def revoke(region, credentials):
    from .workspace_settings import load_zoho

    registration = load_zoho()
    client = credentials.get("oauth_client", registration)
    if registration and client and registration["client_id"] == client["client_id"]:
        client = registration
    try:
        response = httpx.post(
            REGIONS[region][0] + "/oauth/v2/revoke/token",
            auth=(client["client_id"], client["client_secret"]),
            data={"token": credentials["refresh_token"], "token_type": "refresh_token"},
            timeout=10,
        )
        response.raise_for_status()
        return "Zoho consent revoked."
    except Exception:
        return "Local access removed. Revoke the grant in Zoho Connected Apps to confirm remote removal."
