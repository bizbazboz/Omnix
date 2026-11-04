import json
import time
from http.cookies import SimpleCookie
import pytest
from app.core import SESSION_COOKIE, redis
from app.main import session_response
from app.sessions import IDLE_SECONDS, MAX_SECONDS, read_session


def session_key(client):
    return "session:" + client.cookies.get(SESSION_COOKIE)


def test_new_session_cookie_and_server_lifetimes(user):
    before = time.time()
    response = session_response(user.id)
    cookie = SimpleCookie(response.headers["set-cookie"])[SESSION_COOKIE]
    assert int(cookie["max-age"]) == MAX_SECONDS == 30 * 86400
    assert cookie["secure"] and cookie["httponly"] and cookie["samesite"] == "lax"
    key = "session:" + cookie.value
    assert IDLE_SECONDS - 2 <= redis.ttl(key) <= IDLE_SECONDS == 7 * 86400
    assert (
        before + MAX_SECONDS
        <= json.loads(redis.get(key))["expires"]
        <= time.time() + MAX_SECONDS
    )


def test_authenticated_requests_slide_idle_without_changing_absolute_deadline(
    signed_client,
):
    key = session_key(signed_client)
    deadline = json.loads(redis.get(key))["expires"]
    redis.expire(key, 15)
    assert signed_client.get("/api/v1/me").status_code == 200
    assert redis.ttl(key) >= IDLE_SECONDS - 2
    assert json.loads(redis.get(key))["expires"] == deadline


def test_sliding_expiration_is_capped_at_absolute_deadline(signed_client):
    key = session_key(signed_client)
    data = json.loads(redis.get(key))
    data["expires"] = time.time() + 120
    redis.set(key, json.dumps(data), ex=IDLE_SECONDS)
    assert signed_client.get("/api/v1/me").status_code == 200
    assert 117 <= redis.ttl(key) <= 120
    assert json.loads(redis.get(key))["expires"] == data["expires"]


def test_legacy_sessions_keep_their_existing_deadline(signed_client):
    key = session_key(signed_client)
    data = json.loads(redis.get(key))
    data["expires"] = time.time() + 43200
    redis.set(key, json.dumps(data), ex=1800)
    assert signed_client.get("/api/v1/me").status_code == 200
    assert 43197 <= redis.ttl(key) <= 43200
    assert json.loads(redis.get(key))["expires"] == data["expires"]


def test_expired_absolute_session_is_rejected_even_with_remaining_redis_ttl(
    signed_client,
):
    key = session_key(signed_client)
    data = json.loads(redis.get(key))
    data["expires"] = time.time() - 1
    redis.set(key, json.dumps(data), ex=IDLE_SECONDS)
    assert signed_client.get("/api/v1/me").status_code == 401
    assert not redis.exists(key)


def test_idle_expiration_returns_401_for_mutations(signed_client):
    key = session_key(signed_client)
    redis.delete(key)
    assert (
        signed_client.post("/api/v1/notes/pages", json={"title": "Expired"}).status_code
        == 401
    )
    assert not redis.exists(key)


def test_invalid_csrf_does_not_extend_session(signed_client):
    key = session_key(signed_client)
    redis.expire(key, 15)
    assert (
        signed_client.post(
            "/api/v1/notes/pages", json={}, headers={"X-CSRF-Token": "wrong"}
        ).status_code
        == 403
    )
    assert 0 < redis.ttl(key) <= 15


@pytest.mark.parametrize(
    "raw", ["not-json", "[]", '{"user":"x","csrf":"x","expires":"wrong"}']
)
def test_invalid_server_session_data_fails_closed(signed_client, raw):
    key = session_key(signed_client)
    redis.set(key, raw, ex=IDLE_SECONDS)
    assert signed_client.get("/api/v1/me").status_code == 401
    assert not redis.exists(key)


def test_revoked_session_cannot_be_refreshed_back_into_existence(signed_client):
    sid = signed_client.cookies.get(SESSION_COOKIE)
    assert signed_client.post("/api/v1/auth/logout").status_code == 200
    with pytest.raises(Exception) as error:
        read_session(sid, refresh=True)
    assert error.value.status_code == 401
    assert not redis.exists("session:" + sid)
