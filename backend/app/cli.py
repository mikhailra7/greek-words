"""Admin CLI.

python -m app.cli make-admin <username>
python -m app.cli seed-demo          # two demo dictionaries for development
python -m app.cli backup <file.db>   # consistent copy of the SQLite DB (safe while running)
"""

import argparse
import sys
from pathlib import Path

from sqlalchemy import select

from app.api.auth import find_user
from app.db import SessionLocal
from app.models import Category, Dictionary, Word
from app.schemas.dictionary import DictionaryFile
from app.services.dictionaries import create_from_file

SEED_DIR = Path(__file__).parent / "seed"


def make_admin(username: str) -> int:
    with SessionLocal() as db:
        user = find_user(db, username)
        if user is None:
            print(f"Пользователь {username!r} не найден", file=sys.stderr)
            return 1
        user.is_admin = True
        db.commit()
        print(f"{user.username} теперь администратор")
        return 0


def seed_demo() -> int:
    with SessionLocal() as db:
        for path in sorted(SEED_DIR.glob("demo_*.json")):
            data = DictionaryFile.model_validate_json(path.read_text(encoding="utf-8"))
            if db.scalar(select(Dictionary.id).where(Dictionary.title == data.title)):
                print(f"уже есть: {data.title}")
                continue
            create_from_file(db, data, created_by_id=None)
            print(f"создан: {data.title} ({len(data.words)} слов)")
    return 0


def seed_categories() -> int:
    """Creates the base categories (if missing) and puts uncategorized words into them by
    their Greek spelling. Never moves a word that already has a category."""
    import json
    import unicodedata

    def key(text: str) -> str:
        return unicodedata.normalize("NFC", text).casefold()

    data = json.loads((SEED_DIR / "categories.json").read_text(encoding="utf-8"))
    with SessionLocal() as db:
        existing = {key(c.name): c for c in db.scalars(select(Category))}
        by_word: dict[str, Category] = {}
        created = 0
        for pos, item in enumerate(data["categories"], start=1):
            cat = existing.get(key(item["name"]))
            if cat is None:
                cat = Category(name=item["name"], emoji=item.get("emoji"), position=pos)
                db.add(cat)
                created += 1
            for w in item["words"]:
                by_word[key(w)] = cat
        db.flush()
        labelled = left = 0
        for word in db.scalars(select(Word).where(Word.category_id.is_(None))):
            cat = by_word.get(key(word.greek))
            if cat:
                word.category_id = cat.id
                labelled += 1
            else:
                left += 1
        db.commit()
    print(f"категорий создано: {created}; слов размечено: {labelled}; без категории: {left}")
    return 0


def import_prompt() -> int:
    from app.services.importing import render_prompt

    with SessionLocal() as db:
        print(render_prompt(db), end="")
    return 0


def backup(dest: str) -> int:
    """Copies the live DB with SQLite's online backup API. A plain `cp` of a WAL database
    that is being written to can give a broken copy."""
    import sqlite3

    from app.config import settings

    url = settings.database_url
    if not url.startswith("sqlite:///"):
        print(f"Бэкап умеет только SQLite, а в DATABASE_URL: {url}", file=sys.stderr)
        return 1
    dst = Path(dest)
    if dst.exists():
        print(f"Файл уже есть: {dst}", file=sys.stderr)
        return 1
    dst.parent.mkdir(parents=True, exist_ok=True)
    src = sqlite3.connect(f"file:{url.removeprefix('sqlite:///')}?mode=ro", uri=True)
    out = sqlite3.connect(dst)
    try:
        src.backup(out)
        ok = out.execute("PRAGMA integrity_check").fetchone()[0]
    finally:
        out.close()
        src.close()
    if ok != "ok":
        print(f"Копия повреждена: {ok}", file=sys.stderr)
        return 1
    print(f"копия базы: {dst}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("make-admin", help="выдать права администратора")
    p.add_argument("username")
    sub.add_parser("seed-demo", help="создать демо-словари")
    sub.add_parser("seed-categories", help="базовые категории + разметка слов без категории")
    sub.add_parser("import-prompt", help="промпт импорта с текущим списком категорий")
    p = sub.add_parser("backup", help="целостная копия базы SQLite (можно на работающем сайте)")
    p.add_argument("dest")
    args = parser.parse_args()
    if args.command == "make-admin":
        return make_admin(args.username)
    if args.command == "seed-demo":
        return seed_demo()
    if args.command == "seed-categories":
        return seed_categories()
    if args.command == "import-prompt":
        return import_prompt()
    if args.command == "backup":
        return backup(args.dest)
    return 2


if __name__ == "__main__":
    sys.exit(main())
