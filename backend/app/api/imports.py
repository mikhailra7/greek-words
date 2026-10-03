from typing import Literal

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse, PlainTextResponse
from sqlalchemy import select

from app.auth import AdminUser
from app.config import settings
from app.db import DbSession
from app.models import Category, ImportDraftWord, ImportJob
from app.schemas.dictionary import DictionaryOut, WordIn
from app.schemas.importing import (
    AcceptCategoryIn,
    DraftWordOut,
    DraftWordUpdate,
    ImportJobDetailOut,
    ImportJobOut,
    PasteJsonIn,
    PublishIn,
    SelectPagesIn,
)
from app.services import importing, tts
from app.services.importing import ImportProblem

router = APIRouter(prefix="/imports", tags=["imports"])


def _get_job(db: DbSession, job_id: int) -> ImportJob:
    job = db.get(ImportJob, job_id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Импорт не найден")
    return job


def _get_word(job: ImportJob, word_id: int) -> ImportDraftWord:
    word = next((w for w in job.words if w.id == word_id), None)
    if word is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Слово не найдено")
    return word


def _check_category(db: DbSession, category_id: int | None) -> None:
    if category_id is not None and db.get(Category, category_id) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нет такой категории")


def _bad(e: ImportProblem) -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, str(e))


def _word_out(job: ImportJob, w: ImportDraftWord, dups: list[str]) -> DraftWordOut:
    out = DraftWordOut.model_validate(w)
    if w.image_file:
        # File name changes on every re-crop, so the URL doubles as a cache buster.
        out.image_url = f"/api/imports/{job.id}/{w.image_file}"
    out.duplicates = dups
    return out


def _job_out(job: ImportJob) -> ImportJobOut:
    out = ImportJobOut.model_validate(job)
    out.word_count = len(job.words)
    return out


def _detail(db: DbSession, job: ImportJob) -> ImportJobDetailOut:
    dups = importing.duplicates(db, job.words)
    return ImportJobDetailOut(
        **_job_out(job).model_dump(),
        words=[_word_out(job, w, dups[w.id]) for w in job.words],
        claude_pages=len(job.selected_pages),
    )


async def _read_uploads(files: list[UploadFile]) -> list[tuple[str, bytes]]:
    limit = settings.max_upload_mb * 1024 * 1024
    out, total = [], 0
    for f in files:
        data = await f.read()
        total += len(data)
        if total > limit:
            raise HTTPException(
                status.HTTP_413_CONTENT_TOO_LARGE, f"Файлы больше {settings.max_upload_mb} МБ"
            )
        out.append((f.filename or "file", data))
    return out


# --- jobs ---


@router.get("", response_model=list[ImportJobOut])
def list_jobs(_: AdminUser, db: DbSession) -> list[ImportJobOut]:
    jobs = db.scalars(select(ImportJob).order_by(ImportJob.created_at.desc()).limit(30)).all()
    return [_job_out(j) for j in jobs]


@router.post("", response_model=ImportJobDetailOut, status_code=status.HTTP_201_CREATED)
async def create_job(
    admin: AdminUser,
    db: DbSession,
    files: list[UploadFile] = File(...),  # noqa: B008
) -> ImportJobDetailOut:
    uploads = await _read_uploads(files)
    job = ImportJob(created_by_id=admin.id, mode="paste")
    db.add(job)
    db.flush()
    try:
        importing.save_upload(job, uploads)
    except ImportProblem as e:
        importing.delete_job_files(job)
        db.rollback()
        raise _bad(e) from e
    db.commit()
    return _detail(db, job)


@router.post("/package", response_model=ImportJobDetailOut, status_code=status.HTTP_201_CREATED)
async def create_from_package(
    admin: AdminUser,
    db: DbSession,
    file: UploadFile = File(...),  # noqa: B008
) -> ImportJobDetailOut:
    [(name, data)] = await _read_uploads([file])
    job = ImportJob(created_by_id=admin.id, mode="package")
    db.add(job)
    db.flush()
    try:
        importing.load_package(db, job, data, name)
    except ImportProblem as e:
        importing.delete_job_files(job)
        db.rollback()
        raise _bad(e) from e
    db.commit()
    return _detail(db, job)


@router.get("/prompt", response_class=PlainTextResponse)
def get_prompt(
    _: AdminUser, db: DbSession, kind: Literal["import", "wordlist", "dialogue"] = "import"
) -> str:
    """The Claude prompt: everything after the first '---' line of docs/prompts/<kind>.md,
    with the current category list filled in."""
    return importing.render_prompt(db, kind)


@router.get("/{job_id}", response_model=ImportJobDetailOut)
def get_job(job_id: int, _: AdminUser, db: DbSession) -> ImportJobDetailOut:
    return _detail(db, _get_job(db, job_id))


