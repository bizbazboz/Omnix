"""Keep completed issues active for seven days before archiving."""

from alembic import op
import sqlalchemy as sa

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if "completed_at" not in {
        column["name"] for column in sa.inspect(bind).get_columns("project_tasks")
    }:
        op.add_column(
            "project_tasks",
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        )
    if "ix_project_tasks_completed_at" not in {
        index["name"] for index in sa.inspect(bind).get_indexes("project_tasks")
    }:
        op.create_index(
            "ix_project_tasks_completed_at", "project_tasks", ["completed_at"]
        )
    op.execute(
        "UPDATE project_tasks SET completed_at = COALESCE(completed_at, archived_at, updated_at) WHERE status = 'done'"
    )
    op.execute(
        "UPDATE project_tasks SET archived_at = CASE WHEN completed_at <= CURRENT_TIMESTAMP - INTERVAL '7 days' THEN completed_at + INTERVAL '7 days' ELSE NULL END WHERE status = 'done'"
    )


def downgrade():
    op.execute(
        "UPDATE project_tasks SET archived_at = COALESCE(completed_at, archived_at, updated_at) WHERE status = 'done'"
    )
    op.drop_index("ix_project_tasks_completed_at", table_name="project_tasks")
    op.drop_column("project_tasks", "completed_at")
