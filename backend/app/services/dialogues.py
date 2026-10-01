"""Dialogues: import from JSON (file or pasted from a chat) with readable errors, replace."""

from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.models import Dialogue, DialogueLine
from app.schemas.dialogue import DialogueFile
from app.services import media, tts
from app.services.import_text import extract_json
from app.services.importing import ImportProblem

FIELDS = {
    "speaker": "speaker (роль)",
    "greek": "greek",
    "transcription": "transcription",
    "translation_ru": "translation_ru",
    "note": "note",
}


def _message(err: dict) -> str:
    kind, ctx = err["type"], err.get("ctx") or {}
    if kind == "missing":
        return "нет значения"
    # A text field cleaned to "" reports a generic too_short with min_length 1.
    if kind == "string_too_short" or (kind == "too_short" and ctx.get("min_length") == 1):
        return "пусто"
    if kind == "string_too_long":
        return f"длиннее {ctx.get('max_length')} символов"
    if kind == "too_short":
        return f"нужно минимум {ctx.get('min_length')}"
    if kind == "too_long":
        return f"максимум {ctx.get('max_length')}"
    if kind in ("greater_than_equal", "less_than_equal", "int_parsing", "int_type"):
        return "номер роли — 0, 1 или 2"
    if kind in ("string_type",):
        return "нужен текст"
    return err["msg"].removeprefix("Value error, ")


def validate(data: dict) -> DialogueFile:
    if data.get("type") not in (None, "dialogue"):
        raise ImportProblem('Это не диалог: в файле должно быть "type": "dialogue"')
    if "words" in data and "lines" not in data:
        raise ImportProblem("Это словарь, а не диалог — загрузите его в разделе «Словари»")
    try:
        return DialogueFile.model_validate(data)
    except ValidationError as e:
        problems = []
        for err in e.errors()[:5]:
            loc = err["loc"]
            if len(loc) >= 2 and loc[0] == "lines" and isinstance(loc[1], int):
                where = f"реплика {loc[1] + 1}"
                if len(loc) > 2:
                    where += f", поле {FIELDS.get(str(loc[2]), loc[2])}"
            elif loc and loc[0] == "speakers":
                where = "роли (speakers)"
            elif loc:
                where = f"поле {loc[0]}"
            else:  # whole-file checks: the message says where
                problems.append(_message(err))
                continue
            problems.append(f"{where}: {_message(err)}")
        raise ImportProblem("JSON не подходит: " + "; ".join(problems)) from e


def parse_text(text: str) -> DialogueFile:
    """A dialogue JSON pasted from a chat: ```json fences and text around are fine."""
    try:
        data = extract_json(text)
    except ValueError as e:
        raise ImportProblem(str(e)) from e
    return validate(data)


def _fill(d: Dialogue, data: DialogueFile) -> None:
    d.title = data.title
    d.speakers = list(data.speakers)
    d.lines = [
        DialogueLine(
            position=i,
            speaker=line.speaker,
            greek=line.greek,
            transcription=line.transcription,
            translation_ru=line.translation_ru,
            note=line.note,
        )
        for i, line in enumerate(data.lines)
    ]


def create(db: Session, data: DialogueFile, created_by_id: int | None) -> Dialogue:
    d = Dialogue(created_by_id=created_by_id)
    _fill(d, data)
    db.add(d)
    db.commit()
    tts.warm_up_dialogue([line.id for line in d.lines])
    return d


def replace(db: Session, d: Dialogue, data: DialogueFile) -> Dialogue:
    """«Заменить из JSON»: new title, roles and lines (new ids — old audio goes)."""
    stale = tts.dialogue_line_files([line.id for line in d.lines])
    _fill(d, data)
    db.commit()
    for rel in stale:
        media.delete_file(rel)
    tts.warm_up_dialogue([line.id for line in d.lines])
    return d


def delete(db: Session, d: Dialogue) -> None:
    stale = tts.dialogue_line_files([line.id for line in d.lines])
    db.delete(d)
    db.commit()
    for rel in stale:
        media.delete_file(rel)


def to_file(d: Dialogue) -> DialogueFile:
    return DialogueFile(
        title=d.title,
        speakers=d.speakers,
        lines=[
            {
                "speaker": line.speaker,
                "greek": line.greek,
                "transcription": line.transcription,
                "translation_ru": line.translation_ru,
                "note": line.note,
            }
            for line in d.lines
        ],
    )
