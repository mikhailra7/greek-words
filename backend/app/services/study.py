"""«Изучать» on words (SPEC): which words a user trains on. Each word can be ticked on its
dictionary's page and, separately, on its category's page (UserStudyWord.via). The
dictionary's / category's «Использовать в тренировках» ticks or unticks all its words; its
UserActiveDictionary / UserActiveCategory row means «all are ticked» — then words added to it
later are ticked too (see the flush hook at the end)."""

from typing import Literal

from sqlalchemy import Connection, and_, delete, event, func, insert, literal, select
from sqlalchemy.orm import Session, attributes

from app.models import (
    UserActiveCategory,
    UserActiveDictionary,
    UserStudyWord,
    Word,
)

Via = Literal["dictionary", "category"]

_FLAGS = UserStudyWord.__table__


def _container(via: Via):
    """(the Word column of the container, the «all ticked» model, its container id column)"""
    if via == "dictionary":
        return Word.dictionary_id, UserActiveDictionary, UserActiveDictionary.dictionary_id
    return Word.category_id, UserActiveCategory, UserActiveCategory.category_id


def set_container(db: Session, user_id: int, via: Via, container_id: int, on: bool) -> None:
    """«Использовать в тренировках» of a dictionary or category: all its words ticked (and
    the ones added later) or all unticked — in this place only."""
    word_col, model, id_col = _container(via)
    words = select(Word.id).where(word_col == container_id)
    db.execute(
        delete(UserStudyWord).where(
            UserStudyWord.user_id == user_id,
            UserStudyWord.via == via,
            UserStudyWord.word_id.in_(words),
        )
    )
    db.execute(delete(model).where(model.user_id == user_id, id_col == container_id))
    if on:
        db.execute(
            insert(_FLAGS).from_select(
                ["user_id", "word_id", "via"],
                select(literal(user_id), Word.id, literal(via)).where(word_col == container_id),
            )
        )
        db.add(model(user_id=user_id, **{id_col.key: container_id}))
    db.commit()


def set_word(db: Session, user_id: int, word: Word, via: Via, on: bool) -> None:
    """«Изучать» on one word, in its dictionary or in its category."""
    word_col, model, id_col = _container(via)
    container_id = word.dictionary_id if via == "dictionary" else word.category_id
    if container_id is None:
        raise ValueError("word has no category")
    db.execute(
        delete(UserStudyWord).where(
            UserStudyWord.user_id == user_id,
            UserStudyWord.word_id == word.id,
            UserStudyWord.via == via,
        )
    )
    db.execute(delete(model).where(model.user_id == user_id, id_col == container_id))
    if on:
        db.add(UserStudyWord(user_id=user_id, word_id=word.id, via=via))
        db.flush()
        total = db.scalar(select(func.count(Word.id)).where(word_col == container_id))
        ticked = db.scalar(
            select(func.count(UserStudyWord.word_id))
            .join(Word, Word.id == UserStudyWord.word_id)
            .where(
                UserStudyWord.user_id == user_id,
                UserStudyWord.via == via,
                word_col == container_id,
            )
        )
        if ticked == total:  # the last one: the whole dictionary/category is ticked again
            db.add(model(user_id=user_id, **{id_col.key: container_id}))
    db.commit()


def ticked_ids(db: Session, user_id: int, via: Via, word_ids: list[int]) -> set[int]:
    return set(
        db.scalars(
            select(UserStudyWord.word_id).where(
                UserStudyWord.user_id == user_id,
                UserStudyWord.via == via,
                UserStudyWord.word_id.in_(word_ids),
            )
        )
    )


def ticked_counts(db: Session, user_id: int, via: Via) -> dict[int, int]:
    """dictionary / category id → how many of its words the user ticked there."""
    word_col = Word.dictionary_id if via == "dictionary" else Word.category_id
    rows = db.execute(
        select(word_col, func.count(UserStudyWord.word_id))
        .join(Word, Word.id == UserStudyWord.word_id)
        .where(UserStudyWord.user_id == user_id, UserStudyWord.via == via, word_col.is_not(None))
        .group_by(word_col)
    )
    return {cid: n for cid, n in rows}


def studied_word_ids(user_id: int):
    """The words a user trains on (before visibility and «Скрыть выученные»): ticked in their
    dictionary, or ticked in their category while still in one."""
    return select(UserStudyWord.word_id).where(
        UserStudyWord.user_id == user_id,
        (UserStudyWord.via == "dictionary")
        | and_(
            UserStudyWord.via == "category",
            UserStudyWord.word_id.in_(select(Word.id).where(Word.category_id.is_not(None))),
        ),
    )


# --- words added to a dictionary / moved to a category ---


def _tick_followers(conn: Connection, word_id: int, via: Via, container_id: int) -> None:
    _, model, id_col = _container(via)
    conn.execute(
        insert(_FLAGS)
        .prefix_with("OR IGNORE")
        .from_select(
            ["user_id", "word_id", "via"],
            select(model.user_id, literal(word_id), literal(via)).where(id_col == container_id),
        )
    )


@event.listens_for(Session, "after_flush")
def _new_and_moved_words(session: Session, _ctx) -> None:
    """A new word of a dictionary (category) that a user has wholly ticked is ticked for them
    too. A word moved to another category loses its category ticks (they were for the old
    one) and gets the new category's, if wholly ticked."""
    conn = None
    for obj in list(session.new) + list(session.dirty):
        if not isinstance(obj, Word):
            continue
        is_new = obj in session.new
        moved = not is_new and attributes.get_history(obj, "category_id").has_changes()
        if not (is_new or moved):
            continue
        conn = conn or session.connection()
        if is_new:
            _tick_followers(conn, obj.id, "dictionary", obj.dictionary_id)
        else:
            conn.execute(
                delete(_FLAGS).where(_FLAGS.c.word_id == obj.id, _FLAGS.c.via == "category")
            )
        if obj.category_id is not None:
            _tick_followers(conn, obj.id, "category", obj.category_id)
