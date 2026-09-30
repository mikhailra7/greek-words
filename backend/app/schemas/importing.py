from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

from app.schemas.dictionary import OptText, Text, WordIn, _clean_optional


def _check_bbox(value: list[float] | None) -> list[float] | None:
    if value is None:
        return None
    if len(value) != 4:
        raise ValueError("рамка должна быть из 4 чисел")
    x0, y0, x1, y1 = (min(1.0, max(0.0, float(v))) for v in value)
    if x1 - x0 < 0.005 or y1 - y0 < 0.005:
        raise ValueError("рамка пустая или перевёрнута")
    return [round(v, 4) for v in (x0, y0, x1, y1)]


BBox = Annotated[list[float] | None, AfterValidator(_check_bbox)]


class DraftWordIn(WordIn):
    """A word as produced by Claude (path 1) or found in an import package (path 2)."""

    page: int | None = Field(default=None, ge=1)
    bbox: BBox = None
    note: OptText = None
    # Package only: picture file inside the zip, e.g. "images/012.jpg".
    image_file: str | None = None
    # Category *name* (from the list in the prompt, or a new one Claude proposes).
    category: Annotated[
        Annotated[str, Field(max_length=60)] | None, AfterValidator(_clean_optional)
    ] = None


class DraftFile(BaseModel):
    schema_version: Literal[1] = 1
    title: Annotated[Text, Field(max_length=120)] = ""
    description: OptText = None
    words: Annotated[list[DraftWordIn], Field(min_length=1, max_length=500)]


class DraftWordUpdate(WordIn):
    include: bool = True
    note: OptText = None
    page: int | None = Field(default=None, ge=1)
    bbox: BBox = None

    @model_validator(mode="after")
    def _bbox_needs_page(self):
        if self.bbox is not None and self.page is None:
            raise ValueError("для рамки нужен номер страницы")
        return self


class DraftWordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    position: int
    include: bool
    article: str | None
    greek: str
    full_greek: str
    transcription: str
    translations_ru: list[str]
    part_of_speech: str | None
    example_gr: str | None
    example_ru: str | None
    image_emoji: str | None
    image_query: str | None = None
    category_id: int | None = None
    category_suggestion: str | None = None
    category_source: str | None = None
    note: str | None
    page: int | None
    bbox: list[float] | None
    image_url: str | None = None
    duplicates: list[str] = []


class ImportJobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    mode: str
    status: str
    title: str
    source_filename: str
    has_source_pdf: bool
    page_count: int
    selected_pages: list[int]
    dictionary_id: int | None
    created_at: datetime
    word_count: int = 0


class ImportJobDetailOut(ImportJobOut):
    words: list[DraftWordOut] = []
    claude_pages: int = 0


class SelectPagesIn(BaseModel):
    pages: Annotated[list[int], Field(min_length=1)]


class PasteJsonIn(BaseModel):
    text: Annotated[str, Field(min_length=1, max_length=2_000_000)]


class AcceptCategoryIn(BaseModel):
    name: Annotated[Text, Field(min_length=1, max_length=60)]


class PublishIn(BaseModel):
    title: Annotated[Text, Field(min_length=1, max_length=120)]
    description: OptText = None
