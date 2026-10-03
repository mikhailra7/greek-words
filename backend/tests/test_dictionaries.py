import json
from pathlib import Path

import pytest

from tests.conftest import create_invite, register

SEED = Path(__file__).parents[1] / "app" / "seed"

WATER = {
    "article": "το",
    "greek": "νερό",
    "transcription": "to neró",
    "translations_ru": ["вода"],
    "part_of_speech": "noun",
}


@pytest.fixture
def member(admin_client, make_client):
    c = make_client()
    assert register(c, "bob", create_invite(admin_client)).status_code == 201
    return c


def _create_dict(client, title="Урок 1") -> int:
    r = client.post("/api/dictionaries", json={"title": title})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_admin_creates_dictionary_and_words(admin_client):
    d = _create_dict(admin_client)
    r = admin_client.post(f"/api/dictionaries/{d}/words", json=WATER)
    assert r.status_code == 201
    word = r.json()
    assert word["full_greek"] == "το νερό"
    assert word["position"] == 0

    r = admin_client.post(
        f"/api/dictionaries/{d}/words",
        json={"greek": "ψωμί", "translations_ru": ["хлеб"], "article": "το"},
    )
    assert r.json()["position"] == 1

    detail = admin_client.get(f"/api/dictionaries/{d}").json()
    assert [w["greek"] for w in detail["words"]] == ["νερό", "ψωμί"]
    assert detail["word_count"] == 2 and detail["can_edit"] is True


def test_member_reads_but_cannot_edit(admin_client, member):
    d = _create_dict(admin_client)
    word_id = admin_client.post(f"/api/dictionaries/{d}/words", json=WATER).json()["id"]

    listing = member.get("/api/dictionaries").json()
    assert listing["dictionaries"][0]["can_edit"] is False
    assert member.get(f"/api/dictionaries/{d}").status_code == 200

    assert member.post("/api/dictionaries", json={"title": "x"}).status_code == 403
    assert member.post(f"/api/dictionaries/{d}/words", json=WATER).status_code == 403
    assert member.put(f"/api/words/{word_id}", json=WATER).status_code == 403
    assert member.delete(f"/api/words/{word_id}").status_code == 403
    assert member.delete(f"/api/dictionaries/{d}").status_code == 403
    assert member.get(f"/api/dictionaries/{d}/export").status_code == 403


def test_unpublished_hidden_from_members(admin_client, member):
    d = _create_dict(admin_client)
    admin_client.patch(f"/api/dictionaries/{d}", json={"is_published": False})
    assert member.get("/api/dictionaries").json()["dictionaries"] == []
    assert member.get(f"/api/dictionaries/{d}").status_code == 404
    assert len(admin_client.get("/api/dictionaries").json()["dictionaries"]) == 1


def test_active_dictionaries_are_per_user(admin_client, member):
    d1 = _create_dict(admin_client, "A")
    d2 = _create_dict(admin_client, "B")
    admin_client.post(f"/api/dictionaries/{d1}/words", json=WATER)
    admin_client.post(f"/api/dictionaries/{d2}/words", json=WATER)
    admin_client.post(f"/api/dictionaries/{d2}/words", json=WATER)

    r = member.put(f"/api/dictionaries/{d2}/active", json={"active": True})
    assert r.json() == {"dictionaries": 1, "categories": 0, "words": 2, "known": 0, "known_all": 0}
    # idempotent
    assert member.put(f"/api/dictionaries/{d2}/active", json={"active": True}).json()["words"] == 2

    assert admin_client.get("/api/words/active/count").json() == {
        "dictionaries": 0,
        "categories": 0,
        "words": 0,
        "known": 0,
        "known_all": 0,
    }
    flags = {
        d["id"]: d["is_active"] for d in member.get("/api/dictionaries").json()["dictionaries"]
    }
    assert flags == {d1: False, d2: True}

    member.put(f"/api/dictionaries/{d2}/active", json={"active": False})
    assert member.get("/api/words/active/count").json() == {
        "dictionaries": 0,
        "categories": 0,
        "words": 0,
        "known": 0,
        "known_all": 0,
    }


