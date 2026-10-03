import re
from urllib.parse import quote

from fastapi import APIRouter, File, HTTPException, Response, UploadFile, status
from sqlalchemy import ColumnElement, delete, func, or_, select

from app.auth import CurrentUser
from app.db import DbSession
from app.models import Category, Dictionary, User, UserActiveCategory, UserActiveDictionary, Word
from app.schemas.dictionary import (
    ActiveIn,
    ActiveSummary,
    DictionaryDetailOut,
    DictionaryFile,
    DictionaryIn,
    DictionaryListOut,
    DictionaryOut,
    DictionaryPatch,
    WordCategoryIn,
    WordIn,
    WordOut,
)
from app.schemas.importing import PasteJsonIn
from app.services import media, tts
from app.services.dictionaries import add_words, create_from_file
from app.services.importing import ImportProblem, export_package, parse_dictionary_text

router = APIRouter(tags=["dictionaries"])


# --- access rules (one place, so personal dictionaries can be added later) ---


def visible_filter(user: User) -> ColumnElement[bool]:
    shared = Dictionary.owner_id.is_(None)
    if not user.is_admin:
        shared = shared & Dictionary.is_published
    return or_(shared, Dictionary.owner_id == user.id)


def can_edit_dictionary(user: User, d: Dictionary) -> bool:
    if d.owner_id is None:
        return user.is_admin
    return d.owner_id == user.id


def get_visible(db: DbSession, user: User, dictionary_id: int) -> Dictionary:
    d = db.scalar(select(Dictionary).where(Dictionary.id == dictionary_id, visible_filter(user)))
    if d is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Словарь не найден")
    return d


def _get_editable(db: DbSession, user: User, dictionary_id: int) -> Dictionary:
    d = get_visible(db, user, dictionary_id)
    if not can_edit_dictionary(user, d):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нет прав на изменение словаря")
    return d


def get_editable_word(db: DbSession, user: User, word_id: int) -> Word:
    word = db.get(Word, word_id)
    if word is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Слово не найдено")
    _get_editable(db, user, word.dictionary_id)
    return word


# --- helpers ---


def _word_counts(db: DbSession, ids: list[int]) -> dict[int, int]:
    rows = db.execute(
        select(Word.dictionary_id, func.count(Word.id))
        .where(Word.dictionary_id.in_(ids))
        .group_by(Word.dictionary_id)
    )
    return {dictionary_id: n for dictionary_id, n in rows}


def _active_ids(db: DbSession, user: User) -> set[int]:
    return set(
        db.scalars(
            select(UserActiveDictionary.dictionary_id).where(
                UserActiveDictionary.user_id == user.id
            )
        )
    )


def active_summary(db: DbSession, user: User) -> ActiveSummary:
    from app.services.selection import active_word_count, known_word_count

    dicts = db.scalar(
        select(func.count(Dictionary.id))
        .join(UserActiveDictionary, UserActiveDictionary.dictionary_id == Dictionary.id)
        .where(UserActiveDictionary.user_id == user.id, visible_filter(user))
    )
    cats = db.scalar(
        select(func.count(UserActiveCategory.category_id)).where(
            UserActiveCategory.user_id == user.id
        )
    )
    total = active_word_count(db, user)
    return ActiveSummary(
        dictionaries=dicts or 0,
        categories=cats or 0,
        words=total,
        known=total - active_word_count(db, user, hide_known=True),
        known_all=known_word_count(db, user),
    )


def _dictionary_out(d: Dictionary, user: User, word_count: int, active: bool) -> DictionaryOut:
    return DictionaryOut(
        id=d.id,
        title=d.title,
        description=d.description,
        source=d.source,
        is_published=d.is_published,
        word_count=word_count,
        is_active=active,
        can_edit=can_edit_dictionary(user, d),
        author=d.author.username if d.author else None,
    )


# --- dictionaries ---


