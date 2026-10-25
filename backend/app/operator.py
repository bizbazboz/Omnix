"""Operator-only commands; never exposed as anonymous browser endpoints."""

import sys, secrets
from .core import Session, BOOTSTRAP_TOKEN_FILE
from .auth_settings import admin_exists, load_oidc, normalize_origin, save_config


def main():
    if sys.argv[1:] == ["setup-token"]:
        with Session() as db:
            if admin_exists(db):
                raise SystemExit("Setup is locked; use administrator settings.")
        print(BOOTSTRAP_TOKEN_FILE.read_text().strip())
        return
    if len(sys.argv) == 3 and sys.argv[1] == "set-origin":
        config = load_oidc()
        if not config:
            raise SystemExit("Complete browser setup first.")
        config["public_origin"] = normalize_origin(sys.argv[2])
        config["version"] = secrets.token_urlsafe(16)
        with Session() as db:
            save_config(db, config)
        print(
            "Public origin updated. Update the Pocket ID callback and open the new URL."
        )
        return
    raise SystemExit(
        "Usage: python -m app.operator setup-token | set-origin https://new-host"
    )


if __name__ == "__main__":
    main()
