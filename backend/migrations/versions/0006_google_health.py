"""Private Google Health connections and encrypted statistics."""

from alembic import op
from app.core import HealthConnection

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade():
    HealthConnection.__table__.create(bind=op.get_bind(), checkfirst=True)


def downgrade():
    HealthConnection.__table__.drop(bind=op.get_bind(), checkfirst=True)
