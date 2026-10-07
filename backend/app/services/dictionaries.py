import unicodedata

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Category, Dictionary, Word
from app.schemas.dictionary import DictionaryFile, WordIn


def _same(article: str | None, greek: str) -> tuple[str, str]:
    return (article or "", unicodedata.normalize("NFC", greek).casefold())


def append_words(db: Session, d: Dictionary, words: list[WordIn]) -> tuple[list[Word], list[str]]:
    """«+ Слова из JSON»: the new words at the end of the dictionary. Words it already has
    (same article and spelling) or repeated in the file are skipped — loading the same file
    twice adds nothing. A category id that doesn't exist here is dropped. Returns (added,
    skipped full forms)."""
    have = {_same(w.article, w.greek) for w in d.words}
    categories = set(db.scalars(select(Category.id)))
    start = max((w.position for w in d.words), default=-1) + 1
    added: list[Word] = []
    skipped: list[str] = []
    for w in words:
        key = _same(w.article, w.greek)
        if key in have:
            skipped.append(f"{w.article} {w.greek}" if w.article else w.greek)
            continue
        have.add(key)
        if w.category_id is not None and w.category_id not in categories:
            w = w.model_copy(update={"category_id": None})
        word = Word(**w.model_dump(), position=start + len(added))
        d.words.append(word)
        added.append(word)
    db.commit()
    return added, skipped


def add_words(d: Dictionary, words: list[WordIn], start: int) -> None:
    for i, w in enumerate(words):
        d.words.append(Word(**w.model_dump(), position=start + i))


def create_from_file(db: Session, data: DictionaryFile, created_by_id: int | None) -> Dictionary:
    d = Dictionary(
        title=data.title,
        description=data.description,
        source="import",
        created_by_id=created_by_id,
    )
    add_words(d, data.words, start=0)
    db.add(d)
    db.commit()
    return d
