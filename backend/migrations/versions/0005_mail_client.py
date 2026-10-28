"""Add reply headers and private outgoing attachments."""

from alembic import op
import sqlalchemy as sa
from app.core import MailUpload

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade():
    columns = {
        column["name"] for column in sa.inspect(op.get_bind()).get_columns("messages")
    }
    for name in ("cc", "reply_to", "rfc_id"):
        if name in columns:
            continue
        op.add_column(
            "messages", sa.Column(name, sa.Text(), nullable=False, server_default="")
        )
    MailUpload.__table__.create(bind=op.get_bind(), checkfirst=True)


def downgrade():
    MailUpload.__table__.drop(bind=op.get_bind(), checkfirst=True)
    for name in ("cc", "reply_to", "rfc_id"):
        op.drop_column("messages", name)
