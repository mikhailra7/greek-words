"""«5/7» next to words: the user's last 10 answers, whatever the exercise."""

from tests.conftest import create_invite, register


def _answer(client, word_id, correct, mode="translate"):
    r = client.post(
        "/api/training/answers",
        json={"word_id": word_id, "mode": mode, "is_correct": correct, "given_answer": "x"},
    )
    assert r.status_code == 204, r.text


def test_last_ten_answers_per_user(admin_client, make_client):
    d = admin_client.post("/api/dictionaries", json={"title": "С"}).json()["id"]
    w1, w2, w3 = (
        admin_client.post(
            f"/api/dictionaries/{d}/words", json={"greek": g, "translations_ru": [g]}
        ).json()["id"]
        for g in ("ένα", "δύο", "τρία")
    )
    cat = admin_client.post("/api/categories", json={"name": "Числа"}).json()["id"]
    admin_client.patch(f"/api/words/{w1}/category", json={"category_id": cat})

    # w1: 12 answers — 2 old wrong ones fall out of the window, then 7 right + 3 wrong.
    for ok in [False, False] + [True] * 7 + [False] * 3:
        _answer(admin_client, w1, ok, mode="write" if ok else "translate")
    _answer(admin_client, w2, True)  # one answer
    # Somebody else's answers don't count.
    other = make_client()
    assert register(other, "anna", create_invite(admin_client)).status_code == 201
    for _ in range(5):
        _answer(other, w2, False)

    words = {
        w["greek"]: w["answers"] for w in admin_client.get(f"/api/dictionaries/{d}").json()["words"]
    }
    assert words == {
        "ένα": {"right": 7, "total": 10},
        "δύο": {"right": 1, "total": 1},
        "τρία": None,
    }
    in_cat = admin_client.get(f"/api/categories/{cat}").json()["words"]
    assert in_cat[0]["answers"] == {"right": 7, "total": 10}
    theirs = {w["greek"]: w["answers"] for w in other.get(f"/api/dictionaries/{d}").json()["words"]}
    assert theirs["δύο"] == {"right": 0, "total": 5} and theirs["ένα"] is None


def test_accept_typed_answer_counts_it_right(admin_client, make_client):
    d = admin_client.post("/api/dictionaries", json={"title": "А"}).json()["id"]
    w = admin_client.post(
        f"/api/dictionaries/{d}/words",
        json={"article": "το", "greek": "νερό", "translations_ru": ["вода"]},
    ).json()["id"]
    wrong = admin_client.post(
        "/api/training/write/check", json={"word_id": w, "answer": "το νερο"}
    ).json()
    assert wrong["correct"] is False and wrong["answer_id"] > 0
    stats = lambda: admin_client.get(f"/api/dictionaries/{d}").json()["words"][0]["answers"]  # noqa: E731
    assert stats() == {"right": 0, "total": 1}

    assert (
        admin_client.post(f"/api/training/answers/{wrong['answer_id']}/accept").status_code == 204
    )
    assert stats() == {"right": 1, "total": 1}

    # «Не знаю» (empty) can't be accepted; nor somebody else's answer.
    idk = admin_client.post("/api/training/write/check", json={"word_id": w, "answer": ""}).json()
    assert admin_client.post(f"/api/training/answers/{idk['answer_id']}/accept").status_code == 400
    other = make_client()
    assert register(other, "anna", create_invite(admin_client)).status_code == 201
    assert other.post(f"/api/training/answers/{wrong['answer_id']}/accept").status_code == 404
