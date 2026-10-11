"""word category position

Revision ID: 5b2c8e1d4a7f
Revises: 0e601839672a
Create Date: 2026-10-11 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "5b2c8e1d4a7f"
down_revision: str | None = "0e601839672a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # «Порядок слов» inside a category (SPEC). A plain ADD COLUMN: the table isn't rebuilt.
    op.add_column("words", sa.Column("category_position", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("words", schema=None) as batch_op:
        batch_op.drop_column("category_position")
