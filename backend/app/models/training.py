from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.timeutil import utcnow


class AnswerLog(Base):
    """One answer in «Переведи» / «Напиши». Groundwork for stats and spaced repetition."""

    __tablename__ = "answers_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    word_id: Mapped[int] = mapped_column(ForeignKey("words.id", ondelete="CASCADE"), index=True)
    mode: Mapped[str] = mapped_column(String(16))  # translate | write
    direction: Mapped[str | None] = mapped_column(String(8))  # ru_gr | gr_ru
    is_correct: Mapped[bool] = mapped_column(Boolean)
    given_answer: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class UserKnownWord(Base):
    """«Я знаю это слово» — per user; such words are skipped by the trainers unless the user
    switches off «Скрыть выученные слова»."""

    __tablename__ = "user_known_words"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    word_id: Mapped[int] = mapped_column(
        ForeignKey("words.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