@router.get("/dictionaries", response_model=DictionaryListOut)
def list_dictionaries(user: CurrentUser, db: DbSession) -> DictionaryListOut:
    dicts = db.scalars(
        select(Dictionary).where(visible_filter(user)).order_by(Dictionary.created_at)
    ).all()
    counts = _word_counts(db, [d.id for d in dicts])
    active = _active_ids(db, user)
    return DictionaryListOut(
        dictionaries=[_dictionary_out(d, user, counts.get(d.id, 0), d.id in active) for d in dicts],
        active=active_summary(db, user),
    )


@router.post("/dictionaries", response_model=DictionaryOut, status_code=status.HTTP_201_CREATED)
def create_dictionary(body: DictionaryIn, user: CurrentUser, db: DbSession) -> DictionaryOut:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нужны права администратора")
    d = Dictionary(title=body.title, description=body.description, created_by_id=user.id)
    db.add(d)
    db.commit()
    return _dictionary_out(d, user, 0, False)


@router.post(
    "/dictionaries/import", response_model=DictionaryOut, status_code=status.HTTP_201_CREATED
)
def import_dictionary(body: DictionaryFile, user: CurrentUser, db: DbSession) -> DictionaryOut:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нужны права администратора")
    d = create_from_file(db, body, created_by_id=user.id)
    tts.warm_up([w.id for w in d.words])
    return _dictionary_out(d, user, len(body.words), False)


@router.post(
    "/dictionaries/import/text", response_model=DictionaryOut, status_code=status.HTTP_201_CREATED
)
def import_dictionary_text(body: PasteJsonIn, user: CurrentUser, db: DbSession) -> DictionaryOut:
    """The same file, pasted from a Claude chat («Как добавить словари» → список слов):
    ```json fences and text around are tolerated, errors are readable."""
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нужны права администратора")
    try:
        data = parse_dictionary_text(body.text)
    except ImportProblem as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    return import_dictionary(data, user, db)


@router.get("/dictionaries/{dictionary_id}", response_model=DictionaryDetailOut)
def get_dictionary(dictionary_id: int, user: CurrentUser, db: DbSession) -> DictionaryDetailOut:
    d = get_visible(db, user, dictionary_id)
    base = _dictionary_out(d, user, len(d.words), d.id in _active_ids(db, user))
    from app.services.selection import with_known

    return DictionaryDetailOut(**base.model_dump(), words=with_known(db, user, d.words, WordOut))


