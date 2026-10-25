"""Add operational pipeline history without modifying existing user data."""

from alembic import op
from app.core import PipelineRun

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    PipelineRun.__table__.create(bind=op.get_bind(), checkfirst=True)


def downgrade():
    PipelineRun.__table__.drop(bind=op.get_bind(), checkfirst=True)
