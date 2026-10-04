from logging.config import fileConfig

from alembic import context
from sqlalchemy import event

from app import models  # noqa: F401  (registers all models on Base.metadata)
from app.config import settings
from app.db import Base, make_engine

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = make_engine(settings.database_url)
    sqlite = engine.dialect.name == "sqlite"
    if sqlite:
        # Batch migrations rebuild a table: copy, DROP the old one, rename. With foreign keys
        # on, that DROP fires ON DELETE on every row pointing at the table — on 2026-10-04 it
        # wiped all words' categories (SET NULL) and users' ticked categories (CASCADE).
        # Off while migrating (on the raw connection, outside any transaction, after
        # make_engine's own listener turned them on); checked below instead.
        event.listen(engine, "connect", lambda conn, _: conn.execute("PRAGMA foreign_keys=OFF"))
    with engine.connect() as connection:
        # render_as_batch: SQLite can't ALTER most things in place
        context.configure(
            connection=connection, target_metadata=target_metadata, render_as_batch=True
        )
        with context.begin_transaction():
            context.run_migrations()
        if sqlite:
            broken = connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall()
            if broken:
                raise RuntimeError(f"Миграция нарушила внешние ключи: {broken[:5]}")


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
