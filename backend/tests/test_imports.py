import io
import json
import zipfile
from pathlib import Path

import pymupdf
import pytest
from PIL import Image

from app.config import settings
from tests.conftest import create_invite, register

SAMPLES = Path(__file__).parents[2] / "docs" / "samples"

# Page 1: red square at x 0.2-0.4, y 0.1-0.3 with a caption below; page 2: blue square.
RED = (0.2, 0.1, 0.4, 0.3)
BLUE = (0.5, 0.5, 0.7, 0.7)


def make_pdf() -> bytes:
    doc = pymupdf.open()
    for color, (x0, y0, x1, y1), caption in (((1, 0, 0), RED, "νερό"), ((0, 0, 1), BLUE, "ψωμί")):
        page = doc.new_page(width=600, height=800)
        rect = pymupdf.Rect(x0 * 600, y0 * 800, x1 * 600, y1 * 800)
        page.draw_rect(rect, color=color, fill=color)
        page.insert_text((rect.x0, rect.y1 + 20), caption, fontsize=14)
    return doc.tobytes()


def claude_answer(**overrides) -> str:
    words = [
        {
            "article": "το",
            "greek": "νερό",
            "transcription": "to neró",
            "translations_ru": ["вода"],
            "part_of_speech": "noun",
            "image_emoji": "💧",
            "page": 2,  # page 2 of the Claude PDF = source page 1 (pages chosen as [2, 1])
            "bbox": list(RED),
            "note": None,
        },
        {
            "article": "το",
            "greek": "ψωμί",
            "transcription": "to psomí",
            "translations_ru": ["хлеб"],
            "part_of_speech": "noun",
            "image_emoji": "🍞",
            "page": 1,
            "bbox": list(BLUE),
            "note": None,
        },
    ]
    data = {"schema_version": 1, "title": "Урок 3", "words": words, **overrides}
    return "Вот словарь:\n```json\n" + json.dumps(data, ensure_ascii=False) + "\n```"


def dominant(content: bytes) -> tuple[int, int, int]:
    img = Image.open(io.BytesIO(content)).convert("RGB")
    return img.resize((1, 1)).getpixel((0, 0))


@pytest.fixture(autouse=True)
def tmp_dirs(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "imports_dir", tmp_path / "imports")
    monkeypatch.setattr(settings, "media_dir", tmp_path / "media")


def upload(client, files) -> dict:
    r = client.post("/api/imports", files=[("files", f) for f in files])
    assert r.status_code == 201, r.text
    return r.json()


def ready_job(admin_client) -> dict:
    job = upload(admin_client, [("book.pdf", make_pdf(), "application/pdf")])
    admin_client.post(f"/api/imports/{job['id']}/pages", json={"pages": [2, 1]})
    r = admin_client.post(f"/api/imports/{job['id']}/json", json={"text": claude_answer()})
    assert r.status_code == 200, r.text
    return r.json()


def test_full_paste_flow(admin_client):
    job = upload(admin_client, [("book.pdf", make_pdf(), "application/pdf")])
    assert job["status"] == "uploaded" and job["page_count"] == 2
    preview = admin_client.get(f"/api/imports/{job['id']}/previews/1.jpg")
    assert preview.headers["content-type"] == "image/jpeg"

    r = admin_client.post(f"/api/imports/{job['id']}/pages", json={"pages": [2, 1]})
    assert r.json()["status"] == "awaiting_json"
    assert r.json()["claude_pages"] == 2
    claude_pdf = admin_client.get(f"/api/imports/{job['id']}/claude.pdf")
    assert pymupdf.open(stream=claude_pdf.content, filetype="pdf").page_count == 2

    prompt = admin_client.get("/api/imports/prompt").text
    assert prompt.startswith("Ты помогаешь") and "bbox" in prompt

    r = admin_client.post(f"/api/imports/{job['id']}/json", json={"text": claude_answer()})
    detail = r.json()
    assert detail["status"] == "review"
    water, bread = detail["words"]
    red = dominant(admin_client.get(water["image_url"]).content)
    blue = dominant(admin_client.get(bread["image_url"]).content)
    assert red[0] > 200 and red[2] < 80, red  # crop landed on the red square
    assert blue[2] > 200 and blue[0] < 80, blue

    r = admin_client.post(f"/api/imports/{job['id']}/publish", json={"title": "Урок 3"})
    assert r.status_code == 200, r.text
    d = admin_client.get(f"/api/dictionaries/{r.json()['id']}").json()
    assert [w["full_greek"] for w in d["words"]] == ["το νερό", "το ψωμί"]
    assert all(w["image_url"].startswith("/media/images/") for w in d["words"])
    stored = settings.media_dir / d["words"][0]["image_url"].removeprefix("/media/")
    assert stored.exists()
    assert admin_client.get(f"/api/imports/{job['id']}").json()["status"] == "done"


