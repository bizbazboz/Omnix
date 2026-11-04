"""Seven-day sliding inactivity, capped by a fixed thirty-day sign-in lifetime."""

import json
import math
import secrets
import time
from fastapi import HTTPException
from .core import redis

IDLE_SECONDS = 7 * 24 * 60 * 60
MAX_SECONDS = 30 * 24 * 60 * 60

_TOUCH = """
local raw = redis.call('GET', KEYS[1])
if not raw then return nil end
local ok, data = pcall(cjson.decode, raw)
if not ok or type(data) ~= 'table' or type(data.expires) ~= 'number'
    or type(data.user) ~= 'string' or type(data.csrf) ~= 'string' then
    redis.call('DEL', KEYS[1])
    return nil
end
local remaining = math.floor(data.expires - tonumber(ARGV[1]))
if remaining <= 0 then
    redis.call('DEL', KEYS[1])
    return nil
end
redis.call('EXPIRE', KEYS[1], math.min(tonumber(ARGV[2]), remaining))
return raw
"""


def create_session(user_id):
    sid = secrets.token_urlsafe(40)
    data = {
        "user": user_id,
        "csrf": secrets.token_urlsafe(32),
        "expires": time.time() + MAX_SECONDS,
    }
    redis.set("session:" + sid, json.dumps(data), ex=IDLE_SECONDS)
    return sid


def read_session(sid, refresh=False):
    if not sid or len(sid) > 256:
        raise HTTPException(401, "login_required")
    key = "session:" + sid
    raw = (
        redis.eval(_TOUCH, 1, key, time.time(), IDLE_SECONDS)
        if refresh
        else redis.get(key)
    )
    if not raw:
        raise HTTPException(401, "login_required")
    try:
        data = json.loads(raw)
        if (
            not isinstance(data, dict)
            or not isinstance(data.get("user"), str)
            or not isinstance(data.get("csrf"), str)
            or not isinstance(data.get("expires"), (int, float))
            or not math.isfinite(data["expires"])
            or data["expires"] <= time.time()
        ):
            raise ValueError("invalid session")
    except (TypeError, ValueError):
        redis.delete(key)
        raise HTTPException(401, "session_expired")
    return data
