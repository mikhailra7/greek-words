"""Trainers: random words from the user's active dictionaries, and remembered settings."""

import random
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.auth import CurrentUser
from app.db import DbSession
from app.models import AnswerLog, UserSetting, Word
from app.schemas.dictionary import WordOut
from app.services import tts
from app.services.quiz import TaskType, build_hard_questions, build_questions, mix_types
from app.services.selection import active_words, in_dictionary_order, visible_words, with_known
from app.services.selection import training_words as training_pool
from app.services.spelling import check

router = APIRouter(tags=["training"])

SETTING_KEYS = {"study", "translate", "write", "listen", "mix", "voice", "dialogue"}


def voice_from(value: dict | None) -> tts.Voice | None:
    """The profile's «Озвучка» → the site voice; None when the device voice is chosen."""
    value = value or {}
    if value.get("device"):
        return None
    speed = value.get("speed")
    return tts.Voice(male=bool(value.get("male")), rate=speed if speed in tts.RATES else None)


def user_voice(db: DbSession, user: CurrentUser) -> tts.Voice | None:
    row = db.get(UserSetting, (user.id, "voice"))
    return voice_from(row.value if row else None)


def _prepare(db: DbSession, user: CurrentUser, words: list[Word], langs: tuple) -> None:
    """A session starts: make its audio now, in the order the words will come."""
    v = user_voice(db, user)
    if v is not None:
        tts.warm_up([w.id for w in words], v, langs, session=True)


@router.get("/training/words", response_model=list[WordOut])
def training_words(
    user: CurrentUser,
    db: DbSession,
    count: Annotated[int, Query(ge=1, le=2000)] = 20,
    hide_known: bool = True,
    known_only: bool = False,
    in_order: bool = False,
) -> list[WordOut]:
    """`count` random words from the active dictionaries/categories, no repeats, new order
    every call; without the user's known words unless `hide_known=false`. `known_only`:
    from the user's known words in all dictionaries instead («Повторить выученные слова»)."""
    words = training_pool(db, user, hide_known, known_only)
    picked = (
        in_dictionary_order(db, user, words, count)  # «Порядок по словарю»
        if in_order
        else random.sample(words, min(count, len(words)))
    )
    _prepare(db, user, picked, ("el", "ru"))  # «Аудио повторение» also reads Russian
    return with_known(db, user, picked, WordOut)


class OptionOut(BaseModel):
    word_id: int
    text: str


class QuestionOut(BaseModel):
    word: WordOut
    options: list[OptionOut]


@router.get("/training/translate", response_model=list[QuestionOut])
def translate_questions(
    user: CurrentUser,
    db: DbSession,
    direction: Literal["ru_gr", "gr_ru"] = "ru_gr",
    count: Annotated[int, Query(ge=1, le=2000)] = 20,
    hide_known: bool = True,
    known_only: bool = False,
    hard: bool = False,
) -> list[QuestionOut]:
    # Questions: active words (without known ones). Wrong options: any visible dictionary,
    # same part of speech first (quiz.distractors) — more choice than the current lesson.
    pool = visible_words(db, user)
    candidates = training_pool(db, user, hide_known, known_only)
    picked = random.sample(candidates, min(count, len(candidates)))
    _prepare(db, user, picked, ("el",))
    return [
        QuestionOut(
            word=WordOut.model_validate(q.word),
            options=[OptionOut(word_id=o.word_id, text=o.text) for o in q.options],
        )
        for q in (
            build_hard_questions(picked, pool)  # hard mode exists for RU→GR only
            if hard and direction == "ru_gr"
            else build_questions(picked, pool, direction)
        )
    ]


class MixTaskOut(BaseModel):
    type: TaskType
    word: WordOut
    options: list[OptionOut] = []  # empty for «write»


