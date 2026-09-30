import pytest

from app.services.spelling import check, normalize
from tests.conftest import create_invite, register


@pytest.mark.parametrize(
    "answer",
    ["το νερό", "  το   νερό ", "ΤΟ ΝΕΡΌ", "Το Νερό", "το νερό"],  # last: decomposed accent
)
def test_accepted(answer):
    assert check(answer, "το νερό", "το").correct


@pytest.mark.parametrize(
    ("answer", "hint_part"),
    [
        ("το νερο", "ударение"),  # missing tonos is an error
        ("νερό", "артикль"),  # article is required
        ("η νερό", "Артикль другой"),
        ("to νερό", "латиниц"),
        ("τo νερό", "латиниц"),  # Latin o among Greek letters
        ("το ψωμί", None),
    ],
)
def test_rejected_with_hint(answer, hint_part):
    r = check(answer, "το νερό", "το")
    assert not r.correct
    if hint_part:
        assert hint_part in r.hint
    else:
        assert r.hint is None


def test_final_sigma_is_strict():
    assert check("ο φίλος", "ο φίλος", "ο").correct
    r = check("ο φίλοσ", "ο φίλος", "ο")
    assert not r.correct and "ς" in r.hint
    assert not check("ο φίςος", "ο φίλος", "ο").correct
    # capitals are fine: Σ at the end lowercases to ς
    assert check("Ο ΦΊΛΟΣ", "ο φίλος", "ο").correct


def test_words_without_article():
    assert check("θέλω", "θέλω", None).correct
    assert "ударение" in check("θελω", "θέλω", None).hint


def test_segments_show_the_difference():
    r = check("το νερο", "το νερό", "το")
    assert "".join(s.text for s in r.given_segments) == "το νερο"
    assert "".join(s.text for s in r.expected_segments) == "το νερό"
    assert [s.text for s in r.expected_segments if not s.ok] == ["ό"]
    assert [s.text for s in r.given_segments if not s.ok] == ["ο"]


def test_normalize():
    assert normalize("  ΤΟ   ΝΕΡΟΣ ") == "το νερος"


def test_api_check_logs_answer(admin_client, make_client, db_sessionmaker):
    from app.models import AnswerLog

    d = admin_client.post("/api/dictionaries", json={"title": "A"}).json()["id"]
    wid = admin_client.post(
        f"/api/dictionaries/{d}/words",
        json={"article": "το", "greek": "νερό", "translations_ru": ["вода"]},
    ).json()["id"]
    bob = make_client()
    register(bob, "bob", create_invite(admin_client))

    ok = bob.post("/api/training/write/check", json={"word_id": wid, "answer": "ΤΟ ΝΕΡΌ"}).json()
    assert ok["correct"] and ok["expected"] == "το νερό"
    bad = bob.post("/api/training/write/check", json={"word_id": wid, "answer": "νερό"}).json()
    assert not bad["correct"] and "артикль" in bad["hint"]
    # «Не знаю» sends an empty answer: wrong, no hint, the whole right answer highlighted.
    idk = bob.post("/api/training/write/check", json={"word_id": wid, "answer": ""}).json()
    assert not idk["correct"] and idk["hint"] is None and idk["given_segments"] == []
    assert idk["expected_segments"] == [{"text": "το νερό", "ok": False}]
    assert (
        bob.post("/api/training/write/check", json={"word_id": 999, "answer": "x"}).status_code
        == 404
    )
    with db_sessionmaker() as db:
        logs = db.query(AnswerLog).order_by(AnswerLog.id).all()
        assert [(log.mode, log.is_correct) for log in logs] == [
            ("write", True),
            ("write", False),
            ("write", False),
        ]
