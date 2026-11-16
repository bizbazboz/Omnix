"""Archive completed issues without deleting their history or links."""

from alembic import op
import sqlalchemy as sa

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade():
    if "archived_at" not in {
        column["name"]
        for column in sa.inspect(op.get_bind()).get_columns("project_tasks")
    }:
        op.add_column(
            "project_tasks",
            sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        )
    op.execute(
        "UPDATE project_tasks SET archived_at = updated_at WHERE status = 'done'"
    )


def downgrade():
    op.drop_column("project_tasks", "archived_at")
