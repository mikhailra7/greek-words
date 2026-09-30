"""Stock picture search: Pixabay when PIXABAY_API_KEY is set, otherwise Openverse (no key).

The client only ever sends back a provider id; the server looks the picture up again by id
and downloads it itself, so no arbitrary URL from the browser is ever fetched.
"""

from collections import OrderedDict
from dataclasses import dataclass

import httpx

from app.config import settings

TIMEOUT = httpx.Timeout(15.0)
MAX_DOWNLOAD = 12 * 1024 * 1024
HEADERS = {"User-Agent": "greek-words/1.0 (study group vocabulary trainer)"}


class StockError(RuntimeError):
    pass


@dataclass
class StockImage:
    id: str
    thumb_url: str
    full_url: str
    credit: str


# Thumbnails are proxied through our server (the browser never talks to the stock site).
# Only URLs that came from our own search results can be fetched this way.
_thumbs: OrderedDict[str, str] = OrderedDict()
_THUMBS_MAX = 1000


def _remember(found: list[StockImage]) -> list[StockImage]:
    for img in found:
        _thumbs[img.id] = img.thumb_url
        _thumbs.move_to_end(img.id)
    while len(_thumbs) > _THUMBS_MAX:
        _thumbs.popitem(last=False)
    return found


def thumbnail(image_id: str) -> tuple[bytes, str]:
    url = _thumbs.get(image_id)
    if url is None:
        raise StockError("Миниатюра устарела — повторите поиск")
    try:
        r = httpx.get(url, timeout=TIMEOUT, headers=HEADERS, follow_redirects=True)
        r.raise_for_status()
    except httpx.HTTPError as e:
        raise StockError("Миниатюра недоступна") from e
    return r.content[:MAX_DOWNLOAD], r.headers.get("content-type", "image/jpeg")


def provider_name() -> str:
    return "pixabay" if settings.pixabay_api_key else "openverse"


def search(query: str, limit: int = 18) -> list[StockImage]:
    query = query.strip()[:80]
    if not query:
        return []
    try:
        if settings.pixabay_api_key:
            return _remember(
                _pixabay({"q": query, "per_page": max(3, limit), "safesearch": "true"})
            )
        return _remember(_openverse_search(query, limit))
    except httpx.HTTPError as e:
        raise StockError("Сток сейчас недоступен, попробуйте позже") from e


def get(image_id: str) -> StockImage:
    try:
        if settings.pixabay_api_key:
            if not image_id.isdigit():
                raise StockError("Неверный id картинки")
            found = _pixabay({"id": image_id})
        else:
            found = [_openverse_one(image_id)]
    except httpx.HTTPError as e:
        raise StockError("Картинка не найдена на стоке") from e
    if not found:
        raise StockError("Картинка не найдена на стоке")
    return found[0]


def download(img: StockImage) -> bytes:
    for url in (img.full_url, img.thumb_url):
        try:
            with httpx.stream(
                "GET", url, timeout=TIMEOUT, headers=HEADERS, follow_redirects=True
            ) as r:
                r.raise_for_status()
                data = bytearray()
                for chunk in r.iter_bytes():
                    data += chunk
                    if len(data) > MAX_DOWNLOAD:
                        break
                else:
                    return bytes(data)
        except httpx.HTTPError:
            continue
    raise StockError("Не удалось скачать картинку")


# --- Pixabay ---


def _pixabay(params: dict) -> list[StockImage]:
    r = httpx.get(
        "https://pixabay.com/api/",
        params={"key": settings.pixabay_api_key, "image_type": "all", **params},
        timeout=TIMEOUT,
        headers=HEADERS,
    )
    r.raise_for_status()
    return [
        StockImage(
            id=str(h["id"]),
            thumb_url=h["webformatURL"],
            full_url=h.get("largeImageURL") or h["webformatURL"],
            credit=f"Pixabay · {h.get('user', '')}".strip(" ·"),
        )
        for h in r.json().get("hits", [])
    ]


# --- Openverse ---

_OV = "https://api.openverse.org/v1/images/"


def _openverse_item(r: dict) -> StockImage:
    author = r.get("creator") or "автор неизвестен"
    license_ = (r.get("license") or "").upper()
    version = r.get("license_version") or ""
    return StockImage(
        id=r["id"],
        thumb_url=r.get("thumbnail") or r["url"],
        full_url=r["url"],
        credit=f"{author} · CC {license_} {version} · {r.get('source', 'openverse')}".strip(),
    )


def _openverse_search(query: str, limit: int) -> list[StockImage]:
    r = httpx.get(
        _OV,
        params={"q": query, "page_size": limit, "mature": "false"},
        timeout=TIMEOUT,
        headers=HEADERS,
    )
    r.raise_for_status()
    return [_openverse_item(x) for x in r.json().get("results", [])]


def _openverse_one(image_id: str) -> StockImage:
    if not image_id.replace("-", "").isalnum():
        raise StockError("Неверный id картинки")
    r = httpx.get(f"{_OV}{image_id}/", timeout=TIMEOUT, headers=HEADERS)
    r.raise_for_status()
    return _openverse_item(r.json())
