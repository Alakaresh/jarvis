from __future__ import annotations

from collections import deque
from datetime import datetime as real_datetime, timezone as real_timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import pytest
from fastapi import HTTPException
import fastapi.dependencies.utils as fastapi_utils

fastapi_utils.ensure_multipart_is_installed = lambda: None

import backend.main as main
from backend.config import Settings
from backend.services.ai_provider import (
    HuggingFaceProvider,
    OpenAIProvider,
    ProviderConfigurationError,
    ProviderRequestError,
    create_provider,
)


pytestmark = pytest.mark.anyio("asyncio")


WEEKDAYS_FR = [
    "lundi",
    "mardi",
    "mercredi",
    "jeudi",
    "vendredi",
    "samedi",
    "dimanche",
]

MONTHS_FR = [
    "janvier",
    "février",
    "mars",
    "avril",
    "mai",
    "juin",
    "juillet",
    "août",
    "septembre",
    "octobre",
    "novembre",
    "décembre",
]


@pytest.fixture
def anyio_backend():
    return "asyncio"


def test_create_provider_openai():
    settings = Settings(
        ai_provider="openai",
        openai_api_key="test-key",
        openai_model="gpt-test",
    )
    provider = create_provider(
        settings.ai_provider,
        openai_api_key=settings.openai_api_key,
        openai_model=settings.openai_model,
    )

    assert isinstance(provider, OpenAIProvider)
    assert provider.api_key == "test-key"
    assert provider.model == "gpt-test"


def test_create_provider_huggingface():
    settings = Settings(
        ai_provider="huggingface",
        huggingface_api_key="hf-key",
        huggingface_model="distilgpt2",
    )
    provider = create_provider(
        settings.ai_provider,
        huggingface_api_key=settings.huggingface_api_key,
        huggingface_model=settings.huggingface_model,
    )

    assert isinstance(provider, HuggingFaceProvider)
    assert provider.api_key == "hf-key"
    assert provider.model == "distilgpt2"


def test_create_provider_unknown():
    with pytest.raises(ProviderConfigurationError):
        create_provider("invalid")


async def test_chat_endpoint_success(monkeypatch):
    prompts: list[str] = []

    class RecordingProvider:
        def generate_response(self, prompt: str, attachments=None) -> str:  # type: ignore[override]
            prompts.append(prompt)
            return "réponse"

    class FixedDatetime:
        @classmethod
        def now(cls, tz=None):  # type: ignore[override]
            base = real_datetime(2024, 6, 5, 14, 30, tzinfo=real_timezone.utc)
            if tz is not None:
                return base.astimezone(tz)
            return base

    monkeypatch.setattr(main, "datetime", FixedDatetime)
    monkeypatch.setattr(main, "_provider", RecordingProvider())
    monkeypatch.setattr(main, "_provider_error", None)
    monkeypatch.setattr(main, "_recent_history", deque(maxlen=5))

    response = await main.chat(text="hello", files=None, stream=False)

    assert response == {"response": "réponse"}

    base_utc = FixedDatetime.now(real_timezone.utc)
    try:
        expected_now = base_utc.astimezone(ZoneInfo("Europe/Paris"))
        expected_label = main._PARIS_LABEL
    except ZoneInfoNotFoundError:
        expected_now = base_utc.astimezone(main._PARIS_FALLBACK_TZ)
        expected_label = main._PARIS_FALLBACK_LABEL
    weekday = WEEKDAYS_FR[expected_now.weekday()]
    month = MONTHS_FR[expected_now.month - 1]
    date_description = f"{weekday} {expected_now.day} {month} {expected_now.year}"
    time_description = expected_now.strftime("%H:%M")
    iso_timestamp = expected_now.isoformat(timespec="minutes")
    expected_context = (
        "Informations temporelles actuelles :\n"
        f"- Nous sommes {date_description}.\n"
        f"- Il est {time_description} ({expected_label}).\n"
        f"- Timestamp ISO 8601 : {iso_timestamp}.\n"
        "Prends en compte cette temporalité lorsque c'est pertinent."
    )
    assert prompts, "Le provider aurait dû être appelé"
    prompt = prompts[0]
    assert prompt.startswith(expected_context)
    assert prompt.endswith("Nouvelle demande :\nhello")