@router.delete("/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_job(job_id: int, _: AdminUser, db: DbSession) -> None:
    job = _get_job(db, job_id)
    importing.delete_job_files(job)
    db.delete(job)
    db.commit()


@router.post("/{job_id}/pages", response_model=ImportJobDetailOut)
def select_pages(
    job_id: int, body: SelectPagesIn, _: AdminUser, db: DbSession
) -> ImportJobDetailOut:
    job = _get_job(db, job_id)
    if not job.has_source_pdf:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "В этом импорте нет PDF")
    try:
        importing.select_pages(job, body.pages)
    except ImportProblem as e:
        raise _bad(e) from e
    db.commit()
    return _detail(db, job)


@router.post("/{job_id}/json", response_model=ImportJobDetailOut)
def paste_json(job_id: int, body: PasteJsonIn, _: AdminUser, db: DbSession) -> ImportJobDetailOut:
    job = _get_job(db, job_id)
    if not job.selected_pages:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Сначала выберите страницы")
    try:
        importing.apply_pasted_json(db, job, body.text)
    except ImportProblem as e:
        db.rollback()
        raise _bad(e) from e
    db.commit()
    return _detail(db, job)


@router.post("/{job_id}/publish", response_model=DictionaryOut)
def publish(job_id: int, body: PublishIn, admin: AdminUser, db: DbSession) -> DictionaryOut:
    job = _get_job(db, job_id)
    if job.status != "review":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Импорт ещё не готов к публикации")
    try:
        d = importing.publish(db, job, body.title, body.description, admin.id)
    except ImportProblem as e:
        raise _bad(e) from e
    db.commit()
    tts.warm_up([w.id for w in d.words])
    return DictionaryOut(
        id=d.id,
        title=d.title,
        description=d.description,
        source=d.source,
        is_published=d.is_published,
        word_count=len(d.words),
        is_active=False,
        can_edit=True,
    )


@router.post("/{job_id}/categories", response_model=ImportJobDetailOut)
def accept_category(
    job_id: int, body: AcceptCategoryIn, user: AdminUser, db: DbSession
) -> ImportJobDetailOut:
    """Accept a category Claude proposed: create it and assign it to the draft words."""
    job = _get_job(db, job_id)
    importing.accept_category(db, job, body.name, created_by_id=user.id)
    db.commit()
    return _detail(db, job)


# --- draft words ---


@router.post("/{job_id}/words", response_model=DraftWordOut, status_code=status.HTTP_201_CREATED)
def add_word(job_id: int, body: WordIn, _: AdminUser, db: DbSession) -> DraftWordOut:
    job = _get_job(db, job_id)
    pos = max((w.position for w in job.words), default=-1) + 1
    _check_category(db, body.category_id)
    word = ImportDraftWord(position=pos, **body.model_dump())
    if body.category_id is not None:
        word.category_source = "manual"
    job.words.append(word)
    db.commit()
    return _word_out(job, word, importing.duplicates(db, [word])[word.id])


@router.put("/{job_id}/words/{word_id}", response_model=DraftWordOut)
def update_word(
    job_id: int, word_id: int, body: DraftWordUpdate, _: AdminUser, db: DbSession
) -> DraftWordOut:
    job = _get_job(db, job_id)
    word = _get_word(job, word_id)
    if body.page is not None and body.page > len(job.selected_pages):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нет такой страницы")
    _check_category(db, body.category_id)
    importing.update_word(job, word, body.model_dump())
    db.commit()
    return _word_out(job, word, importing.duplicates(db, [word])[word.id])


@router.delete("/{job_id}/words/{word_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_word(job_id: int, word_id: int, _: AdminUser, db: DbSession) -> None:
    job = _get_job(db, job_id)
    word = _get_word(job, word_id)
    importing.drop_crop(job, word)
    job.words.remove(word)
    db.commit()


# --- private files (admin only) ---


@router.get("/{job_id}/claude.pdf")
def download_claude_pdf(job_id: int, _: AdminUser, db: DbSession) -> FileResponse:
    job = _get_job(db, job_id)
    path = importing.claude_pdf(job)
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Сначала выберите страницы")
    return FileResponse(
        path, media_type="application/pdf", filename=f"import_{job.id}_for_claude.pdf"
    )


@router.get("/{job_id}/previews/{page_no}.jpg")
def page_preview(job_id: int, page_no: int, _: AdminUser, db: DbSession) -> FileResponse:
    job = _get_job(db, job_id)
    if not job.has_source_pdf or not 1 <= page_no <= job.page_count:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return FileResponse(importing.preview_path(job, page_no), media_type="image/jpeg")


@router.get("/{job_id}/pageimg/{page_no}.jpg")
def page_image(job_id: int, page_no: int, _: AdminUser, db: DbSession) -> FileResponse:
    job = _get_job(db, job_id)
    if not importing.pages_pdf(job).exists() or not 1 <= page_no <= len(job.selected_pages):
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return FileResponse(importing.page_image_path(job, page_no), media_type="image/jpeg")


@router.get("/{job_id}/crops/{name}")
def crop_image(job_id: int, name: str, _: AdminUser, db: DbSession) -> FileResponse:
    job = _get_job(db, job_id)
    path = importing.job_dir(job) / "crops" / name
    if "/" in name or ".." in name or not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return FileResponse(path, media_type="image/jpeg")
