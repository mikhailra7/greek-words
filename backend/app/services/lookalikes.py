"""Hard mode of «Переведи» (RU→GR): wrong options that look almost like the right answer —
one wrong letter, a misplaced accent, a wrong article.

Generated on the fly from the word itself, so every dictionary gets them for free and they
differ from session to session. Mistakes are the ones learners actually make: letters that
sound the same (ο/ω, ι/η/υ/ει/οι, ε/αι), double vs single consonants.
"""

import random
import unicodedata
from dataclasses import dataclass

ACUTE = "́"
DIAERESIS = "̈"
VOWELS = set("αεηιουω")
# Two letters read as one vowel sound: the accent goes on the second one (αί, εί, ού, αύ…).
DIGRAPHS = {"αι", "ει", "οι", "ου", "υι", "αυ", "ευ"}

# Same sound, different spelling — the classic spelling mistakes.
SOUND_GROUPS = [["ι", "η", "υ", "ει", "οι"], ["ο", "ω"], ["ε", "αι"]]
SAME_SOUND = {g: [x for x in group if x != g] for group in SOUND_GROUPS for g in group}
DOUBLE = set("λμνπρστκ")  # consonants that are written double in some words
TYPOS = {
    "γ": "χ", "χ": "γ", "δ": "θ", "θ": "δ", "β": "φ", "φ": "β",
    "σ": "ζ", "ζ": "σ", "κ": "χ", "μ": "ν", "ν": "μ", "λ": "ρ", "ρ": "λ",
}  # fmt: skip
ARTICLE_GROUPS = [["ο", "η", "το"], ["οι", "τα"]]


@dataclass
class Letter:
    base: str  # lowercase letter without marks
    upper: bool
    acute: bool
    dia: bool

    def text(self) -> str:
        s = self.base.upper() if self.upper else self.base
        return unicodedata.normalize(
            "NFC", s + (DIAERESIS if self.dia else "") + (ACUTE if self.acute else "")
        )


def _letters(word: str) -> list[Letter]:
    out: list[Letter] = []
    for ch in unicodedata.normalize("NFD", word):
        if ch in (ACUTE, DIAERESIS) and out:
            if ch == ACUTE:
                out[-1].acute = True
            else:
                out[-1].dia = True
            continue
        out.append(Letter(ch.lower(), ch.isupper(), False, False))
    return out


def _join(letters: list[Letter]) -> str:
    text = "".join(x.text() for x in letters)
    return _fix_sigma(text)


def _fix_sigma(text: str) -> str:
    """σ at the end of a word is ς, ς inside a word is σ (after a letter was swapped)."""
    chars = list(text)
    for i, ch in enumerate(chars):
        at_end = i + 1 == len(chars) or not chars[i + 1].isalpha()
        if ch == "σ" and at_end:
            chars[i] = "ς"
        elif ch == "ς" and not at_end:
            chars[i] = "σ"
    return "".join(chars)


def _graphemes(letters: list[Letter]) -> list[tuple[int, int]]:
    """Spans [start, end) of vowel sounds: single vowels and digraphs (not split by ¨)."""
    spans, i = [], 0
    while i < len(letters):
        if letters[i].base not in VOWELS:
            i += 1
            continue
        pair = letters[i].base + (letters[i + 1].base if i + 1 < len(letters) else "")
        if pair in DIGRAPHS and not letters[i + 1].dia:
            spans.append((i, i + 2))
            i += 2
        else:
            spans.append((i, i + 1))
            i += 1
    return spans


def wrong_accents(word: str) -> list[str]:
    """Every spelling with the accent moved to a neighbouring vowel of the same word (digraphs
    count as one vowel). Empty when no word in `word` has an accent and a second vowel."""
    tokens = word.split(" ")
    out = []
    for t, token in enumerate(tokens):
        spans = _graphemes(_letters(token))
        letters = _letters(token)
        accented = [n for n, (a, b) in enumerate(spans) if any(x.acute for x in letters[a:b])]
        if not accented or len(spans) < 2:
            continue
        cur = accented[0]
        for target in (cur - 1, cur + 1):
            if not 0 <= target < len(spans):
                continue
            moved = _letters(token)
            for x in moved:
                x.acute = False
            moved[spans[target][1] - 1].acute = True  # on the second letter of a digraph
            out.append(" ".join(tokens[:t] + [_join(moved)] + tokens[t + 1 :]))
    return list(dict.fromkeys(v for v in out if v != word))