def test_paste_errors_are_readable(admin_client):
    job = upload(admin_client, [("book.pdf", make_pdf(), "application/pdf")])
    url = f"/api/imports/{job['id']}/json"
    assert "страницы" in admin_client.post(url, json={"text": "{}"}).json()["detail"]

    admin_client.post(f"/api/imports/{job['id']}/pages", json={"pages": [1]})
    r = admin_client.post(url, json={"text": "Извини, не смог"})
    assert r.status_code == 400 and "JSON" in r.json()["detail"]
    r = admin_client.post(url, json={"text": '{"words": [{"greek": "x"'})
    assert r.status_code == 400
    r = admin_client.post(url, json={"text": claude_answer()})  # page 2 of a 1-page PDF
    assert r.status_code == 400 and "страница 2" in r.json()["detail"]
    bad = claude_answer(words=[{"greek": "νερό", "translations_ru": []}])
    r = admin_client.post(url, json={"text": bad})
    assert r.status_code == 400 and "слово 1" in r.json()["detail"]


def test_edit_draft_word_recrops(admin_client):
    detail = ready_job(admin_client)
    job_id, water = detail["id"], detail["words"][0]
    body = {**water, "bbox": list(BLUE), "page": 1}
    r = admin_client.put(f"/api/imports/{job_id}/words/{water['id']}", json=body)
    moved = r.json()
    assert moved["image_url"] != water["image_url"]
    assert dominant(admin_client.get(moved["image_url"]).content)[2] > 200

    r = admin_client.put(f"/api/imports/{job_id}/words/{water['id']}", json={**body, "bbox": None})
    assert r.json()["image_url"] is None
    assert admin_client.get(moved["image_url"]).status_code == 404


def test_excluded_and_deleted_words_not_published(admin_client):
    detail = ready_job(admin_client)
    job_id, water, bread = detail["id"], *detail["words"]
    admin_client.put(f"/api/imports/{job_id}/words/{water['id']}", json={**water, "include": False})
    admin_client.post(
        f"/api/imports/{job_id}/words",
        json={"article": "το", "greek": "γάλα", "translations_ru": ["молоко"]},
    )
    admin_client.delete(f"/api/imports/{job_id}/words/{bread['id']}")
    r = admin_client.post(f"/api/imports/{job_id}/publish", json={"title": "x"})
    words = admin_client.get(f"/api/dictionaries/{r.json()['id']}").json()["words"]
    assert [w["greek"] for w in words] == ["γάλα"]


def test_duplicates_are_flagged(admin_client):
    d = admin_client.post("/api/dictionaries", json={"title": "Старый"}).json()["id"]
    admin_client.post(
        f"/api/dictionaries/{d}/words", json={"greek": "Νερό", "translations_ru": ["вода"]}
    )
    detail = ready_job(admin_client)
    assert detail["words"][0]["duplicates"] == ["Старый"]
    assert detail["words"][1]["duplicates"] == []


