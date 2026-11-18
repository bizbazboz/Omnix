"""Archive saved readings and remove Google Health credentials and storage."""

from alembic import op
import sqlalchemy as sa
from app.core import encrypt, decrypt, now

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if sa.inspect(bind).has_table("health_connections"):
        for row in bind.execute(
            sa.text("SELECT owner, statistics FROM health_connections")
        ).mappings():
            if row["statistics"]:
                history = decrypt(row["statistics"])
                for metric in history.get("metrics", {}).values():
                    metric.update(stale=True, source="history")
                bind.execute(
                    sa.text(
                        "INSERT INTO system_settings (key, value, updated_at) VALUES (:key, :value, :stamp) ON CONFLICT (key) DO NOTHING"
                    ),
                    {
                        "key": "health-history:" + row["owner"],
                        "value": encrypt(history),
                        "stamp": now(),
                    },
                )
        op.drop_table("health_connections")
    bind.execute(sa.text("DELETE FROM system_settings WHERE key = 'google_health'"))


def downgrade():
    raise RuntimeError("Google Health retirement cannot restore deleted credentials.")
