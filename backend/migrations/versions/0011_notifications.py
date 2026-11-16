"""Private notification inbox and durable per-device delivery."""

from alembic import op
from app.core import Notification, PushDevice, PushDelivery

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade():
    for model in (Notification, PushDevice, PushDelivery):
        model.__table__.create(op.get_bind(), checkfirst=True)
    # Replace the previous default, while preserving other operator-selected intervals.
    from sqlalchemy.orm import Session
    from app.core import SystemSetting, encrypt, decrypt

    with Session(bind=op.get_bind()) as db:
        row = db.get(SystemSetting, "pipelines")
        if row:
            config = decrypt(row.value)
            if config.get("sync_interval") == 120:
                config["sync_interval"] = 15
                row.value = encrypt(config)
                db.flush()


def downgrade():
    for model in (PushDelivery, PushDevice, Notification):
        model.__table__.drop(op.get_bind(), checkfirst=True)
