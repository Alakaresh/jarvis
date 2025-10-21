from __future__ import annotations

import asyncio
import inspect
import json
from collections import deque
from pathlib import Path
import sys

from fastapi import FastAPI, HTTPException, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware

# Ensure the "backend" package can be imported when the module is executed
# directly (e.g. via ``uvicorn main:app`` from inside the ``backend`` folder).
if __package__ is None or __package__ == "":  # pragma: no cover - environment guard
    backend_root = Path(__file__).resolve().parent.parent
    sys.path.insert(0, str(backend_root))

from backend.config import settings
try:
    from backend.memory.memory_manager import VectorMemory
except Exception as exc:  # pragma: no cover - optional dependency
    VectorMemory = None  # type: ignore[assignment]
    _memory_import_error: Exception | None = exc
else:
    _memory_import_error = None
from backend.services.ai_provider import (
    AIProvider,
    Attachment,
    ProviderConfigurationError,
    ProviderRequestError,
    create_provider,
)
from backend.services.self_review import SelfReviewError, run_self_review


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


_provider: AIProvider | None = None
_provider_error: ProviderConfigurationError | None = None
_memory: VectorMemory | None = None
_RECENT_HISTORY_LIMIT = 5
_recent_history: deque[tuple[str, str]] = deque(maxlen=_RECENT_HISTORY_LIMIT)
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_SELF_REVIEW_TRIGGERS = (
    "auto-revue",
    "auto revue",
    "auto-analyse",
    "auto analyse",
    "self review",
    "self-review",
)


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
        if VectorMemory is None:
            raise RuntimeError("La mémoire vectorielle n'est pas disponible.") from _memory_import_error

        if not settings.openai_api_key:
            raise RuntimeError("Une clé API OpenAI est requise pour activer la mémoire vectorielle.")

        persist_dir = Path(__file__).resolve().parent / "memory" / "chroma_store"
        persist_dir.mkdir(parents=True, exist_ok=True)

        _memory = VectorMemory(api_key=settings.openai_api_key, persist_dir=str(persist_dir))
    except Exception as exc:  # pragma: no cover - log only
        _memory = None
        print("⚠️ Impossible d'initialiser la mémoire vectorielle:", exc)


_initialise_memory()


async def _execute_self_review() -> dict[str, str]:
    if _provider is None:
        raise SelfReviewError("Le provider d'IA n'est pas initialisé.")

    report = await asyncio.to_thread(run_self_review, _provider, _PROJECT_ROOT)

    if _memory is not None:
        try:
            _memory.add_memory(
                json.dumps(report, ensure_ascii=False, indent=2),
                metadata={"source": "self_review"},
            )
        except Exception as exc:  # pragma: no cover - log only
            print("⚠️ Impossible d'enregistrer l'audit dans la mémoire:", exc)

    return report




def _provider_supports_attachments(provider: AIProvider) -> bool:
    """Return True when the provider accepts an ``attachments`` parameter."""

    try:
        signature = inspect.signature(provider.generate_response)  # type: ignore[attr-defined]
    except (TypeError, ValueError):  # pragma: no cover - fallback for builtins
        return True

    for parameter in signature.parameters.values():
        if parameter.kind in (
            inspect.Parameter.VAR_KEYWORD,
            inspect.Parameter.VAR_POSITIONAL,
        ):
            return True

    return "attachments" in signature.parameters


def _invoke_provider(
    provider: AIProvider, prompt: str, attachments: list[Attachment]
) -> str:
    """Invoke the provider, gracefully handling optional attachment support."""

    if _provider_supports_attachments(provider):
        attachments_payload: list[Attachment] | None = attachments or None
        return provider.generate_response(prompt, attachments_payload)

    return provider.generate_response(prompt)


async def _extract_chat_inputs(
    request: Request,
) -> tuple[str | None, list[UploadFile]]:
    """Extract the user text and uploaded files from the request."""

    content_type = request.headers.get("content-type", "").lower()

    if "application/json" in content_type:
        try:
            payload = await request.json()
        except Exception as exc:  # pragma: no cover - unexpected payload
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Corps JSON invalide."
            ) from exc

        if not isinstance(payload, dict):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Corps JSON invalide."
            )

        text_value = payload.get("text")
        if text_value is None:
            return None, []
        if not isinstance(text_value, str):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Le champ 'text' doit être une chaîne de caractères.",
            )

        return text_value, []

    try:
        form = await request.form()
    except Exception as exc:  # pragma: no cover - unexpected payload
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Format de requête non supporté pour l'endpoint /chat.",
        ) from exc

    raw_text = form.get("text")
    if isinstance(raw_text, UploadFile):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Le champ 'text' ne doit pas être un fichier.",
        )

    uploads: list[UploadFile] = []
    getlist = getattr(form, "getlist", None)
    if callable(getlist):
        for entry in getlist("files"):
            if isinstance(entry, UploadFile):
                uploads.append(entry)
    else:  # pragma: no cover - starlette currently exposes getlist()
        for key, value in form.multi_items():
            if key == "files" and isinstance(value, UploadFile):
                uploads.append(value)

    if raw_text is None:
        return None, uploads

    if not isinstance(raw_text, str):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Le champ 'text' doit être une chaîne de caractères.",
        )

    return raw_text, uploads


