from datetime import timedelta

from sqlalchemy import select

from app.config import settings
from app.models import InviteCode
from app.timeutil import utcnow
from tests.conftest import create_invite, register


def test_first_user_is_admin_without_code(client):
    assert client.get("/api/auth/status").json() == {"has_users": False, "registration_open": True}
    r = client.post("/api/auth/register", json={"username": "Maria", "password": "secret1"})
    assert r.status_code == 201
    assert r.json()["is_admin"] is True
    assert client.get("/api/auth/me").json()["username"] == "Maria"


def test_second_user_needs_valid_code(admin_client, make_client):
    c = make_client()
    assert (
        c.post("/api/auth/register", json={"username": "bob", "password": "secret1"}).status_code
        == 400
    )
    assert register(c, "bob", "WRONG-CODE").status_code == 400

    code = create_invite(admin_client)
    r = register(c, "bob", code.lower())  # codes are case-insensitive
    assert r.status_code == 201
    assert r.json()["is_admin"] is False


def test_invite_max_uses_expiry_and_disable(admin_client, make_client, db_sessionmaker):
    one_shot = create_invite(admin_client, max_uses=1)
    assert register(make_client(), "u1", one_shot).status_code == 201
    assert register(make_client(), "u2", one_shot).status_code == 400

    expiring = create_invite(admin_client, expires_in_days=1)
    with db_sessionmaker() as db:
        inv = db.scalar(select(InviteCode).where(InviteCode.code == expiring))
        inv.expires_at = utcnow() - timedelta(seconds=1)
        db.commit()
    assert register(make_client(), "u3", expiring).status_code == 400

    disabled = create_invite(admin_client)
    invite_id = next(
        i["id"] for i in admin_client.get("/api/admin/invites").json() if i["code"] == disabled
    )
    r = admin_client.patch(f"/api/admin/invites/{invite_id}", json={"is_active": False})
    assert r.json()["usable"] is False
    assert register(make_client(), "u4", disabled).status_code == 400


def test_user_limit(admin_client, make_client, monkeypatch):
    monkeypatch.setattr(settings, "max_users", 3)
    code = create_invite(admin_client)
    assert register(make_client(), "u1", code).status_code == 201
    assert register(make_client(), "u2", code).status_code == 201
    r = register(make_client(), "u3", code)
    assert r.status_code == 403
    assert "лимит" in r.json()["detail"]
    assert admin_client.get("/api/auth/status").json()["registration_open"] is False


def test_username_unique_case_insensitive(admin_client, make_client):
    code = create_invite(admin_client)
    assert register(make_client(), "ADMIN", code).status_code == 409


def test_login_logout(admin_client, make_client):
    c = make_client()
    assert (
        c.post("/api/auth/login", json={"username": "admin", "password": "nope"}).status_code == 401
    )
    assert (
        c.post("/api/auth/login", json={"username": "Admin", "password": "secret1"}).status_code
        == 200
    )
    assert c.get("/api/auth/me").status_code == 200
    assert c.post("/api/auth/logout").status_code == 204
    assert c.get("/api/auth/me").status_code == 401


def test_login_rate_limit(admin_client, make_client):
    c = make_client()
    for _ in range(10):
        c.post("/api/auth/login", json={"username": "admin", "password": "nope"})
    r = c.post("/api/auth/login", json={"username": "admin", "password": "secret1"})
    assert r.status_code == 429


def test_change_password_logs_out_other_devices(admin_client, make_client):
    other = make_client()
    other.post("/api/auth/login", json={"username": "admin", "password": "secret1"})

    r = admin_client.post(
        "/api/auth/change-password",
        json={"current_password": "wrong", "new_password": "newpass1"},
    )
    assert r.status_code == 400
    r = admin_client.post(
        "/api/auth/change-password",
        json={"current_password": "secret1", "new_password": "newpass1"},
    )
    assert r.status_code == 204
    assert admin_client.get("/api/auth/me").status_code == 200
    assert other.get("/api/auth/me").status_code == 401


def test_validation_errors_are_readable(client):
    r = client.post("/api/auth/register", json={"username": "a b", "password": "123"})
    assert r.status_code == 422
    assert "Имя" in r.json()["detail"] and "Пароль" in r.json()["detail"]


def test_cyrillic_username_case_insensitive(admin_client, make_client):
    code = create_invite(admin_client)
    assert register(make_client(), "Мария", code).status_code == 201
    assert register(make_client(), "мария", code).status_code == 409
    c = make_client()
    r = c.post("/api/auth/login", json={"username": "МАРИЯ", "password": "secret1"})
    assert r.status_code == 200 and r.json()["username"] == "Мария"
