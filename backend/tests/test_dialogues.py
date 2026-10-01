import copy
import json

import pytest

from app import cli
from app.config import settings
from app.services import tts
from tests.conftest import create_invite, register

DIALOGUE = {
    "schema_version": 1,
    "type": "dialogue",
    "title": "Знакомство",
    "speakers": ["Μαρία", "Νίκος"],
    "lines": [
        {
            "speaker": 0,
            "greek": "Γεια σου! Πώς σε λένε;",
            "transcription": "Ya su! Pos se léne?",
            "translation_ru": "Привет! Как тебя зовут?",
            "note": None,
        },
        {
            "speaker": 1,
            "greek": "Με λένε Νίκο. Εσένα;",
            "transcription": None,  # Claude couldn't transcribe it: fine
            "translation_ru": "Меня зовут Никос. А тебя?",
        },
    ],
}


def dialogue(**changes) -> dict:
    d = copy.deepcopy(DIALOGUE)
    d.update(changes)
    return d


@pytest.fixture
def member(admin_client, make_client):
    c = make_client()
    assert register(c, "anna", create_invite(admin_client)).status_code == 201
    return c


def test_import_list_and_read(admin_client, member):
    r = admin_client.post("/api/dialogues/import", json=DIALOGUE)
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["title"] == "Знакомство" and d["speakers"] == ["Μαρία", "Νίκος"]
    assert [x["speaker"] for x in d["lines"]] == [0, 1]
    assert d["lines"][1]["transcription"] == ""
    assert d["lines"][0]["audio_url"].startswith(
        f"/api/dialogue-lines/{d['lines'][0]['id']}/audio?v="
    )

    # Everyone in the group sees it; only admins may change it.
    listed = member.get("/api/dialogues").json()
    assert listed == [
        {
            "id": d["id"],
            "title": "Знакомство",
            "speakers": ["Μαρία", "Νίκος"],
            "line_count": 2,
            "can_edit": False,
        }
    ]
    assert (
        member.get(f"/api/dialogues/{d['id']}").json()["lines"][0]["greek"]
        == "Γεια σου! Πώς σε λένε;"
    )
    assert member.post("/api/dialogues/import", json=DIALOGUE).status_code == 403
    assert member.delete(f"/api/dialogues/{d['id']}").status_code == 403
    assert member.get(f"/api/dialogues/{d['id']}/export").status_code == 403
    assert member.get("/api/dialogues/999").status_code == 404


@pytest.mark.parametrize(
    ("data", "message"),
    [
        (
            dialogue(
                lines=[*DIALOGUE["lines"], {"speaker": 2, "greek": "Α", "translation_ru": "А"}]
            ),
            "реплика 3: роли с номером 2 нет",
        ),
        (
            dialogue(lines=[{"speaker": 0, "greek": "Γεια"}, DIALOGUE["lines"][1]]),
            "реплика 1, поле translation_ru: нет значения",
        ),
        (dialogue(lines=DIALOGUE["lines"][:1]), "поле lines: нужно минимум 2"),
        (dialogue(speakers=["Μαρία"]), "роли (speakers): нужно минимум 2"),
        (
            dialogue(lines=[{**DIALOGUE["lines"][0], "greek": "  "}, DIALOGUE["lines"][1]]),
            "реплика 1, поле greek: пусто",
        ),
        ({"schema_version": 1, "title": "Еда", "words": []}, "Это словарь, а не диалог"),
        (dialogue(type="dictionary"), 'должно быть "type": "dialogue"'),
    ],
)
def test_readable_errors(admin_client, data, message):
    r = admin_client.post("/api/dialogues/import", json=data)
    assert r.status_code == 400
    assert message in r.json()["detail"], r.json()["detail"]


def test_paste_from_chat(admin_client):
    text = "Вот диалог:\n```json\n" + json.dumps(DIALOGUE, ensure_ascii=False) + "\n```\nГотово!"
    r = admin_client.post("/api/dialogues/import/text", json={"text": text})
    assert r.status_code == 201, r.text
    assert len(r.json()["lines"]) == 2
    bad = admin_client.post("/api/dialogues/import/text", json={"text": "нет тут JSON"})
    assert bad.status_code == 400 and "Не нашёл JSON" in bad.json()["detail"]


