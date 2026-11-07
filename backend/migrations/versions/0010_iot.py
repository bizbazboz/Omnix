"""Private calendar rules and durable IoT execution receipts."""

from alembic import op
from app.core import IoTRule, IoTRun

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade():
    IoTRule.__table__.create(op.get_bind(), checkfirst=True)
    IoTRun.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    IoTRun.__table__.drop(op.get_bind(), checkfirst=True)
    IoTRule.__table__.drop(op.get_bind(), checkfirst=True)
