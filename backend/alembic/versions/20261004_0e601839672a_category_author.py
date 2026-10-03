"""category author

Revision ID: 0e601839672a
Revises: 11f460a4be36
Create Date: 2026-10-04 01:26:32.223766
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0e601839672a"
down_revision: str | None = "11f460a4be36"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # «Автор» of a category (SPEC). Existing rows are marked by a one-off data step, not here.
    with op.batch_alter_table("categories", schema=None) as batch_op:
        batch_op.add_column(sa.Column("created_by_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_categories_created_by_id", "users", ["created_by_id"], ["id"], ondelete="SET NULL"
        )


def downgrade() -> None:
    with op.batch_alter_table("categories", schema=None) as batch_op:
        batch_op.drop_constraint("fk_categories_created_by_id", type_="foreignkey")
        batch_op.drop_column("created_by_id")
