import io

import pytest
from PIL import Image

from app.services import stock, tts
from tests.conftest import create_invite, register

WATER = {"article": "το", "greek": "νερό", "translations_ru": ["вода"]}


@pytest.fixture
def word(admin_client) -> dict:
    d = admin_client.post("/api/dictionaries", json={"title": "Урок"}).json()["id"]
    return admin_client.post(f"/api/dictionaries/{d}/words", json=WATER).json()


def test_audio_generated_on_demand_and_cached(admin_client, word, monkeypatch):
    calls = []
    real = tts._synthesize

    async def counting(text, dst, lang="el", v=tts.DEFAULT_VOICE):
        calls.append(text)
        await real(text, dst, lang, v)

    monkeypatch.setattr(tts, "_synthesize", counting)
    r = admin_client.get(word["audio_url"])
    assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg"
    # The article is spoken, separated by a comma so the voice doesn't swallow it.
    assert r.content.endswith("το, νερό".encode())
    admin_client.get(word["audio_url"])
    assert calls == ["το, νερό"]  # second time from cache


def test_russian_audio(admin_client, word):
    assert word["audio_ru_url"].startswith(f"/api/words/{word['id']}/audio/ru?v=")
    r = admin_client.get(word["audio_ru_url"])
    assert r.status_code == 200
    assert r.content == "ID3fake-mp3:ru:ru-RU-SvetlanaNeural:+0%:вода".encode()

    # Translations change → new Russian audio, Greek audio untouched; and vice versa.
    changed = admin_client.put(
        f"/api/words/{word['id']}", json={**WATER, "translations_ru": ["вода", "водичка"]}
    ).json()
    assert changed["audio_ru_url"] != word["audio_ru_url"]
    assert changed["audio_url"] == word["audio_url"]
    assert admin_client.get(changed["audio_ru_url"]).content.endswith("вода, водичка".encode())


def test_audio_follows_text_changes(admin_client, word):
    admin_client.get(word["audio_url"])
    changed = admin_client.put(
        f"/api/words/{word['id']}", json={**WATER, "greek": "γάλα", "translations_ru": ["молоко"]}
    ).json()
    assert changed["audio_url"] != word["audio_url"]
    assert admin_client.get(changed["audio_url"]).content.endswith("το, γάλα".encode())

    same = admin_client.put(
        f"/api/words/{word['id']}",
        json={**WATER, "greek": "γάλα", "translations_ru": ["молоко", "молочко"]},
    ).json()
    assert same["audio_url"] == changed["audio_url"]  # translation edits keep the audio


def test_audio_retries_flaky_service(admin_client, word, monkeypatch):
    calls = []
    real = tts._synthesize

    async def flaky(text, dst, lang="el", v=tts.DEFAULT_VOICE):
        calls.append(text)
        if len(calls) < 3:
            raise RuntimeError("No audio was received")
        await real(text, dst, lang, v)

    monkeypatch.setattr(tts, "_synthesize", flaky)
    monkeypatch.setattr(tts, "RETRY_DELAY", 0)
    assert admin_client.get(word["audio_url"]).status_code == 200
    assert len(calls) == 3


def test_audio_unavailable_is_503(admin_client, word, monkeypatch):
    async def broken(text, dst, lang="el", v=tts.DEFAULT_VOICE):
        raise ConnectionError("no network")

    monkeypatch.setattr(tts, "_synthesize", broken)
    monkeypatch.setattr(tts, "RETRY_DELAY", 0)
    r = admin_client.get(word["audio_url"])
    assert r.status_code == 503 and "Озвучка" in r.json()["detail"]


def test_members_hear_but_cannot_regenerate(admin_client, make_client, word):
    bob = make_client()
    register(bob, "bob", create_invite(admin_client))
    assert bob.get(word["audio_url"]).status_code == 200
    assert bob.post(f"/api/words/{word['id']}/audio/regenerate").status_code == 403
    assert admin_client.post(f"/api/words/{word['id']}/audio/regenerate").status_code == 200


def _jpeg() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (640, 480), "orange").save(buf, "JPEG")
    return buf.getvalue()


@pytest.fixture
def fake_stock(monkeypatch):
    img = stock.StockImage(id="abc-1", thumb_url="t", full_url="f", credit="Ann · CC BY 4.0")
    monkeypatch.setattr(stock, "search", lambda q, limit=18: [img] if q else [])
    monkeypatch.setattr(stock, "get", lambda i: img if i == "abc-1" else _raise())
    monkeypatch.setattr(stock, "download", lambda i: _jpeg())


def _raise():
    raise stock.StockError("Картинка не найдена на стоке")


def test_stock_search_and_choose(admin_client, word, fake_stock):
    r = admin_client.get("/api/stock/search", params={"q": "water"})
    assert r.json()["results"][0]["id"] == "abc-1"
    assert r.json()["results"][0]["thumb_url"] == "/api/stock/thumb/abc-1"
    assert admin_client.get("/api/stock/thumb/never-searched").status_code == 404

    chosen = admin_client.put(f"/api/words/{word['id']}/image/stock", json={"id": "abc-1"})
    body = chosen.json()
    assert body["image_url"].startswith("/media/images/")
    assert body["image_credit"] == "Ann · CC BY 4.0"

    r = admin_client.put(f"/api/words/{word['id']}/image/stock", json={"id": "nope"})
    assert r.status_code == 502

    # Own upload replaces the stock picture and drops its credit.
    up = admin_client.put(
        f"/api/words/{word['id']}/image", files={"file": ("a.jpg", _jpeg(), "image/jpeg")}
    )
    assert up.json()["image_credit"] is None


