"""Pronunciation as mp3 files in media/audio — Greek word and its Russian translation —
generated on demand and cached.

Each user may pick a male voice and another speed of Greek speech (profile → «Озвучка»).
The default voice keeps its file in the Word row (audio_path); other voices/speeds are
separate files in media/audio/v/, found by name.

Provider: edge-tts (Microsoft neural voices through the Edge "read aloud" endpoint).
It is free and unofficial — if it breaks, swap `_synthesize` for another provider;
the rest of the app only sees files and `TTSUnavailable`.
"""

import asyncio
import logging
import shutil
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import edge_tts
import numpy as np
import soundfile as sf
from sqlalchemy.orm import Session

from app.config import settings
from app.models import DialogueLine, Word
from app.models.dictionary import AUDIO_FORMAT_VERSION, speech_hash
from app.services import media

log = logging.getLogger(__name__)

Lang = Literal["el", "ru"]

# Background warm-up, so nobody waits for the service while training. Two queues: `_bulk`
# for whole dictionaries (publish, a new voice in the profile — can take minutes) and
# `_session` for the words of a session that just started, so they don't wait behind a bulk.
_bulk = ThreadPoolExecutor(max_workers=1, thread_name_prefix="tts-bulk")
_session = ThreadPoolExecutor(max_workers=1, thread_name_prefix="tts-session")
MAX_FAILS_IN_ROW = 3  # the service is down: stop instead of hammering it

ATTEMPTS = 3
RETRY_DELAY = 0.4  # seconds, grows with each attempt


class TTSUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class _LangSpec:
    path_attr: str  # Word column holding the cached file
    text_attr: str  # Word property with the text to read
    suffix: str  # file name marker


_LANGS: dict[str, _LangSpec] = {
    "el": _LangSpec("audio_path", "speech_text", ""),
    "ru": _LangSpec("audio_ru_path", "speech_text_ru", "_ru"),
}


# Speeds of Greek speech a user can choose, in percent (the default is settings.tts_rate).
RATES = (-30, -20, -10, 0, 10)


def default_rate() -> int:
    return int(settings.tts_rate.rstrip("%"))


@dataclass(frozen=True)
class Voice:
    male: bool = False
    rate: int | None = None  # Greek only; None = default. Russian is always normal speed.

    def is_default(self, lang: Lang) -> bool:
        return not self.male and (lang == "ru" or self.rate in (None, default_rate()))

    def key(self, lang: Lang) -> str:
        """File name part: «m-20», «f+0» (Greek) or «m» (Russian)."""
        sex = "m" if self.male else "f"
        return sex if lang == "ru" else f"{sex}{self._rate():+d}"

    def _rate(self) -> int:
        return default_rate() if self.rate is None else self.rate

    def edge(self, lang: Lang) -> tuple[str, str]:
        """(edge-tts voice name, rate string)."""
        if lang == "ru":
            name = settings.tts_voice_ru_male if self.male else settings.tts_voice_ru
            return name, settings.tts_rate_ru
        name = settings.tts_voice_male if self.male else settings.tts_voice
        return name, f"{self._rate():+d}%"


DEFAULT_VOICE = Voice()


# Phones and Bluetooth headphones wake their audio output up when a clip starts and lose
# the first ~0.2-0.3 s — with only the voice's own 0.2 s of lead-in that ate the first
# consonant («[д]иван», «[к]апуста»). Extra silence up front gives them room.
LEAD_IN_SECONDS = 0.3


# The service ends every clip with ~1 s of silence: a click on 🔊 sounded slow, and in
# «Аудио повторение» the pause between words only started after it.
TAIL_SECONDS = 0.15
SILENCE = 0.01  # |amplitude| below this counts as silence


def _shape(path: Path, lead_in: bool = True) -> None:
    """Silence: +LEAD_IN_SECONDS at the start (if `lead_in`), the end cut to TAIL_SECONDS."""
    try:
        data, rate = sf.read(path)
        loud = np.flatnonzero(np.abs(data if data.ndim == 1 else data.max(axis=1)) > SILENCE)
        if len(loud):
            data = data[: min(len(data), loud[-1] + 1 + int(rate * TAIL_SECONDS))]
        if lead_in:
            pad = np.zeros((int(rate * LEAD_IN_SECONDS),) + data.shape[1:], dtype=data.dtype)
            data = np.concatenate([pad, data])
        sf.write(path, data, rate, format="MP3", subtype="MPEG_LAYER_III")
    except Exception as e:  # keep the file as it came rather than no audio at all
        log.warning("could not reshape %s: %s", path, e)


