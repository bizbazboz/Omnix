"""Infrastructure configuration. Provider registration belongs in encrypted DB storage."""

import os
from pathlib import Path
from urllib.parse import quote


def secret(name, default_path):
    value = os.getenv(name)
    if value:
        return value
    path = Path(os.getenv(name + "_FILE", default_path))
    if not path.is_file():
        raise RuntimeError(f"Missing {name} secret file; run the init service first")
    return path.read_text().strip()


SESSION_COOKIE = os.getenv("SESSION_COOKIE_NAME", "omnix_session")
OIDC_COOKIE = SESSION_COOKIE + "_oidc"
ENCRYPTION_KEY = secret("ENCRYPTION_KEY", "/data/encryption.key")
DATABASE_URL = os.getenv("DATABASE_URL") or (
    "postgresql+psycopg://omnix:"
    + quote(secret("DATABASE_PASSWORD", "/run/db/password"), safe="")
    + "@postgres:5432/omnix"
)
REDIS_URL = os.getenv("REDIS_URL") or (
    "redis://:"
    + quote(secret("REDIS_PASSWORD", "/run/redis/password"), safe="")
    + "@redis:6379/0"
)
BOOTSTRAP_TOKEN_FILE = Path(os.getenv("BOOTSTRAP_TOKEN_FILE", "/data/setup-token"))