def test_stock_admin_only(admin_client, make_client, word, fake_stock):
    bob = make_client()
    register(bob, "bob", create_invite(admin_client))
    assert bob.get("/api/stock/search", params={"q": "x"}).status_code == 403
    r = bob.put(f"/api/words/{word['id']}/image/stock", json={"id": "abc-1"})
    assert r.status_code == 403


def test_lead_in_silence_added(tmp_path):
    import numpy as np
    import soundfile as sf

    rate = 24000
    tone = 0.5 * np.sin(np.linspace(0, 2 * np.pi * 440, rate))  # 1 s beep, starts at once
    path = tmp_path / "beep.mp3"
    sf.write(path, tone, rate, format="MP3", subtype="MPEG_LAYER_III")

    tts._shape(path)

    data, sr = sf.read(path)
    first_loud = np.argmax(np.abs(data) > 0.1) / sr
    assert first_loud >= tts.LEAD_IN_SECONDS - 0.02
    assert abs(len(data) / sr - (1 + tts.LEAD_IN_SECONDS)) < 0.1


def test_voice_and_speed_per_request(admin_client, word):
    from app.config import settings

    url = word["audio_url"]
    default = admin_client.get(url).content
    assert default.startswith(b"ID3fake-mp3:el:el-GR-AthinaNeural:-10%:")
    male = admin_client.get(url + "&voice=male&rate=0").content
    assert male.startswith(b"ID3fake-mp3:el:el-GR-NestorasNeural:+0%:")
    slow = admin_client.get(url + "&rate=-20").content
    assert slow.startswith(b"ID3fake-mp3:el:el-GR-AthinaNeural:-20%:")
    # The explicit default is the same file as no parameters (no second copy).
    assert admin_client.get(url + "&voice=female&rate=-10").content == default
    ru = admin_client.get(word["audio_ru_url"] + "&voice=male").content
    assert ru.startswith(b"ID3fake-mp3:ru:ru-RU-DmitryNeural:+0%:")
    assert admin_client.get(url + "&rate=-15").status_code == 422
    assert admin_client.get(url + "&voice=robot").status_code == 422

    variants = sorted(p.name for p in (settings.media_dir / "audio/v").iterdir())
    wid = word["id"]
    assert [v.split("_")[:2] for v in variants] == [
        [str(wid), "f-20"],
        [str(wid), "m+0"],
        [str(wid), "ru"],
    ]
    # Regenerating / deleting the word removes every voice.
    admin_client.post(f"/api/words/{wid}/audio/regenerate")
    assert list((settings.media_dir / "audio/v").iterdir()) == []
    admin_client.get(url + "&voice=male")
    admin_client.delete(f"/api/words/{wid}")
    assert list((settings.media_dir / "audio/v").iterdir()) == []


def test_voice_sample(admin_client):
    r = admin_client.get("/api/tts/sample", params={"voice": "male", "rate": 10})
    assert r.status_code == 200
    assert r.content.startswith("ID3fake-mp3:el:el-GR-NestorasNeural:+10%:Καλημέρα".encode())
    ru = admin_client.get("/api/tts/sample", params={"lang": "ru"}).content
    assert ru.startswith(b"ID3fake-mp3:ru:ru-RU-SvetlanaNeural")


def _beep_file(path, seconds_loud=0.5, seconds_quiet=1.0, rate=24000):
    import numpy as np
    import soundfile as sf

    t = np.linspace(0, seconds_loud, int(rate * seconds_loud))
    tone = 0.5 * np.sin(2 * np.pi * 440 * t)
    sf.write(path, np.concatenate([tone, np.zeros(int(rate * seconds_quiet))]), rate,
             format="MP3", subtype="MPEG_LAYER_III")  # fmt: skip


def test_silence_at_the_end_is_cut(tmp_path):
    import soundfile as sf

    path = tmp_path / "word.mp3"
    _beep_file(path)
    tts._shape(path)
    data, sr = sf.read(path)
    expected = tts.LEAD_IN_SECONDS + 0.5 + tts.TAIL_SECONDS
    assert abs(len(data) / sr - expected) < 0.08  # was 0.3 + 0.5 + 1.0


def test_old_format_file_converted_without_the_service(admin_client, word, db_sessionmaker):
    import soundfile as sf

    from app.config import settings
    from app.models import Word

    # A file made before the tail was cut (format version 2), as the DB remembers it.
    with db_sessionmaker() as db:
        w = db.get(Word, word["id"])
        old_rel = tts._rel_path(w, "el", tts.AUDIO_FORMAT_VERSION - 1)
        (settings.media_dir / "audio").mkdir(parents=True, exist_ok=True)
        _beep_file(settings.media_dir / old_rel)
        w.audio_path = old_rel
        db.commit()

    async def no_service(*a, **k):
        raise AssertionError("the service must not be called")

    import pytest as _pytest

    with _pytest.MonkeyPatch.context() as mp:
        mp.setattr(tts, "_synthesize", no_service)
        r = admin_client.get(word["audio_url"])
    assert r.status_code == 200
    assert not (settings.media_dir / old_rel).exists()
    with db_sessionmaker() as db:
        new_rel = db.get(Word, word["id"]).audio_path
    assert new_rel != old_rel
    data, sr = sf.read(settings.media_dir / new_rel)
    assert len(data) / sr < 0.5 + tts.TAIL_SECONDS + 0.1  # lead-in not added twice, tail cut
