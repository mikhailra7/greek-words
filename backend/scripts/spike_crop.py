"""Spike 4.0: crop pictures from the PDF by `page` + normalized `bbox` and build a contact sheet.

Two variants per word, to compare:
  raw  — exactly the bbox (+2% padding)
  trim — same, then trimmed to the non-background content (auto-crop)
"""

import sys
from pathlib import Path

import pymupdf
from PIL import Image, ImageChops, ImageDraw, ImageFont

from app.services.import_text import extract_json

ROOT = Path(__file__).resolve().parents[2]
PDF = ROOT / "docs" / "samples" / "A1_Book_27_29.pdf"
SPIKE = ROOT / "docs" / "samples" / "spike"
DPI = 200
PAD = 0.02


def render_pages() -> list[Image.Image]:
    doc = pymupdf.open(PDF)
    pages = []
    for page in doc:
        pix = page.get_pixmap(dpi=DPI)
        pages.append(Image.frombytes("RGB", (pix.width, pix.height), pix.samples))
    return pages


def crop(page: Image.Image, bbox: list[float]) -> Image.Image:
    w, h = page.size
    x0, y0, x1, y1 = bbox
    pw, ph = (x1 - x0) * PAD, (y1 - y0) * PAD
    box = (
        max(0, int((x0 - pw) * w)),
        max(0, int((y0 - ph) * h)),
        min(w, int((x1 + pw) * w)),
        min(h, int((y1 + ph) * h)),
    )
    return page.crop(box)


def trim(img: Image.Image, tolerance: int = 40) -> Image.Image:
    """Cut away borders that match the corner colour (paper / card background)."""
    bg = Image.new("RGB", img.size, img.getpixel((2, 2)))
    diff = ImageChops.difference(img, bg).convert("L").point(lambda v: 255 if v > tolerance else 0)
    box = diff.getbbox()
    if not box:
        return img
    m = 6
    return img.crop(
        (
            max(0, box[0] - m),
            max(0, box[1] - m),
            min(img.width, box[2] + m),
            min(img.height, box[3] + m),
        )
    )


def thumb(img: Image.Image, size: int = 220) -> Image.Image:
    canvas = Image.new("RGB", (size, size), "white")
    im = img.copy()
    im.thumbnail((size, size))
    canvas.paste(im, ((size - im.width) // 2, (size - im.height) // 2))
    return canvas


def main() -> None:
    # usage: spike_crop.py [name]  → reads spike/<name>.json, writes crops_<name>/, sheet_<name>.jpg
    name = sys.argv[1] if len(sys.argv) > 1 else "import"
    data = extract_json((SPIKE / f"{name}.json").read_text(encoding="utf-8"))
    pages = render_pages()
    out = SPIKE / f"crops_{name}"
    out.mkdir(exist_ok=True)
    words = [w for w in data["words"] if w["bbox"]]

    cell, label_h, cols = 220, 44, 6
    sheet = Image.new(
        "RGB",
        (cols * (2 * cell + 16), ((len(words) + cols - 1) // cols) * (cell + label_h)),
        "#ddd",
    )
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Unicode.ttf", 18)
    draw = ImageDraw.Draw(sheet)

    for i, w in enumerate(words):
        raw = crop(pages[w["page"] - 1], w["bbox"])
        tr = trim(raw)
        stem = f"{i:02d}_{w['greek']}"
        raw.save(out / f"{stem}_raw.jpg", quality=88)
        tr.save(out / f"{stem}_trim.jpg", quality=88)
        col, row = i % cols, i // cols
        x, y = col * (2 * cell + 16), row * (cell + label_h)
        sheet.paste(thumb(raw), (x, y))
        sheet.paste(thumb(tr), (x + cell + 4, y))
        draw.text(
            (x + 4, y + cell + 6), f"{i:02d} {w['article']} {w['greek']}", fill="black", font=font
        )

    sheet_path = SPIKE / f"sheet_{name}.jpg"
    sheet.save(sheet_path, quality=85)
    print(f"{len(words)} crops → {out}, sheet → {sheet_path} {sheet.size}")


if __name__ == "__main__":
    sys.exit(main())
