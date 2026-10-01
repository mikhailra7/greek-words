"""ORM models. Import every model module here so Alembic autogenerate sees them."""

from app.db import Base
from app.models.category import Category, UserActiveCategory
from app.models.dialogue import Dialogue, DialogueLine
from app.models.dictionary import Dictionary, UserActiveDictionary, Word
from app.models.importing import ImportDraftWord, ImportJob
from app.models.training import AnswerLog, UserKnownWord
from app.models.user import AuthSession, InviteCode, User, UserSetting

__all__ = [
    "AnswerLog",
    "AuthSession",
    "Category",
    "Base",
    "Dialogue",
    "DialogueLine",
    "Dictionary",
    "ImportDraftWord",
    "ImportJob",
    "InviteCode",
    "User",
    "UserActiveCategory",
    "UserActiveDictionary",
    "UserKnownWord",
    "UserSetting",
    "Word",
]