@router.patch("/dictionaries/{dictionary_id}", response_model=DictionaryOut)
def update_dictionary(
    dictionary_id: int, body: DictionaryPatch, user: CurrentUser, db: DbSession
) -> DictionaryOut:
    d = _get_editable(db, user, dictionary_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        if field == "title" and value is None:
            continue
        setattr(d, field, value)
    db.commit()
    return _dictionary_out(d, user, len(d.words), d.id in _active_ids(db, user))


@router.delete("/dictionaries/{dictionary_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_dictionary(dictionary_id: int, user: CurrentUser, db: DbSession) -> None:
    d = _get_editable(db, user, dictionary_id)
    files = [
        f
        for w in d.words
        for f in (w.image_path, w.audio_path, w.audio_ru_path, *tts.variant_files(w))
    ]
    db.delete(d)
    db.commit()
    for f in files:
        media.delete_file(f)


@router.put("/dictionaries/{dictionary_id}/active", response_model=ActiveSummary)
def set_active(
    dictionary_id: int, body: ActiveIn, user: CurrentUser, db: DbSession
) -> ActiveSummary:
    get_visible(db, user, dictionary_id)
    db.execute(
        delete(UserActiveDictionary).where(
            UserActiveDictionary.user_id == user.id,
            UserActiveDictionary.dictionary_id == dictionary_id,
        )
    )
    if body.active:
        db.add(UserActiveDictionary(user_id=user.id, dictionary_id=dictionary_id))
    db.commit()
    return active_summary(db, user)


@router.get("/dictionaries/{dictionary_id}/export")
def export_dictionary(
    dictionary_id: int, user: CurrentUser, db: DbSession, format: str = "json"
) -> Response:
    d = _get_editable(db, user, dictionary_id)
    filename = re.sub(r"[^\w\-]+", "_", d.title).strip("_") or "dictionary"
    if format == "zip":
        # With pictures; loads back through «Импорт» → draft.
        return Response(
            content=export_package(d),
            media_type="application/zip",
            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}.zip"},
        )
    data = DictionaryFile(
        title=d.title,
        description=d.description,
        words=[WordIn.model_validate(w, from_attributes=True) for w in d.words],
    )
    return Response(
        content=data.model_dump_json(indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}.json"},
    )


@router.get("/words/active/count", response_model=ActiveSummary)
def active_count(user: CurrentUser, db: DbSession) -> ActiveSummary:
    return active_summary(db, user)


# --- words ---


def _check_category(db: DbSession, body: WordIn) -> None:
    if body.category_id is not None and db.get(Category, body.category_id) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нет такой категории")


@router.post(
    "/dictionaries/{dictionary_id}/words",
    response_model=WordOut,
    status_code=status.HTTP_201_CREATED,
)
def create_word(dictionary_id: int, body: WordIn, user: CurrentUser, db: DbSession) -> Word:
    d = _get_editable(db, user, dictionary_id)
    _check_category(db, body)
    start = max((w.position for w in d.words), default=-1) + 1
    add_words(d, [body], start)
    db.commit()
    tts.warm_up([d.words[-1].id])
    return d.words[-1]


@router.put("/words/{word_id}", response_model=WordOut)
def update_word(word_id: int, body: WordIn, user: CurrentUser, db: DbSession) -> Word:
    word = get_editable_word(db, user, word_id)
    _check_category(db, body)
    spoken_before = (word.speech_text, word.speech_text_ru)
    for field, value in body.model_dump().items():
        setattr(word, field, value)
    if word.speech_text != spoken_before[0]:
        tts.forget_audio(word, "el")
    if word.speech_text_ru != spoken_before[1]:
        tts.forget_audio(word, "ru")
    db.commit()
    if not word.audio_path or not word.audio_ru_path:
        tts.warm_up([word.id])
    return word


@router.patch("/words/{word_id}/category", response_model=WordOut)
def set_word_category(word_id: int, body: WordCategoryIn, user: CurrentUser, db: DbSession) -> Word:
    """Only the category — for quick labelling of many words in a row."""
    word = get_editable_word(db, user, word_id)
    if body.category_id is not None and db.get(Category, body.category_id) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нет такой категории")
    word.category_id = body.category_id
    db.commit()
    return word


@router.delete("/words/{word_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_word(word_id: int, user: CurrentUser, db: DbSession) -> None:
    word = get_editable_word(db, user, word_id)
    files = [word.image_path, word.audio_path, word.audio_ru_path, *tts.variant_files(word)]
    db.delete(word)
    db.commit()
    for f in files:
        media.delete_file(f)


@router.put("/words/{word_id}/image", response_model=WordOut)
async def upload_word_image(
    word_id: int,
    user: CurrentUser,
    db: DbSession,
    file: UploadFile = File(...),  # noqa: B008
) -> Word:
    word = get_editable_word(db, user, word_id)
    try:
        rel = media.store_uploaded_image(await file.read())
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    old = word.image_path
    word.image_path, word.image_source, word.image_credit = rel, "upload", None
    db.commit()
    media.delete_file(old)
    return word


@router.delete("/words/{word_id}/image", response_model=WordOut)
def delete_word_image(word_id: int, user: CurrentUser, db: DbSession) -> Word:
    word = get_editable_word(db, user, word_id)
    old = word.image_path
    word.image_path, word.image_source, word.image_credit = None, None, None
    db.commit()
    media.delete_file(old)
    return word
