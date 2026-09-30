"""Which words a user trains on: words of their active dictionaries plus words of their
active categories (from every visible dictionary), optionally without the words the user
marked as known. One place, so counters and trainers agree."""

from collections.abc import Iterable

from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session

from app.models import (
    Dictionary,
    User,
    UserActiveCategory,
    UserActiveDictionary,
    UserKnownWord,
    Word,
)


def _visible(user: User):
    from app.api.dictionaries import visible_filter  # the single definition of "visible"

    return visible_filter(user)


def _known_subquery(user: User) -> Select:
    return select(UserKnownWord.word_id).where(UserKnownWord.user_id == user.id)


def active_words_query(user: User, hide_known: bool = False) -> Select:
    active_dicts = select(UserActiveDictionary.dictionary_id).where(
        UserActiveDictionary.user_id == user.id
    )
    active_cats = select(UserActiveCategory.category_id).where(
        UserActiveCategory.user_id == user.id
    )
    q = (
        select(Word)
        .join(Dictionary, Word.dictionary_id == Dictionary.id)
        .where(
            _visible(user),
            or_(Word.dictionary_id.in_(active_dicts), Word.category_id.in_(active_cats)),
        )
    )
    if hide_known:
        q = q.where(Word.id.not_in(_known_subquery(user)))
    return q


def active_words(db: Session, user: User, hide_known: bool = False) -> list[Word]:
    return list(db.scalars(active_words_query(user, hide_known)))


def visible_words(db: Session, user: User) -> list[Word]:
    """Every word the user can see, active or not — the pool for wrong answer options."""
    q = select(Word).join(Dictionary, Word.dictionary_id == Dictionary.id).where(_visible(user))
    return list(db.scalars(q))


def active_word_count(db: Session, user: User, hide_known: bool = False) -> int:
    q = active_words_query(user, hide_known).subquery()
    return db.scalar(select(func.count()).select_from(q)) or 0


def known_ids(db: Session, user: User, word_ids: Iterable[int] | None = None) -> set[int]:
    q = select(UserKnownWord.word_id).where(UserKnownWord.user_id == user.id)
    if word_ids is not None:
        q = q.where(UserKnownWord.word_id.in_(list(word_ids)))
    return set(db.scalars(q))


def with_known(db: Session, user: User, words: list, schema) -> list:
    """Words → output schema objects with the per-user `known` flag filled in."""
    known = known_ids(db, user, [w.id for w in words])
    out = []
    for w in words:
        item = schema.model_validate(w)
        item.known = w.id in known
        out.append(item)
    return out
