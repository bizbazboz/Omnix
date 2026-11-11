"""Revalidate current instance admission for every credential type."""

from .core import Session, User


def admitted(user, config=None):
    if config is None:
        from .auth_settings import load_oidc

        config = load_oidc()
    return bool(
        config
        and user
        and user.issuer == config["issuer"]
        and (config["allow_all"] or user.subject in config["allowed_subjects"])
    )


def session_admitted(data):
    with Session() as db:
        return admitted(db.get(User, data["user"]))
