"""Utilities for interacting with external AI providers."""
from __future__ import annotations

import base64
import mimetypes
from dataclasses import dataclass
from typing import Iterable, Literal, Protocol, runtime_checkable
import httpx
from openai import OpenAI  # ✅ Nouveau SDK officiel


# === Exceptions ===
class ProviderError(Exception):
    """Base exception for provider related issues."""


class ProviderConfigurationError(ProviderError):
    """Raised when the provider cannot be configured properly."""


class ProviderRequestError(ProviderError):
    """Raised when a provider request fails."""


@dataclass
class Attachment:
    """Simple representation of a user supplied file."""

    filename: str
    content: bytes
    content_type: str | None = None


# === Streaming helpers ===
@dataclass
class StreamEvent:
    """Represents a chunk emitted during a streaming response."""

    type: Literal["text-delta", "audio-delta"]
    text: str | None = None
    audio: str | None = None
    audio_format: str | None = None
    audio_sample_rate: int | None = None

    def to_payload(self) -> dict[str, str | int]:
        payload: dict[str, str | int] = {"type": self.type}

        if self.text is not None:
            payload["text"] = self.text

        if self.audio is not None:
            payload["audio"] = self.audio

        if self.audio_format is not None:
            payload["audio_format"] = self.audio_format

        if self.audio_sample_rate is not None:
            payload["audio_sample_rate"] = self.audio_sample_rate

        return payload


# === Interface commune ===
@runtime_checkable
class AIProvider(Protocol):
    """Common interface implemented by AI providers."""

    def generate_response(self, prompt: str, attachments: list[Attachment] | None = None) -> str:
        """Generate a textual response for the given prompt."""

    def stream_response(
        self, prompt: str, attachments: list[Attachment] | None = None
    ) -> Iterable[StreamEvent]:
        """Yield chunks of a response for the given prompt."""


# === Implémentation OpenAI (nouveau SDK) ===
@dataclass
class OpenAIProvider:
    """Provider backed by the OpenAI API (v1+ SDK)."""

    api_key: str
    model: str = "gpt-4o-mini"
    voice: str = "alloy"
    audio_format: str = "pcm16"
    audio_sample_rate: int = 24000

    def __post_init__(self) -> None:
        if not self.api_key:
            raise ProviderConfigurationError("An OpenAI API key is required")

        # Création du client OpenAI une fois pour toutes
        self.client = OpenAI(api_key=self.api_key)

    def _create_input_content(
        self, prompt: str, attachments: list[Attachment] | None
    ) -> list[dict[str, str]]:
        input_content: list[dict[str, str]] = [{"type": "input_text", "text": prompt}]

        for attachment in attachments or []:
            mime_type = attachment.content_type or mimetypes.guess_type(attachment.filename)[0]
            encoded_data = base64.b64encode(attachment.content).decode("utf-8")

            if mime_type and mime_type.startswith("image/"):
                data_uri = f"data:{mime_type};base64,{encoded_data}"
                input_content.append({"type": "input_image", "image_url": data_uri})
            else:
                file_payload: dict[str, str] = {
                    "type": "input_file",
                    "file_data": encoded_data,
                }
                if attachment.filename:
                    file_payload["filename"] = attachment.filename
                input_content.append(file_payload)

        return input_content

    def stream_response(
        self, prompt: str, attachments: list[Attachment] | None = None
    ) -> Iterable[StreamEvent]:
        try:
            input_content = self._create_input_content(prompt, attachments)

            with self.client.responses.stream(
                model=self.model,
                input=[{"role": "user", "content": input_content}],
                instructions="Tu es Jarvis, une IA personnelle utile et amicale.",
                modalities=["text", "audio"],
                audio={"voice": self.voice, "format": self.audio_format},
            ) as stream:
                for event in stream:
                    if event.type == "response.output_text.delta":
                        delta = event.delta or ""
                        if delta:
                            yield StreamEvent(type="text-delta", text=delta)
                    elif event.type == "response.output_audio.delta":
                        audio_chunk = event.delta or ""
                        if audio_chunk:
                            yield StreamEvent(
                                type="audio-delta",
                                audio=audio_chunk,
                                audio_format=self.audio_format,
                                audio_sample_rate=self.audio_sample_rate,
                            )
                    elif event.type == "response.error":
                        raise ProviderRequestError(event.error.message)

                stream.until_done()

        except ProviderRequestError:
            raise
        except Exception as exc:
            print("❌ Erreur OpenAI:", exc)
            raise ProviderRequestError("Failed to fetch a response from OpenAI") from exc

    def generate_response(
        self, prompt: str, attachments: list[Attachment] | None = None
    ) -> str:
        final_text_parts: list[str] = []

        for event in self.stream_response(prompt, attachments):
            if event.type == "text-delta" and event.text:
                final_text_parts.append(event.text)

        final_text = "".join(final_text_parts).strip()
        return final_text or "(Réponse vide)"
        


# === Implémentation HuggingFace ===
@dataclass
class HuggingFaceProvider:
    """Provider backed by the Hugging Face Inference API."""

    model: str
    api_key: str | None = None
    endpoint_template: str = "https://api-inference.huggingface.co/models/{model}"

    def __post_init__(self) -> None:
        if not self.model:
            raise ProviderConfigurationError("A Hugging Face model identifier is required")

    def generate_response(
        self, prompt: str, attachments: list[Attachment] | None = None
    ) -> str:
        url = self.endpoint_template.format(model=self.model)
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}

        try:
            response = httpx.post(url, headers=headers, json={"inputs": prompt})
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise ProviderRequestError("Failed to fetch a response from Hugging Face") from exc

        data = response.json()
        if isinstance(data, list) and data:
            generated_text = data[0].get("generated_text")
            if isinstance(generated_text, str):
                return generated_text
        if isinstance(data, dict):
            generated_text = data.get("generated_text") or data.get("text")
            if isinstance(generated_text, str):
                return generated_text

        raise ProviderRequestError("Unexpected response structure from Hugging Face")

    def stream_response(
        self, prompt: str, attachments: list[Attachment] | None = None
    ) -> Iterable[StreamEvent]:
        text = self.generate_response(prompt, attachments)
        yield StreamEvent(type="text-delta", text=text)


# === Factory ===
def create_provider(provider_name: str, **kwargs: str | None) -> AIProvider:
    """Factory that instantiates the proper provider."""

    normalized_name = provider_name.lower()
    if normalized_name == "openai":
        return OpenAIProvider(
            api_key=kwargs.get("openai_api_key") or "",
            model=kwargs.get("openai_model") or "gpt-4o-mini",
        )
    if normalized_name == "huggingface":
        return HuggingFaceProvider(
            model=kwargs.get("huggingface_model") or "",
            api_key=kwargs.get("huggingface_api_key"),
        )

    raise ProviderConfigurationError(f"Unknown AI provider '{provider_name}'")