def wrong_accent(word: str, rng: random.Random) -> str | None:
    """One of `wrong_accents`, or None."""
    options = wrong_accents(word)
    return rng.choice(options) if options else None


def wrong_letters(word: str) -> tuple[list[str], list[str]]:
    """One-mistake spellings: (believable — same-sound vowels, double/single consonants;
    typos — a neighbouring-sound consonant). No duplicates, never `word` itself."""
    tokens = word.split(" ")
    sound, double, typo = [], [], []

    def emit(bucket: list[str], t: int, letters: list[Letter]) -> None:
        variant = tokens[:t] + [_join(letters)] + tokens[t + 1 :]
        bucket.append(" ".join(variant))

    for t, token in enumerate(tokens):
        letters = _letters(token)
        # Vowel sounds written another way; the accent stays on the (new) vowel.
        for a, b in _graphemes(letters):
            spelled = "".join(x.base for x in letters[a:b])
            accent = any(x.acute for x in letters[a:b])
            upper = letters[a].upper
            for repl in SAME_SOUND.get(spelled, []):
                new = [Letter(c, upper and k == 0, False, False) for k, c in enumerate(repl)]
                new[-1].acute = accent
                emit(sound, t, letters[:a] + new + letters[b:])
        for i, x in enumerate(letters):
            nxt = letters[i + 1] if i + 1 < len(letters) else None
            if x.base in DOUBLE and nxt and nxt.base == x.base:  # λλ → λ
                emit(double, t, letters[:i] + letters[i + 1 :])
            elif (
                x.base in DOUBLE
                and 0 < i < len(letters) - 1
                and letters[i - 1].base in VOWELS
                and nxt
                and nxt.base in VOWELS
            ):  # λ between vowels → λλ
                emit(double, t, letters[:i] + [Letter(x.base, False, False, False)] + letters[i:])
            if x.base in TYPOS:
                emit(typo, t, letters[:i] + [Letter(TYPOS[x.base], x.upper, False, False)]
                     + letters[i + 1 :])  # fmt: skip
    seen: set[str] = {word}

    def unique(items: list[str]) -> list[str]:
        out = []
        for v in items:
            if v not in seen:
                seen.add(v)
                out.append(v)
        return out

    return unique(sound + double), unique(typo)


def wrong_articles(article: str | None) -> list[str]:
    """The other articles of the same number (ο/η/το, οι/τα)."""
    for group in ARTICLE_GROUPS:
        if article in group:
            return [a for a in group if a != article]
    return []


def wrong_article(article: str | None, rng: random.Random) -> str | None:
    options = wrong_articles(article)
    return rng.choice(options) if options else None


def lookalikes(article: str | None, greek: str, rng: random.Random | None = None) -> list[str]:
    """Up to 3 wrong full forms («το νερό» style). Each one gets a random kind of mistake
    among those the word allows — another article, the accent on a neighbouring vowel, a wrong
    letter — so it can be three letters, or two accents and an article (2026-10-04; it was
    one of each). Letters: same-sound mistakes first, typos only when those run out."""
    rng = rng or random.Random()

    def full(art: str | None, g: str) -> str:
        return f"{art} {g}" if art else g

    believable, typos = wrong_letters(greek)
    rng.shuffle(believable)
    rng.shuffle(typos)
    pools = {
        "article": [
            full(a, greek)
            for a in rng.sample(wrong_articles(article), k=len(wrong_articles(article)))
        ],
        "accent": [
            full(article, v) for v in rng.sample(wrong_accents(greek), k=len(wrong_accents(greek)))
        ],
        "letter": [full(article, v) for v in believable + typos],
    }
    right = full(article, greek)
    out: list[str] = []
    while len(out) < 3:
        kinds = [k for k, pool in pools.items() if pool]
        if not kinds:
            break  # a very short word: the caller adds ordinary options
        v = pools[rng.choice(kinds)].pop(0)
        if v != right and v not in out:
            out.append(v)
    return out
