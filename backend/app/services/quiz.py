"""«Переведи слово» and «Микс заданий»: choice questions with one right option and up to
three distractors; task types for the mix."""

import random
from dataclasses import dataclass
from typing import Literal

from app.models import Word
from app.services.lookalikes import lookalikes

Direction = Literal["ru_gr", "gr_ru"]
TaskType = Literal["ru_gr", "gr_ru", "write"]
TASK_TYPES: tuple[TaskType, ...] = ("ru_gr", "gr_ru", "write")
OPTIONS = 4


@dataclass
class Option:
    word_id: int
    text: str


@dataclass
class Question:
    word: Word
    options: list[Option]  # shuffled; the right one has word_id == word.id


def option_text(word: Word, direction: Direction) -> str:
    """What the learner picks: Greek in RU→GR, the Russian translations in GR→RU."""
    return word.full_greek if direction == "ru_gr" else ", ".join(word.translations_ru)


def _meanings(word: Word) -> set[str]:
    return {t.strip().lower() for t in word.translations_ru}


def distractors(
    target: Word, pool: list[Word], direction: Direction, rng: random.Random
) -> list[Word]:
    """Up to 3 other words that can't be mistaken for a right answer.

    Excluded: words sharing any translation with the target (both would be "right"),
    and words whose option text would duplicate another option. Same part of speech first,
    so the answer can't be guessed from the grammar alone.
    """
    seen_texts = {option_text(target, direction).lower()}
    target_meanings = _meanings(target)
    candidates = [
        w
        for w in pool
        if w.id != target.id
        and not (_meanings(w) & target_meanings)
        and w.full_greek.lower() != target.full_greek.lower()
    ]
    rng.shuffle(candidates)
    same = [
        w for w in candidates if target.part_of_speech and w.part_of_speech == target.part_of_speech
    ]
    rest = [w for w in candidates if w not in same]

    chosen: list[Word] = []
    for w in same + rest:
        text = option_text(w, direction).lower()
        if text in seen_texts:
            continue
        seen_texts.add(text)
        chosen.append(w)
        if len(chosen) == OPTIONS - 1:
            break
    return chosen


def build_questions(
    words: list[Word], pool: list[Word], direction: Direction, rng: random.Random | None = None
) -> list[Question]:
    rng = rng or random.Random()
    questions = []
    for w in words:
        opts = [w, *distractors(w, pool, direction, rng)]
        rng.shuffle(opts)
        questions.append(
            Question(word=w, options=[Option(o.id, option_text(o, direction)) for o in opts])
        )
    return questions


def mix_types(count: int, rng: random.Random | None = None) -> list[TaskType]:
    """Task types for «Микс»: as even as possible (counts differ by at most one), random order."""
    rng = rng or random.Random()
    extra = list(TASK_TYPES)
    rng.shuffle(extra)  # which types get the leftover slots
    types = [*TASK_TYPES * (count // len(TASK_TYPES)), *extra[: count % len(TASK_TYPES)]]
    rng.shuffle(types)
    return types


def build_hard_questions(
    words: list[Word], pool: list[Word], rng: random.Random | None = None
) -> list[Question]:
    """Hard RU→GR: the wrong options are near-copies of the right answer (wrong article,
    accent, letter — services/lookalikes). They have no word of their own, so they get
    negative ids. Short words with fewer look-alikes are topped up with ordinary options."""
    rng = rng or random.Random()
    questions = []
    for w in words:
        texts = lookalikes(w.article, w.greek, rng)
        options = [Option(w.id, w.full_greek)]
        options += [Option(-(k + 1), t) for k, t in enumerate(texts)]
        if len(options) < OPTIONS:
            taken = {o.text for o in options}
            extra = [d for d in distractors(w, pool, "ru_gr", rng) if d.full_greek not in taken]
            options += [Option(d.id, d.full_greek) for d in extra[: OPTIONS - len(options)]]
        rng.shuffle(options)
        questions.append(Question(word=w, options=options))
    return questions
