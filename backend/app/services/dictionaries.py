from sqlalchemy.orm import Session

from app.models import Dictionary, Word
from app.schemas.dictionary import DictionaryFile, WordIn


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