async def test_chat_endpoint_timezone_fallback(monkeypatch):
    prompts: list[str] = []

    class RecordingProvider:
        def generate_response(self, prompt: str, attachments=None) -> str:  # type: ignore[override]
            prompts.append(prompt)
            return "réponse"

    class FixedDatetime:
        @classmethod
        def now(cls, tz=None):  # type: ignore[override]
            base = real_datetime(2024, 6, 5, 14, 30, tzinfo=real_timezone.utc)
            if tz is not None:
                return base.astimezone(tz)
            return base

    def raising_zoneinfo(key: str):
        raise ZoneInfoNotFoundError(key)

    monkeypatch.setattr(main, "datetime", FixedDatetime)
    monkeypatch.setattr(main, "ZoneInfo", raising_zoneinfo)
    monkeypatch.setattr(main, "_provider", RecordingProvider())
    monkeypatch.setattr(main, "_provider_error", None)
    monkeypatch.setattr(main, "_recent_history", deque(maxlen=5))

    response = await main.chat(text="hello", files=None, stream=False)

    assert response == {"response": "réponse"}

    expected_now = FixedDatetime.now(real_timezone.utc).astimezone(main._PARIS_FALLBACK_TZ)
    weekday = WEEKDAYS_FR[expected_now.weekday()]
    month = MONTHS_FR[expected_now.month - 1]
    date_description = f"{weekday} {expected_now.day} {month} {expected_now.year}"
    time_description = expected_now.strftime("%H:%M")
    iso_timestamp = expected_now.isoformat(timespec="minutes")
    expected_context = (
        "Informations temporelles actuelles :\n"
        f"- Nous sommes {date_description}.\n"
        f"- Il est {time_description} ({main._PARIS_FALLBACK_LABEL}).\n"
        f"- Timestamp ISO 8601 : {iso_timestamp}.\n"
        "Prends en compte cette temporalité lorsque c'est pertinent."
    )
    assert prompts, "Le provider aurait dû être appelé"
    prompt = prompts[0]
    assert prompt.startswith(expected_context)


async def test_chat_endpoint_provider_error(monkeypatch):
    class FailingProvider:
        def generate_response(self, prompt: str, attachments=None) -> str:  # type: ignore[override]
            raise ProviderRequestError("boom")

    monkeypatch.setattr(main, "_provider", FailingProvider())
    monkeypatch.setattr(main, "_provider_error", None)
    monkeypatch.setattr(main, "_recent_history", deque(maxlen=5))

    with pytest.raises(HTTPException) as exc_info:
        await main.chat(text="hello", files=None, stream=False)

    assert exc_info.value.status_code == 502
    assert exc_info.value.detail == "boom"


async def test_chat_endpoint_configuration_error(monkeypatch):
    monkeypatch.setattr(main, "_provider", None)
    monkeypatch.setattr(main, "_provider_error", ProviderConfigurationError("config broken"))
    monkeypatch.setattr(main, "_recent_history", deque(maxlen=5))

    with pytest.raises(HTTPException) as exc_info:
        await main.chat(text="ignored", files=None, stream=False)

    assert exc_info.value.status_code == 500
    assert exc_info.value.detail == "config broken"


async def test_chat_includes_recent_history(monkeypatch):
    prompts: list[str] = []

    class RecordingProvider:
        def generate_response(self, prompt: str, attachments=None) -> str:  # type: ignore[override]
            prompts.append(prompt)
            return "réponse"

    history = deque(maxlen=5)
    for idx in range(1, 6):
        history.append((f"question {idx}", f"réponse {idx}"))

    monkeypatch.setattr(main, "_provider", RecordingProvider())
    monkeypatch.setattr(main, "_provider_error", None)
    monkeypatch.setattr(main, "_memory", None)
    monkeypatch.setattr(main, "_recent_history", history)

    response = await main.chat(text="quelle est la météo ?", files=None, stream=False)

    assert response == {"response": "réponse"}

    assert prompts, "Le provider aurait dû être appelé"
    prompt = prompts[0]
    assert "Voici les derniers échanges" in prompt
    for idx in range(1, 6):
        assert f"question {idx}" in prompt
        assert f"réponse {idx}" in prompt
    assert "Nouvelle demande :\nquelle est la météo ?" in prompt

    assert len(history) == 5
    assert history[-1] == ("quelle est la météo ?", "réponse")
