"""Helpers for JSON pasted from a chat: tolerate ```json fences and chatter around the object."""

import json
import re

_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)


def extract_json(text: str) -> dict:
    """Return the JSON object from pasted text.

    Accepts a bare object, an object inside a ```json fence, or an object with text
    before/after it. Raises ValueError with a readable Russian message otherwise.
    """
    text = text.strip().lstrip("﻿")
    fenced = _FENCE.search(text)
    if fenced:
        text = fenced.group(1).strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("Не нашёл JSON: нужен текст, начинающийся с { и заканчивающийся }")
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError as e:
        raise ValueError(
            f"JSON повреждён (строка {e.lineno}, позиция {e.colno}). "
            "Скопируйте ответ Claude целиком ещё раз."
        ) from e
    if not isinstance(data, dict):
        raise ValueError("Ожидался JSON-объект со словами")
    return data