def test_hidden_active_dictionary_not_counted(admin_client, member):
    d = _create_dict(admin_client)
    admin_client.post(f"/api/dictionaries/{d}/words", json=WATER)
    member.put(f"/api/dictionaries/{d}/active", json={"active": True})
    admin_client.patch(f"/api/dictionaries/{d}", json={"is_published": False})
    assert member.get("/api/words/active/count").json() == {
        "dictionaries": 0,
        "categories": 0,
        "words": 0,
        "known": 0,
        "known_all": 0,
    }


def test_word_validation(admin_client):
    d = _create_dict(admin_client)
    bad = [
        {**WATER, "translations_ru": []},
        {**WATER, "translations_ru": ["a", "b", "c", "d", "e", "f"]},  # 6 > 5
        {**WATER, "article": "der"},
        {**WATER, "greek": "   "},
        {**WATER, "part_of_speech": "banana"},
    ]
    for body in bad:
        assert admin_client.post(f"/api/dictionaries/{d}/words", json=body).status_code == 422, body
    # Up to five translations are fine.
    five = ["вода", "водичка", "водица", "влага", "жидкость"]
    r = admin_client.post(f"/api/dictionaries/{d}/words", json={**WATER, "translations_ru": five})
    assert r.status_code == 201 and r.json()["translations_ru"] == five


def test_text_is_nfc_normalized_and_trimmed(admin_client):
    d = _create_dict(admin_client)
    decomposed = "νερό"  # ο + combining acute
    r = admin_client.post(
        f"/api/dictionaries/{d}/words",
        json={**WATER, "greek": f"  {decomposed} ", "translations_ru": [" вода ", "вода", ""]},
    )
    assert r.json()["greek"] == "νερό"
    assert r.json()["translations_ru"] == ["вода"]


def test_update_and_delete_word(admin_client):
    d = _create_dict(admin_client)
    wid = admin_client.post(f"/api/dictionaries/{d}/words", json=WATER).json()["id"]
    r = admin_client.put(
        f"/api/words/{wid}", json={**WATER, "translations_ru": ["вода", "водичка"]}
    )
    assert r.json()["translations_ru"] == ["вода", "водичка"]
    assert admin_client.delete(f"/api/words/{wid}").status_code == 204
    assert admin_client.get(f"/api/dictionaries/{d}").json()["words"] == []


def test_delete_dictionary_cascades(admin_client, member):
    d = _create_dict(admin_client)
    admin_client.post(f"/api/dictionaries/{d}/words", json=WATER)
    member.put(f"/api/dictionaries/{d}/active", json={"active": True})
    assert admin_client.delete(f"/api/dictionaries/{d}").status_code == 204
    assert member.get("/api/words/active/count").json() == {
        "dictionaries": 0,
        "categories": 0,
        "words": 0,
        "known": 0,
        "known_all": 0,
    }
    assert admin_client.get(f"/api/dictionaries/{d}").status_code == 404


def test_export_import_roundtrip(admin_client):
    data = json.loads((SEED / "demo_food_home.json").read_text(encoding="utf-8"))
    r = admin_client.post("/api/dictionaries/import", json=data)
    assert r.status_code == 201
    assert r.json()["word_count"] == len(data["words"])

    exported = admin_client.get(f"/api/dictionaries/{r.json()['id']}/export")
    assert exported.headers["content-disposition"].startswith("attachment")
    body = exported.json()
    assert body["title"] == data["title"]
    assert [w["greek"] for w in body["words"]] == [w["greek"] for w in data["words"]]

    again = admin_client.post("/api/dictionaries/import", json=body)
    assert again.json()["word_count"] == len(data["words"])


@pytest.mark.parametrize("path", sorted(SEED.glob("demo_*.json")), ids=lambda p: p.name)
def test_seed_files_are_valid(admin_client, path):
    data = json.loads(path.read_text(encoding="utf-8"))
    assert admin_client.post("/api/dictionaries/import", json=data).status_code == 201


def _png(color="red", size=(1200, 600)) -> bytes:
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


