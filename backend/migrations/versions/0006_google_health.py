"""Private Google Health connections and encrypted statistics."""

from alembic import op
import sqlalchemy as sa

legacy = sa.Table(
    "health_connections",
    sa.MetaData(),
    sa.Column("id", sa.String, primary_key=True),
    sa.Column("owner", sa.String, nullable=False, unique=True, index=True),
    sa.Column("credentials", sa.Text, nullable=False),
    sa.Column("statistics", sa.Text, nullable=False),
    sa.Column("status", sa.String, nullable=False),
    sa.Column("error", sa.String, nullable=False),
    sa.Column("last_sync", sa.DateTime(timezone=True)),
    sa.Column("last_attempt", sa.DateTime(timezone=True)),
)

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade():
    legacy.create(bind=op.get_bind(), checkfirst=True)


def downgrade():
    legacy.drop(bind=op.get_bind(), checkfirst=True)
