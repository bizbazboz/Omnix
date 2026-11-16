"""Public Android website association; only public signing certificate hashes."""

import re
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from .workspace_settings import load_setting, store_setting

OFFICIAL_FINGERPRINT = "CF:C5:DA:30:5C:32:F6:99:35:29:63:67:2A:53:3D:70:52:B8:D6:11:9D:DD:68:B0:88:67:D0:BD:76:93:41:BD"


class AndroidLinksInput(BaseModel):
    fingerprints: list[str] = Field(default_factory=list, max_length=5)


def build_android_links_router(authenticated, db_session):
    router = APIRouter()

    def settings():
        return load_setting("android-links", {"fingerprints": [OFFICIAL_FINGERPRINT]})

    @router.get("/.well-known/assetlinks.json", include_in_schema=False)
    def association():
        fingerprints = settings()["fingerprints"]
        return JSONResponse(
            (
                [
                    {
                        "relation": ["delegate_permission/common.handle_all_urls"],
                        "target": {
                            "namespace": "android_app",
                            "package_name": "com.bizbazboz.omnix",
                            "sha256_cert_fingerprints": fingerprints,
                        },
                    }
                ]
                if fingerprints
                else []
            ),
            headers={"Cache-Control": "public, max-age=300"},
        )

    @router.get("/api/v1/settings/android-links")
    def get_links(user=Depends(authenticated)):
        return settings()

    @router.put("/api/v1/settings/android-links")
    def put_links(
        body: AndroidLinksInput, user=Depends(authenticated), db=Depends(db_session)
    ):
        if not user.is_admin:
            raise HTTPException(403, "Administrator access required.")
        fingerprints = [value.strip().upper() for value in body.fingerprints]
        if any(
            not re.fullmatch(r"(?:[0-9A-F]{2}:){31}[0-9A-F]{2}", value)
            for value in fingerprints
        ):
            raise HTTPException(
                422,
                "Enter SHA-256 certificate fingerprints as 32 colon-separated hexadecimal pairs.",
            )
        value = {"fingerprints": list(dict.fromkeys(fingerprints))}
        store_setting(db, "android-links", value)
        return value

    return router
