"""«Изучать» on words, «Есть в словарях», «Знаю» by itself at 10/10 (SPEC)."""


def _dict(client, title, words):
    d = client.post("/api/dictionaries", json={"title": title}).json()["id"]
    ids = [
        client.post(
            f"/api/dictionaries/{d}/words", json={"greek": g, "translations_ru": [g]}
        ).json()["id"]
        for g in words
    ]
    return d, ids


def _pool(client) -> set[str]:
    r = client.get("/api/training/words", params={"count": 100, "hide_known": False})
    return {w["greek"] for w in r.json()}


def _study(client, word_id, on, via="dictionary"):
    r = client.put(f"/api/words/{word_id}/study", json={"study": on, "via": via})
    assert r.status_code == 200, r.text
    return r.json()


def _page(client, d):
    return client.get(f"/api/dictionaries/{d}").json()


def test_dictionary_tick_is_a_tick_on_every_word(admin_client):
    d, ids = _dict(admin_client, "A", ["α", "β", "γ"])
    admin_client.put(f"/api/dictionaries/{d}/active", json={"active": True})
    page = _page(admin_client, d)
    assert page["is_active"] and page["study_count"] == 3
    assert all(w["study"] for w in page["words"])

    summary = _study(admin_client, ids[1], False)
    assert summary["words"] == 2 and summary["dictionaries"] == 1
    assert _pool(admin_client) == {"α", "γ"}
    page = _page(admin_client, d)
    assert not page["is_active"] and page["study_count"] == 2  # partly: the page shows «–»
    listed = admin_client.get("/api/dictionaries").json()["dictionaries"][0]
    assert listed["study_count"] == 2 and not listed["is_active"]

    _study(admin_client, ids[1], True)  # the last one → the whole dictionary again
    assert _page(admin_client, d)["is_active"]

    admin_client.put(f"/api/dictionaries/{d}/active", json={"active": False})
    assert _pool(admin_client) == set()
    _study(admin_client, ids[0], True)  # one word without the dictionary
    assert _pool(admin_client) == {"α"}
    assert not _page(admin_client, d)["is_active"]


def test_new_words_follow_a_wholly_ticked_dictionary_only(admin_client):
    d, ids = _dict(admin_client, "A", ["α", "β"])
    admin_client.put(f"/api/dictionaries/{d}/active", json={"active": True})
    admin_client.post(f"/api/dictionaries/{d}/words", json={"greek": "γ", "translations_ru": ["г"]})
    assert _pool(admin_client) == {"α", "β", "γ"}
    _study(admin_client, ids[0], False)  # partly ticked now: new words aren't
    admin_client.post(f"/api/dictionaries/{d}/words", json={"greek": "δ", "translations_ru": ["д"]})
    assert _pool(admin_client) == {"β", "γ"}


def test_category_tick_survives_unticking_the_dictionary(admin_client):
    d, ids = _dict(admin_client, "A", ["α", "β", "γ"])
    cat = admin_client.post("/api/categories", json={"name": "К"}).json()["id"]
    admin_client.patch(f"/api/words/{ids[0]}/category", json={"category_id": cat})
    admin_client.put(f"/api/dictionaries/{d}/active", json={"active": True})
    _study(admin_client, ids[0], True, via="category")
    page = admin_client.get(f"/api/categories/{cat}").json()
    assert page["is_active"] and page["words"][0]["study"]  # its only word → all ticked

    admin_client.put(f"/api/dictionaries/{d}/active", json={"active": False})
    assert _pool(admin_client) == {"α"}  # still studied «в рамках категории»
    assert not _page(admin_client, d)["words"][0]["study"]  # the dictionary tick is off

    # Unticking the category — gone; the ticks are separate.
    admin_client.put(f"/api/categories/{cat}/active", json={"active": False})
    assert _pool(admin_client) == set()

    r = admin_client.put(f"/api/words/{ids[1]}/study", json={"study": True, "via": "category"})
    assert r.status_code == 400  # no category


