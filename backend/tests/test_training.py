import pytest

from tests.conftest import create_invite, register


def _dict_with_words(client, title: str, n: int) -> int:
    d = client.post("/api/dictionaries", json={"title": title}).json()["id"]
    for i in range(n):
        client.post(
            f"/api/dictionaries/{d}/words",
            json={"greek": f"{title}{i}", "translations_ru": [f"t{i}"]},
        )
    return d


@pytest.fixture
def member(admin_client, make_client):
    c = make_client()
    register(c, "bob", create_invite(admin_client))
    return c


def test_only_active_dictionaries_no_repeats(admin_client, member):
    a = _dict_with_words(admin_client, "a", 5)
    _dict_with_words(admin_client, "b", 5)
    assert member.get("/api/training/words").json() == []

    member.put(f"/api/dictionaries/{a}/active", json={"active": True})
    words = member.get("/api/training/words", params={"count": 3}).json()
    assert len(words) == 3
    assert len({w["id"] for w in words}) == 3
    assert all(w["greek"].startswith("a") for w in words)

    everything = member.get("/api/training/words", params={"count": 100}).json()
    assert sorted(w["greek"] for w in everything) == [f"a{i}" for i in range(5)]


def test_order_is_shuffled(admin_client, member):
    d = _dict_with_words(admin_client, "w", 12)
    member.put(f"/api/dictionaries/{d}/active", json={"active": True})
    orders = {
        tuple(w["id"] for w in member.get("/api/training/words", params={"count": 12}).json())
        for _ in range(5)
    }
    assert len(orders) > 1


def test_hidden_dictionary_excluded(admin_client, member):
    d = _dict_with_words(admin_client, "h", 3)
    member.put(f"/api/dictionaries/{d}/active", json={"active": True})
    admin_client.patch(f"/api/dictionaries/{d}", json={"is_published": False})
    assert member.get("/api/training/words").json() == []


def test_count_validation(member):
    assert member.get("/api/training/words", params={"count": 0}).status_code == 422


def test_settings_roundtrip_per_user(admin_client, member):
    assert member.get("/api/me/settings").json() == {}
    r = member.put("/api/me/settings/study", json={"value": {"count": 7, "speak": False}})
    assert r.status_code == 204
    member.put("/api/me/settings/study", json={"value": {"count": 9, "speak": True}})
    assert member.get("/api/me/settings").json() == {"study": {"count": 9, "speak": True}}
    assert admin_client.get("/api/me/settings").json() == {}
    assert member.put("/api/me/settings/hack", json={"value": {}}).status_code == 404
    assert member.put("/api/me/settings/mix", json={"value": {"count": 5}}).status_code == 204


def test_mix_tasks_balanced(admin_client, member):
    d = _dict_with_words(admin_client, "m", 10)
    member.put(f"/api/dictionaries/{d}/active", json={"active": True})
    tasks = member.get("/api/training/mix", params={"count": 8}).json()
    assert len(tasks) == 8
    assert len({t["word"]["id"] for t in tasks}) == 8
    kinds = [t["type"] for t in tasks]
    assert sorted(kinds.count(k) for k in ("ru_gr", "gr_ru", "write")) == [2, 3, 3]
    for t in tasks:
        if t["type"] == "write":
            assert t["options"] == []
        else:
            assert len(t["options"]) == 4
            assert t["word"]["id"] in {o["word_id"] for o in t["options"]}
    ru_gr = next(t for t in tasks if t["type"] == "ru_gr")
    assert all(o["text"].startswith("m") for o in ru_gr["options"])  # Greek options
    gr_ru = next(t for t in tasks if t["type"] == "gr_ru")
    assert all(o["text"].startswith("t") for o in gr_ru["options"])  # Russian options


def test_mix_skips_known_words(admin_client, member):
    d = _dict_with_words(admin_client, "k", 3)
    member.put(f"/api/dictionaries/{d}/active", json={"active": True})
    words = member.get("/api/training/words", params={"count": 3}).json()
    member.put(f"/api/words/{words[0]['id']}/known", json={"known": True})
    tasks = member.get("/api/training/mix", params={"count": 10}).json()
    assert words[0]["id"] not in {t["word"]["id"] for t in tasks}
    assert len(tasks) == 2
    everything = member.get("/api/training/mix", params={"count": 10, "hide_known": False})
    assert len(everything.json()) == 3