def test_package_roundtrip_keeps_pictures(admin_client):
    detail = ready_job(admin_client)
    d = admin_client.post(f"/api/imports/{detail['id']}/publish", json={"title": "Урок 3"}).json()

    exported = admin_client.get(f"/api/dictionaries/{d['id']}/export?format=zip")
    assert exported.headers["content-type"] == "application/zip"
    names = zipfile.ZipFile(io.BytesIO(exported.content)).namelist()
    assert "import.json" in names and "images/000.jpg" in names

    r = admin_client.post(
        "/api/imports/package", files={"file": ("u3.zip", exported.content, "application/zip")}
    )
    assert r.status_code == 201, r.text
    job = r.json()
    assert job["mode"] == "package" and job["status"] == "review"
    assert all(w["image_url"] for w in job["words"])
    assert dominant(admin_client.get(job["words"][0]["image_url"]).content)[0] > 200


def test_package_with_source_pdf_and_bboxes(admin_client):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("source.pdf", make_pdf())
        data = json.loads(claude_answer().split("```json\n")[1].split("\n```")[0])
        data["words"][0]["page"] = 1  # package pages refer to source.pdf directly
        data["words"][1]["page"] = 2
        zf.writestr("import.json", json.dumps(data, ensure_ascii=False))
    r = admin_client.post(
        "/api/imports/package", files={"file": ("p.zip", buf.getvalue(), "application/zip")}
    )
    job = r.json()
    assert job["has_source_pdf"] and job["selected_pages"] == [1, 2]
    assert dominant(admin_client.get(job["words"][0]["image_url"]).content)[0] > 200


def test_bad_packages(admin_client):
    def post(content):
        return admin_client.post(
            "/api/imports/package", files={"file": ("x.zip", content, "application/zip")}
        )

    assert post(b"not a zip").status_code == 400
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(
            "import.json",
            json.dumps(
                {"words": [{"greek": "a", "translations_ru": ["b"], "image_file": "images/x.jpg"}]}
            ),
        )
    r = post(buf.getvalue())
    assert r.status_code == 400 and "images/x.jpg" in r.json()["detail"]


def test_photos_become_pdf_pages(admin_client):
    def photo(color):
        buf = io.BytesIO()
        Image.new("RGB", (300, 400), color).save(buf, "JPEG")
        return buf.getvalue()

    job = upload(
        admin_client,
        [("a.jpg", photo("red"), "image/jpeg"), ("b.jpg", photo("blue"), "image/jpeg")],
    )
    assert job["page_count"] == 2


def test_unsupported_uploads(admin_client, monkeypatch):
    monkeypatch.setattr("shutil.which", lambda _: None)
    r = admin_client.post("/api/imports", files=[("files", ("a.docx", b"PK..", "application/x"))])
    assert r.status_code == 400 and "PDF" in r.json()["detail"]
    r = admin_client.post("/api/imports", files=[("files", ("a.txt", b"hi", "text/plain"))])
    assert r.status_code == 400
    r = admin_client.post("/api/imports", files=[("files", ("a.pdf", b"junk", "application/pdf"))])
    assert r.status_code == 400 and "PDF" in r.json()["detail"]


def test_members_cannot_import(admin_client, make_client):
    bob = make_client()
    register(bob, "bob", create_invite(admin_client))
    assert bob.get("/api/imports").status_code == 403
    assert bob.get("/api/imports/prompt").status_code == 403
    r = bob.post("/api/imports", files=[("files", ("b.pdf", make_pdf(), "application/pdf"))])
    assert r.status_code == 403


@pytest.mark.skipif(
    not (SAMPLES / "spike" / "claude_ai_v3.json").exists(), reason="local textbook sample only"
)
def test_real_textbook_sample(admin_client):
    pdf_bytes = (SAMPLES / "A1_Book_27_29.pdf").read_bytes()
    job = upload(admin_client, [("A1.pdf", pdf_bytes, "application/pdf")])
    admin_client.post(f"/api/imports/{job['id']}/pages", json={"pages": [1, 2, 3, 4]})
    text = (SAMPLES / "spike" / "claude_ai_v3.json").read_text(encoding="utf-8")
    r = admin_client.post(f"/api/imports/{job['id']}/json", json={"text": text})
    assert r.status_code == 200, r.text
    words = r.json()["words"]
    assert len(words) == 63
    assert sum(1 for w in words if w["image_url"]) == 61


