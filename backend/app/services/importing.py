"""Textbook import: upload → choose pages → Claude JSON / package → draft → publish."""

import io
import json
import secrets
import shutil
import unicodedata
import zipfile
from pathlib import Path, PurePosixPath
from typing import TypeVar

from PIL import Image
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session, object_session

from app.config import settings
from app.models import Category, Dictionary, ImportDraftWord, ImportJob, Word
from app.schemas.dictionary import DictionaryFile
from app.schemas.importing import DraftFile, DraftWordIn
from app.services import media, pdf
from app.services.import_text import extract_json

WORD_FIELDS = (
    "article",
    "greek",
    "transcription",
    "translations_ru",
    "part_of_speech",
    "example_gr",
    "example_ru",
    "image_emoji",
    "image_query",
)


class ImportProblem(ValueError):
    """User-facing import problem (message is shown as is)."""


# --- files ---


CATEGORIES_PLACEHOLDER = "{{CATEGORIES}}"


_F = TypeVar("_F", DraftFile, DictionaryFile)

PROMPTS = {"import": "import.md", "wordlist": "wordlist.md", "dialogue": "dialogue.md"}


def render_prompt(db: Session, kind: str = "import") -> str:
    """docs/prompts/<kind>.md after its first '---' line, with the category list inserted —
    for «Скопировать промпт» on the site and for the Claude Code import skill.
    import — textbook pages; wordlist — a plain list of words (no pictures, no draft)."""
    text = (settings.prompts_dir / PROMPTS[kind]).read_text(encoding="utf-8")
    _, _, body = text.partition("\n---\n")
    cats = db.scalars(select(Category).order_by(Category.position, Category.name)).all()
    listing = "\n".join(f"- {c.name}" for c in cats) or "- (список пока пуст)"
    return (body or text).strip().replace(CATEGORIES_PLACEHOLDER, listing) + "\n"


def job_dir(job: ImportJob) -> Path:
    return settings.imports_dir / str(job.id)


def source_pdf(job: ImportJob) -> Path:
    return job_dir(job) / "source.pdf"


def claude_pdf(job: ImportJob) -> Path:
    return job_dir(job) / "claude.pdf"


def pages_pdf(job: ImportJob) -> Path:
    """Selected pages without the grid; bbox coordinates refer to this file."""
    return job_dir(job) / "pages.pdf"


def preview_path(job: ImportJob, page_no: int) -> Path:
    path = job_dir(job) / "previews" / f"p{page_no}.jpg"
    if not path.exists():
        pdf.save_jpeg(pdf.render_page(source_pdf(job), page_no, dpi=40), path, quality=75)
    return path


def page_image_path(job: ImportJob, page_no: int) -> Path:
    """Page of pages.pdf as an image, for the bbox editor."""
    path = job_dir(job) / "pageimg" / f"p{page_no}.jpg"
    if not path.exists():
        pdf.save_jpeg(pdf.render_page(pages_pdf(job), page_no, dpi=110), path)
    return path


def crop_file(job: ImportJob, word: ImportDraftWord) -> Path | None:
    return job_dir(job) / word.image_file if word.image_file else None


def delete_job_files(job: ImportJob) -> None:
    shutil.rmtree(job_dir(job), ignore_errors=True)


# --- steps ---


def save_upload(job: ImportJob, files: list[tuple[str, bytes]]) -> None:
    try:
        count = pdf.uploads_to_pdf(files, source_pdf(job))
    except pdf.ConvertError as e:
        raise ImportProblem(str(e)) from e
    if count > settings.max_import_pages:
        raise ImportProblem(
            f"В файле {count} страниц, максимум {settings.max_import_pages}. Разбейте файл."
        )
    job.has_source_pdf = True
    job.page_count = count
    job.source_filename = ", ".join(name for name, _ in files)[:255]
    job.status = "uploaded"


def select_pages(job: ImportJob, pages: list[int]) -> None:
    pages = list(dict.fromkeys(pages))
    if any(p < 1 or p > job.page_count for p in pages):
        raise ImportProblem("Номер страницы вне файла")
    pdf.extract_pages(source_pdf(job), pages, claude_pdf(job), grid=True)
    pdf.extract_pages(source_pdf(job), pages, pages_pdf(job), grid=False)
    shutil.rmtree(job_dir(job) / "pageimg", ignore_errors=True)
    job.selected_pages = pages
    if job.status == "uploaded":
        job.status = "awaiting_json"


