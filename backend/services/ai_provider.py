"""Utilities for interacting with external AI providers."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

import httpx


class ProviderError(Exception):
    """Base exception for provider related issues."""


class ProviderConfigurationError(ProviderError):
    """Raised when the provider cannot be configured properly."""


class ProviderRequestError(ProviderError):
    """Raised when a provider request fails."""


@runtime_checkable
class AIProvider(Protocol):
    """Common interface implemented by AI providers."""

    def generate_response(self, prompt: str) -> str:
        """Generate a textual response for the given prompt."""


@dataclass
class OpenAIProvider:
    """Provider backed by the OpenAI API."""

    api_key: str
    model: str = "gpt-3.5-turbo"

    def __post_init__(self) -> None:
        if not self.api_key:
            raise ProviderConfigurationError("An OpenAI API key is required")

    def generate_response(self, prompt: str) -> str:
        try:
            import openai
        except ImportError as exc:  # pragma: no cover - defensive, depends on environment
            raise ProviderRequestError("OpenAI SDK is not installed") from exc

        try:
            openai.api_key = self.api_key  # type: ignore[attr-defined]
            response = openai.ChatCompletion.create(  # type: ignore[attr-defined]
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
            )
        except Exception as exc:  # pragma: no cover - actual API call not covered by tests
            raise ProviderRequestError("Failed to fetch a response from OpenAI") from exc

        try:
            return response["choices"][0]["message"]["content"].strip()
        except (KeyError, IndexError, TypeError) as exc:
            raise ProviderRequestError("Unexpected response structure from OpenAI") from exc


@dataclass
class HuggingFaceProvider:
    """Provider backed by the Hugging Face Inference API."""

    model: str
    api_key: str | None = None
    endpoint_template: str = "https://api-inference.huggingface.co/models/{model}"

    def __post_init__(self) -> None:
        if not self.model:
            raise ProviderConfigurationError("A Hugging Face model identifier is required")

    def generate_response(self, prompt: str) -> str:
        url = self.endpoint_template.format(model=self.model)
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}

        try:
            response = httpx.post(url, headers=headers, json={"inputs": prompt})
            response.raise_for_status()
        except httpx.HTTPError as exc:  # pragma: no cover - network failures not deterministic
            raise ProviderRequestError("Failed to fetch a response from Hugging Face") from exc

        data = response.json()
        if isinstance(data, list) and data:
            # Text generation models usually return a list of dictionaries.
            generated_text = data[0].get("generated_text")
            if isinstance(generated_text, str):
                return generated_text
        if isinstance(data, dict):
            generated_text = data.get("generated_text") or data.get("text")
            if isinstance(generated_text, str):
                return generated_text

        raise ProviderRequestError("Unexpected response structure from Hugging Face")


def create_provider(provider_name: str, **kwargs: str | None) -> AIProvider:
    """Factory that instantiates the proper provider."""

    normalized_name = provider_name.lower()
    if normalized_name == "openai":
        return OpenAIProvider(api_key=kwargs.get("openai_api_key") or "", model=kwargs.get("openai_model") or "gpt-3.5-turbo")
    if normalized_name == "huggingface":
        return HuggingFaceProvider(
            model=kwargs.get("huggingface_model") or "",
            api_key=kwargs.get("huggingface_api_key"),
        )

    raise ProviderConfigurationError(f"Unknown AI provider '{provider_name}'")
