"""Per-word statistics for the dictionary and category pages (SPEC «Статистика»)."""

from collections.abc import Iterable

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.models import AnswerLog, User

LAST_ANSWERS = 10


def last_answers(
    db: Session, user: User, word_ids: Iterable[int], n: int = LAST_ANSWERS
) -> dict[int, tuple[int, int]]:
    """word id → (right, total) over the user's last `n` answers to it in «Переведи»,
    «Напиши» and «Микс» (all logged in answers_log, whatever the exercise). Words without
    answers are absent. One query: the answers are ranked newest first per word."""
    ids = list(word_ids)
    if not ids:
        return {}
    rank = (
        func.row_number()
        .over(
            partition_by=AnswerLog.word_id,
            order_by=(AnswerLog.created_at.desc(), AnswerLog.id.desc()),
        )
        .label("rank")
    )
    recent = (
        select(AnswerLog.word_id, AnswerLog.is_correct, rank)
        .where(AnswerLog.user_id == user.id, AnswerLog.word_id.in_(ids))
        .subquery()
    )
    rows = db.execute(
        select(
            recent.c.word_id,
            func.sum(case((recent.c.is_correct, 1), else_=0)),
            func.count(),
        )
        .where(recent.c.rank <= n)
        .group_by(recent.c.word_id)
    )
    return {word_id: (int(right), int(total)) for word_id, right, total in rows}
