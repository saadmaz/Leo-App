"""
Brand Knowledge Base routes.

Lets users upload brand documents (PDFs, text files, URLs) that are chunked,
stored in Firestore, and retrieved into the chat context alongside the Brand Core.

Endpoints:
  POST /projects/{id}/knowledge/upload   - Upload a text/PDF document
  POST /projects/{id}/knowledge/url      - Ingest a URL via Firecrawl
  GET  /projects/{id}/knowledge          - List knowledge documents
  DELETE /projects/{id}/knowledge/{doc_id} - Delete a document
"""

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field, HttpUrl

from backend.api.deps import get_project_as_editor, get_project_as_member
from backend.middleware.auth import CurrentUser
from backend.services import firebase_service, cache_service
from backend.services.knowledge_service import chunk_and_store, ingest_url, delete_document

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects/{project_id}/knowledge", tags=["knowledge"])


class IngestUrlRequest(BaseModel):
    url: str = Field(..., min_length=8, max_length=500)
    title: Optional[str] = Field(None, max_length=200)


# ---------------------------------------------------------------------------
# Upload a local document (PDF or plain text, ≤ 5 MB)
# ---------------------------------------------------------------------------

@router.post("/upload", status_code=status.HTTP_201_CREATED)
async def upload_document(
    project_id: str,
    user: CurrentUser,
    file: UploadFile = File(...),
    title: Optional[str] = Form(None),
):
    get_project_as_editor(project_id, user["uid"])

    if file.size and file.size > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File exceeds 5 MB limit.")

    allowed = {"text/plain", "text/markdown", "application/pdf"}
    if file.content_type not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{file.content_type}'. Upload plain text or PDF."
        )

    content_bytes = await file.read()
    doc_title = title or file.filename or "Uploaded document"

    doc = await asyncio.to_thread(
        chunk_and_store,
        project_id=project_id,
        title=doc_title,
        content_bytes=content_bytes,
        content_type=file.content_type,
        source="upload",
        uploader_uid=user["uid"],
    )

    # Bust knowledge cache so next chat picks up the new document.
    cache_service.delete(f"knowledge:{project_id}")
    return doc


# ---------------------------------------------------------------------------
# Ingest a URL (calls Firecrawl to scrape + convert to markdown)
# ---------------------------------------------------------------------------

@router.post("/url", status_code=status.HTTP_201_CREATED)
async def ingest_from_url(
    project_id: str,
    body: IngestUrlRequest,
    user: CurrentUser,
):
    get_project_as_editor(project_id, user["uid"])

    doc = await ingest_url(
        project_id=project_id,
        url=body.url,
        title=body.title,
        uploader_uid=user["uid"],
    )

    cache_service.delete(f"knowledge:{project_id}")
    return doc


# ---------------------------------------------------------------------------
# List knowledge documents for a project
# ---------------------------------------------------------------------------

@router.get("")
async def list_documents(
    project_id: str,
    user: CurrentUser,
):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_knowledge_docs, project_id)
    return {"documents": docs, "count": len(docs)}


# ---------------------------------------------------------------------------
# Delete a knowledge document
# ---------------------------------------------------------------------------

@router.delete("/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_doc(
    project_id: str,
    doc_id: str,
    user: CurrentUser,
):
    get_project_as_editor(project_id, user["uid"])
    await asyncio.to_thread(delete_document, project_id, doc_id)
    cache_service.delete(f"knowledge:{project_id}")
