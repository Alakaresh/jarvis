from __future__ import annotations

import asyncio
from collections import deque
from datetime import datetime, timedelta, timezone
from io import BytesIO
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from pathlib import Path
import sys

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI

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
_TRANSCRIPTION_MODELS = ("gpt-4o-mini-transcribe", "whisper-1")

_WEEKDAYS_FR = [
    "lundi",
    "mardi",
    "mercredi",
    "jeudi",
    "vendredi",
    "samedi",
    "dimanche",
]

_MONTHS_FR = [
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


_PARIS_FALLBACK_TZ = timezone(timedelta(hours=2))
_PARIS_LABEL = "heure de Paris"
_PARIS_FALLBACK_LABEL = "heure de Paris (UTC+02:00 approximative)"


def _build_temporal_context() -> str:
    """Return a human readable description of the current Paris date and time."""

    now_utc = datetime.now(timezone.utc)

    try:
        paris_tz = ZoneInfo("Europe/Paris")
    except ZoneInfoNotFoundError:
        now_paris = now_utc.astimezone(_PARIS_FALLBACK_TZ)
        time_label = _PARIS_FALLBACK_LABEL
    else:
        now_paris = now_utc.astimezone(paris_tz)
        time_label = _PARIS_LABEL

    weekday = _WEEKDAYS_FR[now_paris.weekday()]
    month = _MONTHS_FR[now_paris.month - 1]
    date_description = f"{weekday} {now_paris.day} {month} {now_paris.year}"
    time_description = now_paris.strftime("%H:%M")
    iso_timestamp = now_paris.isoformat(timespec="minutes")

    return (
        "Informations temporelles actuelles :\n"
        f"- Nous sommes {date_description}.\n"
        f"- Il est {time_description} ({time_label}).\n"
        f"- Timestamp ISO 8601 : {iso_timestamp}.\n"
        "Prends en compte cette temporalité lorsque c'est pertinent."
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


@app.post("/chat")
async def chat(
    text: str = Form(...),
    files: list[UploadFile] | None = File(default=None),
    stream: bool = Form(default=False),
):
    try:
        if _provider_error is not None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=str(_provider_error),
            )

        if _provider is None:
            raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "AI provider not initialised")

        prompt = text
        stream_requested = bool(stream)

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

        prompt_sections: list[str] = [_build_temporal_context()]

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

        history_question = text
        if attachments:
            history_question = (
                f"{text}\n[Fichiers partagés : "
                + ", ".join(attachment.filename for attachment in attachments)
                + "]"
            )

        def handle_response(response_text: str) -> None:
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

            _recent_history.append((history_question, response_text))

        if stream_requested:

            async def streaming_generator():
                loop = asyncio.get_running_loop()
                queue: asyncio.Queue[tuple[str | None, Exception | None]] = asyncio.Queue()

                def produce() -> None:
                    try:
                        for chunk in _provider.stream_response(prompt, attachments):
                            asyncio.run_coroutine_threadsafe(queue.put((chunk, None)), loop)
                    except Exception as exc:
                        asyncio.run_coroutine_threadsafe(queue.put((None, exc)), loop)
                    finally:
                        asyncio.run_coroutine_threadsafe(queue.put((None, None)), loop)

                producer_task = asyncio.create_task(asyncio.to_thread(produce))
                final_parts: list[str] = []
                cancelled = False

                try:
                    while True:
                        chunk, error = await queue.get()
                        if error is not None:
                            await producer_task
                            if isinstance(error, ProviderRequestError):
                                raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(error)) from error
                            raise HTTPException(
                                status.HTTP_500_INTERNAL_SERVER_ERROR, str(error)
                            ) from error
                        if chunk is None:
                            break
                        if chunk:
                            final_parts.append(chunk)
                            yield chunk
                except asyncio.CancelledError:
                    cancelled = True
                finally:
                    await producer_task

                if cancelled:
                    return

                response_text = "".join(final_parts).strip() or "(Réponse vide)"
                handle_response(response_text)

            return StreamingResponse(
                streaming_generator(), media_type="text/plain; charset=utf-8"
            )

        try:
            response_text = await asyncio.to_thread(
                _provider.generate_response, prompt, attachments
            )
        except ProviderRequestError as exc:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc

        handle_response(response_text)

        return {"response": response_text}

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print("❌ ERREUR DANS /chat :", e)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))



@app.post("/transcribe-audio")
async def transcribe_audio(audio: UploadFile = File(...)):
    if not settings.openai_api_key:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "La transcription vocale nécessite une clé API OpenAI.",
        )

    original_filename = audio.filename or "enregistrement.webm"

    try:
        audio_bytes = await audio.read()
    except Exception as exc:  # pragma: no cover - unexpected I/O failure
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Impossible de lire le flux audio fourni.",
        ) from exc
    finally:
        await audio.close()

    if not audio_bytes:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Le fichier audio est vide.",
        )

    client = OpenAI(api_key=settings.openai_api_key)

    last_error: Exception | None = None
    for model in _TRANSCRIPTION_MODELS:
        audio_buffer = BytesIO(audio_bytes)
        audio_buffer.name = original_filename

        try:
            result = client.audio.transcriptions.create(
                model=model,
                file=audio_buffer,
            )
        except Exception as exc:  # pragma: no cover - network/API failure
            last_error = exc
            continue

        transcript = getattr(result, "text", None)
        if isinstance(transcript, str):
            stripped = transcript.strip()
            if stripped:
                return {"text": stripped}
            last_error = RuntimeError("Réponse de transcription vide.")
            continue

        last_error = RuntimeError("Réponse de transcription invalide.")

    if last_error is not None:  # pragma: no cover - log only
        print("⚠️ Transcription audio échouée:", last_error)

    raise HTTPException(
        status.HTTP_502_BAD_GATEWAY,
        "La transcription vocale a échoué.",
    )



@app.get("/")
def root():
    return {"message": "API Jarvis prête 🚀"}
