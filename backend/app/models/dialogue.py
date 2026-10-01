from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.timeutil import utcnow


class Dialogue(Base):
    """A short dialogue to learn by heart (SPEC «Диалоги»). Shared by the group, like the
    dictionaries; only admins import, replace and delete them."""

    __tablename__ = "dialogues"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    speakers: Mapped[list[str]] = mapped_column(JSON)  # 2..3 role names
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    lines: Mapped[list["DialogueLine"]] = relationship(
        back_populates="dialogue",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="DialogueLine.position",
    )


class DialogueLine(Base):
    __tablename__ = "dialogue_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    dialogue_id: Mapped[int] = mapped_column(
        ForeignKey("dialogues.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(Integer)
    speaker: Mapped[int] = mapped_column(Integer)  # index into Dialogue.speakers
    greek: Mapped[str] = mapped_column(Text)
    transcription: Mapped[str] = mapped_column(Text, default="")
    translation_ru: Mapped[str] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(Text)

    dialogue: Mapped[Dialogue] = relationship(back_populates="lines")
