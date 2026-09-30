"""Spike 4.0: copy of the sample PDF with a light coordinate grid, to help Claude place bboxes.

Lines every 0.05 of the page, labels 0.1..0.9 on all four edges. The grid does not change
page size, so bbox fractions measured on it apply to the original PDF as is.
Output: docs/samples/A1_Book_27_29_grid.pdf
"""

from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "docs" / "samples" / "A1_Book_27_29.pdf"
DST = ROOT / "docs" / "samples" / "A1_Book_27_29_grid.pdf"

MINOR = (0.55, 0.75, 1.0)  # light blue
MAJOR = (0.1, 0.35, 0.9)
LABEL = (0.85, 0.1, 0.1)


def add_grid(page: pymupdf.Page) -> None:
    w, h = page.rect.width, page.rect.height
    shape = page.new_shape()
    for i in range(1, 20):
        f = i / 20
        major = i % 2 == 0
        color, width = (MAJOR, 0.6) if major else (MINOR, 0.3)
        shape.draw_line((f * w, 0), (f * w, h))
        shape.finish(color=color, width=width, stroke_opacity=0.55 if major else 0.4)
        shape.draw_line((0, f * h), (w, f * h))
        shape.finish(color=color, width=width, stroke_opacity=0.55 if major else 0.4)
    shape.commit(overlay=True)
    for i in range(2, 20, 2):
        f = i / 20
        label = f"{f:.1f}"
        for x, y in ((f * w + 1, 8), (f * w + 1, h - 3)):
            page.insert_text((x, y), label, fontsize=7, color=LABEL)
        for x, y in ((2, f * h - 1), (w - 14, f * h - 1)):
            page.insert_text((x, y), label, fontsize=7, color=LABEL)


def main() -> None:
    doc = pymupdf.open(SRC)
    for page in doc:
        add_grid(page)
    doc.save(DST, garbage=3, deflate=True)
    print(f"{doc.page_count} pages → {DST}")


if __name__ == "__main__":
    main()
