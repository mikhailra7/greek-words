"""Path 2 of the textbook import: build an import package in Claude Code.

  prepare <file.pdf>          → import_outbox/<name>/pages/pN.png (with coordinate grid) to read
  build   <file.pdf> <json>   → crops + contact sheet for checking + import_outbox/<name>.zip

The zip (import.json + images/ + source.pdf) is uploaded on the site: Словари → Импорт
из учебника → «Загрузить архив». `page` in the JSON is the page number of <file.pdf>.
See .claude/skills/import-textbook/SKILL.md.
"""

import argparse
import json
import sys
import zipfile
from pathlib import Path

import pymupdf
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schemas.importing import DraftFile  # noqa: E402
from app.services import pdf  # noqa: E402
from app.services.import_text import extract_json  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUTBOX = ROOT / "import_outbox"
FONT = "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"


def workdir(src: Path) -> Path:
    return OUTBOX / src.stem


def prepare(src: Path) -> None:
    wd = workdir(src)
    n = pymupdf.open(src).page_count
    pages = list(range(1, n + 1))
    pdf.extract_pages(src, pages, wd / "grid.pdf", grid=True)
    pdf.extract_pages(src, pages, wd / "pages.pdf", grid=False)
    for p in pages:
        pdf.save_jpeg(pdf.render_page(wd / "grid.pdf", p, dpi=150), wd / "pages" / f"p{p}.jpg", 90)
    print(f"{n} pages → {wd / 'pages'}  (read them, then write {wd / 'import.json'})")


def build(src: Path, json_path: Path) -> None:
    wd = workdir(src)
    clean = wd / "pages.pdf"
    if not clean.exists():
        prepare(src)
    data = extract_json(json_path.read_text(encoding="utf-8"))
    draft = DraftFile.model_validate(data)  # fail early with pydantic's message

    words = []
    crops: list[tuple[str, Image.Image]] = []
    labels: list[tuple[str, Image.Image]] = []
    for i, w in enumerate(draft.words):
        item = w.model_dump(exclude={"image_file"}, exclude_none=True)
        if w.page and w.bbox:
            img = pdf.crop(clean, w.page, w.bbox)
            name = f"images/{i:03d}.jpg"
            item["image_file"] = name
            crops.append((name, img))
            labels.append((f"{i:02d} {w.article or ''} {w.greek}", img))
        words.append(item)
    contact_sheet(labels).save(wd / "sheet.jpg", quality=85)

    out = OUTBOX / f"{src.stem}.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        payload = {**data, "words": words}
        zf.writestr("import.json", json.dumps(payload, ensure_ascii=False, indent=1))
        zf.write(clean, "source.pdf")
        for name, img in crops:
            buf = wd / name
            pdf.save_jpeg(img, buf, quality=88)
            zf.write(buf, name)
    print(f"{len(words)} words, {len(crops)} pictures → {out}\ncheck: {wd / 'sheet.jpg'}")


def contact_sheet(items: list[tuple[str, Image.Image]], cell: int = 220, cols: int = 8):
    label = 40
    rows = max(1, (len(items) + cols - 1) // cols)
    sheet = Image.new("RGB", (cols * (cell + 8), rows * (cell + label)), "#ddd")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.truetype(FONT, 17) if Path(FONT).exists() else None
    for i, (text, img) in enumerate(items):
        x, y = (i % cols) * (cell + 8), (i // cols) * (cell + label)
        tile = Image.new("RGB", (cell, cell), "white")
        im = img.copy()
        im.thumbnail((cell, cell))
        tile.paste(im, ((cell - im.width) // 2, (cell - im.height) // 2))
        sheet.paste(tile, (x, y))
        draw.text((x + 3, y + cell + 6), text, fill="black", font=font)
    return sheet


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("pdf", type=Path)
    b = sub.add_parser("build")
    b.add_argument("pdf", type=Path)
    b.add_argument("json", type=Path)
    args = ap.parse_args()
    if args.cmd == "prepare":
        prepare(args.pdf)
    else:
        build(args.pdf, args.json)


if __name__ == "__main__":
    main()
