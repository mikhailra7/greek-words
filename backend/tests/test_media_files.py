import sqlite3

from fastapi.testclient import TestClient

from app import cli
from app.config import settings
from app.main import app


def _put(rel: str, data: bytes) -> None:
    path = settings.media_dir / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def test_media_needs_a_session(admin_client, make_client):
    _put("images/abc.jpg", b"jpeg-bytes")
    assert make_client().get("/media/images/abc.jpg").status_code == 401

    r = admin_client.get("/media/images/abc.jpg")
    assert r.status_code == 200 and r.content == b"jpeg-bytes"
    assert r.headers["content-type"] == "image/jpeg"
    assert "private" in r.headers["cache-control"]


def test_media_range_and_missing(admin_client):
    _put("audio/1.mp3", b"0123456789")
    r = admin_client.get("/media/audio/1.mp3", headers={"Range": "bytes=2-5"})
    assert r.status_code == 206 and r.content == b"2345"
    assert admin_client.head("/media/audio/1.mp3").status_code == 200
    assert admin_client.get("/media/audio/none.mp3").status_code == 404
    assert admin_client.get("/media/audio").status_code == 404  # a folder, not a file


def test_media_never_leaves_media_dir(admin_client, tmp_path):
    (tmp_path / "secret.txt").write_text("nope")  # media_dir is tmp_path / "media"
    for path in ("/media/../secret.txt", "/media/%2e%2e/secret.txt", "/media/..%2fsecret.txt"):
        assert admin_client.get(path).status_code == 404, path


def test_docs_hidden_outside_dev(monkeypatch):
    monkeypatch.setattr(settings, "env", "prod")
    from app.main import create_app

    client = TestClient(create_app())
    assert client.get("/api/docs").status_code == 404
    assert client.get("/api/openapi.json").status_code == 404
    assert TestClient(app).get("/api/docs").status_code == 200  # the dev app (env=dev)


def test_session_cookie_is_secure_outside_dev(make_client, monkeypatch):
    monkeypatch.setattr(settings, "env", "prod")
    r = make_client().post("/api/auth/register", json={"username": "adm", "password": "secret1"})
    assert r.status_code == 201
    cookie = r.headers["set-cookie"].lower()
    assert "secure" in cookie and "httponly" in cookie


def test_cli_backup_copies_a_live_db(tmp_path, monkeypatch, capsys):
    src = tmp_path / "live.db"
    db = sqlite3.connect(src)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("CREATE TABLE t (x)")
    db.execute("INSERT INTO t VALUES (1), (2)")
    db.commit()  # left open: rows may still sit in the WAL file, as on a running site
    monkeypatch.setattr(settings, "database_url", f"sqlite:///{src}")

    dst = tmp_path / "backups" / "copy.db"
    assert cli.backup(str(dst)) == 0
    assert sqlite3.connect(dst).execute("SELECT count(*) FROM t").fetchone()[0] == 2
    assert cli.backup(str(dst)) == 1  # never overwrites an existing file
    db.close()
