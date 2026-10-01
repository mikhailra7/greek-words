from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.dictionary import OptText, Text

MAX_LINE = 300


class DialogueLineIn(BaseModel):
    speaker: Annotated[int, Field(ge=0, le=2)]  # index into `speakers`
    greek: Annotated[Text, Field(min_length=1, max_length=MAX_LINE)]
    transcription: Annotated[Text, Field(max_length=MAX_LINE)] = ""
    translation_ru: Annotated[Text, Field(min_length=1, max_length=MAX_LINE)]
    note: OptText = None

    @model_validator(mode="before")
    @classmethod
    def _null_is_empty(cls, data):
        # Claude writes "transcription": null for a line it couldn't transcribe.
        if isinstance(data, dict) and data.get("transcription") is None:
            data = {**data, "transcription": ""}
        return data


class DialogueFile(BaseModel):
    """Import/export format (SPEC «Диалоги», Д2). `type` tells it from a dictionary file."""

    schema_version: Literal[1] = 1
    type: Literal["dialogue"] = "dialogue"
    title: Annotated[Text, Field(min_length=1, max_length=120)]
    speakers: Annotated[
        list[Annotated[Text, Field(min_length=1, max_length=40)]], Field(min_length=2, max_length=3)
    ]
    lines: Annotated[list[DialogueLineIn], Field(min_length=2, max_length=80)]

    @model_validator(mode="after")
    def _speakers_exist(self) -> "DialogueFile":
        for i, line in enumerate(self.lines):
            if line.speaker >= len(self.speakers):
                raise ValueError(
                    f"реплика {i + 1}: роли с номером {line.speaker} нет "
                    f"(роли нумеруются с 0, всего их {len(self.speakers)})"
                )
        return self


class DialogueLineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    speaker: int
    greek: str
    transcription: str
    translation_ru: str
    note: str | None
    audio_url: str


class DialogueOut(BaseModel):
    id: int
    title: str
    speakers: list[str]
    line_count: int
    can_edit: bool


class DialogueDetailOut(DialogueOut):
    lines: list[DialogueLineOut]
