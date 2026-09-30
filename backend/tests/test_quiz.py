import random

from app.models import Word
from app.services.quiz import build_questions, distractors, mix_types, option_text
from tests.conftest import create_invite, register


def W(i, greek, ru, pos="noun", article="το"):
    return Word(id=i, greek=greek, article=article, translations_ru=ru, part_of_speech=pos)


POOL = [
    W(1, "νερό", ["вода"]),
    W(2, "ψωμί", ["хлеб"]),
    W(3, "γάλα", ["молоко"]),
    W(4, "τυρί", ["сыр"]),
    W(5, "σπίτι", ["дом"]),
    W(6, "πίνω", ["пить"], pos="verb", article=None),
    W(7, "τρώω", ["есть", "кушать"], pos="verb", article=None),
    W(8, "θέλω", ["хотеть"], pos="verb", article=None),
    W(9, "μένω", ["жить"], pos="verb", article=None),
]


def test_mix_types_even_and_shuffled():
    for n in range(0, 13):
        types = mix_types(n)
        counts = [types.count(k) for k in ("ru_gr", "gr_ru", "write")]
        assert sum(counts) == n and max(counts) - min(counts) <= 1
    assert len({tuple(mix_types(9, random.Random(s))) for s in range(10)}) > 1


def test_option_text_by_direction():
    assert option_text(POOL[6], "ru_gr") == "τρώω"
    assert option_text(POOL[6], "gr_ru") == "есть, кушать"


def test_right_answer_plus_three_distinct_options():
    for direction in ("ru_gr", "gr_ru"):
        [q] = build_questions([POOL[0]], POOL, direction, random.Random(1))
        ids = [o.word_id for o in q.options]
        assert len(ids) == 4 and len(set(ids)) == 4 and 1 in ids
        assert len({o.text for o in q.options}) == 4


def test_prefers_same_part_of_speech():
    rng = random.Random(0)
    for _ in range(20):
        assert all(w.part_of_speech == "verb" for w in distractors(POOL[5], POOL, "ru_gr", rng))


def test_never_offers_a_second_correct_meaning():
    pool = [*POOL, W(10, "νεράκι", ["вода", "водичка"]), W(11, "ύδωρ", ["Вода "])]
    rng = random.Random(0)
    for _ in range(30):
        ids = {w.id for w in distractors(pool[0], pool, "gr_ru", rng)}
        assert not ids & {10, 11}


def test_duplicate_texts_skipped():
    pool = [W(1, "νερό", ["вода"]), W(2, "ψωμί", ["хлеб"]), W(3, "ψωμί", ["батон"])]
    texts = [option_text(w, "ru_gr") for w in distractors(pool[0], pool, "ru_gr", random.Random(0))]
    assert texts == ["το ψωμί"]


def test_small_pool_gives_fewer_options():
    [q] = build_questions([POOL[0]], POOL[:2], "ru_gr")
    assert len(q.options) == 2
    [q] = build_questions([POOL[0]], POOL[:1], "ru_gr")
    assert [o.word_id for o in q.options] == [1]


def test_api_questions_and_answer_log(admin_client, make_client, db_sessionmaker):
    from app.models import AnswerLog

    d = admin_client.post("/api/dictionaries", json={"title": "A"}).json()["id"]
    for w in POOL:
        admin_client.post(
            f"/api/dictionaries/{d}/words",
            json={
                "greek": w.greek,
                "article": w.article,
                "translations_ru": w.translations_ru,
                "part_of_speech": w.part_of_speech,
            },
        )
    bob = make_client()
    register(bob, "bob", create_invite(admin_client))
    assert bob.get("/api/training/translate").json() == []
    bob.put(f"/api/dictionaries/{d}/active", json={"active": True})

    qs = bob.get("/api/training/translate", params={"count": 5, "direction": "gr_ru"}).json()
    assert len(qs) == 5 and len({q["word"]["id"] for q in qs}) == 5
    for q in qs:
        assert q["word"]["id"] in [o["word_id"] for o in q["options"]]
        assert len(q["options"]) == 4
    assert bob.get("/api/training/translate", params={"direction": "xx"}).status_code == 422

    word_id = qs[0]["word"]["id"]
    r = bob.post(
        "/api/training/answers",
        json={
            "word_id": word_id,
            "mode": "translate",
            "direction": "gr_ru",
            "is_correct": False,
            "given_answer": "сыр",
        },
    )
    assert r.status_code == 204
    with db_sessionmaker() as db:
        [log] = db.query(AnswerLog).all()
        assert (log.word_id, log.is_correct, log.given_answer) == (word_id, False, "сыр")
