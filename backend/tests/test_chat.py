from __future__ import annotations

import base64

import pytest
from fastapi.testclient import TestClient

from backend.config import Settings
from backend.main import app
from backend.services.ai_provider import (
    HuggingFaceProvider,
    OpenAIProvider,
    ProviderConfigurationError,
    ProviderRequestError,
    create_provider,
)


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


def test_chat_endpoint_success(monkeypatch):
    class DummyProvider:
        def generate_response(self, prompt: str) -> str:
            return f"echo: {prompt}"

    monkeypatch.setattr("backend.main._provider", DummyProvider())
    monkeypatch.setattr("backend.main._provider_error", None)

    client = TestClient(app)
    response = client.post("/chat", json={"text": "hello"})

    assert response.status_code == 200
    assert response.json() == {"response": "echo: Demande de l'utilisateur :\nhello"}


def test_chat_endpoint_provider_error(monkeypatch):
    class FailingProvider:
        def generate_response(self, prompt: str) -> str:
            raise ProviderRequestError("boom")

    monkeypatch.setattr("backend.main._provider", FailingProvider())
    monkeypatch.setattr("backend.main._provider_error", None)

    client = TestClient(app)
    response = client.post("/chat", json={"text": "hello"})

    assert response.status_code == 502
    assert response.json()["detail"] == "boom"


def test_chat_endpoint_configuration_error(monkeypatch):
    monkeypatch.setattr("backend.main._provider", None)
    monkeypatch.setattr("backend.main._provider_error", ProviderConfigurationError("config broken"))

    client = TestClient(app)
    response = client.post("/chat", json={"text": "ignored"})

    assert response.status_code == 500
    assert response.json()["detail"] == "config broken"


def test_chat_endpoint_with_attachments(monkeypatch):
    captured_prompt: dict[str, str] = {}

    class DummyProvider:
        def generate_response(self, prompt: str) -> str:
            captured_prompt["prompt"] = prompt
            return "ok"

    monkeypatch.setattr("backend.main._provider", DummyProvider())
    monkeypatch.setattr("backend.main._provider_error", None)

    client = TestClient(app)
    payload = {
        "text": "Peux-tu aider ?",
        "files": [
            {
                "name": "note.txt",
                "type": "text/plain",
                "content": base64.b64encode(b"Information cruciale").decode(),
            }
        ],
    }

    response = client.post("/chat", json=payload)

    assert response.status_code == 200
    assert response.json() == {"response": "ok"}
    assert "Information cruciale" in captured_prompt["prompt"]
