from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.timeutil import utcnow

# uploaded → (pages chosen) awaiting_json → (JSON pasted / package loaded) review → done
IMPORT_STATUSES = ("uploaded", "awaiting_json", "review", "done")


class ImportJob(Base):
    __tablename__ = "import_jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    mode: Mapped[str] = mapped_column(String(16))  # paste | package
    status: Mapped[str] = mapped_column(String(16), default="uploaded")
    title: Mapped[str] = mapped_column(String(120), default="")
    source_filename: Mapped[str] = mapped_column(String(255), default="")
    # All files live in settings.imports_dir / str(id); paths are relative to that folder.
    has_source_pdf: Mapped[bool] = mapped_column(Boolean, default=False)
    page_count: Mapped[int] = mapped_column(Integer, default=0)
    # 1-based page numbers of source.pdf, in the order they were given to Claude.
    selected_pages: Mapped[list[int]] = mapped_column(JSON, default=list)
    raw_json: Mapped[str | None] = mapped_column(Text)
    dictionary_id: Mapped[int | None] = mapped_column(
        ForeignKey("dictionaries.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    words: Mapped[list["ImportDraftWord"]] = relationship(
        back_populates="job",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="ImportDraftWord.position",
    )


class ImportDraftWord(Base):
    __tablename__ = "import_draft_words"

    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[int] = mapped_column(
        ForeignKey("import_jobs.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(Integer, default=0)
    include: Mapped[bool] = mapped_column(Boolean, default=True)

    article: Mapped[str | None] = mapped_column(String(4))
    greek: Mapped[str] = mapped_column(String(120))
    transcription: Mapped[str] = mapped_column(String(160), default="")
    translations_ru: Mapped[list[str]] = mapped_column(JSON)
    part_of_speech: Mapped[str | None] = mapped_column(String(16))
    example_gr: Mapped[str | None] = mapped_column(Text)
    example_ru: Mapped[str | None] = mapped_column(Text)
    image_emoji: Mapped[str | None] = mapped_column(String(16))
    image_query: Mapped[str | None] = mapped_column(String(80))
    # Category: chosen from the list (category_id) or a new name Claude proposed
    # (category_suggestion, until an admin accepts it). category_source: claude | match | manual
    # (match = the same Greek word already has this category in another dictionary).
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL")
    )
    category_suggestion: Mapped[str | None] = mapped_column(String(60))
    category_source: Mapped[str | None] = mapped_column(String(16))
    note: Mapped[str | None] = mapped_column(Text)

    # Page in the Claude PDF (1..len(job.selected_pages)); bbox is normalized [x0, y0, x1, y1].
    page: Mapped[int | None] = mapped_column(Integer)
    bbox: Mapped[list[float] | None] = mapped_column(JSON)
    # Cropped picture, relative to the job folder (e.g. "crops/12_ab12cd.jpg").
    image_file: Mapped[str | None] = mapped_column(String(255))

    job: Mapped[ImportJob] = relationship(back_populates="words")

    @property
    def full_greek(self) -> str:
        return f"{self.article} {self.greek}" if self.article else self.greek
