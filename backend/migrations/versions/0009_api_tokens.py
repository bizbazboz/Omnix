"""Account-bound personal API tokens, storing only token digests."""

from alembic import op
from app.core import ApiToken

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade():
    ApiToken.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    ApiToken.__table__.drop(op.get_bind(), checkfirst=True)
