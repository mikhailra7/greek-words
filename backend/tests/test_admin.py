from tests.conftest import create_invite, register


def _user_id(admin_client, username: str) -> int:
    users = admin_client.get("/api/admin/users").json()["users"]
    return next(u["id"] for u in users if u["username"] == username)


def test_non_admin_cannot_use_admin_api(admin_client, make_client, client):
    assert client.get("/api/admin/users").status_code == 401

    bob = make_client()
    register(bob, "bob", create_invite(admin_client))
    assert bob.get("/api/admin/users").status_code == 403
    assert bob.post("/api/admin/invites", json={}).status_code == 403


def test_grant_and_revoke_admin(admin_client, make_client):
    bob = make_client()
    register(bob, "bob", create_invite(admin_client))
    bob_id = _user_id(admin_client, "bob")

    assert (
        admin_client.patch(f"/api/admin/users/{bob_id}", json={"is_admin": True}).status_code == 200
    )
    assert bob.get("/api/admin/users").status_code == 200  # rights apply immediately

    # bob (now admin) revokes the original admin; bob stays as the last admin
    admin_id = _user_id(admin_client, "admin")
    assert bob.patch(f"/api/admin/users/{admin_id}", json={"is_admin": False}).status_code == 200
    r = bob.patch(f"/api/admin/users/{bob_id}", json={"is_admin": False})
    assert r.status_code == 400
    assert "последнего" in r.json()["detail"]


def test_reset_password(admin_client, make_client):
    bob = make_client()
    register(bob, "bob", create_invite(admin_client), password="oldpass1")
    r = admin_client.post(f"/api/admin/users/{_user_id(admin_client, 'bob')}/reset-password")
    temp = r.json()["password"]

    assert bob.get("/api/auth/me").status_code == 401  # old sessions dropped
    fresh = make_client()
    assert (
        fresh.post("/api/auth/login", json={"username": "bob", "password": "oldpass1"}).status_code
        == 401
    )
    assert (
        fresh.post("/api/auth/login", json={"username": "bob", "password": temp}).status_code == 200
    )


def test_delete_user(admin_client, make_client):
    bob = make_client()
    register(bob, "bob", create_invite(admin_client))
    bob_id = _user_id(admin_client, "bob")

    assert (
        admin_client.delete(f"/api/admin/users/{_user_id(admin_client, 'admin')}").status_code
        == 400
    )
    assert admin_client.delete(f"/api/admin/users/{bob_id}").status_code == 204
    assert bob.get("/api/auth/me").status_code == 401
    assert [u["username"] for u in admin_client.get("/api/admin/users").json()["users"]] == [
        "admin"
    ]