def test_wrong_options_from_any_dictionary_same_part_of_speech_first(admin_client, member):
    def add(d, greek, ru, pos, article=None):
        admin_client.post(
            f"/api/dictionaries/{d}/words",
            json={
                "greek": greek,
                "article": article,
                "translations_ru": [ru],
                "part_of_speech": pos,
            },
        )

    lesson = admin_client.post("/api/dictionaries", json={"title": "Урок"}).json()["id"]
    add(lesson, "νερό", "вода", "noun", "το")
    other = admin_client.post("/api/dictionaries", json={"title": "Другой"}).json()["id"]
    for greek, ru in (("ψωμί", "хлеб"), ("γάλα", "молоко"), ("τυρί", "сыр")):
        add(other, greek, ru, "noun", "το")
    for greek, ru in (("πίνω", "пить"), ("τρώω", "есть"), ("θέλω", "хотеть")):
        add(other, greek, ru, "verb")
    hidden = admin_client.post("/api/dictionaries", json={"title": "Скрытый"}).json()["id"]
    add(hidden, "σπίτι", "дом", "noun", "το")
    admin_client.patch(f"/api/dictionaries/{hidden}", json={"is_published": False})

    member.put(f"/api/dictionaries/{lesson}/active", json={"active": True})  # only the lesson
    for _ in range(5):
        (q,) = member.get("/api/training/translate", params={"count": 5}).json()
        assert q["word"]["greek"] == "νερό"  # questions: active words only
        texts = sorted(o["text"] for o in q["options"])
        # Wrong options: nouns from the inactive dictionary; hidden dictionaries never.
        assert texts == ["το γάλα", "το νερό", "το τυρί", "το ψωμί"]
        (t,) = member.get("/api/training/mix", params={"count": 1}).json()
        if t["type"] == "ru_gr":
            assert sorted(o["text"] for o in t["options"]) == texts


def test_translate_hard_mode(admin_client, member):
    d = admin_client.post("/api/dictionaries", json={"title": "Hard"}).json()["id"]
    words = [
        ("το", "νερό", "вода"),
        (None, "και", "и"),
        ("το", "ψωμί", "хлеб"),
        (None, "πίνω", "пить"),
    ]
    for article, greek, ru in words:
        admin_client.post(
            f"/api/dictionaries/{d}/words",
            json={"article": article, "greek": greek, "translations_ru": [ru]},
        )
    member.put(f"/api/dictionaries/{d}/active", json={"active": True})

    params = {"count": 4, "direction": "ru_gr", "hard": True}
    for q in member.get("/api/training/translate", params=params).json():
        opts = q["options"]
        assert len(opts) == 4 and len({o["text"] for o in opts}) == 4
        right = [o for o in opts if o["word_id"] == q["word"]["id"]]
        assert [o["text"] for o in right] == [q["word"]["full_greek"]]
        if q["word"]["greek"] == "νερό":
            assert all(o["word_id"] < 0 for o in opts if o not in right)  # look-alikes only
        if q["word"]["greek"] == "και":  # few look-alikes → topped up with real words
            assert any(o["word_id"] > 0 for o in opts if o not in right)

    # Hard mode is RU→GR only: GR→RU options stay real translations.
    params["direction"] = "gr_ru"
    for q in member.get("/api/training/translate", params=params).json():
        assert all(o["word_id"] > 0 for o in q["options"])


@pytest.fixture
def warmups(monkeypatch):
    """Records warm-ups for sessions and voice changes (not the one after adding a word)."""
    from app.services import tts

    calls = []

    def record(ids, v=tts.DEFAULT_VOICE, langs=("el", "ru"), **kw):
        if kw:
            calls.append((ids, v, langs, kw))

    monkeypatch.setattr(tts, "warm_up", record)
    return calls


def test_audio_prepared_for_session_and_new_voice(admin_client, member, warmups):
    from app.services import tts

    d = _dict_with_words(admin_client, "a", 3)
    member.put(f"/api/dictionaries/{d}/active", json={"active": True})
    words = member.get("/api/training/words", params={"count": 3}).json()
    ids, v, langs, kw = warmups.pop()
    assert ids == [w["id"] for w in words]  # in the order the session shows them
    assert v == tts.DEFAULT_VOICE and langs == ("el", "ru") and kw == {"session": True}
    member.get("/api/training/translate", params={"count": 2})
    assert warmups.pop()[2] == ("el",)

    # A new voice in the profile → all active words in that voice, as the user's bulk job.
    voice = {"device": False, "male": True, "speed": 0}
    member.put("/api/me/settings/voice", json={"value": voice})
    ids, v, langs, kw = warmups.pop()
    assert sorted(ids) == sorted(w["id"] for w in words)
    assert v == tts.Voice(male=True, rate=0) and langs == ("el", "ru") and "user_id" in kw
    member.get("/api/training/words", params={"count": 1})
    assert warmups.pop()[1] == tts.Voice(male=True, rate=0)

    # The device voice needs nothing from the server.
    member.put("/api/me/settings/voice", json={"value": {**voice, "device": True}})
    member.get("/api/training/words", params={"count": 1})
    assert warmups == []
