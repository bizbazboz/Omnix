"""One-shot infrastructure initialization. Never overwrite existing secrets."""

import os
import secrets
from pathlib import Path
from cryptography.fernet import Fernet


def write_once(path, value, mode=0o644, owner=10001):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    except FileExistsError:
        return target.read_text().strip()
    with os.fdopen(descriptor, "w") as stream:
        stream.write(value + "\n")
    os.chown(target, owner, owner)
    os.chmod(target, mode)
    return value


def main():
    write_once("/data/encryption.key", Fernet.generate_key().decode(), 0o600)
    write_once("/data/setup-token", secrets.token_urlsafe(32), 0o600)
    write_once("/secrets/db/password", secrets.token_hex(32))
    password = write_once("/secrets/redis/password", secrets.token_hex(32))
    write_once(
        "/secrets/redis/redis.conf",
        "bind 0.0.0.0\nprotected-mode yes\nappendonly yes\nsave 60 1\nrequirepass "
        + password,
    )
    for directory in ["/data"]:
        Path(directory).mkdir(parents=True, exist_ok=True)
        os.chown(directory, 10001, 10001)
    print("Persistent infrastructure secrets initialized. No values were logged.")


if __name__ == "__main__":
    main()
