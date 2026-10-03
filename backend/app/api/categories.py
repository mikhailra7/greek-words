from fastapi import APIRouter, HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError

from app.api.dictionaries import visible_filter
from app.auth import CurrentUser
from app.db import DbSession
from app.models import Category, Dictionary, User, UserActiveCategory, Word
from app.schemas.category import (
    CategoryDetailOut,
    CategoryIn,
    CategoryOut,
    CategoryPatch,
    CategoryWordOut,
)
from app.schemas.dictionary import ActiveIn, ActiveSummary, AnswerStats, WordOut
from app.services.selection import known_ids
from app.services.stats import last_answers

router = APIRouter(prefix="/categories", tags=["categories"])


def _require_admin(user: User) -> None:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нужны права администратора")


def _get(db: DbSession, category_id: int) -> Category:
    c = db.get(Category, category_id)
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Категория не найдена")
    return c


def _word_counts(db: DbSession, user: User) -> dict[int, int]:
    rows = db.execute(
        select(Word.category_id, func.count(Word.id))
        .join(Dictionary, Word.dictionary_id == Dictionary.id)
        .where(Word.category_id.is_not(None), visible_filter(user))
        .group_by(Word.category_id)
    )
    return {cid: n for cid, n in rows}


def _active_ids(db: DbSession, user: User) -> set[int]:
    return set(
        db.scalars(
            select(UserActiveCategory.category_id).where(UserActiveCategory.user_id == user.id)
        )
    )


def _out(c: Category, user: User, count: int, active: bool) -> CategoryOut:
    return CategoryOut(
        id=c.id,
        name=c.name,
        emoji=c.emoji,
        position=c.position,
        word_count=count,
        is_active=active,
        can_edit=user.is_admin,
        author=c.author.username if c.author else None,
    )


def _check_unique_name(db: DbSession, name: str, exclude_id: int | None = None) -> None:
    # In Python: SQLite's lower() doesn't fold Cyrillic («Еда» vs «еда»).
    key = name.casefold()
    for c in db.scalars(select(Category)):
        if c.id != exclude_id and c.name.casefold() == key:
            raise HTTPException(status.HTTP_409_CONFLICT, "Такая категория уже есть")


def _commit_unique(db: DbSession) -> None:
    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Такая категория уже есть") from e


@router.get("", response_model=list[CategoryOut])
def list_categories(user: CurrentUser, db: DbSession) -> list[CategoryOut]:
    cats = db.scalars(select(Category).order_by(Category.position, Category.name)).all()
    counts, active = _word_counts(db, user), _active_ids(db, user)
    return [_out(c, user, counts.get(c.id, 0), c.id in active) for c in cats]


@router.post("", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
def create_category(body: CategoryIn, user: CurrentUser, db: DbSession) -> CategoryOut:
    _require_admin(user)
    _check_unique_name(db, body.name)
    last = db.scalar(select(func.max(Category.position))) or 0
    c = Category(name=body.name, emoji=body.emoji, position=last + 1, created_by_id=user.id)
    db.add(c)
    _commit_unique(db)
    return _out(c, user, 0, False)


@router.get("/{category_id}", response_model=CategoryDetailOut)
def get_category(category_id: int, user: CurrentUser, db: DbSession) -> CategoryDetailOut:
    c = _get(db, category_id)
    rows = db.execute(
        select(Word, Dictionary.title)
        .join(Dictionary, Word.dictionary_id == Dictionary.id)
        .where(Word.category_id == c.id, visible_filter(user))
        .order_by(Dictionary.created_at, Word.position)
    ).all()
    known = known_ids(db, user, [w.id for w, _ in rows])
    stats = last_answers(db, user, [w.id for w, _ in rows])
    words = [
        CategoryWordOut(
            **WordOut.model_validate(w).model_dump(exclude={"known", "answers"}),
            dictionary_title=title,
            known=w.id in known,
            answers=AnswerStats(right=stats[w.id][0], total=stats[w.id][1])
            if w.id in stats
            else None,
        )
        for w, title in rows
    ]
    base = _out(c, user, len(words), c.id in _active_ids(db, user))
    return CategoryDetailOut(**base.model_dump(), words=words)


@router.patch("/{category_id}", response_model=CategoryOut)
def update_category(
    category_id: int, body: CategoryPatch, user: CurrentUser, db: DbSession
) -> CategoryOut:
    _require_admin(user)
    c = _get(db, category_id)
    if body.name is not None:
        _check_unique_name(db, body.name, exclude_id=c.id)
    for field, value in body.model_dump(exclude_unset=True).items():
        if field in ("name", "position") and value is None:
            continue
        setattr(c, field, value)
    _commit_unique(db)
    return _out(c, user, _word_counts(db, user).get(c.id, 0), c.id in _active_ids(db, user))


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(category_id: int, user: CurrentUser, db: DbSession) -> None:
    """Words stay in their dictionaries, they just lose the category."""
    _require_admin(user)
    db.delete(_get(db, category_id))
    db.commit()


@router.put("/{category_id}/active", response_model=ActiveSummary)
def set_active(category_id: int, body: ActiveIn, user: CurrentUser, db: DbSession) -> ActiveSummary:
    from app.api.dictionaries import active_summary

    _get(db, category_id)
    db.execute(
        delete(UserActiveCategory).where(
            UserActiveCategory.user_id == user.id, UserActiveCategory.category_id == category_id
        )
    )
    if body.active:
        db.add(UserActiveCategory(user_id=user.id, category_id=category_id))
    db.commit()
    return active_summary(db, user)
