import random
import unicodedata

import pytest

from app.services.lookalikes import lookalikes, wrong_accent, wrong_article, wrong_letters

ACUTE = "́"


def accent_pos(word: str) -> int:
    return unicodedata.normalize("NFD", word).index(ACUTE)


def base(word: str) -> str:
    return unicodedata.normalize("NFD", word).replace(ACUTE, "")


@pytest.mark.parametrize("seed", range(20))
def test_noun_gets_article_accent_and_letter(seed):
    out = lookalikes("το", "νερό", random.Random(seed))
    assert len(out) == 3 and len(set(out)) == 3 and "το νερό" not in out
    arts = [o.split(" ")[0] for o in out]
    assert sum(a in ("ο", "η") for a in arts) == 1  # one wrong article (singular group)
    words = [o.split(" ", 1)[1] for o in out if o.startswith("το ")]
    accent = [w for w in words if base(w) == "νερο"]
    assert len(accent) == 1 and accent_pos(accent[0]) != accent_pos("νερό")
    letter = [w for w in words if base(w) != "νερο"]
    assert len(letter) == 1 and ACUTE in unicodedata.normalize("NFD", letter[0])


def test_plural_article_stays_plural():
    for seed in range(10):
        assert wrong_article("τα", random.Random(seed)) == "οι"
        assert wrong_article("οι", random.Random(seed)) == "τα"
    assert wrong_article(None, random.Random()) is None


def test_no_article_two_wrong_letters():
    out = lookalikes(None, "πίνω", random.Random(3))
    assert len(out) == 3
    assert sum(base(o) == base("πίνω") for o in out) == 1  # one wrong accent
    assert sum(base(o) != base("πίνω") for o in out) == 2  # two wrong letters


def test_one_vowel_two_wrong_letters():
    out = lookalikes("το", "φως", random.Random(1))
    assert out[0] in ("ο φως", "η φως")
    assert all(o.startswith("το ") for o in out[1:]) and len(out) == 3
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
