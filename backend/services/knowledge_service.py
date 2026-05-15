"""
Brand Knowledge Base service.

Handles chunking, storing, and retrieving brand documents from Firestore.

Documents are split into ≤ 800-token chunks. At query time the top-K chunks
(by simple keyword overlap with the user's message) are injected into the
system prompt — no vector DB required for v1.

Supported ingest sources:
  - Plain text / markdown (direct)
  - PDF (basic text extraction via pdfminer.six if installed, else fallback)
  - URL (via Firecrawl, same client used by brand ingestion)
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

# Maximum characters per chunk (≈ 600–800 tokens at ~4 chars/token)
_CHUNK_SIZE = 3000
_CHUNK_OVERLAP = 300


# ---------------------------------------------------------------------------
# Text extraction
# ---------------------------------------------------------------------------

def _extract_text(content_bytes: bytes, content_type: str) -> str:
    """Extract plain text from uploaded bytes."""
    if content_type == "application/pdf":
        return _extract_pdf(content_bytes)
    # Plain text / markdown — decode and clean up
    try:
        text = content_bytes.decode("utf-8", errors="replace")
    except Exception:
        text = content_bytes.decode("latin-1", errors="replace")
    return text


def _extract_pdf(content_bytes: bytes) -> str:
    """Extract text from PDF bytes using pdfminer if available."""
    try:
        from pdfminer.high_level import extract_text_to_fp
        from pdfminer.layout import LAParams
        import io
        output = io.StringIO()
        extract_text_to_fp(io.BytesIO(content_bytes), output, laparams=LAParams())
        return output.getvalue()
    except ImportError:
        logger.warning("pdfminer.six not installed — PDF text extraction unavailable. Install with: pip install pdfminer.six")
        raise RuntimeError("PDF support requires pdfminer.six. Install it with: pip install pdfminer.six")


# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------

def _chunk_text(text: str, size: int = _CHUNK_SIZE, overlap: int = _CHUNK_OVERLAP) -> list[str]:
    """Split text into overlapping chunks by character count."""
    text = re.sub(r"\n{3,}", "\n\n", text.strip())
    if len(text) <= size:
        return [text]

    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = start + size
        # Try to break at a paragraph or sentence boundary
        if end < len(text):
            for boundary in ("\n\n", "\n", ". ", " "):
                idx = text.rfind(boundary, start, end)
                if idx > start + size // 2:
                    end = idx + len(boundary)
                    break
        chunks.append(text[start:end].strip())
        start = end - overlap
    return [c for c in chunks if c]


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

def chunk_and_store(
    project_id: str,
    title: str,
    content_bytes: bytes,
    content_type: str,
    source: str,
    uploader_uid: str,
) -> dict:
    """Extract text, chunk it, and persist to Firestore. Returns the doc metadata."""
    from backend.services import firebase_service

    text = _extract_text(content_bytes, content_type)
    chunks = _chunk_text(text)
    doc_id = hashlib.sha1(f"{project_id}:{title}:{len(text)}".encode()).hexdigest()[:16]

    doc = {
        "id": doc_id,
        "projectId": project_id,
        "title": title,
        "source": source,
        "contentType": content_type,
        "chunkCount": len(chunks),
        "charCount": len(text),
        "createdBy": uploader_uid,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }

    # Store document metadata
    firebase_service.save_knowledge_doc(project_id, doc_id, doc)

    # Store each chunk as a sub-document
    for i, chunk in enumerate(chunks):
        chunk_doc = {
            "docId": doc_id,
            "index": i,
            "text": chunk,
        }
        firebase_service.save_knowledge_chunk(project_id, doc_id, str(i), chunk_doc)

    logger.info("Knowledge: stored '%s' → %d chunks (%d chars) for project %s", title, len(chunks), len(text), project_id)
    return doc


async def ingest_url(
    project_id: str,
    url: str,
    title: Optional[str],
    uploader_uid: str,
) -> dict:
    """Scrape a URL with Firecrawl and store as a knowledge document."""
    from backend.config import settings
    if not settings.FIRECRAWL_API_KEY:
        raise RuntimeError("FIRECRAWL_API_KEY is not configured — URL ingestion unavailable.")

    from backend.services.ingestion.firecrawl_client import scrape_url as _scrape
    result = await asyncio.to_thread(_scrape, url)
    markdown = result.get("markdown") or result.get("content") or ""
    page_title = title or result.get("metadata", {}).get("title") or url

    if not markdown:
        raise RuntimeError(f"Firecrawl returned no content for URL: {url}")

    return await asyncio.to_thread(
        chunk_and_store,
        project_id=project_id,
        title=page_title,
        content_bytes=markdown.encode("utf-8"),
        content_type="text/markdown",
        source=url,
        uploader_uid=uploader_uid,
    )


def delete_document(project_id: str, doc_id: str) -> None:
    """Remove a knowledge document and all its chunks from Firestore."""
    from backend.services import firebase_service
    firebase_service.delete_knowledge_doc(project_id, doc_id)
    logger.info("Knowledge: deleted doc %s from project %s", doc_id, project_id)


# ---------------------------------------------------------------------------
# Retrieval — keyword-overlap ranking (no vector DB required for v1)
# ---------------------------------------------------------------------------

def retrieve_relevant_chunks(
    project_id: str,
    query: str,
    top_k: int = 4,
    max_chars: int = 6000,
) -> str:
    """
    Return up to top_k chunks most relevant to query, formatted for the system prompt.

    Uses simple token overlap scoring — fast, zero dependencies, good enough for
    < 50 documents per project. Migrate to pgvector/Pinecone when projects grow larger.
    """
    from backend.services import firebase_service, cache_service

    cache_key = f"knowledge:{project_id}"
    all_chunks: Optional[list[dict]] = cache_service.get(cache_key)
    if all_chunks is None:
        all_chunks = firebase_service.list_knowledge_chunks(project_id)
        cache_service.set(cache_key, all_chunks, ttl=cache_service.TTL_BRAND_CONTEXT)

    if not all_chunks:
        return ""

    query_tokens = set(re.findall(r"\b\w{3,}\b", query.lower()))
    scored: list[tuple[float, dict]] = []
    for chunk in all_chunks:
        text = chunk.get("text", "")
        chunk_tokens = set(re.findall(r"\b\w{3,}\b", text.lower()))
        overlap = len(query_tokens & chunk_tokens)
        if overlap > 0:
            scored.append((overlap, chunk))

    scored.sort(key=lambda x: x[0], reverse=True)
    top = [c for _, c in scored[:top_k]]

    if not top:
        return ""

    lines = ["BRAND KNOWLEDGE BASE (relevant excerpts from uploaded documents):"]
    total = 0
    for chunk in top:
        snippet = chunk["text"][:max_chars - total]
        lines.append(f"---\n{snippet}")
        total += len(snippet)
        if total >= max_chars:
            break

    return "\n".join(lines)