# --- categories on import ---


def _cat(admin_client, name):
    return admin_client.post("/api/categories", json={"name": name}).json()["id"]


def test_prompt_lists_current_categories(admin_client):
    _cat(admin_client, "Еда и напитки")
    _cat(admin_client, "Транспорт")
    prompt = admin_client.get("/api/imports/prompt").text
    assert "- Еда и напитки\n- Транспорт" in prompt
    assert "{{CATEGORIES}}" not in prompt


def test_categories_from_claude_match_and_suggestion(admin_client):
    food = _cat(admin_client, "Еда и напитки")
    home = _cat(admin_client, "Дом")
    # ψωμί is already labelled «Дом» somewhere (odd, but it must win for consistency).
    d = admin_client.post("/api/dictionaries", json={"title": "Старый"}).json()["id"]
    admin_client.post(
        f"/api/dictionaries/{d}/words",
        json={"article": "το", "greek": "ψωμί", "translations_ru": ["хлеб"], "category_id": home},
    )
    job = upload(admin_client, [("book.pdf", make_pdf(), "application/pdf")])
    admin_client.post(f"/api/imports/{job['id']}/pages", json={"pages": [2, 1]})
    answer = json.loads(claude_answer().split("```json\n")[1].split("\n```")[0])
    answer["words"][0]["category"] = "еда и НАПИТКИ"  # case doesn't matter
    answer["words"][1]["category"] = "Еда и напитки"  # overridden by the existing label
    answer["words"].append(
        {"greek": "ταξί", "article": "το", "translations_ru": ["такси"], "category": "Транспорт"}
    )
    r = admin_client.post(f"/api/imports/{job['id']}/json", json={"text": json.dumps(answer)})
    water, bread, taxi = r.json()["words"]
    assert (water["category_id"], water["category_source"]) == (food, "claude")
    assert (bread["category_id"], bread["category_source"]) == (home, "match")
    assert taxi["category_id"] is None and taxi["category_suggestion"] == "Транспорт"

    # Accepting the suggestion creates the category and assigns it.
    r = admin_client.post(f"/api/imports/{job['id']}/categories", json={"name": "Транспорт"})
    taxi = r.json()["words"][2]
    assert taxi["category_suggestion"] is None and taxi["category_id"] is not None
    names = [c["name"] for c in admin_client.get("/api/categories").json()]
    assert "Транспорт" in names

    # Manual change in the draft; then publish carries categories into the dictionary.
    r = admin_client.put(
        f"/api/imports/{job['id']}/words/{water['id']}", json={**water, "category_id": home}
    )
    assert (r.json()["category_id"], r.json()["category_source"]) == (home, "manual")
    bad = admin_client.put(
        f"/api/imports/{job['id']}/words/{water['id']}", json={**water, "category_id": 999}
    )
    assert bad.status_code == 400
    pub = admin_client.post(f"/api/imports/{job['id']}/publish", json={"title": "Урок"}).json()
    words = admin_client.get(f"/api/dictionaries/{pub['id']}").json()["words"]
    assert [w["category_id"] for w in words] == [home, home, taxi["category_id"]]


def test_package_roundtrip_keeps_categories(admin_client):
    food = _cat(admin_client, "Еда")
    d = admin_client.post("/api/dictionaries", json={"title": "Урок"}).json()["id"]
    admin_client.post(
        f"/api/dictionaries/{d}/words",
        json={"greek": "νερό", "translations_ru": ["вода"], "category_id": food},
    )
    exported = admin_client.get(f"/api/dictionaries/{d}/export?format=zip").content
    data = json.loads(zipfile.ZipFile(io.BytesIO(exported)).read("import.json"))
    assert data["words"][0]["category"] == "Еда"
    r = admin_client.post(
        "/api/imports/package", files={"file": ("u.zip", exported, "application/zip")}
    )
    assert r.json()["words"][0]["category_id"] == food
