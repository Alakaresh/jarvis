from __future__ import annotations

import asyncio
from collections import deque
from datetime import datetime, timezone
import mimetypes
import os
from pathlib import Path
import sys
from typing import Any

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
_SOURCE_FILE_EXTENSIONS = {
    ".py",
    ".pyi",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".mjs",
    ".cjs",
    ".html",
    ".css",
    ".scss",
    ".sass",
    ".less",
    ".json",
    ".yml",
    ".yaml",
    ".md",
}
_EXCLUDED_DIR_NAMES = {
    "__pycache__",
    "node_modules",
    "tests",
    "test",
    "data",
    "dataset",
    "datasets",
    "venv",
    ".venv",
    ".git",
    ".idea",
    ".mypy_cache",
    ".pytest_cache",
    ".cache",
    "dist",
    "build",
    "coverage",
    "tmp",
    "temp",
    "chroma_store",
}
_EXCLUDED_FILE_NAMES = {
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "poetry.lock",
    "pipfile.lock",
    ".ds_store",
    ".env",
}
_MAX_FILES_LISTED_IN_PROMPT = 30
_SELF_REVIEW_PROMPT = (
    "Tu es Jarvis et tu dois réaliser un audit complet de ton propre projet. "
    "Les fichiers sources sont fournis en pièces jointes et leurs noms correspondent "
    "à leur chemin relatif dans le dépôt. Analyse l'ensemble du code et rédige un "
    "rapport détaillé en français en respectant impérativement les sections suivantes :\n"
    "1. Architecture\n"
    "2. Sécurité\n"
    "3. Lisibilité / Style\n"
    "4. Performance\n"
    "5. Maintenabilité\n"
    "6. Améliorations proposées\n\n"
    "Pour chaque section, cite des exemples précis en mentionnant le chemin du fichier "
    "entre parenthèses, identifie les points forts, les risques potentiels et propose "
    "des actions concrètes. Si une section ne s'applique pas, explique pourquoi. "
    "Conclue par un bref résumé global et, lorsque c'est pertinent, suggère un ordre "
    "de priorité pour les actions à mener."
)


def _should_skip_directory(name: str) -> bool:
    normalized = name.lower()
    return normalized in _EXCLUDED_DIR_NAMES or normalized.startswith(".")


def _should_skip_file(name: str) -> bool:
    normalized = name.lower()
    if normalized in _EXCLUDED_FILE_NAMES:
        return True
    return normalized.startswith(".")


def _guess_mime_type(path: Path) -> str | None:
    mime_type, _ = mimetypes.guess_type(path.name)
    if mime_type:
        return mime_type
    return "text/plain"


def _gather_source_attachments(base_dir: Path) -> tuple[list[Attachment], list[str]]:
    attachments: list[Attachment] = []
    relative_paths: list[str] = []

    for root, dirs, files in os.walk(base_dir):
        dirs[:] = [directory for directory in dirs if not _should_skip_directory(directory)]

        for file_name in files:
            if _should_skip_file(file_name):
                continue

            file_path = Path(root) / file_name
            if file_path.suffix.lower() not in _SOURCE_FILE_EXTENSIONS:
                continue

            try:
                content = file_path.read_bytes()
            except OSError as exc:
                print(f"⚠️ Lecture impossible pour '{file_path}':", exc)
                continue

            relative_path = file_path.relative_to(base_dir).as_posix()
            attachments.append(
                Attachment(
                    filename=relative_path,
                    content=content,
                    content_type=_guess_mime_type(file_path),
                )
            )
            relative_paths.append(relative_path)

    attachments.sort(key=lambda item: item.filename.lower())
    relative_paths.sort()

    return attachments, relative_paths


def _is_self_review_request(text: str) -> bool:
    normalized = text.lower().replace("’", "'")
    normalized = " ".join(normalized.split())
    normalized_no_hyphen = normalized.replace("-", " ")

    triggers = [
        "auto revue",
        "autorevue",
        "auto revue de ton code",
        "auto revue du code",
        "auto audit",
        "self review",
        "self-review",
        "audit de ton code",
        "audit du code",
        "analyse ton code",
        "analyse de ton code",
        "auto-analyse",
        "auto analyse",
    ]

    return any(
        trigger in normalized or trigger in normalized_no_hyphen for trigger in triggers
    )


