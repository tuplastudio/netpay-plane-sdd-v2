"""Conocimiento del negocio: documentos Markdown por tenant y lectura web.

`tenantId` llega como query param con default; el proxy de `apps/web`
siempre lo sobrescribe con el tenant autenticado antes de reenviar.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

from ..knowledge import (
    DEFAULT_TENANT_ID,
    KnowledgeUploadError,
    delete_knowledge_doc,
    knowledge_outline,
    knowledge_stats,
    reload_knowledge,
    save_uploaded_doc,
    search_knowledge,
)
from ..tenant_context import load_company_context
from ..web_reader import WebReadError, crawl_url, save_web_page

router = APIRouter(tags=["conocimiento"])


@router.post("/knowledge/reload")
async def knowledge_reload(tenantId: str = DEFAULT_TENANT_ID) -> dict[str, Any]:
    return {"chars": len(reload_knowledge(tenantId))}


@router.get("/knowledge")
async def knowledge_index(tenantId: str = DEFAULT_TENANT_ID) -> dict[str, Any]:
    result = {**knowledge_stats(tenantId), "outline": knowledge_outline(tenantId)}
    company = await load_company_context(tenantId)
    if company.get("name"):
        result["profile"] = {**result["profile"], "name": str(company["name"])}
    return result


@router.get("/knowledge/search")
async def knowledge_search(q: str = Query(..., min_length=2), tenantId: str = DEFAULT_TENANT_ID) -> dict[str, Any]:
    return {"hits": search_knowledge(tenantId, q)}


@router.post("/knowledge/upload")
async def knowledge_upload(file: UploadFile = File(...), tenantId: str = DEFAULT_TENANT_ID) -> dict[str, Any]:
    content = await file.read()
    try:
        doc_id = save_uploaded_doc(tenantId, file.filename or "", content)
    except KnowledgeUploadError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"docId": doc_id, "chars": len(reload_knowledge(tenantId))}


@router.delete("/knowledge/{doc_id:path}")
async def knowledge_delete(doc_id: str, tenantId: str = DEFAULT_TENANT_ID) -> dict[str, Any]:
    try:
        removed = delete_knowledge_doc(tenantId, doc_id)
    except KnowledgeUploadError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not removed:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    return {"deleted": doc_id, "chars": len(reload_knowledge(tenantId))}


# El contenido bajado de la web se trata igual que un .md subido a mano: dato
# del negocio, nunca instrucción para el modelo (ver web_reader.py).


class WebPreviewRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2000)


class WebSaveRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2000)
    title: str = Field(min_length=1, max_length=200)
    # None = guardar todas las secciones detectadas en el preview.
    sections: list[str] | None = None
    filename: str | None = None


@router.post("/knowledge/web/preview")
async def knowledge_web_preview(
    req: WebPreviewRequest, tenantId: str = DEFAULT_TENANT_ID  # noqa: ARG001 - solo lectura; paridad con /knowledge/*
) -> dict[str, Any]:
    result = await crawl_url(req.url)
    if result.error:
        raise HTTPException(status_code=400, detail=result.error)
    return {
        "url": result.url,
        "title": result.title,
        "sections": [{"heading": s.heading, "body": s.body} for s in result.sections],
    }


@router.post("/knowledge/web/save")
async def knowledge_web_save(req: WebSaveRequest, tenantId: str = DEFAULT_TENANT_ID) -> dict[str, Any]:
    try:
        doc_id, _ = await save_web_page(
            tenantId, url=req.url, title=req.title, selected_sections=req.sections, filename=req.filename
        )
    except (WebReadError, KnowledgeUploadError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"docId": doc_id, "chars": len(reload_knowledge(tenantId))}
