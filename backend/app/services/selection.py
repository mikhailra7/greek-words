"""Which words a user trains on: the visible words they ticked «Изучать» (in the dictionary
or in the category, see app/services/study.py), optionally without the words the user
marked as known. One place, so counters and trainers agree."""

import unicodedata
from collections.abc import Iterable
from typing import Literal

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.models import (
    Dictionary,
    User,
    UserKnownWord,
    Word,
)
from app.services import study


def _visible(user: User):
    from app.api.dictionaries import visible_filter  # the single definition of "visible"

    return visible_filter(user)


def _known_subquery(user: User) -> Select:
    return select(UserKnownWord.word_id).where(UserKnownWord.user_id == user.id)


def active_words_query(user: User, hide_known: bool = False) -> Select:
    from app.services.study import studied_word_ids

    q = (
        select(Word)
        .join(Dictionary, Word.dictionary_id == Dictionary.id)
        .where(_visible(user), Word.id.in_(studied_word_ids(user.id)))
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


SortMode = Literal["dictionary", "category"]


def sorted_words(
    db: Session, user: User, words: list[Word], count: int, sort: SortMode
) -> list[Word]:
    """«Сортировка» (SPEC). «по словарю»: the dictionaries in the order of the «Словари» list,
    each by its word order; then the words that came from the active categories, by category.
    «по категориям»: the words of the ticked categories, the categories in the order of the
    «Категории» list, each by its own word order; then the rest (from ticked dictionaries,
    not in a ticked category) as «по словарю». With fewer words wanted than there are, each
    group gives a share proportional to its size, as one unbroken run from a random place."""
    from app.models import Category

    far = 1 << 30
    dict_order = {
        d_id: i
        for i, d_id in enumerate(
            db.scalars(select(Dictionary.id).where(_visible(user)).order_by(Dictionary.created_at))
        )
    }
    cat_order = {
        c_id: i
        for i, c_id in enumerate(
            db.scalars(select(Category.id).order_by(Category.position, Category.name))
        )
    }
    ids = [w.id for w in words]
    in_dict = study.ticked_ids(db, user.id, "dictionary", ids)
    in_cat = study.ticked_ids(db, user.id, "category", ids)

    def by_dictionary(w: Word) -> tuple:
        return (dict_order.get(w.dictionary_id, far), w.position, w.id)

    def by_category(w: Word) -> tuple:
        placed = w.category_position is not None
        return (not placed, w.category_position if placed else 0, *by_dictionary(w))

    def group(w: Word) -> tuple:
        if sort == "category":
            if w.id in in_cat and w.category_id is not None:
                return (0, cat_order.get(w.category_id, far))
            return (1, dict_order.get(w.dictionary_id, far))
        # Not ticked in its dictionary (so it was ticked in its category, or it's a known word
        # in «Повторить выученные»): its category if ticked there, else its own dictionary.
        if w.id in in_dict or w.id not in in_cat or w.category_id is None:
            return (0, dict_order.get(w.dictionary_id, far))
        return (1, cat_order.get(w.category_id, far))

    groups: dict[tuple, list[Word]] = {}
    for w in words:
        groups.setdefault(group(w), []).append(w)
    ordered = [
        sorted(groups[k], key=by_category if sort == "category" and k[0] == 0 else by_dictionary)
        for k in sorted(groups)
    ]
    return _runs(ordered, count)


def _runs(ordered: list[list[Word]], count: int) -> list[Word]:
    import random

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


def _word_key(greek: str) -> str:
    return unicodedata.normalize("NFC", greek).strip().casefold()


def fill_page_words(db: Session, user: User, items: list, via: study.Via) -> None:
    """Dictionary and category pages: per word the user's last answers, «Изучать» (ticked on
    this page) and the other dictionaries with the same word («Есть в словарях» — to find
    duplicates; the same spelling, the article doesn't matter)."""
    from app.schemas.dictionary import AnswerStats, DictionaryRef
    from app.services.stats import last_answers

    ids = [w.id for w in items]
    stats = last_answers(db, user, ids)
    ticked = study.ticked_ids(db, user.id, via, ids)
    by_key: dict[str, list[tuple[int, int, str]]] = {}
    rows = db.execute(
        select(Word.id, Word.greek, Dictionary.id, Dictionary.title)
        .join(Dictionary, Word.dictionary_id == Dictionary.id)
        .where(_visible(user))
        .order_by(Dictionary.created_at)
    )
    for word_id, greek, d_id, title in rows:
        by_key.setdefault(_word_key(greek), []).append((word_id, d_id, title))
    for w in items:
        if w.id in stats:
            w.answers = AnswerStats(right=stats[w.id][0], total=stats[w.id][1])
        w.study = w.id in ticked
        refs: dict[int, DictionaryRef] = {}
        for word_id, d_id, title in by_key.get(_word_key(w.greek), []):
            if word_id != w.id:
                refs.setdefault(d_id, DictionaryRef(id=d_id, title=title))
        w.also_in = list(refs.values())