def test_upload_replace_and_remove_word_image(admin_client, member, tmp_path, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "media_dir", tmp_path)
    d = _create_dict(admin_client)
    wid = admin_client.post(f"/api/dictionaries/{d}/words", json=WATER).json()["id"]
    url = f"/api/words/{wid}/image"

    def upload(client, data, name="p.png"):
        return client.put(url, files={"file": (name, data, "image/png")})

    first = upload(admin_client, _png()).json()["image_url"]
    path1 = tmp_path / first.removeprefix("/media/")
    from PIL import Image

    assert max(Image.open(path1).size) == 900  # downscaled

    second = upload(admin_client, _png("blue")).json()["image_url"]
    assert second != first and not path1.exists()  # old file cleaned up

    assert upload(admin_client, b"not an image", "x.png").status_code == 400
    assert upload(member, _png()).status_code == 403

    r = admin_client.delete(url)
    assert r.json()["image_url"] is None
    assert not (tmp_path / second.removeprefix("/media/")).exists()
    assert admin_client.get(f"/api/dictionaries/{d}").json()["words"][0]["image_url"] is None


def test_seed_categories_cover_demo_words():
    import unicodedata

    def key(t):
        return unicodedata.normalize("NFC", t).casefold()

    cats = json.loads((SEED / "categories.json").read_text(encoding="utf-8"))["categories"]
    labelled = [key(w) for c in cats for w in c["words"]]
    assert len(labelled) == len(set(labelled)), "a word is listed in two categories"
    for path in SEED.glob("demo_*.json"):
        for w in json.loads(path.read_text(encoding="utf-8"))["words"]:
            assert key(w["greek"]) in labelled, f"{path.name}: {w['greek']} has no category"


def test_import_pasted_text(admin_client, member):
    answer = """Вот словарь:
```json
{"schema_version": 1, "title": "Список", "words": [
  {"article": "το", "greek": "νερό", "transcription": "to neró", "translations_ru": ["вода"],
   "part_of_speech": "noun", "image_emoji": "💧", "image_query": "water", "note": null}
]}
```"""
    r = admin_client.post("/api/dictionaries/import/text", json={"text": answer})
    assert r.status_code == 201, r.text
    d = admin_client.get(f"/api/dictionaries/{r.json()['id']}").json()
    assert d["title"] == "Список"
    assert [w["full_greek"] for w in d["words"]] == ["το νερό"]

    bad = admin_client.post(
        "/api/dictionaries/import/text",
        json={"text": '{"title": "x", "words": [{"greek": "λάθος", "translations_ru": []}]}'},
    )
    assert bad.status_code == 400
    assert "слово 1, поле translations_ru" in bad.json()["detail"]
    junk = admin_client.post("/api/dictionaries/import/text", json={"text": "привет"})
    assert junk.status_code == 400
    assert member.post("/api/dictionaries/import/text", json={"text": answer}).status_code == 403


def test_wordlist_prompt(admin_client):
    prompt = admin_client.get("/api/imports/prompt", params={"kind": "wordlist"}).text
    assert prompt.startswith("Ты помогаешь") and "Список слов:" in prompt
    assert "bbox" not in prompt
    assert admin_client.get("/api/imports/prompt", params={"kind": "x"}).status_code == 422


def test_reorder_words(admin_client, member):
    d = _create_dict(admin_client)
    ids = [
        admin_client.post(f"/api/dictionaries/{d}/words", json={**WATER, "greek": g}).json()["id"]
        for g in ("ένα", "δύο", "τρία")
    ]
    new = [ids[2], ids[0], ids[1]]
    assert (
        admin_client.put(f"/api/dictionaries/{d}/order", json={"word_ids": new}).status_code == 204
    )
    assert [w["id"] for w in admin_client.get(f"/api/dictionaries/{d}").json()["words"]] == new
    # Not every word, a stranger's word, a member: refused.
    assert (
        admin_client.put(f"/api/dictionaries/{d}/order", json={"word_ids": new[:2]}).status_code
        == 409
    )
    assert (
        admin_client.put(f"/api/dictionaries/{d}/order", json={"word_ids": [*new, 999]}).status_code
        == 409
    )
    assert member.put(f"/api/dictionaries/{d}/order", json={"word_ids": ids}).status_code == 403
