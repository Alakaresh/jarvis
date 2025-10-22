"""Application configuration helpers."""
from __future__ import annotations

import os
from functools import lru_cache
from typing import Any
from dotenv import load_dotenv  # 👈 AJOUT IMPORTANT

# Charger les variables du fichier .env
load_dotenv(dotenv_path=".env")

class Settings:
    """Simple settings loader relying on environment variables."""

    def __init__(self, **overrides: Any) -> None:
        env = os.getenv
        self.ai_provider: str = overrides.get("ai_provider", env("AI_PROVIDER", "openai"))
        self.openai_api_key: str | None = overrides.get("openai_api_key", env("OPENAI_API_KEY"))
        self.openai_model: str = overrides.get("openai_model", env("OPENAI_MODEL", "gpt-4o-mini"))
        self.openai_realtime_model: str = overrides.get(
            "openai_realtime_model", env("OPENAI_REALTIME_MODEL", "gpt-4o-realtime-preview")
        )
        self.openai_realtime_voice: str | None = overrides.get(
            "openai_realtime_voice", env("OPENAI_REALTIME_VOICE", "alloy")
        )
        self.openai_realtime_language: str | None = overrides.get(
            "openai_realtime_language", env("OPENAI_REALTIME_LANGUAGE")
        )
        self.huggingface_api_key: str | None = overrides.get(
            "huggingface_api_key", env("HUGGINGFACE_API_KEY")
        )
        self.huggingface_model: str = overrides.get(
            "huggingface_model", env("HUGGINGFACE_MODEL", "gpt2")
        )

    def model_dump(self) -> dict[str, Any]:
        """Expose settings as a dictionary for convenience."""
        return {
            "ai_provider": self.ai_provider,
            "openai_api_key": self.openai_api_key,
            "openai_model": self.openai_model,
            "openai_realtime_model": self.openai_realtime_model,
            "openai_realtime_voice": self.openai_realtime_voice,
            "openai_realtime_language": self.openai_realtime_language,
            "huggingface_api_key": self.huggingface_api_key,
            "huggingface_model": self.huggingface_model,
        }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached application settings."""
    return Settings()


settings = get_settings()
