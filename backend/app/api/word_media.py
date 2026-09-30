"""Word pronunciation and stock pictures."""

from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from app.api.dictionaries import get_editable_word, get_visible
from app.auth import AdminUser, CurrentUser
from app.db import DbSession
from app.models import Word
from app.schemas.dictionary import WordOut
from app.services import media, stock, tts

router = APIRouter(tags=["word media"])


def _voice(voice: str, rate: int | None) -> tts.Voice:
    if rate is not None and rate not in tts.RATES:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f"Скорость — одна из {tts.RATES}"
        )
    return tts.Voice(male=voice == "male", rate=rate)


def _mp3(path: Path) -> FileResponse:
    # URLs carry ?v=<hash of the text> (and the voice), so the browser may cache them long.
    return FileResponse(
        path, media_type="audio/mpeg", headers={"Cache-Control": "private, max-age=31536000"}
    )


def _audio(word_id: int, lang: tts.Lang, v: tts.Voice, user, db) -> FileResponse:
    word = db.get(Word, word_id)
    if word is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Слово не найдено")
    get_visible(db, user, word.dictionary_id)
    try:
        return _mp3(tts.ensure_audio(db, word, lang, v))
    except tts.TTSUnavailable as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e)) from e


VoiceName = Literal["female", "male"]


@router.get("/words/{word_id}/audio")
def word_audio(
    word_id: int,
    user: CurrentUser,
    db: DbSession,
    voice: VoiceName = "female",
    rate: int | None = None,
) -> FileResponse:
    """Greek pronunciation (with the article). `voice`/`rate` — the user's «Озвучка» choice."""
    return _audio(word_id, "el", _voice(voice, rate), user, db)


@router.get("/words/{word_id}/audio/ru")
def word_audio_ru(
    word_id: int, user: CurrentUser, db: DbSession, voice: VoiceName = "female"
) -> FileResponse:
    """The Russian translations read aloud (for «Аудио повторение»); always normal speed."""
    return _audio(word_id, "ru", _voice(voice, None), user, db)


@router.get("/tts/sample")
def voice_sample(
    _: CurrentUser,
    lang: tts.Lang = "el",
    voice: VoiceName = "female",
    rate: int | None = None,
) -> FileResponse:
    """A short phrase to try a voice/speed in the profile."""
    try:
        return _mp3(tts.ensure_sample(lang, _voice(voice, rate)))
    except tts.TTSUnavailable as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e)) from e


@router.post("/words/{word_id}/audio/regenerate", response_model=WordOut)
def regenerate_audio(word_id: int, user: CurrentUser, db: DbSession) -> Word:
    word = get_editable_word(db, user, word_id)
    for lang in ("el", "ru"):
        tts.forget_audio(word, lang)
    db.commit()
    try:
        tts.ensure_audio(db, word, "el")
        tts.ensure_audio(db, word, "ru")
    except tts.TTSUnavailable as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e)) from e
    return word


class StockHit(BaseModel):
    id: str
    thumb_url: str
    credit: str


class StockResults(BaseModel):
    provider: str
    results: list[StockHit]


class StockChoice(BaseModel):
    id: str = Field(min_length=1, max_length=64)


@router.get("/stock/search", response_model=StockResults)
def stock_search(q: str, _: AdminUser) -> StockResults:
    try:
        found = stock.search(q)
    except stock.StockError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e)) from e
    return StockResults(
        provider=stock.provider_name(),
        results=[
            StockHit(id=i.id, thumb_url=f"/api/stock/thumb/{i.id}", credit=i.credit) for i in found
        ],
    )


@router.get("/stock/thumb/{image_id}")
def stock_thumb(image_id: str, _: AdminUser) -> Response:
    try:
        data, content_type = stock.thumbnail(image_id)
    except stock.StockError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    if not content_type.startswith("image/"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Не картинка")
    return Response(
        data, media_type=content_type, headers={"Cache-Control": "private, max-age=3600"}
    )


@router.put("/words/{word_id}/image/stock", response_model=WordOut)
def choose_stock_image(word_id: int, body: StockChoice, user: CurrentUser, db: DbSession) -> Word:
    word = get_editable_word(db, user, word_id)
    try:
        img = stock.get(body.id)
        rel = media.store_uploaded_image(stock.download(img))
    except stock.StockError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e)) from e
    except ValueError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Сток отдал не картинку: {e}") from e
    old = word.image_path
    word.image_path, word.image_source, word.image_credit = rel, "stock", img.credit
    db.commit()
    media.delete_file(old)
    return word
