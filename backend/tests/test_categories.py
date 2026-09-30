import pytest

from tests.conftest import create_invite, register


@pytest.fixture
def member(admin_client, make_client):
    c = make_client()
    register(c, "bob", create_invite(admin_client))
    return c


def _cat(client, name, emoji=None) -> int:
    r = client.post("/api/categories", json={"name": name, "emoji": emoji})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _dict(client, title) -> int:
    return client.post("/api/dictionaries", json={"title": title}).json()["id"]


def _word(client, d, greek, ru, category_id=None) -> int:
    r = client.post(
        f"/api/dictionaries/{d}/words",
        json={"greek": greek, "translations_ru": [ru], "category_id": category_id},
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_admin_manages_categories(admin_client, member):
    food = _cat(admin_client, "Еда", "🍽️")
    assert admin_client.post("/api/categories", json={"name": "еда"}).status_code == 409
    r = admin_client.patch(f"/api/categories/{food}", json={"name": "Еда и напитки"})
    assert r.json()["name"] == "Еда и напитки"

    assert member.post("/api/categories", json={"name": "X"}).status_code == 403
    assert member.patch(f"/api/categories/{food}", json={"name": "X"}).status_code == 403
    assert member.delete(f"/api/categories/{food}").status_code == 403
    [c] = member.get("/api/categories").json()
    assert c["name"] == "Еда и напитки" and c["can_edit"] is False


def test_word_has_one_category_and_it_must_exist(admin_client):
    food = _cat(admin_client, "Еда")
    home = _cat(admin_client, "Дом")
    d = _dict(admin_client, "Урок")
    wid = _word(admin_client, d, "νερό", "вода", food)
    word = admin_client.get(f"/api/dictionaries/{d}").json()["words"][0]
    assert word["category_id"] == food

    r = admin_client.put(
        f"/api/words/{wid}",
        json={"greek": "νερό", "translations_ru": ["вода"], "category_id": home},
    )
    assert r.json()["category_id"] == home  # moved, not added: only one category
    r = admin_client.put(
        f"/api/words/{wid}", json={"greek": "νερό", "translations_ru": ["вода"], "category_id": 999}
    )
    assert r.status_code == 400


def test_category_spans_dictionaries(admin_client):
    food = _cat(admin_client, "Еда")
    d1, d2 = _dict(admin_client, "Урок 1"), _dict(admin_client, "Урок 2")
    _word(admin_client, d1, "νερό", "вода", food)
    _word(admin_client, d2, "ψωμί", "хлеб", food)
    _word(admin_client, d2, "σπίτι", "дом")  # no category
    detail = admin_client.get(f"/api/categories/{food}").json()
    assert detail["word_count"] == 2
    assert [(w["greek"], w["dictionary_title"]) for w in detail["words"]] == [
        ("νερό", "Урок 1"),
        ("ψωμί", "Урок 2"),
    ]


def test_training_pool_is_union_of_dictionaries_and_categories(admin_client, member):
    food = _cat(admin_client, "Еда")
    d1, d2 = _dict(admin_client, "Урок 1"), _dict(admin_client, "Урок 2")
    _word(admin_client, d1, "νερό", "вода", food)
    _word(admin_client, d1, "σπίτι", "дом")
    _word(admin_client, d2, "ψωμί", "хлеб", food)
    _word(admin_client, d2, "τρένο", "поезд")

    def pool():
        return sorted(
            w["greek"] for w in member.get("/api/training/words", params={"count": 100}).json()
        )

    summary = member.put(f"/api/categories/{food}/active", json={"active": True}).json()
    assert summary == {"dictionaries": 0, "categories": 1, "words": 2, "known": 0}
    assert pool() == ["νερό", "ψωμί"]  # the category pulls from both dictionaries

    member.put(f"/api/dictionaries/{d1}/active", json={"active": True})
    assert pool() == ["νερό", "σπίτι", "ψωμί"]  # νερό counted once
    assert member.get("/api/words/active/count").json() == {
        "dictionaries": 1,
        "categories": 1,
        "words": 3,
        "known": 0,
    }
    assert [c["is_active"] for c in member.get("/api/categories").json()] == [True]
    assert admin_client.get("/api/words/active/count").json()["words"] == 0  # per user

    member.put(f"/api/categories/{food}/active", json={"active": False})
    assert pool() == ["νερό", "σπίτι"]


def test_hidden_dictionary_words_not_pulled_by_category(admin_client, member):
    food = _cat(admin_client, "Еда")
    d = _dict(admin_client, "Черновик")
    _word(admin_client, d, "νερό", "вода", food)
    admin_client.patch(f"/api/dictionaries/{d}", json={"is_published": False})
    member.put(f"/api/categories/{food}/active", json={"active": True})
    assert member.get("/api/training/words").json() == []
    assert member.get("/api/categories").json()[0]["word_count"] == 0
    assert admin_client.get("/api/categories").json()[0]["word_count"] == 1


def test_delete_category_keeps_words(admin_client, member):
    food = _cat(admin_client, "Еда")
    d = _dict(admin_client, "Урок")
    _word(admin_client, d, "νερό", "вода", food)
    member.put(f"/api/categories/{food}/active", json={"active": True})
    assert admin_client.delete(f"/api/categories/{food}").status_code == 204
    words = admin_client.get(f"/api/dictionaries/{d}").json()["words"]
    assert [(w["greek"], w["category_id"]) for w in words] == [("νερό", None)]
    assert member.get("/api/words/active/count").json()["categories"] == 0


def test_quick_category_patch(admin_client, member):
    food = _cat(admin_client, "Еда")
    d = _dict(admin_client, "Урок")
    wid = _word(admin_client, d, "νερό", "вода")
    r = admin_client.patch(f"/api/words/{wid}/category", json={"category_id": food})
    assert r.status_code == 200 and r.json()["category_id"] == food
    assert r.json()["translations_ru"] == ["вода"]  # nothing else touched
    assert (
        admin_client.patch(f"/api/words/{wid}/category", json={"category_id": 999}).status_code
        == 400
    )
    assert member.patch(f"/api/words/{wid}/category", json={"category_id": None}).status_code == 403
    r = admin_client.patch(f"/api/words/{wid}/category", json={"category_id": None})
    assert r.json()["category_id"] is None
