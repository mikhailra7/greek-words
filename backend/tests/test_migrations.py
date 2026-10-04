"""Migrations must not lose data. 2026-10-04: a SQLite batch migration (rebuild = copy, drop,
rename) of `categories` ran with foreign keys on, so dropping the old table fired
ON DELETE SET NULL / CASCADE — every word lost its category, users their ticked categories."""

import sqlite3
from pathlib import Path

from alembic import command
from alembic.config import Config

from app.config import settings

BACKEND = Path(__file__).resolve().parents[1]


def _alembic(db: Path) -> Config:
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    return cfg


def test_upgrade_keeps_category_links(tmp_path, monkeypatch):
    db = tmp_path / "m.db"
    monkeypatch.setattr(settings, "database_url", f"sqlite:///{db}")
    cfg = _alembic(db)
    command.upgrade(cfg, "11f460a4be36")  # before the categories rebuild (0e601839672a)

    c = sqlite3.connect(db)
    c.executescript(
        """
        INSERT INTO users (id, username, password_hash, is_admin, created_at)
            VALUES (1, 'u', 'x', 1, '2026-10-01');
        INSERT INTO categories (id, name, position, created_at) VALUES (5, 'Еда', 1, '2026-10-01');
        INSERT INTO dictionaries (id, title, source, is_published, created_at)
            VALUES (1, 'Д', 'manual', 1, '2026-10-01');
        INSERT INTO words (id, dictionary_id, greek, transcription, translations_ru, position,
                           created_at, category_id)
            VALUES (1, 1, 'νερό', '', '["вода"]', 0, '2026-10-01', 5);
        INSERT INTO user_active_categories (user_id, category_id) VALUES (1, 5);
        """
    )
    c.commit()
    c.close()

    command.upgrade(cfg, "head")

    c = sqlite3.connect(db)
    assert c.execute("SELECT category_id FROM words WHERE id = 1").fetchone() == (5,)
    assert c.execute("SELECT * FROM user_active_categories").fetchall() == [(1, 5)]
    assert c.execute("PRAGMA foreign_key_check").fetchall() == []
