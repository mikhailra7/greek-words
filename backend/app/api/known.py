"""«Я знаю это слово» — per user. Marked words drop out of every trainer (unless the user
switches off «Скрыть выученные слова» there); unmark one by one or reset a whole
dictionary / category."""

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import delete, select

from app.api.dictionaries import get_visible, visible_filter
from app.auth import CurrentUser
from app.db import DbSession
from app.models import Category, Dictionary, UserKnownWord, Word

router = APIRouter(tags=["known words"])


class KnownIn(BaseModel):
    known: bool


class KnownOut(BaseModel):
    known: bool


class ResetOut(BaseModel):
    reset: int  # how many marks were removed


@router.put("/words/{word_id}/known", response_model=KnownOut)
def set_known(word_id: int, body: KnownIn, user: CurrentUser, db: DbSession) -> KnownOut:
    word = db.get(Word, word_id)
    if word is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Слово не найдено")
    get_visible(db, user, word.dictionary_id)
    db.execute(
        delete(UserKnownWord).where(
            UserKnownWord.user_id == user.id, UserKnownWord.word_id == word_id
        )
    )
    if body.known:
        db.add(UserKnownWord(user_id=user.id, word_id=word_id))
    db.commit()
    return KnownOut(known=body.known)


def _reset(db: DbSession, user_id: int, word_ids) -> ResetOut:
    result = db.execute(
        delete(UserKnownWord).where(
            UserKnownWord.user_id == user_id, UserKnownWord.word_id.in_(word_ids)
        )
    )
    db.commit()
    return ResetOut(reset=result.rowcount or 0)


@router.post("/dictionaries/{dictionary_id}/known/reset", response_model=ResetOut)
def reset_dictionary(dictionary_id: int, user: CurrentUser, db: DbSession) -> ResetOut:
    get_visible(db, user, dictionary_id)
    return _reset(db, user.id, select(Word.id).where(Word.dictionary_id == dictionary_id))


@router.post("/categories/{category_id}/known/reset", response_model=ResetOut)
def reset_category(category_id: int, user: CurrentUser, db: DbSession) -> ResetOut:
    if db.get(Category, category_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Категория не найдена")
    words = (
        select(Word.id)
        .join(Dictionary, Word.dictionary_id == Dictionary.id)
        .where(Word.category_id == category_id, visible_filter(user))
    )
    return _reset(db, user.id, words)
