"""«Диалоги» (SPEC): shared dialogues to learn by heart. Everyone reads; admins import,
replace, export and delete."""

import re
from typing import Annotated, Any
from urllib.parse import quote

from fastapi import APIRouter, Body, HTTPException, Response, status
from fastapi.responses import FileResponse
from sqlalchemy import select

from app.api.word_media import VoiceName, _mp3, _voice
from app.auth import AdminUser, CurrentUser
from app.db import DbSession
from app.models import Dialogue, DialogueLine
from app.models.dictionary import speech_hash
from app.schemas.dialogue import DialogueDetailOut, DialogueLineOut, DialogueOut
from app.schemas.importing import PasteJsonIn
from app.services import dialogues, tts
from app.services.importing import ImportProblem

router = APIRouter(tags=["dialogues"])

JsonBody = Annotated[Any, Body()]


def _get(db: DbSession, dialogue_id: int) -> Dialogue:
    d = db.get(Dialogue, dialogue_id)
    if d is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Диалог не найден")
    return d


def _out(d: Dialogue, user) -> DialogueOut:
    return DialogueOut(
        id=d.id,
        title=d.title,
        speakers=d.speakers,
        line_count=len(d.lines),
        can_edit=user.is_admin,
    )


def _line_out(line: DialogueLine) -> DialogueLineOut:
    return DialogueLineOut(
        id=line.id,
        speaker=line.speaker,
        greek=line.greek,
        transcription=line.transcription,
        translation_ru=line.translation_ru,
        note=line.note,
        # ?v= changes with the text, so the browser may cache the file for long.
        audio_url=f"/api/dialogue-lines/{line.id}/audio?v={speech_hash(line.greek)}",
    )


def _detail(d: Dialogue, user) -> DialogueDetailOut:
    return DialogueDetailOut(**_out(d, user).model_dump(), lines=[_line_out(x) for x in d.lines])


def _parse(data: Any) -> dialogues.DialogueFile:
    if not isinstance(data, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ожидался JSON-объект диалога")
    try:
        return dialogues.validate(data)
    except ImportProblem as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e


@router.get("/dialogues", response_model=list[DialogueOut])
def list_dialogues(user: CurrentUser, db: DbSession) -> list[DialogueOut]:
    return [_out(d, user) for d in db.scalars(select(Dialogue).order_by(Dialogue.id))]


@router.get("/dialogues/{dialogue_id}", response_model=DialogueDetailOut)
def get_dialogue(dialogue_id: int, user: CurrentUser, db: DbSession) -> DialogueDetailOut:
    return _detail(_get(db, dialogue_id), user)


# The body is taken as plain JSON and validated here: errors name the line and the field
# («реплика 3, поле translation_ru: пусто») instead of the generic 422.
@router.post(
    "/dialogues/import", response_model=DialogueDetailOut, status_code=status.HTTP_201_CREATED
)
def import_dialogue(user: AdminUser, db: DbSession, data: JsonBody) -> DialogueDetailOut:
    return _detail(dialogues.create(db, _parse(data), created_by_id=user.id), user)


@router.post(
    "/dialogues/import/text", response_model=DialogueDetailOut, status_code=status.HTTP_201_CREATED
)
def import_dialogue_text(body: PasteJsonIn, user: AdminUser, db: DbSession) -> DialogueDetailOut:
    """The answer of a Claude chat (prompt «Диалог»), pasted as is."""
    try:
        data = dialogues.parse_text(body.text)
    except ImportProblem as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    return _detail(dialogues.create(db, data, created_by_id=user.id), user)


@router.put("/dialogues/{dialogue_id}/import", response_model=DialogueDetailOut)
def replace_dialogue(
    dialogue_id: int, user: AdminUser, db: DbSession, data: JsonBody
) -> DialogueDetailOut:
    """«Заменить из JSON»: the same dialogue (same place in the list), new content."""
    d = _get(db, dialogue_id)
    return _detail(dialogues.replace(db, d, _parse(data)), user)


@router.get("/dialogues/{dialogue_id}/export")
def export_dialogue(dialogue_id: int, _: AdminUser, db: DbSession) -> Response:
    d = _get(db, dialogue_id)
    filename = re.sub(r"[^\w\-]+", "_", d.title).strip("_") or "dialogue"
    return Response(
        content=dialogues.to_file(d).model_dump_json(indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}.json"},
    )


@router.delete("/dialogues/{dialogue_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_dialogue(dialogue_id: int, _: AdminUser, db: DbSession) -> None:
    dialogues.delete(db, _get(db, dialogue_id))


@router.get("/dialogue-lines/{line_id}/audio")
def line_audio(
    line_id: int,
    _: CurrentUser,
    db: DbSession,
    voice: VoiceName = "female",
    rate: int | None = None,
) -> FileResponse:
    """A whole line, in the voice the page asks for (each role has its own on the site voice)."""
    line = db.get(DialogueLine, line_id)
    if line is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Реплика не найдена")
    try:
        return _mp3(tts.ensure_line_audio(line, _voice(voice, rate)))
    except tts.TTSUnavailable as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e)) from e
