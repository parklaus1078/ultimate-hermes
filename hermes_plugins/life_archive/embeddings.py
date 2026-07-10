from __future__ import annotations

import hashlib
import json
import math
import os
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

from .db import normalize_text
from .secrets import read_macos_keychain


DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"
DEFAULT_EMBEDDING_DIMENSIONS = 1536
DEFAULT_EMBEDDING_URL = "https://api.openai.com/v1/embeddings"


def _bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def normalize_vector(values: list[float]) -> list[float]:
    magnitude = math.sqrt(sum(value * value for value in values))
    if magnitude == 0:
        return values
    return [value / magnitude for value in values]


def vector_literal(values: list[float]) -> str:
    return "[" + ",".join(f"{value:.8f}" if math.isfinite(value) else "0" for value in values) + "]"


def stable_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def strip_html(text: str) -> str:
    text = re.sub(r"<script\b[^>]*>.*?</script>", " ", text, flags=re.I | re.S)
    text = re.sub(r"<style\b[^>]*>.*?</style>", " ", text, flags=re.I | re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def event_embedding_text(event: dict[str, Any], *, max_chars: int = 20000) -> str:
    parts = [
        f"Title: {event.get('title') or ''}",
        f"Type: {event.get('type') or ''}",
        f"Summary: {event.get('summary') or ''}",
        f"Body: {event.get('body') or ''}",
    ]
    text = "\n".join(parts)
    if "<" in text and ">" in text:
        text = strip_html(text)
    return normalize_text(text, limit=max_chars)


@dataclass
class EmbeddingConfig:
    provider: str = "openai"
    model: str = DEFAULT_EMBEDDING_MODEL
    dimensions: int = DEFAULT_EMBEDDING_DIMENSIONS
    url: str = DEFAULT_EMBEDDING_URL
    keychain_service: str = "hermes-embedding"
    keychain_account: str = "default"
    batch_size: int = 64
    timeout_seconds: int = 60
    max_chars: int = 20000
    semantic_recall_enabled: bool = True

    @classmethod
    def from_dict(cls, config: dict[str, Any] | None) -> "EmbeddingConfig":
        raw = config or {}
        nested = raw.get("embedding") or raw.get("embeddings") or {}
        cfg = nested if isinstance(nested, dict) else raw
        return cls(
            provider=str(os.environ.get("LIFE_ARCHIVE_EMBEDDING_PROVIDER") or cfg.get("provider") or "openai"),
            model=str(os.environ.get("LIFE_ARCHIVE_EMBEDDING_MODEL") or cfg.get("model") or DEFAULT_EMBEDDING_MODEL),
            dimensions=int(os.environ.get("LIFE_ARCHIVE_EMBEDDING_DIMENSIONS") or cfg.get("dimensions") or DEFAULT_EMBEDDING_DIMENSIONS),
            url=str(os.environ.get("LIFE_ARCHIVE_EMBEDDING_URL") or cfg.get("url") or DEFAULT_EMBEDDING_URL),
            keychain_service=str(
                os.environ.get("LIFE_ARCHIVE_EMBEDDING_KEYCHAIN_SERVICE")
                or os.environ.get("HERMES_EMBEDDING_KEYCHAIN_SERVICE")
                or cfg.get("keychain_service")
                or "hermes-embedding"
            ),
            keychain_account=str(
                os.environ.get("LIFE_ARCHIVE_EMBEDDING_KEYCHAIN_ACCOUNT")
                or os.environ.get("HERMES_EMBEDDING_KEYCHAIN_ACCOUNT")
                or cfg.get("keychain_account")
                or "default"
            ),
            batch_size=int(os.environ.get("LIFE_ARCHIVE_EMBEDDING_BATCH_SIZE") or cfg.get("batch_size") or 64),
            timeout_seconds=int(os.environ.get("LIFE_ARCHIVE_EMBEDDING_TIMEOUT_SECONDS") or cfg.get("timeout_seconds") or 60),
            max_chars=int(os.environ.get("LIFE_ARCHIVE_EMBEDDING_MAX_CHARS") or cfg.get("max_chars") or 20000),
            semantic_recall_enabled=_bool(
                os.environ.get("LIFE_ARCHIVE_SEMANTIC_RECALL_ENABLED")
                if "LIFE_ARCHIVE_SEMANTIC_RECALL_ENABLED" in os.environ
                else cfg.get("semantic_recall_enabled"),
                True,
            ),
        )


class EmbeddingProvider:
    model: str
    dimensions: int

    def is_configured(self) -> bool:
        raise NotImplementedError

    def embed_many(self, texts: list[str]) -> list[list[float]]:
        raise NotImplementedError

    def embed_one(self, text: str) -> list[float]:
        return self.embed_many([text])[0]


class LocalHashEmbeddingProvider(EmbeddingProvider):
    def __init__(self, dimensions: int = DEFAULT_EMBEDDING_DIMENSIONS):
        self.model = "local-hash-v1"
        self.dimensions = dimensions

    def is_configured(self) -> bool:
        return True

    def embed_many(self, texts: list[str]) -> list[list[float]]:
        return [self._embed(text) for text in texts]

    def _embed(self, text: str) -> list[float]:
        values = [0.0] * self.dimensions
        tokens = [token for token in re.split(r"[^\w가-힣]+", text.lower()) if token]
        for token in tokens or [text.lower()]:
            digest = hashlib.sha256(token.encode("utf-8")).digest()
            for index in range(0, len(digest), 2):
                bucket = digest[index] % self.dimensions
                sign = 1.0 if digest[index + 1 if index + 1 < len(digest) else 0] % 2 == 0 else -1.0
                values[bucket] += sign
        return normalize_vector(values)


class OpenAIEmbeddingProvider(EmbeddingProvider):
    def __init__(self, config: EmbeddingConfig):
        self.config = config
        self.model = config.model
        self.dimensions = config.dimensions
        self._api_key: str | None = None

    def _read_api_key(self) -> str:
        if self._api_key is not None:
            return self._api_key
        self._api_key = (
            os.environ.get("LIFE_ARCHIVE_EMBEDDING_API_KEY")
            or os.environ.get("HERMES_EMBEDDING_API_KEY")
            or os.environ.get("OPENAI_API_KEY")
            or read_macos_keychain(self.config.keychain_service, self.config.keychain_account)
            or ""
        )
        return self._api_key

    def is_configured(self) -> bool:
        return bool(self._read_api_key())

    def embed_many(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        api_key = self._read_api_key()
        if not api_key:
            raise RuntimeError(
                "Missing embedding API key. Store it with: "
                "python scripts/set_macos_keychain_secret.py hermes-embedding default"
            )
        payload = {
            "model": self.model,
            "input": texts,
            "dimensions": self.dimensions,
        }
        request = urllib.request.Request(
            self.config.url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.config.timeout_seconds) as response:
                data = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Embedding request failed: HTTP {error.code} {body[:500]}") from error
        except urllib.error.URLError as error:
            raise RuntimeError(f"Embedding request failed: {error}") from error

        items = data.get("data") or []
        items = sorted(items, key=lambda item: int(item.get("index", 0)))
        embeddings = [item.get("embedding") for item in items]
        if len(embeddings) != len(texts):
            raise RuntimeError(f"Embedding response count mismatch: expected {len(texts)}, got {len(embeddings)}")
        out: list[list[float]] = []
        for embedding in embeddings:
            if not isinstance(embedding, list):
                raise RuntimeError("Embedding response did not include a vector.")
            if len(embedding) != self.dimensions:
                raise RuntimeError(f"Embedding dimension mismatch: expected {self.dimensions}, got {len(embedding)}")
            out.append(normalize_vector([float(value) for value in embedding]))
        return out


def create_embedding_provider(config: EmbeddingConfig) -> EmbeddingProvider:
    if config.provider == "local_hash":
        return LocalHashEmbeddingProvider(config.dimensions)
    if config.provider != "openai":
        raise ValueError(f"Unsupported embedding provider: {config.provider}")
    return OpenAIEmbeddingProvider(config)
