"""PDF helpers for textbook import: normalize uploads to PDF, grid overlay for Claude, cropping."""

import shutil
import subprocess
import tempfile
from functools import lru_cache
from io import BytesIO
from pathlib import Path

import pymupdf
from PIL import Image

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
DOC_EXTS = {".doc", ".docx", ".odt"}

CROP_DPI = 200
CROP_PAD = 0.02  # of bbox size, on each side
CROP_MAX_SIDE = 900


class ConvertError(ValueError):
    pass


def uploads_to_pdf(files: list[tuple[str, bytes]], dst: Path) -> int:
    """Save uploads as one PDF. Accepts one PDF, one DOC/DOCX, or one or more images.

    Returns the page count. Raises ConvertError with a user-facing message.
    """
    if not files:
        raise ConvertError("Файл не выбран")
    exts = [Path(name).suffix.lower() for name, _ in files]

    if len(files) == 1 and exts[0] == ".pdf":
        doc = _open_pdf(files[0][1])
    elif len(files) == 1 and exts[0] in DOC_EXTS:
        doc = _open_pdf(_doc_to_pdf(files[0]))
    elif all(e in IMAGE_EXTS for e in exts):
        doc = pymupdf.open()
        for name, data in files:
            doc.insert_pdf(_image_to_pdf(name, data))
    else:
        raise ConvertError(
            "Поддерживаются: один PDF, один DOC/DOCX или несколько фото (JPG, PNG, WEBP)"
        )

    if doc.page_count == 0:
        raise ConvertError("В файле нет страниц")
    dst.parent.mkdir(parents=True, exist_ok=True)
    doc.save(dst, garbage=3, deflate=True)
    return doc.page_count


def _open_pdf(data: bytes) -> pymupdf.Document:
    try:
        return pymupdf.open(stream=data, filetype="pdf")
    except Exception as e:
        raise ConvertError("Не удалось открыть PDF: файл повреждён или защищён паролем") from e


def _image_to_pdf(name: str, data: bytes) -> pymupdf.Document:
    try:
        img = Image.open(BytesIO(data))
        img = img.convert("RGB")
    except Exception as e:
        raise ConvertError(f"Не удалось открыть картинку {name}") from e
    buf = BytesIO()
    img.save(buf, "JPEG", quality=90)
    # A4-ish page at the image's aspect ratio.
    w, h = img.size
    page_w = 595
    page_h = page_w * h / w
    doc = pymupdf.open()
    page = doc.new_page(width=page_w, height=page_h)
    page.insert_image(page.rect, stream=buf.getvalue())
    return doc


def _doc_to_pdf(file: tuple[str, bytes]) -> bytes:
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        raise ConvertError(
            "DOC/DOCX пока не поддерживается на этом сервере (нет LibreOffice). "
            "Сохраните документ как PDF и загрузите его."
        )
    name, data = file
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / Path(name).name
        src.write_bytes(data)
        subprocess.run(
            [soffice, "--headless", "--convert-to", "pdf", "--outdir", tmp, str(src)],
            check=True,
            capture_output=True,
            timeout=120,
        )
        out = src.with_suffix(".pdf")
        if not out.exists():
            raise ConvertError("LibreOffice не смог сконвертировать документ")
        return out.read_bytes()


def render_page(pdf: Path, page_no: int, dpi: int) -> Image.Image:
    """page_no is 1-based. Returns a copy, safe to modify."""
    return _render_cached(str(pdf), pdf.stat().st_mtime_ns, page_no, dpi).copy()


@lru_cache(maxsize=6)
def _render_cached(pdf: str, _mtime: int, page_no: int, dpi: int) -> Image.Image:
    # Cutting 60 pictures from 4 pages should render 4 pages, not 60.
    with pymupdf.open(pdf) as doc:
        pix = doc[page_no - 1].get_pixmap(dpi=dpi)
        return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def save_jpeg(img: Image.Image, dst: Path, quality: int = 85) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    img.save(dst, "JPEG", quality=quality)


def crop(pdf: Path, page_no: int, bbox: list[float]) -> Image.Image:
    page = render_page(pdf, page_no, CROP_DPI)
    w, h = page.size
    x0, y0, x1, y1 = bbox
    pw, ph = (x1 - x0) * CROP_PAD, (y1 - y0) * CROP_PAD
    img = page.crop(
        (
            max(0, int((x0 - pw) * w)),
            max(0, int((y0 - ph) * h)),
            min(w, int((x1 + pw) * w)),
            min(h, int((y1 + ph) * h)),
        )
    )
    img.thumbnail((CROP_MAX_SIDE, CROP_MAX_SIDE))
    return img


# --- coordinate grid for Claude (see docs/prompts/import.md) ---

_MINOR = (0.55, 0.75, 1.0)
_MAJOR = (0.1, 0.35, 0.9)
_LABEL = (0.85, 0.1, 0.1)


def _add_grid(page: pymupdf.Page) -> None:
    w, h = page.rect.width, page.rect.height
    shape = page.new_shape()
    for i in range(1, 20):
        f = i / 20
        major = i % 2 == 0
        color, width, opacity = (_MAJOR, 0.6, 0.55) if major else (_MINOR, 0.3, 0.4)
        shape.draw_line((f * w, 0), (f * w, h))
        shape.finish(color=color, width=width, stroke_opacity=opacity)
        shape.draw_line((0, f * h), (w, f * h))
        shape.finish(color=color, width=width, stroke_opacity=opacity)
    shape.commit(overlay=True)
    for i in range(2, 20, 2):
        f = i / 20
        label = f"{f:.1f}"
        for x, y in ((f * w + 1, 8), (f * w + 1, h - 3), (2, f * h - 1), (w - 14, f * h - 1)):
            page.insert_text((x, y), label, fontsize=7, color=_LABEL)


def extract_pages(src: Path, pages: list[int], dst: Path, grid: bool) -> None:
    """Selected pages (1-based, in order) as one PDF, rotation normalized.

    Built twice per import: with the grid for Claude, and without it for cropping — so page
    numbers and coordinates match exactly between the two.
    """
    with pymupdf.open(src) as source:
        out = pymupdf.open()
        for p in pages:
            out.insert_pdf(source, from_page=p - 1, to_page=p - 1)
        for page in out:
            page.remove_rotation()
            if grid:
                _add_grid(page)
        dst.parent.mkdir(parents=True, exist_ok=True)
        out.save(dst, garbage=3, deflate=True)
