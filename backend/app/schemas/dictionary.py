import unicodedata
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from app.models.dictionary import ARTICLES, PARTS_OF_SPEECH


def clean_text(value: str) -> str:
    """NFC + trimmed + single spaces. NFC matters: 'ό' can arrive as one or two code points."""
    return " ".join(unicodedata.normalize("NFC", value).split())


def _clean_optional(value: str | None) -> str | None:
    if value is None:
        return None
    value = clean_text(value)
    return value or None


Text = Annotated[str, AfterValidator(clean_text)]
OptText = Annotated[str | None, AfterValidator(_clean_optional)]
Article = Literal[ARTICLES]  # type: ignore[valid-type]
PartOfSpeech = Literal[PARTS_OF_SPEECH]  # type: ignore[valid-type]


def _clean_translations(values: list[str]) -> list[str]:
    cleaned = [clean_text(v) for v in values]
    cleaned = [v for v in dict.fromkeys(cleaned) if v]
    if not 1 <= len(cleaned) <= 3:
        raise ValueError("нужно от 1 до 3 переводов")
    if any(len(v) > 100 for v in cleaned):
        raise ValueError("перевод длиннее 100 символов")
    return cleaned


class WordIn(BaseModel):
    article: Article | None = None
    greek: Annotated[Text, Field(min_length=1, max_length=120)]
    transcription: Annotated[Text, Field(max_length=160)] = ""
    translations_ru: Annotated[list[str], AfterValidator(_clean_translations)]
    part_of_speech: PartOfSpeech | None = None
    example_gr: OptText = None
    example_ru: OptText = None
    image_emoji: Annotated[
        Annotated[str, Field(max_length=16)] | None, AfterValidator(_clean_optional)
    ] = None
    category_id: int | None = None
    # English keyword for the stock picture search (Claude fills it on import).
    image_query: Annotated[
        Annotated[str, Field(max_length=80)] | None, AfterValidator(_clean_optional)
    ] = None


class WordCategoryIn(BaseModel):
    category_id: int | None


class WordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    dictionary_id: int
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
    image_url: str | None = None
    image_credit: str | None = None
    audio_url: str | None = None
    audio_ru_url: str | None = None
    position: int
    known: bool = False  # per user: «Я знаю это слово»


class DictionaryIn(BaseModel):
    title: Annotated[Text, Field(min_length=1, max_length=120)]
    description: OptText = None


class DictionaryPatch(BaseModel):
    title: Annotated[Text, Field(min_length=1, max_length=120)] | None = None
    description: OptText = None
    is_published: bool | None = None


class DictionaryOut(BaseModel):
    id: int
    title: str
    description: str | None
    source: str
    is_published: bool
    word_count: int
    is_active: bool
    can_edit: bool


class DictionaryDetailOut(DictionaryOut):
    words: list[WordOut]


class ActiveSummary(BaseModel):
    dictionaries: int
    categories: int = 0
    words: int
    known: int = 0  # of `words`, how many the user marked as known


class DictionaryListOut(BaseModel):
    dictionaries: list[DictionaryOut]
    active: ActiveSummary


class ActiveIn(BaseModel):
    active: bool


class DictionaryFile(BaseModel):
    """Import/export format. Stage 4 (textbook import) produces the same `words` shape."""

    schema_version: Literal[1] = 1
    title: Annotated[Text, Field(min_length=1, max_length=120)]
    description: OptText = None
    words: list[WordIn]
