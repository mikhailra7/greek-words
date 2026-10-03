import random
import unicodedata

import pytest

from app.services.lookalikes import lookalikes, wrong_accent, wrong_article, wrong_letters

ACUTE = "́"


def accent_pos(word: str) -> int:
    return unicodedata.normalize("NFD", word).index(ACUTE)


def base(word: str) -> str:
    return unicodedata.normalize("NFD", word).replace(ACUTE, "")


def kind(variant: str, article: str | None, greek: str) -> str:
    """Which single mistake a variant has: article / accent / letter."""
    art, word = variant.split(" ", 1) if article else (None, variant)
    if art != article:
        assert word == greek, variant  # only the article differs
        return "article"
    assert word != greek
    return "accent" if base(word) == base(greek) else "letter"


@pytest.mark.parametrize("seed", range(30))
def test_noun_three_variants_each_with_one_mistake(seed):
    out = lookalikes("η", "γυναίκα", random.Random(seed))
    assert len(out) == 3 and len(set(out)) == 3 and "η γυναίκα" not in out
    for v in out:
        kind(v, "η", "γυναίκα")  # exactly one kind of mistake each


def test_kinds_are_mixed_at_random():
    """Not one of each any more: any mix the word allows — three letters, two articles, two
    accents — turns up."""
    combos = set()
    for seed in range(300):
        out = lookalikes("η", "γυναίκα", random.Random(seed))
        combos.add(tuple(sorted(kind(v, "η", "γυναίκα") for v in out)))
    assert ("letter", "letter", "letter") in combos
    assert any(c.count("article") == 2 for c in combos)  # ο γυναίκα and το γυναίκα
    assert any(c.count("accent") == 2 for c in combos)  # γύναικα and γυναικά
    assert ("accent", "article", "letter") in combos  # the old fixed mix is still possible


def test_plural_article_stays_plural():
    for seed in range(10):
        assert wrong_article("τα", random.Random(seed)) == "οι"
        assert wrong_article("οι", random.Random(seed)) == "τα"
    assert wrong_article(None, random.Random()) is None


def test_no_article_no_article_mistakes():
    for seed in range(20):
        out = lookalikes(None, "πίνω", random.Random(seed))
        assert len(out) == 3 and "πίνω" not in out
        assert {kind(v, None, "πίνω") for v in out} <= {"accent", "letter"}


def test_one_vowel_no_accent_mistakes():
    for seed in range(20):
        out = lookalikes("το", "φως", random.Random(seed))
        assert len(out) == 3
        assert {kind(v, "το", "φως") for v in out} <= {"article", "letter"}
    assert wrong_accent("φως", random.Random()) is None
    assert wrong_accent("πώς", random.Random()) is None  # one vowel sound


def test_accent_moves_to_a_neighbouring_vowel_digraph_aware():
    # γυναίκα: υ | αί | α → the accent goes on υ or the last α, never on the α of «αι».
    for seed in range(20):
        w = wrong_accent("γυναίκα", random.Random(seed))
        assert w in ("γύναικα", "γυναικά")
    assert wrong_accent("Αύγουστος", random.Random(0)) == "Αυγούστος"


def test_letter_mistakes_are_same_sound_first():
    believable, typos = wrong_letters("νερό")
    assert "νερώ" in believable and "ναιρό" in believable and "νερρό" in believable
    assert "νελό" in typos
    assert "νερό" not in believable + typos


def test_final_sigma_and_capitals_kept_right():
    believable, _ = wrong_letters("Αύγουστος")
    assert "Αύγουστως" in believable
    assert all(v.endswith("ς") and v[0].isupper() for v in believable)


def test_short_words_may_have_fewer_variants():
    out = lookalikes(None, "και", random.Random(0))
    assert 1 <= len(out) <= 3 and "και" not in out
