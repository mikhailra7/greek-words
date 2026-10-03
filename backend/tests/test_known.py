import pytest

from tests.conftest import create_invite, register


@pytest.fixture
def member(admin_client, make_client):
    c = make_client()
    register(c, "bob", create_invite(admin_client))
    return c


def _setup(admin_client):
    food = admin_client.post("/api/categories", json={"name": "Еда"}).json()["id"]
    d = admin_client.post("/api/dictionaries", json={"title": "Урок"}).json()["id"]
    ids = []
    for greek, ru, cat in (("νερό", "вода", food), ("ψωμί", "хлеб", food), ("σπίτι", "дом", None)):
        r = admin_client.post(
            f"/api/dictionaries/{d}/words",
            json={"greek": greek, "translations_ru": [ru], "category_id": cat},
        )
        ids.append(r.json()["id"])
    return d, food, ids


def _pool(client, hide=True):
    r = client.get("/api/training/words", params={"count": 100, "hide_known": hide})
    return sorted(w["greek"] for w in r.json())


def test_known_words_leave_trainers_per_user(admin_client, member):
    d, _, (water, bread, house) = _setup(admin_client)
    for c in (admin_client, member):
        c.put(f"/api/dictionaries/{d}/active", json={"active": True})

    assert member.put(f"/api/words/{water}/known", json={"known": True}).json() == {"known": True}
    assert _pool(member) == ["σπίτι", "ψωμί"]
    assert _pool(member, hide=False) == ["νερό", "σπίτι", "ψωμί"]  # «скрыть выученные» off
    assert _pool(admin_client) == ["νερό", "σπίτι", "ψωμί"]  # someone else's marks don't count

    summary = member.get("/api/words/active/count").json()
    assert (summary["words"], summary["known"]) == (3, 1)  # slider max = 3 - 1 with hiding

    # The flag is shown in the dictionary and in the (unfiltered) word lists.
    words = {w["greek"]: w["known"] for w in member.get(f"/api/dictionaries/{d}").json()["words"]}
    assert words == {"νερό": True, "ψωμί": False, "σπίτι": False}
    assert all(not w["known"] for w in admin_client.get(f"/api/dictionaries/{d}").json()["words"])
    flags = {
        w["greek"]: w["known"]
        for w in member.get("/api/training/words", params={"hide_known": False}).json()
    }
    assert flags["νερό"] is True

    member.put(f"/api/words/{water}/known", json={"known": False})
    assert _pool(member) == ["νερό", "σπίτι", "ψωμί"]


def test_translate_skips_known_but_may_use_them_as_options(admin_client, member):
    d, _, (water, bread, house) = _setup(admin_client)
    member.put(f"/api/dictionaries/{d}/active", json={"active": True})
    for w in (water, bread):
        member.put(f"/api/words/{w}/known", json={"known": True})
    qs = member.get("/api/training/translate", params={"count": 10}).json()
    assert [q["word"]["greek"] for q in qs] == ["σπίτι"]
    assert len(qs[0]["options"]) == 3  # known words still serve as wrong options
    all_qs = member.get("/api/training/translate", params={"count": 10, "hide_known": False})
    assert len(all_qs.json()) == 3


def test_reset_by_dictionary_and_category(admin_client, member):
    d, food, (water, bread, house) = _setup(admin_client)
    for w in (water, bread, house):
        member.put(f"/api/words/{w}/known", json={"known": True})
    admin_client.put(f"/api/words/{house}/known", json={"known": True})

    r = member.post(f"/api/categories/{food}/known/reset")
    assert r.json() == {"reset": 2}  # νερό, ψωμί
    known = {w["greek"] for w in member.get(f"/api/dictionaries/{d}").json()["words"] if w["known"]}
    assert known == {"σπίτι"}
    cat_words = member.get(f"/api/categories/{food}").json()["words"]
    assert all(not w["known"] for w in cat_words)

    assert member.post(f"/api/dictionaries/{d}/known/reset").json() == {"reset": 1}
    # The admin's own mark survived the member's reset.
    assert admin_client.get(f"/api/dictionaries/{d}").json()["words"][2]["known"] is True


def test_known_needs_a_visible_word(admin_client, member):
    d, _, (water, *_rest) = _setup(admin_client)
    assert member.put("/api/words/999/known", json={"known": True}).status_code == 404
    admin_client.patch(f"/api/dictionaries/{d}", json={"is_published": False})
    assert member.put(f"/api/words/{water}/known", json={"known": True}).status_code == 404
    assert member.post(f"/api/dictionaries/{d}/known/reset").status_code == 404


def test_repeat_known_words_from_all_dictionaries(admin_client):
    """«Повторить выученные слова»: the known words of every dictionary, active or not."""
    a = admin_client.post("/api/dictionaries", json={"title": "A"}).json()["id"]
    b = admin_client.post("/api/dictionaries", json={"title": "B"}).json()["id"]
    words = {}
    for d, greek, ru in [
        (a, "νερό", "вода"),
        (a, "ψωμί", "хлеб"),
        (b, "γάλα", "молоко"),
        (b, "τυρί", "сыр"),
    ]:
        r = admin_client.post(
            f"/api/dictionaries/{d}/words", json={"greek": greek, "translations_ru": [ru]}
        )
        words[greek] = r.json()["id"]
    admin_client.put(f"/api/dictionaries/{a}/active", json={"active": True})  # only A is active
    for greek in ("ψωμί", "γάλα"):  # one known in A, one in the inactive B
        assert admin_client.put(
            f"/api/words/{words[greek]}/known", json={"known": True}
        ).status_code in (200, 204)

    summary = admin_client.get("/api/words/active/count").json()
    assert summary["words"] == 2 and summary["known"] == 1 and summary["known_all"] == 2

    got = admin_client.get("/api/training/words", params={"count": 10, "known_only": True}).json()
    assert sorted(w["greek"] for w in got) == ["γάλα", "ψωμί"]
    q = admin_client.get("/api/training/translate", params={"count": 10, "known_only": True}).json()
    assert sorted(x["word"]["greek"] for x in q) == ["γάλα", "ψωμί"]
    m = admin_client.get("/api/training/mix", params={"count": 10, "known_only": True}).json()
    assert sorted(x["word"]["greek"] for x in m) == ["γάλα", "ψωμί"]
    # Off: the active words as before, known ones hidden by default.
    plain = admin_client.get("/api/training/words", params={"count": 10}).json()
    assert [w["greek"] for w in plain] == ["νερό"]
