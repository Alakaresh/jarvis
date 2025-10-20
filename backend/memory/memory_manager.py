"""Gestion simplifiée de la mémoire vectorielle de Jarvis."""

from __future__ import annotations

from uuid import uuid4

import chromadb
from chromadb.utils import embedding_functions

class VectorMemory:
    def __init__(self, api_key: str, persist_dir: str = "./memory/chroma"):
        self.client = chromadb.PersistentClient(path=persist_dir)

        # Utilise OpenAI pour générer les embeddings
        self.embedding_function = embedding_functions.OpenAIEmbeddingFunction(
            api_key=api_key,
            model_name="text-embedding-3-small"  # rapide et précis
        )

        # Collection principale pour les souvenirs
        self.collection = self.client.get_or_create_collection(
            name="jarvis_memory",
            embedding_function=self.embedding_function
        )

    def add_memory(self, content: str, metadata: dict | None = None) -> None:
        """Ajoute une information à la mémoire vectorielle."""
        self.collection.add(
            documents=[content],
            metadatas=[metadata or {}],
            ids=[f"mem_{uuid4()}"],
        )

    def retrieve_relevant(self, query: str, n: int = 5) -> list[str]:
        """Recherche les souvenirs les plus pertinents pour une question."""
        results = self.collection.query(query_texts=[query], n_results=n)
        return list(results.get("documents", [[]])[0])

    def clear_memory(self) -> None:
        """Efface toute la mémoire."""
        self.collection.delete(where={})
