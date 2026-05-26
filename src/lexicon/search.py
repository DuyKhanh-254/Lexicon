from __future__ import annotations

import json
import math
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .config import ensure_app_dir
from .decay import note_decay_info
from .vault import Vault, slugify

TOKEN_RE = re.compile(r"[\w\u00c0-\u1ef9]+", re.UNICODE)
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+)$")
MAX_CHUNK_TOKENS = 220
CHUNK_OVERLAP_TOKENS = 35
INDEX_VERSION = 3


@dataclass
class TextChunk:
    path: str
    title: str
    heading: str
    chunk_id: int
    text: str
    tokens: Counter[str]


def tokenize(text: str) -> list[str]:
    return [item.lower() for item in TOKEN_RE.findall(text)]


def index_path(vault: Vault) -> Path:
    return ensure_app_dir() / "embeddings" / f"{slugify(vault.path.name)}.json"


def rebuild_index(vault: Vault) -> Path:
    documents: list[dict[str, Any]] = []
    chunks: list[dict[str, Any]] = []
    doc_freq: Counter[str] = Counter()

    for path in vault.markdown_files():
        if path.name in {"agent.md", "_index.md"}:
            continue
        rel = path.relative_to(vault.path).as_posix()
        text = path.read_text(encoding="utf-8-sig")
        decay = note_decay_info(vault, path)
        note_chunks = chunk_markdown(text, rel, path.stem)
        documents.append(
            {
                "path": rel,
                "title": path.stem,
                "chunk_count": len(note_chunks),
                "decay_status": decay.status,
                "expires_at": decay.expires_at,
                "reviewed_at": decay.reviewed_at,
            }
        )
        for chunk in note_chunks:
            chunk_tokens = dict(chunk.tokens)
            chunks.append(
                {
                    "path": chunk.path,
                    "title": chunk.title,
                    "heading": chunk.heading,
                    "chunk_id": chunk.chunk_id,
                    "text": chunk.text,
                    "tokens": chunk_tokens,
                    "decay_status": decay.status,
                    "expires_at": decay.expires_at,
                    "reviewed_at": decay.reviewed_at,
                }
            )
            doc_freq.update(chunk.tokens.keys())

    payload = {
        "version": INDEX_VERSION,
        "documents": documents,
        "chunks": chunks,
        "doc_freq": dict(doc_freq),
    }
    target = index_path(vault)
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return target


def chunk_markdown(text: str, path: str, title: str) -> list[TextChunk]:
    body = _remove_frontmatter(text)
    sections = _split_sections(body)
    chunks: list[TextChunk] = []
    for heading, section_text in sections:
        for piece in _split_token_windows(section_text):
            clean = piece.strip()
            if not clean:
                continue
            chunks.append(
                TextChunk(
                    path=path,
                    title=title,
                    heading=heading,
                    chunk_id=len(chunks),
                    text=clean,
                    tokens=Counter(tokenize(clean)),
                )
            )
    return chunks


def search(vault: Vault, query: str, limit: int = 5) -> list[dict[str, Any]]:
    payload = load_index(vault)
    query_tokens = Counter(tokenize(query))
    if not query_tokens:
        return []

    chunks = payload.get("chunks", [])
    doc_freq = Counter(payload.get("doc_freq", {}))
    total_chunks = max(1, len(chunks))
    query_weights = _tfidf_weights(query_tokens, doc_freq, total_chunks)

    ranked: list[dict[str, Any]] = []
    seen: set[tuple[str, int]] = set()
    for chunk in chunks:
        chunk_tokens = Counter(chunk.get("tokens", {}))
        score = cosine_similarity(query_weights, _tfidf_weights(chunk_tokens, doc_freq, total_chunks))
        if score <= 0:
            continue
        key = (chunk["path"], int(chunk["chunk_id"]))
        if key in seen:
            continue
        seen.add(key)
        ranked.append(
            {
                "path": chunk["path"],
                "title": chunk.get("title", ""),
                "heading": chunk.get("heading", ""),
                "chunk_id": chunk.get("chunk_id", 0),
                "score": round(score, 4),
                "snippet": relevant_snippet(chunk.get("text", ""), query),
                "decay_status": chunk.get("decay_status", "no_expiry"),
                "expires_at": chunk.get("expires_at", ""),
                "reviewed_at": chunk.get("reviewed_at", ""),
            }
        )
    ranked.sort(key=lambda item: item["score"], reverse=True)
    return ranked[:limit]


def load_index(vault: Vault) -> dict[str, Any]:
    target = index_path(vault)
    if not target.exists():
        rebuild_index(vault)
    payload = json.loads(target.read_text(encoding="utf-8-sig"))
    if isinstance(payload, list) or payload.get("version") != INDEX_VERSION:
        rebuild_index(vault)
        payload = json.loads(target.read_text(encoding="utf-8-sig"))
    return payload