def _validate(data: dict, model: type[_F] = DraftFile) -> _F:  # type: ignore[assignment]
    try:
        return model.model_validate(data)
    except ValidationError as e:
        problems = []
        for err in e.errors()[:5]:
            loc = err["loc"]
            where = f"слово {loc[1] + 1}" if len(loc) > 1 and loc[0] == "words" else "файл"
            field = loc[2] if len(loc) > 2 else (loc[0] if loc else "")
            problems.append(f"{where}, поле {field}: {err['msg']}")
        raise ImportProblem("JSON не подходит: " + "; ".join(problems)) from e


def parse_dictionary_text(text: str) -> DictionaryFile:
    """A dictionary JSON pasted from a chat (the «список слов» prompt), with readable errors."""
    try:
        data = extract_json(text)
    except ValueError as e:
        raise ImportProblem(str(e)) from e
    if not data.get("title"):
        data["title"] = "Новый словарь"
    return _validate(data, DictionaryFile)


def apply_pasted_json(db: Session, job: ImportJob, text: str) -> None:
    try:
        data = extract_json(text)
    except ValueError as e:
        raise ImportProblem(str(e)) from e
    draft = _validate(data)
    n = len(job.selected_pages)
    for i, w in enumerate(draft.words):
        if w.page is not None and w.page > n:
            raise ImportProblem(f"Слово {i + 1} ({w.greek}): страница {w.page}, а в PDF их {n}")
    job.raw_json = text
    _replace_words(db, job, draft)
    for word in job.words:
        recrop(job, word)
    job.status = "review"


def load_package(db: Session, job: ImportJob, data: bytes, filename: str) -> None:
    """Zip with import.json (+ images/, + optional source.pdf). Same format as dictionary export."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as e:
        raise ImportProblem("Это не zip-архив") from e
    with zf:
        names = set(zf.namelist())
        if "import.json" not in names:
            raise ImportProblem("В архиве нет import.json")
        try:
            draft = _validate(extract_json(zf.read("import.json").decode("utf-8")))
        except (UnicodeDecodeError, ValueError) as e:
            raise ImportProblem(str(e)) from e

        job.source_filename = filename[:255]
        if "source.pdf" in names:
            save_upload(job, [("source.pdf", zf.read("source.pdf"))])
            select_pages(job, list(range(1, job.page_count + 1)))

        _replace_words(db, job, draft)
        for word, src in zip(job.words, draft.words, strict=True):
            if src.image_file:
                name = str(PurePosixPath(src.image_file))
                if name not in names or not name.startswith("images/") or ".." in name:
                    raise ImportProblem(f"{src.greek}: в архиве нет файла {src.image_file}")
                rel = f"crops/{word.id}_{secrets.token_hex(4)}.jpg"
                dst = job_dir(job) / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                try:
                    img = Image.open(io.BytesIO(zf.read(name))).convert("RGB")
                except Exception as e:
                    raise ImportProblem(f"{src.greek}: не удалось открыть {name}") from e
                pdf.save_jpeg(img, dst, quality=88)
                word.image_file = rel
            elif job.has_source_pdf:
                recrop(job, word)
    job.title = job.title or draft.title
    job.status = "review"


def _replace_words(db: Session, job: ImportJob, draft: DraftFile) -> None:
    for w in list(job.words):
        drop_crop(job, w)
    job.words.clear()
    db.flush()
    if draft.title and not job.title:
        job.title = draft.title
    for i, w in enumerate(draft.words):
        job.words.append(_draft_word(w, i))
    db.flush()  # ids are needed for crop file names
    assign_categories(db, job.words, [w.category for w in draft.words])


def _fold(text: str) -> str:
    return unicodedata.normalize("NFC", text).strip().casefold()


def known_categories(db: Session, greek_words: list[str]) -> dict[str, int]:
    """Greek word → category it already has in other dictionaries (the most common one)."""
    keys = {_fold(g) for g in greek_words}
    votes: dict[str, dict[int, int]] = {}
    for greek, cat_id in db.execute(
        select(Word.greek, Word.category_id).where(Word.category_id.is_not(None))
    ):
        k = _fold(greek)
        if k in keys:
            votes.setdefault(k, {}).setdefault(cat_id, 0)
            votes[k][cat_id] += 1
    return {k: max(v, key=v.get) for k, v in votes.items()}


def assign_categories(
    db: Session, words: list[ImportDraftWord], claude_names: list[str | None]
) -> None:
    """An already-labelled identical word wins (consistency across dictionaries); otherwise
    Claude's choice — an existing category by name, or a new name kept as a suggestion."""
    by_name = {_fold(c.name): c.id for c in db.scalars(select(Category))}
    known = known_categories(db, [w.greek for w in words])
    for word, name in zip(words, claude_names, strict=True):
        word.category_id, word.category_suggestion, word.category_source = None, None, None
        if (cat_id := known.get(_fold(word.greek))) is not None:
            word.category_id, word.category_source = cat_id, "match"
        elif name:
            if (cat_id := by_name.get(_fold(name))) is not None:
                word.category_id = cat_id
            else:
                word.category_suggestion = name[:60]
            word.category_source = "claude"