def test_word_moved_to_another_category(admin_client):
    _, ids = _dict(admin_client, "A", ["α", "β"])
    old = admin_client.post("/api/categories", json={"name": "Старая"}).json()["id"]
    new = admin_client.post("/api/categories", json={"name": "Новая"}).json()["id"]
    admin_client.patch(f"/api/words/{ids[0]}/category", json={"category_id": old})
    admin_client.patch(f"/api/words/{ids[1]}/category", json={"category_id": new})
    admin_client.put(f"/api/categories/{old}/active", json={"active": True})
    admin_client.put(f"/api/categories/{new}/active", json={"active": True})
    assert _pool(admin_client) == {"α", "β"}
    admin_client.put(f"/api/categories/{old}/active", json={"active": False})
    _study(admin_client, ids[0], True, via="category")  # α ticked alone in «Старая»
    admin_client.put(f"/api/categories/{new}/active", json={"active": False})
    admin_client.patch(f"/api/words/{ids[0]}/category", json={"category_id": new})
    assert _pool(admin_client) == set()  # the tick was for the old category

    admin_client.put(f"/api/categories/{new}/active", json={"active": True})
    admin_client.patch(f"/api/words/{ids[1]}/category", json={"category_id": None})
    admin_client.patch(f"/api/words/{ids[1]}/category", json={"category_id": new})
    assert _pool(admin_client) == {"α", "β"}  # back into a wholly ticked one → ticked


def test_each_user_ticks_their_own(admin_client, make_client):
    from tests.conftest import create_invite, register

    d, ids = _dict(admin_client, "A", ["α", "β"])
    admin_client.patch(f"/api/dictionaries/{d}", json={"is_published": True})
    bob = make_client()
    register(bob, "bob", create_invite(admin_client))
    _study(bob, ids[0], True)
    assert _pool(bob) == {"α"} and _pool(admin_client) == set()


def test_also_in_other_dictionaries(admin_client):
    a, a_ids = _dict(admin_client, "Первый", ["νερό", "ψωμί"])
    b, _ = _dict(admin_client, "Второй", ["Νερό"])
    c, _ = _dict(admin_client, "Третий", ["νερό", "νερο"])  # without the accent — another word
    words = _page(admin_client, a)["words"]
    assert words[0]["also_in"] == [{"id": b, "title": "Второй"}, {"id": c, "title": "Третий"}]
    assert words[1]["also_in"] == []
    cat = admin_client.post("/api/categories", json={"name": "Вода"}).json()["id"]
    admin_client.patch(f"/api/words/{a_ids[0]}/category", json={"category_id": cat})
    in_cat = admin_client.get(f"/api/categories/{cat}").json()["words"][0]
    assert [r["title"] for r in in_cat["also_in"]] == ["Второй", "Третий"]


def _answer(client, word_id, ok):
    r = client.post(
        "/api/training/answers",
        json={"word_id": word_id, "mode": "translate", "is_correct": ok, "given_answer": "x"},
    )
    assert r.status_code == 204


def _known(client, d) -> list[bool]:
    return [w["known"] for w in _page(client, d)["words"]]


def test_known_by_itself_at_ten_of_ten(admin_client):
    d, (w,) = _dict(admin_client, "A", ["α"])
    _answer(admin_client, w, False)
    for _ in range(9):
        _answer(admin_client, w, True)
    assert _known(admin_client, d) == [False]  # 9/10
    _answer(admin_client, w, True)
    assert _known(admin_client, d) == [True]  # 10/10

    # Unticked by hand: a wrong answer then nine right ones don't bring it back…
    admin_client.put(f"/api/words/{w}/known", json={"known": False})
    _answer(admin_client, w, False)
    for _ in range(9):
        _answer(admin_client, w, True)
    assert _known(admin_client, d) == [False]
    _answer(admin_client, w, True)  # …the tenth right one in a row does
    assert _known(admin_client, d) == [True]


def test_known_at_ten_of_ten_in_write_and_by_accept(admin_client):
    d, (w,) = _dict(admin_client, "A", ["λέξη"])
    for _ in range(9):
        r = admin_client.post("/api/training/write/check", json={"word_id": w, "answer": "λέξη"})
        assert r.json()["correct"]
    assert _known(admin_client, d) == [False]
    r = admin_client.post("/api/training/write/check", json={"word_id": w, "answer": "λεξη"})
    assert not r.json()["correct"] and _known(admin_client, d) == [False]
    admin_client.post(f"/api/training/answers/{r.json()['answer_id']}/accept")
    assert _known(admin_client, d) == [True]  # «Я ответил правильно» made it 10/10