def _audio_files() -> list[str]:
    root = settings.media_dir / tts.DIALOGUE_DIR
    return sorted(p.name for p in root.glob("*.mp3")) if root.exists() else []


def test_audio_voice_per_request(admin_client, monkeypatch):
    d = admin_client.post("/api/dialogues/import", json=DIALOGUE).json()
    line = d["lines"][0]
    spoken = []
    real = tts._synthesize

    async def recording(text, dst, lang="el", v=tts.DEFAULT_VOICE):
        spoken.append((text, v.key(lang)))
        await real(text, dst, lang, v)

    monkeypatch.setattr(tts, "_synthesize", recording)

    female = admin_client.get(line["audio_url"])
    assert female.status_code == 200 and female.headers["content-type"] == "audio/mpeg"
    male = admin_client.get(line["audio_url"] + "&voice=male&rate=0")
    assert male.status_code == 200
    admin_client.get(line["audio_url"])  # cached: not made again
    assert spoken == [("Γεια σου! Πώς σε λένε;", "f-10"), ("Γεια σου! Πώς σε λένε;", "m+0")]
    assert len(_audio_files()) == 2
    assert admin_client.get("/api/dialogue-lines/999/audio").status_code == 404

    def down(*a, **k):
        raise tts.TTSUnavailable("Озвучка сейчас недоступна")

    monkeypatch.setattr(tts, "_generate", down)
    assert admin_client.get(d["lines"][1]["audio_url"]).status_code == 503


def test_role_voices():
    assert [tts.role_voice(i).male for i in range(3)] == [False, True, False]


def test_replace_export_delete(admin_client):
    d = admin_client.post("/api/dialogues/import", json=DIALOGUE).json()
    admin_client.get(d["lines"][0]["audio_url"])
    assert len(_audio_files()) == 1

    new = dialogue(
        title="Знакомство (новое)",
        lines=[
            *DIALOGUE["lines"],
            {"speaker": 0, "greek": "Χαίρω πολύ!", "translation_ru": "Очень приятно!"},
        ],
    )
    r = admin_client.put(f"/api/dialogues/{d['id']}/import", json=new)
    assert r.status_code == 200, r.text
    assert r.json()["id"] == d["id"] and r.json()["line_count"] == 3
    assert _audio_files() == []  # the old lines' audio is gone

    exported = admin_client.get(f"/api/dialogues/{d['id']}/export")
    assert "attachment" in exported.headers["content-disposition"]
    data = exported.json()
    assert data["type"] == "dialogue" and data["title"] == "Знакомство (новое)"
    assert [x["greek"] for x in data["lines"]][-1] == "Χαίρω πολύ!"
    # The export loads back as it is.
    assert admin_client.post("/api/dialogues/import", json=data).status_code == 201

    admin_client.get(r.json()["lines"][0]["audio_url"])
    assert admin_client.delete(f"/api/dialogues/{d['id']}").status_code == 204
    assert _audio_files() == []
    assert admin_client.get(f"/api/dialogues/{d['id']}").status_code == 404
    assert len(admin_client.get("/api/dialogues").json()) == 1


def test_seed_dialogues_once(db_sessionmaker, monkeypatch, capsys):
    monkeypatch.setattr(cli, "SessionLocal", db_sessionmaker)
    assert cli.seed_dialogues() == 0
    assert cli.seed_dialogues() == 0
    out = capsys.readouterr().out
    assert "создан диалог: Знакомство (7 реплик)" in out and "уже есть: Знакомство" in out


def test_prompt_for_claude(admin_client, member):
    r = admin_client.get("/api/imports/prompt", params={"kind": "dialogue"})
    assert r.status_code == 200
    assert '"type": "dialogue"' in r.text and "Γεια σου!" in r.text
    assert member.get("/api/imports/prompt", params={"kind": "dialogue"}).status_code == 403


def test_dialogue_settings_are_kept(member):
    value = {
        "mode": "roles",
        "greek": True,
        "transcription": False,
        "translation": True,
        "oneVoice": True,
    }
    assert member.put("/api/me/settings/dialogue", json={"value": value}).status_code == 204
    assert member.get("/api/me/settings").json()["dialogue"] == value
