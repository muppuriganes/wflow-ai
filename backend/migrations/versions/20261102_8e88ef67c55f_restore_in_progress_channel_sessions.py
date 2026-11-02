"""restore in-progress channel sessions

Revision ID: 8e88ef67c55f
Revises: 712aaaf225ec
Create Date: 2026-11-02 13:52:14.636890
"""
from collections.abc import Sequence

from alembic import op

revision: str = '8e88ef67c55f'
down_revision: str | None = '712aaaf225ec'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# A gateway that crashed (no graceful shutdown) leaves connections in in-progress states.
# Including them in the restore list means a restarted gateway picks them up again instead of
# the UI waiting forever for a QR code that no process is producing.
_FUNCTION = """
CREATE OR REPLACE FUNCTION channel_connections_to_restore()
RETURNS TABLE (id uuid, organization_id uuid, channel_type text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT id, organization_id, channel_type FROM channel_connections
    WHERE deleted_at IS NULL AND session_reference IS NOT NULL
      AND status IN ({statuses})
$$
"""
_IN_PROGRESS = "'INITIALIZING', 'QR_PENDING', 'AUTHENTICATING', 'RECONNECTING', 'CONNECTED', 'DISCONNECTED'"
_PREVIOUS = "'CONNECTED', 'RECONNECTING', 'DISCONNECTED', 'AUTHENTICATING'"


def upgrade() -> None:
    op.execute(_FUNCTION.format(statuses=_IN_PROGRESS))


def downgrade() -> None:
    op.execute(_FUNCTION.format(statuses=_PREVIOUS))