def relevant_snippet(text: str, query: str, max_chars: int = 1800) -> str:
    compact = "\n".join(line.rstrip() for line in text.splitlines())
    query_tokens = set(tokenize(query))
    if not compact or not query_tokens:
        return compact[:max_chars]

    lowered = compact.lower()
    positions = [lowered.find(token) for token in query_tokens if lowered.find(token) >= 0]
    if not positions:
        return compact[:max_chars]

    center = min(positions)
    start = max(0, center - max_chars // 3)
    end = min(len(compact), start + max_chars)

    para_start = compact.rfind("\n\n", 0, start)
    if para_start >= 0 and start - para_start < 400:
        start = para_start + 2
    para_end = compact.find("\n\n", end)
    if para_end >= 0 and para_end - end < 500:
        end = para_end

    prefix = "..." if start > 0 else ""
    suffix = "..." if end < len(compact) else ""
    return prefix + compact[start:end].strip() + suffix


def similar_existing(vault: Vault, markdown: str, threshold: float = 0.7) -> list[dict[str, str | float]]:
    new_chunks = chunk_markdown(markdown, "__new__.md", "new")
    if not new_chunks:
        return []

    payload = load_index(vault)
    chunks = payload.get("chunks", [])
    doc_freq = Counter(payload.get("doc_freq", {}))
    total_chunks = max(1, len(chunks))
    matches: dict[str, float] = {}

    for new_chunk in new_chunks:
        new_weights = _tfidf_weights(new_chunk.tokens, doc_freq, total_chunks)
        for chunk in chunks:
            old_tokens = Counter(chunk.get("tokens", {}))
            old_weights = _tfidf_weights(old_tokens, doc_freq, total_chunks)
            score = max(
                cosine_similarity(new_weights, old_weights),
                lexical_overlap_similarity(new_chunk.tokens, old_tokens),
            )
            if score >= threshold:
                path = chunk["path"]
                matches[path] = max(matches.get(path, 0.0), score)

    return [
        {"path": path, "similarity": round(score, 3)}
        for path, score in sorted(matches.items(), key=lambda item: item[1], reverse=True)
    ]


def cosine_similarity(left: dict[str, float], right: dict[str, float]) -> float:
    if not left or not right:
        return 0.0
    dot = sum(weight * right.get(token, 0.0) for token, weight in left.items())
    if dot <= 0:
        return 0.0
    left_norm = math.sqrt(sum(weight * weight for weight in left.values()))
    right_norm = math.sqrt(sum(weight * weight for weight in right.values()))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return dot / (left_norm * right_norm)


def lexical_overlap_similarity(left: Counter[str], right: Counter[str]) -> float:
    left_terms = {token for token, count in left.items() if count > 0}
    right_terms = {token for token, count in right.items() if count > 0}
    if not left_terms or not right_terms:
        return 0.0
    intersection = len(left_terms & right_terms)
    smaller = min(len(left_terms), len(right_terms))
    return intersection / smaller if smaller else 0.0


def _tfidf_weights(tokens: Counter[str], doc_freq: Counter[str], total_docs: int) -> dict[str, float]:
    weights: dict[str, float] = {}
    for token, count in tokens.items():
        if count <= 0:
            continue
        idf = math.log((1 + total_docs) / (1 + doc_freq.get(token, 0))) + 1
        weights[token] = (1 + math.log(count)) * idf
    return weights


def _remove_frontmatter(text: str) -> str:
    if not text.startswith("---"):
        return text
    end = text.find("\n---", 3)
    if end == -1:
        return text
    return text[end + 4 :].lstrip()


def _split_sections(text: str) -> list[tuple[str, str]]:
    sections: list[tuple[str, list[str]]] = [("Overview", [])]
    current_heading = "Overview"
    for line in text.splitlines():
        match = HEADING_RE.match(line)
        if match:
            current_heading = match.group(2).strip()
            sections.append((current_heading, [line]))
            continue
        sections[-1][1].append(line)
    return [(heading, "\n".join(lines).strip()) for heading, lines in sections if "\n".join(lines).strip()]


def _split_token_windows(text: str) -> list[str]:
    paragraphs = [item.strip() for item in re.split(r"\n\s*\n", text) if item.strip()]
    windows: list[str] = []
    current: list[str] = []
    current_count = 0

    for paragraph in paragraphs:
        para_tokens = tokenize(paragraph)
        if len(para_tokens) > MAX_CHUNK_TOKENS:
            if current:
                windows.append("\n\n".join(current))
                current, current_count = [], 0
            windows.extend(_split_large_paragraph(paragraph))
            continue
        if current and current_count + len(para_tokens) > MAX_CHUNK_TOKENS:
            windows.append("\n\n".join(current))
            overlap = _overlap_text(current)
            current = [overlap] if overlap else []
            current_count = len(tokenize(overlap)) if overlap else 0
        current.append(paragraph)
        current_count += len(para_tokens)

    if current:
        windows.append("\n\n".join(current))
    return windows


def _split_large_paragraph(paragraph: str) -> list[str]:
    words = paragraph.split()
    if not words:
        return []
    chunks: list[str] = []
    step = max(1, MAX_CHUNK_TOKENS - CHUNK_OVERLAP_TOKENS)
    for start in range(0, len(words), step):
        piece = " ".join(words[start : start + MAX_CHUNK_TOKENS])
        if piece:
            chunks.append(piece)
        if start + MAX_CHUNK_TOKENS >= len(words):
            break
    return chunks


def _overlap_text(paragraphs: list[str]) -> str:
    words = " ".join(paragraphs).split()
    if not words:
        return ""
    return " ".join(words[-CHUNK_OVERLAP_TOKENS:])
