from collections.abc import Callable, Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401  (registers tables)
from app.db import Base, get_db, make_engine
from app.main import app
from app.ratelimit import invite_limiter, login_limiter


@pytest.fixture(autouse=True)
def offline_media(tmp_path, monkeypatch):
    """No network and no real DB/media from tests: fake TTS, no background warm-up."""
    from app.config import settings
    from app.services import tts

    async def fake_synthesize(text, dst, lang="el", v=tts.DEFAULT_VOICE):
        voice, rate = v.edge(lang)
        dst.write_bytes(f"ID3fake-mp3:{lang}:{voice}:{rate}:".encode() + text.encode())

    monkeypatch.setattr(settings, "media_dir", tmp_path / "media")
    monkeypatch.setattr(tts, "_synthesize", fake_synthesize)
    monkeypatch.setattr(tts, "warm_up", lambda *a, **k: None)


@pytest.fixture
def db_sessionmaker():
    engine = make_engine("sqlite://", poolclass=StaticPool)  # one shared in-memory DB per test
    Base.metadata.create_all(engine)
    yield sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    engine.dispose()


@pytest.fixture
def make_client(db_sessionmaker) -> Iterator[Callable[[], TestClient]]:
    """Factory: each call returns a client with its own cookie jar (= a separate browser)."""

    def override_get_db():
        with db_sessionmaker() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    login_limiter.reset()
    invite_limiter.reset()
    yield lambda: TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def client(make_client) -> TestClient:
    return make_client()


@pytest.fixture
def admin_client(make_client) -> TestClient:
    c = make_client()
    r = c.post("/api/auth/register", json={"username": "admin", "password": "secret1"})
    assert r.status_code == 201, r.text
    return c


def create_invite(admin_client: TestClient, **kwargs) -> str:
    r = admin_client.post("/api/admin/invites", json=kwargs)
    assert r.status_code == 201, r.text
    return r.json()["code"]


def register(client: TestClient, username: str, code: str, password: str = "secret1"):
    return client.post(
        "/api/auth/register",
        json={"username": username, "password": password, "invite_code": code},
    )