def _upgrade(old: Path, new: Path) -> bool:
    """A file of the previous format (version 2: same lead-in, long tail) → the current one,
    without asking the service again. False if there is no such file."""
    if not old.exists():
        return False
    tmp = _tmp_for(new)
    try:
        shutil.copyfile(old, tmp)
        _shape(tmp, lead_in=False)
        tmp.replace(new)
    finally:
        tmp.unlink(missing_ok=True)
    old.unlink(missing_ok=True)
    return True


def _tmp_for(dst: Path) -> Path:
    # Unique: a background warm-up and a request may make the same file at the same time.
    dst.parent.mkdir(parents=True, exist_ok=True)
    return dst.with_name(f"{dst.stem}.{uuid.uuid4().hex[:8]}.part")


async def _synthesize(text: str, dst: Path, lang: Lang = "el", v: Voice = DEFAULT_VOICE) -> None:
    voice, rate = v.edge(lang)
    tmp = _tmp_for(dst)
    try:
        await edge_tts.Communicate(text, voice, rate=rate).save(str(tmp))
        _shape(tmp)
        tmp.replace(dst)
    finally:
        tmp.unlink(missing_ok=True)


def _rel_path(word: Word, lang: Lang, version: int = AUDIO_FORMAT_VERSION) -> str:
    spec = _LANGS[lang]
    text_hash = speech_hash(getattr(word, spec.text_attr), version)
    return f"audio/{word.id}{spec.suffix}_{text_hash}.mp3"


VARIANT_DIR = "audio/v"


def _variant_rel(word: Word, lang: Lang, v: Voice, version: int = AUDIO_FORMAT_VERSION) -> str:
    spec = _LANGS[lang]
    text_hash = speech_hash(getattr(word, spec.text_attr), version)
    return f"{VARIANT_DIR}/{word.id}{spec.suffix}_{v.key(lang)}_{text_hash}.mp3"


def _generate(text: str, path: Path, lang: Lang, v: Voice, what: object) -> None:
    if not settings.tts_enabled:
        raise TTSUnavailable("Озвучка отключена")
    path.parent.mkdir(parents=True, exist_ok=True)
    # The Edge endpoint answers "no audio" to roughly one call in ten; a retry usually works.
    for attempt in range(ATTEMPTS):
        try:
            asyncio.run(asyncio.wait_for(_synthesize(text, path, lang, v), timeout=20))
            return
        except Exception as e:  # network, service hiccups, timeouts
            log.warning("TTS %s attempt %s failed for %s: %s", lang, attempt + 1, what, e)
            if attempt == ATTEMPTS - 1:
                raise TTSUnavailable("Озвучка сейчас недоступна") from e
            time.sleep(RETRY_DELAY * (attempt + 1))


def ensure_audio(db: Session, word: Word, lang: Lang = "el", v: Voice = DEFAULT_VOICE) -> Path:
    """Return the mp3 for the word in voice `v`, generating it if missing or outdated."""
    spec = _LANGS[lang]
    text = getattr(word, spec.text_attr)
    root = settings.media_dir
    if not v.is_default(lang):
        path = root / _variant_rel(word, lang, v)
        if not path.exists():
            previous = root / _variant_rel(word, lang, v, AUDIO_FORMAT_VERSION - 1)
            if not _upgrade(previous, path):
                _cleanup_variants(word, lang, v)  # older text of this voice
                _generate(text, path, lang, v, f"word {word.id}")
        return path
    rel = _rel_path(word, lang)
    path = root / rel
    if getattr(word, spec.path_attr) == rel and path.exists():
        return path
    old = getattr(word, spec.path_attr)
    if not (old == _rel_path(word, lang, AUDIO_FORMAT_VERSION - 1) and _upgrade(root / old, path)):
        _generate(text, path, lang, v, f"word {word.id}")
    setattr(word, spec.path_attr, rel)
    db.commit()
    if old and old != rel:
        media.delete_file(old)
    return path


def _variant_glob(word: Word, lang: Lang, v: Voice | None = None) -> list[Path]:
    """Files of one voice (`v`) or of every non-default voice. Names: «<id>_f-20_<hash>»,
    «<id>_m+0_<hash>» (Greek), «<id>_ru_m_<hash>» (Russian)."""
    prefix = f"{word.id}{_LANGS[lang].suffix}_"
    pattern = f"{prefix}{v.key(lang)}_*.mp3" if v else f"{prefix}[fm]*.mp3"
    return list((settings.media_dir / VARIANT_DIR).glob(pattern))


def _cleanup_variants(word: Word, lang: Lang, v: Voice | None = None) -> None:
    for f in _variant_glob(word, lang, v):
        f.unlink(missing_ok=True)


def variant_files(word: Word) -> list[str]:
    """Other voices/speeds of this word (relative paths) — to delete along with the word."""
    root = settings.media_dir
    return [str(p.relative_to(root)) for lang in ("el", "ru") for p in _variant_glob(word, lang)]


