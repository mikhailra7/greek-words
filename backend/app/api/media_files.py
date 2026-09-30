"""Word pictures and other files under media_dir, served at /media for signed-in users only.

The pictures are cut from the textbook, so they are not public even though their names are
random. FileResponse answers Range requests, which Safari needs for audio.
"""

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse

from app.auth import CurrentUser
from app.config import settings

router = APIRouter(tags=["media"])


@router.api_route("/media/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
def media_file(path: str, _: CurrentUser) -> FileResponse:
    root = settings.media_dir.resolve()
    file = (root / path).resolve()
    if not file.is_relative_to(root) or not file.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Файл не найден")
    # Every stored file gets a fresh random name, so the browser may cache it for long.
    return FileResponse(file, headers={"Cache-Control": "private, max-age=31536000"})
