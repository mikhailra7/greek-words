"""«Автор» of dictionaries, categories and dialogues: set on creation, shown by name."""

from tests.conftest import create_invite, register

DIALOGUE = {
    "type": "dialogue",
    "title": "Д",
    "speakers": ["Α", "Β"],
    "lines": [
        {"speaker": 0, "greek": "Γεια!", "translation_ru": "Привет!"},
        {"speaker": 1, "greek": "Γεια σου!", "translation_ru": "Привет!"},
    ],
}


def test_author_set_and_shown(admin_client, make_client):
    julia = make_client()
    assert register(julia, "julia", create_invite(admin_client)).status_code == 201
    me = julia.get("/api/auth/me").json()
    assert (
        admin_client.patch(f"/api/admin/users/{me['id']}", json={"is_admin": True}).status_code
        == 200
    )

    d = admin_client.post("/api/dictionaries", json={"title": "Мой"}).json()
    assert d["author"] == "admin"
    imported = julia.post(
        "/api/dictionaries/import",
        json={"title": "Её", "words": [{"greek": "νερό", "translations_ru": ["вода"]}]},
    ).json()
    assert imported["author"] == "julia"
    listed = {
        x["title"]: x["author"]
        for x in admin_client.get("/api/dictionaries").json()["dictionaries"]
    }
    assert listed == {"Мой": "admin", "Её": "julia"}
    assert julia.get(f"/api/dictionaries/{d['id']}").json()["author"] == "admin"

    cat = julia.post("/api/categories", json={"name": "Фразы"}).json()
    assert cat["author"] == "julia"
    assert {c["name"]: c["author"] for c in admin_client.get("/api/categories").json()} == {
        "Фразы": "julia"
    }

    dlg = admin_client.post("/api/dialogues/import", json=DIALOGUE).json()
    assert dlg["author"] == "admin"
    assert julia.get("/api/dialogues").json()[0]["author"] == "admin"
