"""Direct FCM HTTP v1 delivery. Service credentials stay encrypted on the server."""

import hashlib
import json
import re
import secrets
import time
import httpx
from authlib.jose import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, SecretStr, Field
from .core import redis, encrypt, decrypt
from .workspace_settings import load_setting, store_setting

TOKEN_URL = "https://oauth2.googleapis.com/token"
SCOPE = "https://www.googleapis.com/auth/firebase.messaging"


def validate_key(raw):
    try:
        value = json.loads(raw)
        if value.get("type") != "service_account":
            raise ValueError()
        if not re.fullmatch(r"[a-z][a-z0-9-]{4,28}[a-z0-9]", value["project_id"]):
            raise ValueError()
        if not re.fullmatch(
            r"[A-Za-z0-9._-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com",
            value["client_email"],
        ):
            raise ValueError()
        key = serialization.load_pem_private_key(
            value["private_key"].encode(), password=None
        )
        if not isinstance(key, rsa.RSAPrivateKey) or key.key_size < 2048:
            raise ValueError()
        if value.get("token_uri", TOKEN_URL) != TOKEN_URL:
            raise ValueError()
        return {
            name: value[name] for name in ("project_id", "client_email", "private_key")
        }
    except Exception:
        raise HTTPException(
            422, "Upload a valid Firebase service-account JSON key."
        ) from None


class FirebaseInput(BaseModel):
    service_account: SecretStr = Field(default=SecretStr(""), max_length=32000)
    android_config: SecretStr = Field(default=SecretStr(""), max_length=128000)


def android_clients(raw, project_id):
    try:
        data = json.loads(raw)
        info = data["project_info"]
        if info["project_id"] != project_id or not re.fullmatch(
            r"[0-9]{6,30}", str(info["project_number"])
        ):
            raise ValueError()
        result = []
        for client in data["client"]:
            package = client["client_info"]["android_client_info"]["package_name"]
            if package not in ("com.bizbazboz.omnix", "com.bizbazboz.omnix.preview"):
                continue
            app_id = client["client_info"]["mobilesdk_app_id"]
            api_key = client["api_key"][0]["current_key"]
            if not re.fullmatch(
                r"1:" + str(info["project_number"]) + r":android:[a-fA-F0-9]+", app_id
            ):
                raise ValueError()
            if not re.fullmatch(r"AIza[A-Za-z0-9_-]{35}", api_key):
                raise ValueError()
            result.append(
                {
                    "projectId": project_id,
                    "appId": app_id,
                    "apiKey": api_key,
                    "messagingSenderId": str(info["project_number"]),
                    "packageName": package,
                }
            )
        if not result or len({v["packageName"] for v in result}) != len(result):
            raise ValueError()
        return result
    except Exception:
        raise HTTPException(
            422, "Upload matching google-services.json for the Omnix Android package."
        ) from None


def firebase_status(config):
    clients = config.get("android_clients", []) if config else []
    return {
        "configured": bool(config and clients),
        "key_configured": bool(config),
        "android_configured": bool(clients),
        "project_id": config["project_id"] if config else "",
        "packages": [c["packageName"] for c in clients],
    }


