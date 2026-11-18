"""Google Health retirement, archived history and owner isolation."""

from pathlib import Path
import importlib.util
from sqlalchemy import inspect, text
from app.core import Session, SystemSetting, encrypt, decrypt, now


def migration(name):
    p = Path(__file__).parents[1] / "migrations" / "versions" / name
    spec = importlib.util.spec_from_file_location("migration_" + name[:4], p)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_cloud_routes_and_jobs_are_removed(signed_client):
    from app.main import app
    from app.tasks import celery

    paths = {route.path for route in app.routes if hasattr(route, "path")}
    assert not any("/health/google" in path for path in paths)
    assert "/api/v1/health/refresh" not in paths
    assert "/api/v1/health/connection" not in paths
    assert "health-dispatch" not in celery.conf.beat_schedule
    assert "app.tasks.health_sync" not in celery.tasks
    assert signed_client.get("/api/v1/health/status").json()["connected"] is False


def test_retirement_migrates_history_and_destroys_credentials(
    user, monkeypatch, signed_client
):
    old = migration("0006_google_health.py")
    retire = migration("0014_retire_google_health.py")
    history = {
        "dates": ["2026-01-01"],
        "metrics": {"steps": {"points": {"2026-01-01": 42}}},
    }
    with Session() as db:
        bind = db.connection()
        monkeypatch.setattr(old.op, "get_bind", lambda: bind)
        old.upgrade()
        bind.execute(
            text(
                "INSERT INTO health_connections (id,owner,credentials,statistics,status,error) VALUES ('legacy',:owner,:credentials,:statistics,'ready','')"
            ),
            {
                "owner": user.id,
                "credentials": encrypt({"refresh_token": "retired-secret"}),
                "statistics": encrypt(history),
            },
        )
        db.add(
            SystemSetting(
                key="google_health", value=encrypt({"client_secret": "retired-client"})
            )
        )
        db.flush()
        monkeypatch.setattr(
            retire.op, "drop_table", lambda name: old.legacy.drop(bind=bind)
        )
        retire.upgrade()
        retire.upgrade()  # Safe when no legacy table remains.
        assert not inspect(bind).has_table("health_connections")
        db.commit()
        assert db.get(SystemSetting, "google_health") is None
        raw = db.get(SystemSetting, "health-history:" + user.id).value
        archived = decrypt(raw)
        assert archived["metrics"]["steps"]["points"] == {"2026-01-01": 42}
        assert archived["metrics"]["steps"]["stale"]
        assert '"points"' not in raw and "retired-secret" not in str(archived)
        db.add(
            SystemSetting(
                key="health-history:other-user",
                value=encrypt({"dates": ["1900-01-01"], "metrics": {}}),
            )
        )
        db.commit()
    assert signed_client.get("/api/v1/health/statistics").json() == archived
    state = signed_client.get("/api/v1/health/status").json()
    assert state["connected"] and state["source"] == "history" and "google" not in state
