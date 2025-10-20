from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

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

@app.post("/chat")
def chat(msg: Message):
    response = f"Jarvis : tu as dit → {msg.text}"
    return {"response": response}

@app.get("/")
def root():
    return {"message": "API Jarvis prête 🚀"}
