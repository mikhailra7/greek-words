"""«Напиши»: compare a typed Greek answer with the right spelling.

Rules (SPEC 2.6): case and extra spaces don't matter; accents (τόνος) do; ς and σ are
different letters; the article is part of the answer. A few near-misses get a hint so the
learner sees *why* it's wrong.
"""

import difflib
import re
import unicodedata
from dataclasses import dataclass, field

_LATIN = re.compile(r"[A-Za-z]")


def normalize(text: str) -> str:
    # str.lower() applies the Greek final-sigma rule: "ΟΔΟΣ" → "οδος" (ς at the end).
    return " ".join(unicodedata.normalize("NFC", text).split()).lower()


def _strip_accents(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text)
    return unicodedata.normalize(
        "NFC", "".join(c for c in decomposed if not unicodedata.combining(c))
    )


@dataclass
class Segment:
    text: str
    ok: bool


@dataclass
class CheckResult:
    correct: bool
    expected: str
    hint: str | None = None
    # Answer split into matching / wrong parts, and the right spelling split into
    # matching / missed parts — for highlighting.
    given_segments: list[Segment] = field(default_factory=list)
    expected_segments: list[Segment] = field(default_factory=list)


def _hint(given: str, expected: str, article: str | None) -> str | None:
    if _LATIN.search(given):
        return "Похоже, часть букв набрана латиницей — переключите клавиатуру на греческую"
    if _strip_accents(given) == _strip_accents(expected):
        return "Почти: проверьте ударение"
    if given.replace("ς", "σ") == expected.replace("ς", "σ"):
        return "Почти: в конце слова пишется ς, в середине — σ"
    if article:
        word = expected.removeprefix(f"{article} ")
        if given == word:
            return f"Не забудьте артикль: {article}"
        parts = given.split(" ", 1)
        if len(parts) == 2 and parts[1] == word:
            return f"Артикль другой: {article}"
    return None


def _segments(given: str, expected: str) -> tuple[list[Segment], list[Segment]]:
    g_out: list[Segment] = []
    e_out: list[Segment] = []
    matcher = difflib.SequenceMatcher(a=given, b=expected, autojunk=False)
    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        ok = op == "equal"
        if i2 > i1:
            g_out.append(Segment(given[i1:i2], ok))
        if j2 > j1:
            e_out.append(Segment(expected[j1:j2], ok))
    return g_out, e_out


def check(answer: str, expected_display: str, article: str | None) -> CheckResult:
    given = normalize(answer)
    expected = normalize(expected_display)
    if given == expected:
        return CheckResult(
            correct=True,
            expected=expected_display,
            given_segments=[Segment(answer.strip(), True)],
            expected_segments=[Segment(expected_display, True)],
        )
    g, e = _segments(given, expected)
    return CheckResult(
        correct=False,
        expected=expected_display,
        hint=_hint(given, expected, article),
        given_segments=g,
        expected_segments=e,
    )