@app.post("/chat")
async def chat(request: Request):
    uploads: list[UploadFile] = []
    try:
        if _provider_error is not None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=str(_provider_error),
            )

        if _provider is None:
            raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "AI provider not initialised")

        raw_text, uploads = await _extract_chat_inputs(request)

        if raw_text is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Le champ 'text' est requis."
            )

        text = raw_text.strip()
        if not text:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Le champ 'text' est requis."
            )

        normalized_request = text.lower()
        if any(trigger in normalized_request for trigger in _SELF_REVIEW_TRIGGERS):
            try:
                audit_report = await _execute_self_review()
            except SelfReviewError as exc:
                raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(exc)) from exc

            formatted_report = json.dumps(audit_report, ensure_ascii=False, indent=2)
            _recent_history.append((text, formatted_report))
            return {"response": formatted_report}

        prompt = text

        attachments: list[Attachment] = []
        for upload in uploads:
            content: bytes | None = None
            try:
                content = await upload.read()
            except Exception as exc:
                filename = upload.filename or "(inconnu)"
                print(f"⚠️ Lecture impossible pour le fichier '{filename}':", exc)
                continue

            if not content:
                continue

            attachments.append(
                Attachment(
                    filename=upload.filename or "pièce-jointe",
                    content=content,
                    content_type=upload.content_type,
                )
            )

        relevant_memories: list[str] = []
        if _memory is not None:
            try:
                relevant_memories = [memory for memory in _memory.retrieve_relevant(text) if memory]
            except Exception as exc:  # pragma: no cover - log only
                print("⚠️ Impossible de récupérer la mémoire vectorielle:", exc)

        prompt_sections: list[str] = []

        if _recent_history:
            history_entries = []
            for index, (question, answer) in enumerate(_recent_history, start=1):
                history_entries.append(
                    f"Échange {index} :\nUtilisateur : {question}\nJarvis : {answer}"
                )
            prompt_sections.append(
                "Voici les derniers échanges avec l'utilisateur pour te donner du contexte :\n"
                + "\n\n".join(history_entries)
            )

        if relevant_memories:
            memories_block = "\n".join(f"- {memory}" for memory in relevant_memories)
            prompt_sections.append(
                "Voici des souvenirs issus de conversations précédentes qui peuvent t'aider :\n"
                f"{memories_block}"
            )

        if attachments:
            attachment_lines = "\n".join(f"- {attachment.filename}" for attachment in attachments)
            prompt_sections.append(
                "L'utilisateur a fourni des fichiers en pièces jointes. Utilise-les dans ta réponse si pertinent :\n"
                f"{attachment_lines}"
            )

        if prompt_sections:
            prompt_sections.append("Nouvelle demande :\n" + text)
            prompt = "\n\n".join(prompt_sections)

        try:
            response_text = await asyncio.to_thread(
                _invoke_provider, _provider, prompt, attachments
            )
        except ProviderRequestError as exc:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc

        if _memory is not None:
            try:
                attachment_note = ""
                if attachments:
                    attachment_note = "\nFichiers partagés : " + ", ".join(
                        attachment.filename for attachment in attachments
                    )
                _memory.add_memory(
                    f"Utilisateur : {text}{attachment_note}\nJarvis : {response_text}",
                    metadata={"source": "conversation"},
                )
            except Exception as exc:  # pragma: no cover - log only
                print("⚠️ Impossible d'enregistrer la mémoire vectorielle:", exc)

        history_question = text
        if attachments:
            history_question = (
                f"{text}\n[Fichiers partagés : "
                + ", ".join(attachment.filename for attachment in attachments)
                + "]"
            )

        _recent_history.append((history_question, response_text))

        return {"response": response_text}

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print("❌ ERREUR DANS /chat :", e)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        for upload in uploads:
            try:
                await upload.close()
            except Exception:
                pass


@app.post("/self-review")
async def trigger_self_review() -> dict[str, dict[str, str]]:
    if _provider_error is not None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(_provider_error),
        )

    try:
        report = await _execute_self_review()
    except SelfReviewError as exc:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(exc)) from exc

    return {"report": report}


@app.get("/")
def root():
    return {"message": "API Jarvis prête 🚀"}
