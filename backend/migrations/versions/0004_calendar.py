"""Add private calendar subscriptions without changing existing mail data."""

from alembic import op
from app.core import CalendarFeed

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    CalendarFeed.__table__.create(bind=op.get_bind(), checkfirst=True)


def downgrade():
    CalendarFeed.__table__.drop(bind=op.get_bind(), checkfirst=True)
