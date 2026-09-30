import pytest

from app.services.import_text import extract_json

OBJ = '{"schema_version": 1, "title": "t", "words": []}'


@pytest.mark.parametrize(
    "text",
    [
        OBJ,
        f"```json\n{OBJ}\n```",
        f"```\n{OBJ}\n```",
        f"Вот результат:\n```json\n{OBJ}\n```\nГотово!",
        f"Вот результат: {OBJ} надеюсь, помог",
        f"﻿  {OBJ}  ",
    ],
)
def test_extracts_object(text):
    assert extract_json(text)["title"] == "t"


@pytest.mark.parametrize("text", ["", "просто текст", '{"a": 1,', "[1, 2]"])
def test_rejects_garbage(text):
    with pytest.raises(ValueError):
        extract_json(text)
