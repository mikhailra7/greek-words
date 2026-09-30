from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    env: str = "dev"
    database_url: str = f"sqlite:///{PROJECT_ROOT / 'data' / 'greek.db'}"
    # Public files (word images, audio), served at /media.
    media_dir: Path = PROJECT_ROOT / "media"
    # Private import working files (uploaded textbook PDFs, draft crops). Served only to admins.
    imports_dir: Path = PROJECT_ROOT / "data" / "imports"
    prompts_dir: Path = PROJECT_ROOT / "docs" / "prompts"
    max_upload_mb: int = 50
    max_import_pages: int = 30
    # Text-to-speech (edge-tts, Microsoft neural voices; unofficial API, free).
    tts_enabled: bool = True  # off in e2e tests: no network calls
    tts_voice: str = "el-GR-AthinaNeural"
    tts_rate: str = "-10%"
    tts_voice_ru: str = "ru-RU-SvetlanaNeural"
    # Male voices — a per-user choice in the profile («Озвучка»).
    tts_voice_male: str = "el-GR-NestorasNeural"
    tts_voice_ru_male: str = "ru-RU-DmitryNeural"
    tts_rate_ru: str = "+0%"
    # Stock pictures: Openverse needs no key; Pixabay is used instead when a key is set.
    pixabay_api_key: str = ""
    session_secret: str = "change-me"
    max_users: int = 20


settings = Settings()