def _perform_self_audit(store_in_memory: bool = True) -> dict[str, Any]:
    if _provider is None:
        raise RuntimeError("Le fournisseur d'IA n'est pas initialisé.")

    attachments, relative_paths = _gather_source_attachments(_PROJECT_ROOT)

    if not attachments:
        raise RuntimeError("Aucun fichier source détecté pour l'auto-revue.")

    listed_paths = relative_paths[:_MAX_FILES_LISTED_IN_PROMPT]
    remaining_count = max(0, len(relative_paths) - len(listed_paths))
    prompt_sections = [_SELF_REVIEW_PROMPT]

    if listed_paths:
        file_listing = "\n".join(f"- {path}" for path in listed_paths)
        if remaining_count:
            file_listing += f"\n- … et {remaining_count} autres fichiers."
        prompt_sections.append(
            "Aperçu des fichiers analysés (chemins relatifs) :\n" + file_listing
        )

    prompt = "\n\n".join(prompt_sections)

    response_text = _provider.generate_response(prompt, attachments)
    report_text = response_text.strip()
    timestamp = datetime.now(timezone.utc).isoformat()

    result: dict[str, Any] = {
        "report": report_text,
        "file_count": len(relative_paths),
        "generated_at": timestamp,
    }

    if len(relative_paths) <= 200:
        result["files"] = relative_paths
    else:
        result["files"] = [
            *relative_paths[:200],
            f"… ({len(relative_paths) - 200} fichiers supplémentaires)",
        ]

    if store_in_memory and _memory is not None:
        try:
            _memory.add_memory(
                f"[Auto-audit du {timestamp}]\n{report_text}",
                metadata={
                    "source": "self-review",
                    "file_count": len(relative_paths),
                },
            )
        except Exception as exc:  # pragma: no cover - log only
            print("⚠️ Impossible d'enregistrer l'auto-audit dans la mémoire:", exc)

    return result


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

        uploads = files or []
        is_self_review = _is_self_review_request(text)
        audit_payload: dict[str, Any] | None = None
        attachments_for_history: list[Attachment] = []

        if is_self_review:
            for upload in uploads:
                try:
                    await upload.close()
                except Exception as exc:  # pragma: no cover - log only
                    filename = upload.filename or "(inconnu)"
                    print(f"⚠️ Impossible de fermer le fichier '{filename}':", exc)

            try:
                audit_payload = await asyncio.to_thread(_perform_self_audit, True)
            except ProviderRequestError as exc:
                raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc

            response_text = audit_payload.get("report", "").strip()
            if not response_text:
                raise HTTPException(
                    status.HTTP_500_INTERNAL_SERVER_ERROR,
                    "Rapport d'auto-audit vide",
                )
        else:
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

            attachments_for_history = attachments

            relevant_memories: list[str] = []
            if _memory is not None:
                try:
                    relevant_memories = [
                        memory for memory in _memory.retrieve_relevant(text) if memory
                    ]
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
                attachment_lines = "\n".join(
                    f"- {attachment.filename}" for attachment in attachments
                )
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
                if audit_payload is not None:
                    attachment_note = "\nCommande spéciale : auto-audit du code"
                elif attachments_for_history:
                    attachment_note = "\nFichiers partagés : " + ", ".join(
                        attachment.filename for attachment in attachments_for_history
                    )
                _memory.add_memory(
                    f"Utilisateur : {text}{attachment_note}\nJarvis : {response_text}",
                    metadata={"source": "conversation"},
                )
            except Exception as exc:  # pragma: no cover - log only
                print("⚠️ Impossible d'enregistrer la mémoire vectorielle:", exc)

        history_question = text
        if attachments_for_history:
            history_question = (
                f"{text}\n[Fichiers partagés : "
                + ", ".join(attachment.filename for attachment in attachments_for_history)
                + "]"
            )
        elif audit_payload is not None:
            history_question = f"{text}\n[Auto-audit interne déclenché]"

        _recent_history.append((history_question, response_text))

        response_payload: dict[str, Any] = {"response": response_text}
        if audit_payload is not None:
            response_payload["audit"] = audit_payload

        return response_payload

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print("❌ ERREUR DANS /chat :", e)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/self-review")
async def trigger_self_review(store_in_memory: bool = True):
    try:
        if _provider_error is not None:
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                str(_provider_error),
            )

        if _provider is None:
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                "AI provider not initialised",
            )

        audit_result = await asyncio.to_thread(_perform_self_audit, store_in_memory)
        return audit_result

    except ProviderRequestError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        import traceback

        print("❌ ERREUR DANS /self-review :", exc)
        traceback.print_exc()
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(exc))


@app.get("/")
def root():
    return {"message": "API Jarvis prête 🚀"}
