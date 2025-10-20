from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config import settings
from memory.memory_manager import VectorMemory
from services.ai_provider import (
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


class Message(BaseModel):
    text: str


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


@app.post("/chat")
def chat(msg: Message):
    try:
        if _provider_error is not None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=str(_provider_error),
            )

        if _provider is None:
            raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "AI provider not initialised")

        prompt = msg.text

        relevant_memories: list[str] = []
        if _memory is not None:
            try:
                relevant_memories = [memory for memory in _memory.retrieve_relevant(msg.text) if memory]
            except Exception as exc:  # pragma: no cover - log only
                print("⚠️ Impossible de récupérer la mémoire vectorielle:", exc)

        if relevant_memories:
            memories_block = "\n".join(f"- {memory}" for memory in relevant_memories)
            prompt = (
                "Voici des souvenirs issus de conversations précédentes qui peuvent t'aider :\n"
                f"{memories_block}\n\n"
                "En t'appuyant dessus si nécessaire, réponds à la demande suivante :\n"
                f"{msg.text}"
            )

        response_text = _provider.generate_response(prompt)

        if _memory is not None:
            try:
                _memory.add_memory(
                    f"Utilisateur : {msg.text}\nJarvis : {response_text}",
                    metadata={"source": "conversation"},
                )
            except Exception as exc:  # pragma: no cover - log only
                print("⚠️ Impossible d'enregistrer la mémoire vectorielle:", exc)

        return {"response": response_text}

    except Exception as e:
        import traceback
        print("❌ ERREUR DANS /chat :", e)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))



@app.get("/")
def root():
    return {"message": "API Jarvis prête 🚀"}