def build_firebase_router(authenticated, db_session):
    router = APIRouter(prefix="/api/v1/settings/firebase")

    def admin(user=Depends(authenticated)):
        if not user.is_admin:
            raise HTTPException(403, "Administrator access required.")
        return user

    @router.get("")
    def status(user=Depends(authenticated)):
        config = load_setting("firebase-push")
        return firebase_status(config)

    @router.get("/client")
    def client_config(user=Depends(authenticated)):
        config = load_setting("firebase-push")
        if not config or not config.get("android_clients"):
            raise HTTPException(
                409, "Upload the Android Firebase configuration in Integrations first."
            )
        # Construct an explicit allowlist; private sending credentials never leave the server.
        keys = ("projectId", "appId", "apiKey", "messagingSenderId", "packageName")
        return {"clients": [{k: c[k] for k in keys} for c in config["android_clients"]]}

    @router.put("")
    def configure(body: FirebaseInput, user=Depends(admin), db=Depends(db_session)):
        old = load_setting("firebase-push")
        raw = body.service_account.get_secret_value()
        value = validate_key(raw) if raw else old
        if not value:
            raise HTTPException(422, "Upload a Firebase service-account key first.")
        value = dict(value)
        clients = (
            old.get("android_clients", [])
            if old and old["project_id"] == value["project_id"]
            else []
        )
        raw_android = body.android_config.get_secret_value()
        if raw_android:
            uploaded = android_clients(raw_android, value["project_id"])
            clients = list({c["packageName"]: c for c in clients + uploaded}.values())
        value["android_clients"] = clients
        value["version"] = secrets.token_hex(16)
        store_setting(db, "firebase-push", value)
        return firebase_status(value)

    @router.delete("", status_code=204)
    def remove(user=Depends(admin), db=Depends(db_session)):
        from .core import SystemSetting

        row = db.get(SystemSetting, "firebase-push")
        if row:
            db.delete(row)
            db.commit()

    return router


class FirebaseError(Exception):
    def __init__(self, invalid_token=False, permanent=False):
        super().__init__("Firebase push could not be delivered")
        self.invalid_token, self.permanent = invalid_token, permanent


def token_key(config):
    return "firebase-token:" + hashlib.sha256(config["version"].encode()).hexdigest()


def access_token(config):
    key = token_key(config)
    with redis.lock(key + ":lock", timeout=15, blocking_timeout=1):
        cached = redis.get(key)
        if cached:
            return decrypt(cached)["token"]
        stamp = int(time.time())
        assertion = jwt.encode(
            {"alg": "RS256", "typ": "JWT"},
            {
                "iss": config["client_email"],
                "scope": SCOPE,
                "aud": TOKEN_URL,
                "iat": stamp,
                "exp": stamp + 3600,
            },
            config["private_key"],
        ).decode()
        response = httpx.post(
            TOKEN_URL,
            data={
                "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                "assertion": assertion,
            },
            timeout=5,
            follow_redirects=False,
        )
        if response.status_code != 200:
            raise FirebaseError()
        data = response.json()
        token = data.get("access_token")
        if not isinstance(token, str) or not token or len(token) > 8192:
            raise FirebaseError()
        ttl = max(1, min(3600, int(data.get("expires_in", 3600))) - 60)
        redis.setex(key, ttl, encrypt({"token": token}))
        return token


def send_firebase(token, payload, origin):
    config = load_setting("firebase-push")
    if not config:
        raise FirebaseError()
    data = {"id": payload["id"], "href": payload["href"], "origin": origin}
    response = httpx.post(
        "https://fcm.googleapis.com/v1/projects/"
        + config["project_id"]
        + "/messages:send",
        headers={"Authorization": "Bearer " + access_token(config)},
        json={
            "message": {
                "token": token,
                "notification": {"title": payload["title"], "body": payload["body"]},
                "data": {**data, "body": json.dumps(data), "channelId": "omnix"},
                "android": {
                    "priority": "high",
                    "ttl": "3600s",
                    "notification": {
                        "icon": "ic_stat_omnix",
                        "channel_id": "omnix",
                        "tag": payload["id"],
                        "sound": "default",
                    },
                },
            }
        },
        timeout=5,
        follow_redirects=False,
    )
    if response.status_code == 200:
        return
    if response.status_code == 401:
        redis.delete(token_key(config))
    try:
        details = response.json().get("error", {}).get("details", [])
        invalid = any(d.get("errorCode") == "UNREGISTERED" for d in details)
    except Exception:
        invalid = False
    raise FirebaseError(
        invalid_token=invalid, permanent=response.status_code in (400, 403, 404)
    )
