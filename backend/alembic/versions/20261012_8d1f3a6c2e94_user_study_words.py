"""user study words

Revision ID: 8d1f3a6c2e94
Revises: 5b2c8e1d4a7f
Create Date: 2026-10-12 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "8d1f3a6c2e94"
down_revision: str | None = "5b2c8e1d4a7f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # «Изучать» on words (SPEC). A new table; nothing is rebuilt.
    op.create_table(
        "user_study_words",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("word_id", sa.Integer(), nullable=False),
        sa.Column("via", sa.String(length=10), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["word_id"], ["words.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "word_id", "via"),
    )
    op.create_index("ix_user_study_words_word_id", "user_study_words", ["word_id"])
    # What was ticked stays ticked: every word of a ticked dictionary / category.
    op.execute(
        """
        INSERT INTO user_study_words (user_id, word_id, via)
        SELECT a.user_id, w.id, 'dictionary'
        FROM user_active_dictionaries a JOIN words w ON w.dictionary_id = a.dictionary_id
        """
    )
    op.execute(
        """
        INSERT INTO user_study_words (user_id, word_id, via)
        SELECT a.user_id, w.id, 'category'
        FROM user_active_categories a JOIN words w ON w.category_id = a.category_id
        """
    )
    # «Знаю» by itself at 10/10 (SPEC), once for the words that are there already: the last
    # 10 answers of the user to the word all right.
    op.execute(
        """
        INSERT OR IGNORE INTO user_known_words (user_id, word_id, created_at)
        SELECT user_id, word_id, CURRENT_TIMESTAMP FROM (
            SELECT user_id, word_id, is_correct,
                   row_number() OVER (PARTITION BY user_id, word_id
                                      ORDER BY created_at DESC, id DESC) AS rank
            FROM answers_log
        )
        WHERE rank <= 10
        GROUP BY user_id, word_id
        HAVING count(*) = 10 AND sum(is_correct) = 10
        """
    )


def downgrade() -> None:
    op.drop_index("ix_user_study_words_word_id", table_name="user_study_words")
    op.drop_table("user_study_words")
