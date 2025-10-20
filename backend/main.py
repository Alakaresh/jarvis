from __future__ import annotations

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .config import settings
from .services.ai_provider import (
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


@app.post("/chat")
def chat(msg: Message):
    if _provider_error is not None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(_provider_error),
        )

    if _provider is None:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "AI provider not initialised")

    try:
        response_text = _provider.generate_response(msg.text)
    except ProviderRequestError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    return {"response": response_text}


@app.get("/")
def root():
    return {"message": "API Jarvis prête 🚀"}