@router.get("/training/mix", response_model=list[MixTaskOut])
def mix_tasks(
    user: CurrentUser,
    db: DbSession,
    count: Annotated[int, Query(ge=1, le=2000)] = 20,
    hide_known: bool = True,
    known_only: bool = False,
) -> list[MixTaskOut]:
    """«Микс заданий»: each picked word gets one task — RU→GR choice, GR→RU choice or
    «Напиши»; the three types are balanced and shuffled. Options as in «Переведи»."""
    pool = visible_words(db, user)
    candidates = training_pool(db, user, hide_known, known_only)
    picked = random.sample(candidates, min(count, len(candidates)))
    _prepare(db, user, picked, ("el",))
    tasks = []
    for word, kind in zip(picked, mix_types(len(picked)), strict=True):
        options = [] if kind == "write" else build_questions([word], pool, kind)[0].options
        tasks.append(
            MixTaskOut(
                type=kind,
                word=WordOut.model_validate(word),
                options=[OptionOut(word_id=o.word_id, text=o.text) for o in options],
            )
        )
    return tasks


class AnswerIn(BaseModel):
    word_id: int
    mode: Literal["translate", "write"]
    direction: Literal["ru_gr", "gr_ru"] | None = None
    is_correct: bool
    given_answer: Annotated[str | None, Field(max_length=300)] = None


@router.post("/training/answers", status_code=status.HTTP_204_NO_CONTENT)
def log_answer(body: AnswerIn, user: CurrentUser, db: DbSession) -> None:
    if db.get(Word, body.word_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Слово не найдено")
    db.add(AnswerLog(user_id=user.id, **body.model_dump()))
    db.commit()


class WriteCheckIn(BaseModel):
    word_id: int
    answer: Annotated[str, Field(max_length=200)]


class SegmentOut(BaseModel):
    text: str
    ok: bool


class WriteCheckOut(BaseModel):
    answer_id: int = 0  # the answers_log row — «Я ответил правильно» flips it
    correct: bool
    expected: str
    hint: str | None
    given_segments: list[SegmentOut]
    expected_segments: list[SegmentOut]


@router.post("/training/write/check", response_model=WriteCheckOut)
def write_check(body: WriteCheckIn, user: CurrentUser, db: DbSession) -> WriteCheckOut:
    """Check a typed answer and log it (mode=write)."""
    word = db.get(Word, body.word_id)
    if word is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Слово не найдено")
    result = check(body.answer, word.full_greek, word.article)
    entry = AnswerLog(
        user_id=user.id,
        word_id=word.id,
        mode="write",
        is_correct=result.correct,
        given_answer=body.answer[:300],
    )
    db.add(entry)
    db.commit()
    out = WriteCheckOut.model_validate(result, from_attributes=True)
    out.answer_id = entry.id
    return out


@router.post("/training/answers/{answer_id}/accept", status_code=status.HTTP_204_NO_CONTENT)
def accept_answer(answer_id: int, user: CurrentUser, db: DbSession) -> None:
    """«Я ответил правильно»: the learner overrules the check of a typed answer — it counts as
    right in the word's statistics (and the page counts it right in the exercise). Only one's
    own «Напиши» answers, and not «Не знаю» (an empty answer)."""
    entry = db.get(AnswerLog, answer_id)
    if entry is None or entry.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ответ не найден")
    if entry.mode != "write" or not (entry.given_answer or "").strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Этот ответ нельзя засчитать")
    entry.is_correct = True
    db.commit()


# --- remembered settings ---


class SettingIn(BaseModel):
    value: dict[str, Any]


@router.get("/me/settings")
def get_settings(user: CurrentUser, db: DbSession) -> dict[str, dict]:
    rows = db.scalars(select(UserSetting).where(UserSetting.user_id == user.id))
    return {r.key: r.value for r in rows}


@router.put("/me/settings/{key}", status_code=status.HTTP_204_NO_CONTENT)
def put_setting(key: str, body: SettingIn, user: CurrentUser, db: DbSession) -> None:
    if key not in SETTING_KEYS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Неизвестная настройка")
    if len(str(body.value)) > 2000:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Слишком большая настройка")
    row = db.get(UserSetting, (user.id, key))
    if row is None:
        db.add(UserSetting(user_id=user.id, key=key, value=body.value))
    else:
        row.value = body.value
    db.commit()
    if key == "voice" and (v := voice_from(body.value)) is not None:
        # A new voice/speed: make it for all the user's words in the background, so
        # training doesn't wait for the service word by word.
        langs = ("el", "ru") if v.male else ("el",)  # female Russian exists already
        ids = [w.id for w in active_words(db, user)]
        tts.warm_up(ids, v, langs, user_id=user.id)