def accept_category(db: Session, job: ImportJob, name: str) -> Category:
    """Create (or reuse) the category Claude proposed and give it to every draft word
    that carried this suggestion."""
    key = _fold(name)
    cat = next((c for c in db.scalars(select(Category)) if _fold(c.name) == key), None)
    if cat is None:
        last = db.scalar(select(func.max(Category.position))) or 0
        cat = Category(name=name.strip(), position=last + 1)
        db.add(cat)
        db.flush()
    for w in job.words:
        if w.category_suggestion and _fold(w.category_suggestion) == key:
            w.category_id, w.category_suggestion = cat.id, None
    return cat


def _draft_word(w: DraftWordIn, position: int) -> ImportDraftWord:
    return ImportDraftWord(
        position=position,
        **{f: getattr(w, f) for f in WORD_FIELDS},
        note=w.note,
        page=w.page,
        bbox=w.bbox,
    )


def drop_crop(job: ImportJob, word: ImportDraftWord) -> None:
    path = crop_file(job, word)
    if path:
        path.unlink(missing_ok=True)
    word.image_file = None


def recrop(job: ImportJob, word: ImportDraftWord) -> None:
    """(Re)cut the picture for a draft word from pages.pdf using its page + bbox."""
    drop_crop(job, word)
    if word.bbox is None or word.page is None or not pages_pdf(job).exists():
        return
    if word.page > len(job.selected_pages):
        return
    rel = f"crops/{word.id}_{secrets.token_hex(4)}.jpg"
    pdf.save_jpeg(pdf.crop(pages_pdf(job), word.page, word.bbox), job_dir(job) / rel, quality=88)
    word.image_file = rel


def update_word(job: ImportJob, word: ImportDraftWord, data: dict) -> None:
    geometry_changed = (data["page"], data["bbox"]) != (word.page, word.bbox)
    if "category_id" in data and data["category_id"] != word.category_id:
        # A choice made by hand replaces whatever was suggested.
        word.category_suggestion, word.category_source = None, "manual"
    for field, value in data.items():
        setattr(word, field, value)
    if geometry_changed:
        recrop(job, word)


def _norm(text: str) -> str:
    return unicodedata.normalize("NFC", text).strip().lower()


def duplicates(db: Session, words: list[ImportDraftWord]) -> dict[int, list[str]]:
    """draft word id → titles of dictionaries that already contain the same Greek word."""
    keys = {_norm(w.greek) for w in words}
    found: dict[str, set[str]] = {}
    rows = db.execute(select(Word.greek, Dictionary.title).join(Dictionary))
    for greek, title in rows:
        k = _norm(greek)
        if k in keys:
            found.setdefault(k, set()).add(title)
    return {w.id: sorted(found.get(_norm(w.greek), ())) for w in words}


def publish(
    db: Session, job: ImportJob, title: str, description: str | None, user_id: int
) -> Dictionary:
    chosen = [w for w in job.words if w.include]
    if not chosen:
        raise ImportProblem("Не выбрано ни одного слова")
    d = Dictionary(title=title, description=description, source="import", created_by_id=user_id)
    for i, w in enumerate(chosen):
        word = Word(
            **{f: getattr(w, f) for f in WORD_FIELDS}, category_id=w.category_id, position=i
        )
        crop = crop_file(job, w)
        if crop and crop.exists():
            word.image_path = media.store_image(crop)
            word.image_source = "textbook"
        word.source_page = job.selected_pages[w.page - 1] if w.page and job.selected_pages else None
        d.words.append(word)
    db.add(d)
    db.flush()
    job.dictionary_id = d.id
    job.status = "done"
    return d


def export_package(d: Dictionary) -> bytes:
    """Dictionary → zip (import.json + images/), loadable back through load_package."""
    db = object_session(d)
    names = {c.id: c.name for c in db.scalars(select(Category))} if db else {}
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        words = []
        for i, w in enumerate(d.words):
            item = {f: getattr(w, f) for f in WORD_FIELDS}
            if w.category_id in names:
                item["category"] = names[w.category_id]
            if w.image_path:
                path = settings.media_dir / w.image_path
                if path.exists():
                    name = f"images/{i:03d}.jpg"
                    zf.write(path, name)
                    item["image_file"] = name
            words.append(item)
        payload = {
            "schema_version": 1,
            "title": d.title,
            "description": d.description,
            "words": words,
        }
        zf.writestr("import.json", json.dumps(payload, ensure_ascii=False, indent=1))
    return buf.getvalue()
