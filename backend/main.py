from __future__ import annotations

import asyncio
import json
from collections import deque
from pathlib import Path
import sys

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, status
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


@app.post("/chat")
async def chat(
    text: str = Form(...), files: list[UploadFile] | None = File(default=None)
):
    try:
        if _provider_error is not None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=str(_provider_error),
            )

        if _provider is None:
            raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "AI provider not initialised")

        normalized_request = text.strip().lower()
        if any(trigger in normalized_request for trigger in _SELF_REVIEW_TRIGGERS):
            try:
                audit_report = await _execute_self_review()
            except SelfReviewError as exc:
                raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(exc)) from exc

            formatted_report = json.dumps(audit_report, ensure_ascii=False, indent=2)
            _recent_history.append((text, formatted_report))
            return {"response": formatted_report}

        prompt = text

        uploads = files or []
        attachments: list[Attachment] = []
        for upload in uploads:
            content: bytes | None = None
            try:
                content = await upload.read()
            except Exception as exc:
                filename = upload.filename or "(inconnu)"
                print(f"⚠️ Lecture impossible pour le fichier '{filename}':", exc)
                continue
            finally:
                await upload.close()

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
                _provider.generate_response, prompt, attachments
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
