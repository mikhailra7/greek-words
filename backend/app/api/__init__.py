from fastapi import APIRouter

from app.api import (
    admin,
    auth,
    categories,
    dictionaries,
    health,
    imports,
    known,
    training,
    word_media,
)

api_router = APIRouter(prefix="/api")
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(admin.router)
api_router.include_router(dictionaries.router)
api_router.include_router(imports.router)
api_router.include_router(word_media.router)
api_router.include_router(training.router)
api_router.include_router(categories.router)
api_router.include_router(known.router)
