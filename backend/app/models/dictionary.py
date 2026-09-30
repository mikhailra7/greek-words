import hashlib
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.timeutil import utcnow

# Bump when the way audio files are produced changes, so browsers drop their cached copies
# (audio URLs are cached for a year). 2: +0.3 s of silence at the start. 3: the ~1 s of
# silence at the end cut to 0.15 s (files of version 2 are converted, not re-generated).
AUDIO_FORMAT_VERSION = 3


def speech_hash(text: str, version: int = AUDIO_FORMAT_VERSION) -> str:
    return hashlib.sha1(f"{version}:{text}".encode()).hexdigest()[:10]


ARTICLES = ("ο", "η", "το", "οι", "τα")
PARTS_OF_SPEECH = (
    "noun",
    "verb",
    "adjective",
    "adverb",
    "pronoun",
    "preposition",
    "conjunction",
    "numeral",
    "phrase",
    "other",
)


class Dictionary(Base):
    __tablename__ = "dictionaries"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(16), default="manual")  # manual | import
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    # NULL = shared group dictionary. Personal dictionaries are a future feature.
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    is_published: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    words: Mapped[list["Word"]] = relationship(
        back_populates="dictionary",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="Word.position",
    )


class Word(Base):
    __tablename__ = "words"

    id: Mapped[int] = mapped_column(primary_key=True)
    dictionary_id: Mapped[int] = mapped_column(
        ForeignKey("dictionaries.id", ondelete="CASCADE"), index=True
    )
    article: Mapped[str | None] = mapped_column(String(4))
    greek: Mapped[str] = mapped_column(String(120))  # without the article
    transcription: Mapped[str] = mapped_column(String(160))  # Latin, with the article
    translations_ru: Mapped[list[str]] = mapped_column(JSON)  # 1..3
    part_of_speech: Mapped[str | None] = mapped_column(String(16))
    example_gr: Mapped[str | None] = mapped_column(Text)
    example_ru: Mapped[str | None] = mapped_column(Text)
    # Media are filled in stage 3/4.
    image_path: Mapped[str | None] = mapped_column(String(255))
    image_source: Mapped[str | None] = mapped_column(String(16))  # textbook|stock|emoji|upload
    image_emoji: Mapped[str | None] = mapped_column(String(16))
    image_credit: Mapped[str | None] = mapped_column(String(300))  # author/license for stock
    image_query: Mapped[str | None] = mapped_column(String(80))  # English keyword for stock search
    audio_path: Mapped[str | None] = mapped_column(String(255))
    audio_ru_path: Mapped[str | None] = mapped_column(String(255))
    source_page: Mapped[int | None] = mapped_column(Integer)
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), index=True
    )
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    dictionary: Mapped[Dictionary] = relationship(back_populates="words")

    @property
    def full_greek(self) -> str:
        return f"{self.article} {self.greek}" if self.article else self.greek

    @property
    def image_url(self) -> str | None:
        return f"/media/{self.image_path}" if self.image_path else None

    @property
    def speech_text(self) -> str:
        """What the TTS voice reads. Without the comma the neural voices swallow a short
        article («η σαλάτα» → 0.15 s, barely audible); with it the article is clear (~0.45 s)
        and followed by a short pause."""
        return f"{self.article}, {self.greek}" if self.article else self.greek

    @property
    def speech_text_ru(self) -> str:
        return ", ".join(self.translations_ru)

    @property
    def audio_ru_url(self) -> str:
        return f"/api/words/{self.id}/audio/ru?v={speech_hash(self.speech_text_ru)}"

    @property
    def audio_url(self) -> str:
        # Generated on first request; the version changes when the spoken text changes.
        return f"/api/words/{self.id}/audio?v={speech_hash(self.speech_text)}"


class UserActiveDictionary(Base):
    __tablename__ = "user_active_dictionaries"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    dictionary_id: Mapped[int] = mapped_column(
        ForeignKey("dictionaries.id", ondelete="CASCADE"), primary_key=True
    )
