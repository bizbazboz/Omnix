"""Private notes, revisions, assets, projects and tasks."""

from alembic import op
from app.core import NoteProject, NotePage, NoteRevision, NoteAsset, ProjectTask

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None
TABLES = (NoteProject, NotePage, NoteRevision, NoteAsset, ProjectTask)


def upgrade():
    for model in TABLES:
        model.__table__.create(bind=op.get_bind(), checkfirst=True)


def downgrade():
    for model in reversed(TABLES):
        model.__table__.drop(bind=op.get_bind(), checkfirst=True)
