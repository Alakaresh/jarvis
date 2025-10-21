from __future__ import annotations

from collections import deque

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
    monkeypatch.setattr("backend.main._recent_history", deque(maxlen=5))
    monkeypatch.setattr("backend.main._uploaded_documents", deque(maxlen=3))

    client = TestClient(app)
    response = client.post("/chat", json={"text": "hello"})

    assert response.status_code == 200
    assert response.json() == {"response": "echo: hello"}


def test_chat_endpoint_provider_error(monkeypatch):
    class FailingProvider:
        def generate_response(self, prompt: str) -> str:
            raise ProviderRequestError("boom")

    monkeypatch.setattr("backend.main._provider", FailingProvider())
    monkeypatch.setattr("backend.main._provider_error", None)
    monkeypatch.setattr("backend.main._recent_history", deque(maxlen=5))
    monkeypatch.setattr("backend.main._uploaded_documents", deque(maxlen=3))

    client = TestClient(app)
    response = client.post("/chat", json={"text": "hello"})

    assert response.status_code == 502
    assert response.json()["detail"] == "boom"


def test_chat_endpoint_configuration_error(monkeypatch):
    monkeypatch.setattr("backend.main._provider", None)
    monkeypatch.setattr("backend.main._provider_error", ProviderConfigurationError("config broken"))
    monkeypatch.setattr("backend.main._recent_history", deque(maxlen=5))
    monkeypatch.setattr("backend.main._uploaded_documents", deque(maxlen=3))

    client = TestClient(app)
    response = client.post("/chat", json={"text": "ignored"})

    assert response.status_code == 500
    assert response.json()["detail"] == "config broken"


def test_chat_includes_recent_history(monkeypatch):
    prompts: list[str] = []

    class RecordingProvider:
        def generate_response(self, prompt: str) -> str:
            prompts.append(prompt)
            return "réponse"

    history = deque(maxlen=5)
    for idx in range(1, 6):
        history.append((f"question {idx}", f"réponse {idx}"))

    monkeypatch.setattr("backend.main._provider", RecordingProvider())
    monkeypatch.setattr("backend.main._provider_error", None)
    monkeypatch.setattr("backend.main._memory", None)
    monkeypatch.setattr("backend.main._recent_history", history)
    monkeypatch.setattr("backend.main._uploaded_documents", deque(maxlen=3))

    client = TestClient(app)
    response = client.post("/chat", json={"text": "quelle est la météo ?"})

    assert response.status_code == 200
    assert response.json() == {"response": "réponse"}

    assert prompts, "Le provider aurait dû être appelé"
    prompt = prompts[0]
    assert "Voici les derniers échanges" in prompt
    for idx in range(1, 6):
        assert f"question {idx}" in prompt
        assert f"réponse {idx}" in prompt
    assert "Nouvelle demande :\nquelle est la météo ?" in prompt

    assert len(history) == 5
    assert history[-1] == ("quelle est la météo ?", "réponse")


def test_chat_includes_uploaded_documents(monkeypatch):
    prompts: list[str] = []

    class RecordingProvider:
        def generate_response(self, prompt: str) -> str:
            prompts.append(prompt)
            return "ok"

    uploaded = deque(maxlen=3)
    uploaded.append(("guide.txt", "Contenu important"))

    monkeypatch.setattr("backend.main._provider", RecordingProvider())
    monkeypatch.setattr("backend.main._provider_error", None)
    monkeypatch.setattr("backend.main._memory", None)
    monkeypatch.setattr("backend.main._recent_history", deque(maxlen=5))
    monkeypatch.setattr("backend.main._uploaded_documents", uploaded)

    client = TestClient(app)
    response = client.post("/chat", json={"text": "utilise le guide"})

    assert response.status_code == 200
    assert prompts, "Le provider aurait dû être appelé"
    prompt = prompts[0]
    assert "guide.txt" in prompt
    assert "Contenu important" in prompt


def test_upload_document_success(monkeypatch):
    captured_memories: list[tuple[str, dict | None]] = []

    class DummyMemory:
        def add_memory(self, content: str, metadata: dict | None = None) -> None:
            captured_memories.append((content, metadata))

    uploaded = deque(maxlen=3)

    monkeypatch.setattr("backend.main._uploaded_documents", uploaded)
    monkeypatch.setattr("backend.main._memory", DummyMemory())

    client = TestClient(app)
    response = client.post(
        "/documents",
        json={"filename": "notes.txt", "content": "Bonjour Jarvis"},
    )

    assert response.status_code == 200
    assert uploaded, "Le document aurait dû être enregistré"
    name, content = uploaded[-1]
    assert name == "notes.txt"
    assert "Bonjour Jarvis" in content
    assert captured_memories, "Le document aurait dû être envoyé à la mémoire"
    saved_content, metadata = captured_memories[-1]
    assert "Document téléchargé" in saved_content
    assert metadata and metadata.get("source") == "notes.txt"


def test_upload_document_rejects_empty(monkeypatch):
    monkeypatch.setattr("backend.main._uploaded_documents", deque(maxlen=3))
    monkeypatch.setattr("backend.main._memory", None)

    client = TestClient(app)
    response = client.post(
        "/documents",
        json={"filename": "vide.txt", "content": "   "},
    )

    assert response.status_code == 400
