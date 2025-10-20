from __future__ import annotations

from pathlib import Path

import base64
import binascii

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.config import settings
from backend.memory.memory_manager import VectorMemory
from backend.services.ai_provider import (
    AIProvider,
    ProviderConfigurationError,
    ProviderRequestError,
    create_provider,
)


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Attachment(BaseModel):
    name: str
    content: str
    type: str | None = None


class Message(BaseModel):
    text: str
    files: list[Attachment] | None = None


MAX_ATTACHMENT_SIZE = 1_000_000  # 1 Mo
MAX_ATTACHMENT_CHARS = 5_000


_provider: AIProvider | None = None
_provider_error: ProviderConfigurationError | None = None
_memory: VectorMemory | None = None


def _initialise_provider() -> None:
    global _provider, _provider_error
    try:
        _provider = create_provider(
            settings.ai_provider,
            openai_api_key=settings.openai_api_key,
            openai_model=settings.openai_model,
            huggingface_api_key=settings.huggingface_api_key,
            huggingface_model=settings.huggingface_model,
        )
        _provider_error = None
    except ProviderConfigurationError as exc:
        _provider = None
        _provider_error = exc


_initialise_provider()


def _initialise_memory() -> None:
    global _memory

    try:
        if not settings.openai_api_key:
            raise RuntimeError("Une clé API OpenAI est requise pour activer la mémoire vectorielle.")

        persist_dir = Path(__file__).resolve().parent / "memory" / "chroma_store"
        persist_dir.mkdir(parents=True, exist_ok=True)

        _memory = VectorMemory(api_key=settings.openai_api_key, persist_dir=str(persist_dir))
    except Exception as exc:  # pragma: no cover - log only
        _memory = None
        print("⚠️ Impossible d'initialiser la mémoire vectorielle:", exc)


_initialise_memory()


def _decode_attachments(files: list[Attachment] | None) -> list[tuple[str, str]]:
    attachments: list[tuple[str, str]] = []

    if not files:
        return attachments

    for item in files:
        file_name = item.name or "fichier_sans_nom"

        try:
            raw_content = base64.b64decode(item.content, validate=True)
        except binascii.Error as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Le fichier '{file_name}' est invalide (encodage base64).",
            ) from exc

        if len(raw_content) > MAX_ATTACHMENT_SIZE:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Le fichier '{file_name}' dépasse la taille maximale autorisée (1 Mo).",
            )

        try:
            decoded = raw_content.decode("utf-8")
        except UnicodeDecodeError:
            decoded = raw_content.decode("utf-8", errors="ignore")

        if len(decoded) > MAX_ATTACHMENT_CHARS:
            decoded = decoded[:MAX_ATTACHMENT_CHARS] + "\n… (contenu tronqué)"

        label = file_name
        if item.type:
            label += f" ({item.type})"

        attachments.append((label, decoded.strip()))

    return attachments


@app.post("/chat")
async def chat(msg: Message):
    try:
        message_text = msg.text.strip()

        if not message_text:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Un message texte est requis.",
            )

        if _provider_error is not None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=str(_provider_error),
            )

        if _provider is None:
            raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "AI provider not initialised")

        attachments = _decode_attachments(msg.files)

        prompt_sections: list[str] = []

        relevant_memories: list[str] = []
        if _memory is not None:
            try:
                relevant_memories = [memory for memory in _memory.retrieve_relevant(message_text) if memory]
            except Exception as exc:  # pragma: no cover - log only
                print("⚠️ Impossible de récupérer la mémoire vectorielle:", exc)

        if relevant_memories:
            memories_block = "\n".join(f"- {memory}" for memory in relevant_memories)
            prompt_sections.append(
                "Voici des souvenirs issus de conversations précédentes qui peuvent t'aider :\n"
                f"{memories_block}"
            )

        if attachments:
            attachments_block = "\n\n".join(
                f"Nom du fichier : {filename}\nContenu :\n{content}"
                for filename, content in attachments
            )
            prompt_sections.append(
                "L'utilisateur a fourni des fichiers en pièce jointe. Utilise-les si pertinent pour répondre.\n"
                f"{attachments_block}"
            )

        prompt_sections.append(f"Demande de l'utilisateur :\n{message_text}")

        prompt = "\n\n".join(prompt_sections)

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print("❌ ERREUR DANS /chat :", e)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

    error_to_raise: HTTPException | None = None
    try:
        response_text = _provider.generate_response(prompt)
    except ProviderRequestError as exc:
        error_to_raise = HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        )
    except Exception as e:
        import traceback
        print("❌ ERREUR DANS /chat :", e)
        traceback.print_exc()
        error_to_raise = HTTPException(status_code=500, detail=str(e))

    if error_to_raise is not None:
        raise error_to_raise

    if _memory is not None:
        try:
            _memory.add_memory(
                f"Utilisateur : {message_text}\nJarvis : {response_text}",
                metadata={"source": "conversation"},
            )
        except Exception as exc:  # pragma: no cover - log only
            print("⚠️ Impossible d'enregistrer la mémoire vectorielle:", exc)

    return {"response": response_text}



@app.get("/")
def root():
    return {"message": "API Jarvis prête 🚀"}
