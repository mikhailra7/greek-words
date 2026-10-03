from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.api import api_router, media_files
from app.config import settings

FIELD_HINTS = {
    "username": "Имя: 2–32 символа — буквы, цифры, точка, дефис, подчёркивание",
    "password": "Пароль: минимум 6 символов",
    "new_password": "Новый пароль: минимум 6 символов",
    "title": "Название: от 1 до 120 символов",
    "greek": "Греческое слово обязательно (до 120 символов)",
    "translations_ru": "Перевод: от 1 до 5 вариантов, каждый до 100 символов",
    "article": "Артикль: ο, η, το, οι, τα или пусто",
    "part_of_speech": "Неизвестная часть речи",
}


async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    """Turn pydantic errors into one readable Russian message for the UI."""
    fields = [str(e["loc"][-1]) for e in exc.errors() if e.get("loc")]
    hints = [FIELD_HINTS[f] for f in dict.fromkeys(fields) if f in FIELD_HINTS]
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={"detail": "; ".join(hints) or "Проверьте введённые данные"},
    )


def create_app() -> FastAPI:
    app = FastAPI(
        title="Greek Words",
        docs_url="/api/docs" if settings.env == "dev" else None,
        openapi_url="/api/openapi.json" if settings.env == "dev" else None,
    )
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.include_router(api_router)
    app.include_router(media_files.router)
    return app


app = create_app()
