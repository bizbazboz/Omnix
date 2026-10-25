"""Browser-managed encrypted OIDC settings and administrator role."""

from alembic import op
import sqlalchemy as sa
from app.core import SystemSetting

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    columns = {c["name"] for c in sa.inspect(bind).get_columns("users")}
    if "is_admin" not in columns:
        op.add_column(
            "users",
            sa.Column(
                "is_admin", sa.Boolean(), nullable=False, server_default=sa.false()
            ),
        )
    SystemSetting.__table__.create(bind=bind, checkfirst=True)


def downgrade():
    op.drop_table("system_settings")
    op.drop_column("users", "is_admin")