def forget_audio(word: Word, lang: Lang = "el") -> None:
    """Drop the cached files, every voice (e.g. to re-generate them)."""
    attr = _LANGS[lang].path_attr
    media.delete_file(getattr(word, attr))
    setattr(word, attr, None)
    _cleanup_variants(word, lang)


SAMPLE_TEXT = {
    "el": "Καλημέρα! Το νερό, η γυναίκα, το αγγούρι.",
    "ru": "Доброе утро! Вода, женщина.",
}


def ensure_sample(lang: Lang, v: Voice) -> Path:
    """A short phrase in voice `v`, to try voices in the profile."""
    path = settings.media_dir / f"audio/samples/{lang}_{v.key(lang)}_v{AUDIO_FORMAT_VERSION}.mp3"
    if not path.exists():
        _generate(SAMPLE_TEXT[lang], path, lang, v, "sample")
    return path


# The voice each user asked to prepare last: a bulk warm-up for an older choice stops
# (clicking through speeds in the profile shouldn't queue every speed for every word).
_wanted: dict[int, Voice] = {}
_wanted_lock = threading.Lock()


def warm_up(
    word_ids: list[int],
    v: Voice = DEFAULT_VOICE,
    langs: tuple[Lang, ...] = ("el", "ru"),
    *,
    session: bool = False,
    user_id: int | None = None,
) -> None:
    """Make the audio in the background, in this order; failures are fine — playback
    retries on demand. `session=True`: words of a session that just started (own queue).
    `user_id`: a bulk job for this user's voice choice, dropped if they choose another."""
    if not word_ids or not settings.tts_enabled:
        return
    if user_id is not None:
        with _wanted_lock:
            _wanted[user_id] = v
    (_session if session else _bulk).submit(_warm, list(word_ids), v, langs, user_id)


def _warm(word_ids: list[int], v: Voice, langs: tuple[Lang, ...], user_id: int | None) -> None:
    from app.db import SessionLocal

    fails = 0
    with SessionLocal() as db:
        for word_id in word_ids:
            if user_id is not None and _wanted.get(user_id) != v:
                return  # the user picked another voice meanwhile
            word = db.get(Word, word_id)
            if word is None:
                continue
            for lang in langs:
                try:
                    ensure_audio(db, word, lang, v)
                    fails = 0
                except TTSUnavailable:
                    fails += 1
                    if fails >= MAX_FAILS_IN_ROW:
                        return  # the service is down: stop, don't hammer it


# --- dialogue lines (SPEC «Диалоги», Д5) ---
#
# A line is read as a whole sentence. Files: audio/dlg/<line id>_<voice>_<hash of the text>.mp3,
# made on first request. A replaced dialogue gets new lines (new ids), so stale files are only
# left behind by deletion — dialogue_line_files() lists them for that.

DIALOGUE_DIR = "audio/dlg"


def role_voice(speaker: int, rate: int | None = None) -> Voice:
    """Site voice of a role: the first female, the second male, the third female again."""
    return Voice(male=speaker % 2 == 1, rate=rate)


def _line_rel(line: DialogueLine, v: Voice) -> str:
    return f"{DIALOGUE_DIR}/{line.id}_{v.key('el')}_{speech_hash(line.greek)}.mp3"


def ensure_line_audio(line: DialogueLine, v: Voice) -> Path:
    path = settings.media_dir / _line_rel(line, v)
    if not path.exists():
        _generate(line.greek, path, "el", v, f"dialogue line {line.id}")
    return path


def dialogue_line_files(line_ids: list[int]) -> list[str]:
    """Every voice of these lines (relative paths) — to delete along with the dialogue."""
    root = settings.media_dir
    return [
        str(p.relative_to(root))
        for line_id in line_ids
        for p in (root / DIALOGUE_DIR).glob(f"{line_id}_*.mp3")
    ]


def wait_for_background() -> None:
    """For one-off commands (CLI): finish the queued audio before the process exits —
    otherwise the worker threads die with it («cannot schedule new futures after shutdown»)."""
    _bulk.shutdown(wait=True)
    _session.shutdown(wait=True)


def warm_up_dialogue(line_ids: list[int]) -> None:
    """Each line in its role's voice at the default speed, in the background."""
    if line_ids and settings.tts_enabled:
        _bulk.submit(_warm_lines, list(line_ids))


def _warm_lines(line_ids: list[int]) -> None:
    from app.db import SessionLocal

    fails = 0
    with SessionLocal() as db:
        for line_id in line_ids:
            line = db.get(DialogueLine, line_id)
            if line is None:
                continue
            try:
                ensure_line_audio(line, role_voice(line.speaker))
                fails = 0
            except TTSUnavailable:
                fails += 1
                if fails >= MAX_FAILS_IN_ROW:
                    return
