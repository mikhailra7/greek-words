from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.timeutil import utcnow

if TYPE_CHECKING:
    from app.models.user import User


class Category(Base):
    """Thematic category («Еда», «Транспорт»…), shared across dictionaries.

    A word belongs to at most one category (Word.category_id). Like dictionaries, categories
    are group-wide (owner_id NULL); personal ones are a possible future feature.
    """

    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(60))
    emoji: Mapped[str | None] = mapped_column(String(16))
    position: Mapped[int] = mapped_column(Integer, default=0)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    # Who made it («Автор: …» on the site); kept NULL if that user is deleted.
    author: Mapped["User | None"] = relationship(foreign_keys=[created_by_id], lazy="joined")


Index("ux_categories_name_lower", func.lower(Category.name), unique=True)


class UserActiveCategory(Base):
    __tablename__ = "user_active_categories"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    category_id: Mapped[int] = mapped_column(
        ForeignKey("categories.id", ondelete="CASCADE"), primary_key=True
    )
