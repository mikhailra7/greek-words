"""«Сортировка» по словарю и по категориям: /training/words?in_order=true&sort=…"""

from tests.conftest import create_invite, register


def _dict(client, title, words):
    d = client.post("/api/dictionaries", json={"title": title}).json()["id"]
    ids = [
        client.post(
            f"/api/dictionaries/{d}/words", json={"greek": g, "translations_ru": [g]}
        ).json()["id"]
        for g in words
    ]
    return d, ids


def _greek(client, **params):
    r = client.get("/api/training/words", params={"in_order": True, "count": 100, **params})
    assert r.status_code == 200, r.text
    return [w["greek"] for w in r.json()]


def test_dictionaries_in_list_order_then_categories(admin_client):
    a, a_ids = _dict(admin_client, "A", ["α1", "α2", "α3", "α4", "α5", "α6"])
    b, _ = _dict(admin_client, "B", ["β1", "β2"])
    _, d_ids = _dict(admin_client, "D (не отмечен)", ["δ1", "δ2", "δ3"])
    cat = admin_client.post("/api/categories", json={"name": "Кат"}).json()["id"]
    for wid in (d_ids[2], d_ids[0]):  # two words of D in the category
        admin_client.patch(f"/api/words/{wid}/category", json={"category_id": cat})
    for d in (b, a):  # ticked in the other order: the list order still wins
        admin_client.put(f"/api/dictionaries/{d}/active", json={"active": True})
    admin_client.put(f"/api/categories/{cat}/active", json={"active": True})

    assert _greek(admin_client) == ["α1", "α2", "α3", "α4", "α5", "α6", "β1", "β2", "δ1", "δ3"]
    # The order dragged on the dictionary page is the order here.
    admin_client.put(f"/api/dictionaries/{a}/order", json={"word_ids": a_ids[::-1]})
    assert _greek(admin_client)[:6] == ["α6", "α5", "α4", "α3", "α2", "α1"]


def test_fewer_words_proportional_unbroken_runs(admin_client):
    a, _ = _dict(admin_client, "A", [f"α{i}" for i in range(1, 7)])  # 6
    b, _ = _dict(admin_client, "B", ["β1", "β2"])  # 2
    for d in (a, b):
        admin_client.put(f"/api/dictionaries/{d}/active", json={"active": True})
    starts = set()
    for _ in range(30):
        got = _greek(admin_client, count=4)
        # 4 of 8: 3 from A (6/8), 1 from B (2/8); A first, each an unbroken run.
        assert len(got) == 4 and all(g.startswith("α") for g in got[:3]) and got[3].startswith("β")
        nums = [int(g[1:]) for g in got[:3]]
        assert nums == list(range(nums[0], nums[0] + 3))
        starts.add(nums[0])
    assert len(starts) > 1  # the start is random


def test_plain_order_is_random_and_not_affected(admin_client):
    a, _ = _dict(admin_client, "A", [f"α{i}" for i in range(1, 9)])
    admin_client.put(f"/api/dictionaries/{a}/active", json={"active": True})
    orders = {
        tuple(
            w["greek"] for w in admin_client.get("/api/training/words", params={"count": 8}).json()
        )
        for _ in range(10)
    }
    assert len(orders) > 1


def test_sort_by_categories(admin_client):
    """«Сортировка по категориям»: the ticked categories in list order, each by its own word
    order; then the rest of the pool as «по словарю»."""
    a, a_ids = _dict(admin_client, "A", ["α1", "α2", "α3"])
    _, b_ids = _dict(admin_client, "B (не отмечен)", ["β1", "β2"])
    first = admin_client.post("/api/categories", json={"name": "Первая"}).json()["id"]
    second = admin_client.post("/api/categories", json={"name": "Вторая"}).json()["id"]
    off = admin_client.post("/api/categories", json={"name": "Не отмечена"}).json()["id"]
    for wid, cat in ((a_ids[0], second), (b_ids[1], second), (b_ids[0], first), (a_ids[2], off)):
        admin_client.patch(f"/api/words/{wid}/category", json={"category_id": cat})
    admin_client.put(f"/api/dictionaries/{a}/active", json={"active": True})
    for cat in (first, second):
        admin_client.put(f"/api/categories/{cat}/active", json={"active": True})

    def by_cat(**params):
        return _greek(admin_client, sort="category", **params)

    # Not placed yet: inside a category by dictionary and position.
    assert by_cat() == ["β1", "α1", "β2", "α2", "α3"]
    assert _greek(admin_client) == ["α1", "α2", "α3", "β1", "β2"]  # «по словарю» as before

    r = admin_client.put(f"/api/categories/{second}/order", json={"word_ids": [b_ids[1], a_ids[0]]})
    assert r.status_code == 204, r.text
    assert by_cat() == ["β1", "β2", "α1", "α2", "α3"]
    page = admin_client.get(f"/api/categories/{second}").json()
    assert [w["greek"] for w in page["words"]] == ["β2", "α1"]

    # A word moved to another category goes to its end, not to its old place number.
    admin_client.patch(f"/api/words/{a_ids[1]}/category", json={"category_id": second})
    assert by_cat() == ["β1", "β2", "α1", "α2", "α3"]
    admin_client.put(
        f"/api/categories/{second}/order", json={"word_ids": [a_ids[1], b_ids[1], a_ids[0]]}
    )
    admin_client.patch(f"/api/words/{a_ids[1]}/category", json={"category_id": first})
    admin_client.patch(f"/api/words/{a_ids[1]}/category", json={"category_id": second})
    assert [w["greek"] for w in admin_client.get(f"/api/categories/{second}").json()["words"]] == [
        "β2",
        "α1",
        "α2",
    ]


def test_category_order_admin_only_and_complete(admin_client, make_client):
    _, ids = _dict(admin_client, "A", ["α1", "α2"])
    cat = admin_client.post("/api/categories", json={"name": "К"}).json()["id"]
    for wid in ids:
        admin_client.patch(f"/api/words/{wid}/category", json={"category_id": cat})
    r = admin_client.put(f"/api/categories/{cat}/order", json={"word_ids": ids[:1]})
    assert r.status_code == 409
    member = make_client()
    register(member, "bob", create_invite(admin_client))
    r = member.put(f"/api/categories/{cat}/order", json={"word_ids": ids[::-1]})
    assert r.status_code == 403
