from typing import Annotated

from pydantic import AfterValidator, BaseModel, Field

from app.schemas.dictionary import Text, WordOut, _clean_optional


class CategoryIn(BaseModel):
    name: Annotated[Text, Field(min_length=1, max_length=60)]
    emoji: Annotated[
        Annotated[str, Field(max_length=16)] | None, AfterValidator(_clean_optional)
    ] = None


class CategoryPatch(BaseModel):
    name: Annotated[Text, Field(min_length=1, max_length=60)] | None = None
    emoji: Annotated[
        Annotated[str, Field(max_length=16)] | None, AfterValidator(_clean_optional)
    ] = None
    position: int | None = None


class CategoryOut(BaseModel):
    id: int
    name: str
    emoji: str | None
    position: int
    word_count: int
    is_active: bool
    can_edit: bool
    author: str | None = None  # username of who made it


class CategoryWordOut(WordOut):
    dictionary_title: str


class CategoryDetailOut(CategoryOut):
    words: list[CategoryWordOut]
