"""Self-review utilities for Jarvis."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Iterator

from backend.services.ai_provider import AIProvider, Attachment


class SelfReviewError(Exception):
    """Raised when the self-review process fails."""


_SOURCE_EXTENSIONS = {
    ".py",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".json",
    ".yaml",
    ".yml",
    ".html",
    ".css",
    ".scss",
    ".md",
}

_EXCLUDED_DIR_NAMES = {
    "__pycache__",
    "node_modules",
    "tests",
    "test",
    "data",
    "venv",
    ".venv",
    ".git",
    ".mypy_cache",
    ".pytest_cache",
    "dist",
    "build",
    "coverage",
}


def _iter_source_files(root: Path) -> Iterator[Path]:
    """Yield project files that should be included in the audit."""

    if not root.exists():
        raise SelfReviewError(f"Le dossier racine '{root}' est introuvable.")

    for current_root, dirnames, filenames in os.walk(root):
        current_path = Path(current_root)

        # Remove excluded directories in-place to prevent descending into them.
        dirnames[:] = [d for d in dirnames if d not in _EXCLUDED_DIR_NAMES]

        for filename in filenames:
            path = current_path / filename
            if path.suffix.lower() not in _SOURCE_EXTENSIONS:
                continue
            yield path


def _build_attachments(root: Path) -> list[Attachment]:
    attachments: list[Attachment] = []

    for file_path in sorted(_iter_source_files(root)):
        relative_path = file_path.relative_to(root)
        try:
            content = file_path.read_bytes()
        except OSError as exc:
            print(f"⚠️ Impossible de lire le fichier '{relative_path}': {exc}")
            continue

        attachments.append(
            Attachment(
                filename=str(relative_path),
                content=content,
                content_type="text/plain",
            )
        )

    if not attachments:
        raise SelfReviewError("Aucun fichier source éligible trouvé pour l'audit.")

    return attachments


_AUDIT_PROMPT = """
Tu es un auditeur technique qui doit analyser le code du projet Jarvis.
Tu reçois l'intégralité des fichiers sources pertinents en pièces jointes.
Ta mission : produire un audit exhaustif couvrant les aspects suivants :
- Architecture
- Sécurité
- Lisibilité / Style
- Performance
- Maintenabilité
- Améliorations proposées

Consignes importantes :
1. Analyse attentivement les fichiers fournis et base-toi uniquement sur ces informations.
2. Si des informations te manquent, indique-le clairement.
3. Ta réponse doit être un JSON valide, sans texte supplémentaire, structuré ainsi :
{
  "architecture": "...",
  "securite": "...",
  "lisibilite_style": "...",
  "performance": "...",
  "maintenabilite": "...",
  "ameliorations_proposees": "..."
}
Chaque valeur doit être un texte détaillé (tu peux utiliser du Markdown pour structurer les informations).
4. Ne produis pas de code, concentre-toi sur l'analyse.
""".strip()


_EXPECTED_KEYS = {
    "architecture",
    "securite",
    "lisibilite_style",
    "performance",
    "maintenabilite",
    "ameliorations_proposees",
}


def _fallback_report(raw_response: str, reason: str) -> dict[str, str]:
    message = (
        f"{reason}\n\nRéponse brute du provider :\n```\n{raw_response.strip()}\n```"
    ).strip()
    return {section: message for section in _EXPECTED_KEYS}


def run_self_review(provider: AIProvider, project_root: Path) -> dict[str, str]:
    """Execute the self-review workflow and return the generated report."""

    attachments = _build_attachments(project_root)

    try:
        response_text = provider.generate_response(_AUDIT_PROMPT, attachments)
    except Exception as exc:  # pragma: no cover - provider failure
        raise SelfReviewError("Échec de l'appel au provider d'IA pour l'audit.") from exc

    try:
        parsed = json.loads(response_text)
    except json.JSONDecodeError:
        return _fallback_report(
            response_text,
            "Impossible de décoder la réponse du provider en JSON.",
        )

    if not isinstance(parsed, dict):
        return _fallback_report(
            response_text,
            "Le provider n'a pas renvoyé un objet JSON pour l'audit.",
        )

    report: dict[str, str] = {}
    for key in _EXPECTED_KEYS:
        value = parsed.get(key)
        if isinstance(value, str) and value.strip():
            report[key] = value.strip()
        else:
            report[key] = (
                "Information manquante pour cette section dans la réponse du provider."
            )

    return report
