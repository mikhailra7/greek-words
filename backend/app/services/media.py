"""Public media files (served at /media). Paths stored in the DB are relative to media_dir."""

import secrets
import shutil
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from app.config import settings

UPLOAD_MAX_SIDE = 900
UPLOAD_MAX_BYTES = 15 * 1024 * 1024


def public_url(rel_path: str | None) -> str | None:
    return f"/media/{rel_path}" if rel_path else None


def store_image(src: Path) -> str:
    """Copy a JPEG into media/images under a fresh name; return the relative path."""
    rel = f"images/{secrets.token_hex(8)}.jpg"
    dst = settings.media_dir / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dst)
    return rel


def store_uploaded_image(data: bytes) -> str:
    """Save a user-uploaded picture as a JPEG in media/images; return the relative path.

    Raises ValueError with a user-facing message if the file isn't a usable image.
    """
    if len(data) > UPLOAD_MAX_BYTES:
        raise ValueError("Картинка больше 15 МБ")
    try:
        img = Image.open(BytesIO(data))
        # Phone photos store rotation in EXIF; bake it in or the picture ends up sideways.
        img = ImageOps.exif_transpose(img).convert("RGB")
    except (UnidentifiedImageError, OSError) as e:
        raise ValueError("Не удалось открыть картинку: нужен JPG, PNG или WEBP") from e
    img.thumbnail((UPLOAD_MAX_SIDE, UPLOAD_MAX_SIDE))
    rel = f"images/{secrets.token_hex(8)}.jpg"
    dst = settings.media_dir / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    img.save(dst, "JPEG", quality=88)
    return rel


def delete_file(rel_path: str | None) -> None:
    if not rel_path:
        return
    path = (settings.media_dir / rel_path).resolve()
    # Never step outside media_dir, whatever ended up in the DB.
    if settings.media_dir.resolve() in path.parents:
        path.unlink(missing_ok=True)
