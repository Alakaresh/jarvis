# Jarvis Project

## Démarrer le projet

### Prérequis

- **Python 3.11+** et `pip` pour installer les dépendances du backend FastAPI.
- **Node.js 18+** (ou une version LTS plus récente) et `npm` pour la partie frontend.
- Facultatif mais recommandé : créer un fichier `backend/.env` pour y définir les clés API
  (`OPENAI_API_KEY`, `HUGGINGFACE_API_KEY`, etc.) si vous souhaitez activer toutes les
  fonctionnalités IA.

### 1. Lancer l'API (backend)

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Sous Windows : .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

L'API sera disponible sur http://127.0.0.1:8000.

### 2. Lancer l'interface web (frontend)

```bash
cd frontend
npm install
npm run dev
```

Vite affiche l'URL de développement (généralement http://localhost:5173). L'application suppose
que l'API tourne sur `http://127.0.0.1:8000`.

### 3. Utilisation

1. Démarrez le backend comme indiqué ci-dessus.
2. Lancez l'interface web avec `npm run dev`.
3. Ouvrez l'URL fournie par Vite dans votre navigateur et commencez à utiliser Jarvis.
