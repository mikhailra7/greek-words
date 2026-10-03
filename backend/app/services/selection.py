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


def known_words_query(user: User) -> Select:
    """«Повторить выученные слова»: every visible word the user marked as known — the active
    dictionaries and categories don't matter."""
    return (
        select(Word)
        .join(Dictionary, Word.dictionary_id == Dictionary.id)
        .where(_visible(user), Word.id.in_(_known_subquery(user)))
    )


def training_words(
    db: Session, user: User, hide_known: bool = True, known_only: bool = False
) -> list[Word]:
    """The pool a trainer draws from: the active words (known ones hidden if asked), or with
    `known_only` the user's known words from all dictionaries."""
    if known_only:
        return list(db.scalars(known_words_query(user)))
    return active_words(db, user, hide_known)


def known_word_count(db: Session, user: User) -> int:
    q = known_words_query(user).subquery()
    return db.scalar(select(func.count()).select_from(q)) or 0


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


def in_dictionary_order(db: Session, user: User, words: list[Word], count: int) -> list[Word]:
    """«Порядок по словарю» (SPEC): the words as in the dictionaries — the dictionaries in the
    order of the «Словари» list, each by its word order; then the words that came from the
    active categories, by category (and inside one, by dictionary and position). With fewer
    words wanted than there are, each group gives a share proportional to its size, as one
    unbroken run from a random place in it."""
    import random

    dict_order = {
        d_id: i
        for i, d_id in enumerate(
            db.scalars(select(Dictionary.id).where(_visible(user)).order_by(Dictionary.created_at))
        )
    }
    active = set(
        db.scalars(
            select(UserActiveDictionary.dictionary_id).where(
                UserActiveDictionary.user_id == user.id
            )
        )
    )
    from app.models import Category

    cat_order = {
        c_id: i
        for i, c_id in enumerate(
            db.scalars(select(Category.id).order_by(Category.position, Category.name))
        )
    }

    def group(w: Word) -> tuple:
        # Not from an active dictionary (so it came with a category, or it's a known word in
        # «Повторить выученные»): its category if any, else its own dictionary.
        if w.dictionary_id in active or w.category_id is None:
            return (0, dict_order.get(w.dictionary_id, 1 << 30))
        return (1, cat_order.get(w.category_id, 1 << 30))

    groups: dict[tuple, list[Word]] = {}
    for w in words:
        groups.setdefault(group(w), []).append(w)
    ordered = [
        sorted(
            groups[k], key=lambda w: (dict_order.get(w.dictionary_id, 1 << 30), w.position, w.id)
        )
        for k in sorted(groups)
    ]

    total = sum(len(g) for g in ordered)
    if count >= total:
        return [w for g in ordered for w in g]
    # Largest remainder: shares add up to `count`, no group gives more than it has.
    exact = [count * len(g) / total for g in ordered]
    shares = [int(x) for x in exact]
    for i in sorted(range(len(ordered)), key=lambda i: exact[i] - shares[i], reverse=True):
        if sum(shares) >= count:
            break
        if shares[i] < len(ordered[i]):
            shares[i] += 1
    picked: list[Word] = []
    for g, n in zip(ordered, shares, strict=True):
        if n:
            start = random.randint(0, len(g) - n)
            picked.extend(g[start : start + n])
    return picked
