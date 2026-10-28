"""Folders and personal issue tracking, preserving existing notes and tasks."""

from alembic import op
import sqlalchemy as sa
from app.core import IssueComment, IssueActivity, encrypt

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()

    def add(table, column):
        if column.name not in {
            item["name"] for item in sa.inspect(bind).get_columns(table)
        }:
            op.add_column(table, column)

    add(
        "note_pages",
        sa.Column("is_folder", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    add(
        "note_projects",
        sa.Column("issue_prefix", sa.String(), nullable=False, server_default="PRJ"),
    )
    add(
        "note_projects",
        sa.Column(
            "next_issue_number", sa.Integer(), nullable=False, server_default="1"
        ),
    )
    add(
        "project_tasks",
        sa.Column("issue_number", sa.Integer(), nullable=False, server_default="0"),
    )
    add(
        "project_tasks",
        sa.Column("issue_type", sa.String(), nullable=False, server_default="task"),
    )
    add(
        "project_tasks",
        sa.Column("labels", sa.Text(), nullable=False, server_default=encrypt([])),
    )
    add(
        "project_tasks",
        sa.Column("sprint", sa.Text(), nullable=False, server_default=encrypt("")),
    )
    add("project_tasks", sa.Column("estimate", sa.Integer(), nullable=True))
    for project in bind.execute(sa.text("SELECT id FROM note_projects")):
        prefix = "PRJ" + project.id.replace("-", "")[:8].upper()
        tasks = list(
            bind.execute(
                sa.text(
                    "SELECT id FROM project_tasks WHERE project_id=:id ORDER BY updated_at,id"
                ),
                {"id": project.id},
            )
        )
        for number, task in enumerate(tasks, 1):
            bind.execute(
                sa.text("UPDATE project_tasks SET issue_number=:n WHERE id=:id"),
                {"n": number, "id": task.id},
            )
        bind.execute(
            sa.text(
                "UPDATE note_projects SET issue_prefix=:p,next_issue_number=:n WHERE id=:id"
            ),
            {"p": prefix, "n": len(tasks) + 1, "id": project.id},
        )
    for model in (IssueComment, IssueActivity):
        model.__table__.create(bind=bind, checkfirst=True)


def downgrade():
    # Keep user content and additive columns intact; downgrade requires an explicit data migration.
    pass
