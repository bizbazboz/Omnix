"""Private Health Connect readings and retained, read-only health history."""

from fastapi import APIRouter, Depends
from .core import SystemSetting, decrypt
from .health_connect import saved, summary, phone_statistics, KINDS


def archive(db, owner):
    row = db.get(SystemSetting, "health-history:" + owner)
    return decrypt(row.value) if row else {"dates": [], "metrics": {}}


def build_health_router(authenticated, db_session, rate):
    router = APIRouter(prefix="/api/v1/health")

    @router.get("/status")
    def status(user=Depends(authenticated), db=Depends(db_session)):
        phone = saved(db, user.id)
        history = archive(db, user.id)
        has_phone = bool(phone.get("enabled") or phone.get("history"))
        has_history = bool(history.get("metrics"))
        return {
            "configured": has_phone,
            "can_configure": True,
            "connected": has_phone or has_history,
            "source": "health_connect" if has_phone else "history",
            "status": (
                ("ready" if phone.get("last_sync") else "pending")
                if has_phone
                else "history" if has_history else "disconnected"
            ),
            "last_sync": phone.get("last_sync"),
            "error": "",
            "groups": sorted(
                {
                    m.get("group", "activity")
                    for m in history.get("metrics", {}).values()
                }
                | (
                    {KINDS[k][2] for k in phone.get("metrics", []) if k in KINDS}
                    if has_phone
                    else set()
                )
            ),
            "health_connect": {
                k: v
                for k, v in summary(phone, user.id).items()
                if k not in {"changes_token", "device_id", "user_id"}
            },
        }

    @router.get("/statistics")
    def statistics(user=Depends(authenticated), db=Depends(db_session)):
        return phone_statistics(saved(db, user.id), archive(db, user.id))

    return router
