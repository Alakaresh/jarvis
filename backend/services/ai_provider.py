"""Utilities for interacting with external AI providers."""
from __future__ import annotations

import base64
import mimetypes
from dataclasses import dataclass
from typing import Iterable, Protocol, runtime_checkable
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


# === Interface commune ===
@runtime_checkable
class AIProvider(Protocol):
    """Common interface implemented by AI providers."""

    def generate_response(self, prompt: str, attachments: list[Attachment] | None = None) -> str:
        """Generate a textual response for the given prompt."""

    def stream_response(
        self, prompt: str, attachments: list[Attachment] | None = None
    ) -> Iterable[str]:
        """Stream a textual response chunk by chunk."""


# === Implémentation OpenAI (nouveau SDK) ===
@dataclass
class OpenAIProvider:
    """Provider backed by the OpenAI API (v1+ SDK)."""

    api_key: str
    model: str = "gpt-4o-mini"
    instructions: str = "Tu es Jarvis, une IA personnelle utile et amicale."

    def __post_init__(self) -> None:
        if not self.api_key:
            raise ProviderConfigurationError("An OpenAI API key is required")

        # Création du client OpenAI une fois pour toutes
        self.client = OpenAI(api_key=self.api_key)

    def _build_input_content(
        self, prompt: str, attachments: list[Attachment] | None
    ) -> list[dict[str, str]]:
        input_content: list[dict[str, str]] = [
            {"type": "input_text", "text": prompt}
        ]

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

    def _build_request_payload(
        self, prompt: str, attachments: list[Attachment] | None
    ) -> dict[str, object]:
        return {
            "model": self.model,
            "input": [
                {
                    "role": "user",
                    "content": self._build_input_content(prompt, attachments),
                }
            ],
            "instructions": self.instructions,
        }

    def generate_response(
        self, prompt: str, attachments: list[Attachment] | None = None
    ) -> str:
        try:
            response = self.client.responses.create(**self._build_request_payload(prompt, attachments))

            usage = getattr(response, "usage", None)
            if usage is not None:
                input_tokens = getattr(usage, "input_tokens", None)
                if input_tokens is not None:
                    print(f"🧮 Tokens envoyés au modèle : {input_tokens}")

            result_text = response.output_text.strip()
            if not result_text:
                for output in getattr(response, "output", []):
                    if getattr(output, "type", None) == "message":
                        for content in getattr(output, "content", []):
                            if getattr(content, "type", None) == "output_text":
                                maybe_text = getattr(content, "text", "").strip()
                                if maybe_text:
                                    result_text = maybe_text
                                    break
                        if result_text:
                            break

            if not result_text:
                raise ProviderRequestError("Empty response received from OpenAI")

            return result_text
        except Exception as exc:
            print("❌ Erreur OpenAI:", exc)
            raise ProviderRequestError("Failed to fetch a response from OpenAI") from exc

    def stream_response(
        self, prompt: str, attachments: list[Attachment] | None = None
    ) -> Iterable[str]:
        try:
            payload = self._build_request_payload(prompt, attachments)
            with self.client.responses.stream(**payload) as stream:
                final_response = None
                emitted_any = False
                for event in stream:
                    event_type = getattr(event, "type", "")
                    if event_type == "response.output_text.delta":
                        chunk = getattr(event, "delta", "")
                        if chunk:
                            emitted_any = True
                            yield chunk
                    elif event_type == "response.completed":
                        final_response = getattr(event, "response", None)
                    elif event_type == "response.error":
                        error_obj = getattr(event, "error", None)
                        message = getattr(error_obj, "message", None) if error_obj else None
                        raise ProviderRequestError(message or "Failed to stream a response from OpenAI")

                final_response = final_response or stream.get_final_response()

                if not emitted_any and final_response is not None:
                    fallback_text = getattr(final_response, "output_text", "").strip()
                    if not fallback_text:
                        for output in getattr(final_response, "output", []):
                            if getattr(output, "type", None) == "message":
                                for content in getattr(output, "content", []):
                                    if getattr(content, "type", None) == "output_text":
                                        maybe_text = getattr(content, "text", "").strip()
                                        if maybe_text:
                                            fallback_text = maybe_text
                                            break
                                if fallback_text:
                                    break
                    if fallback_text:
                        yield fallback_text
                        emitted_any = True

                if not emitted_any:
                    raise ProviderRequestError("Empty response received from OpenAI")

                usage = getattr(final_response, "usage", None) if final_response is not None else None
                if usage is not None:
                    input_tokens = getattr(usage, "input_tokens", None)
                    if input_tokens is not None:
                        print(f"🧮 Tokens envoyés au modèle : {input_tokens}")
        except ProviderRequestError:
            raise
        except Exception as exc:
            print("❌ Erreur OpenAI (stream):", exc)
            raise ProviderRequestError("Failed to stream a response from OpenAI") from exc


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
    ) -> Iterable[str]:
        yield self.generate_response(prompt, attachments)


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
