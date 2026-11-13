import hmac
from typing import Literal
from urllib.parse import quote

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, Field

from app.config import api_key, data_dir, frontend_dist
from app import agent
from app.models import DraftInput
from app.store import Store, VersionConflict
from app.integrations import (
    IntegrationError,
    airtable_context,
    capabilities,
    connections,
    gmail_messages,
)
from app.workbooks import create_workbook, validate_workbook_payload
from app.saved_review import (
    TEXT_PREVIEW_LIMIT,
    DocumentNotEditable,
    SavedDraftsError,
    list_saved_drafts,
    read_saved_content,
    saved_download,
    saved_markdown,
)


MAX_REQUEST_BYTES = 5_000_000


class DocumentVersionInput(BaseModel):
    text: str = Field(max_length=TEXT_PREVIEW_LIMIT)
    base_version: int = Field(ge=0)
    original_sha256: str = Field(pattern="^[0-9a-f]{64}$")


def attachment_headers(filename: str) -> dict:
    """Content-Disposition for a validated, indexed file name (RFC 6266 / 5987)."""
    fallback = "".join(ch if ch.isascii() and (ch.isalnum() or ch in "._-") else "_" for ch in filename)
    return {
        "Content-Disposition": f"attachment; filename=\"{fallback}\"; filename*=utf-8''{quote(filename)}",
    }


def secure_response(response: Response, path: str) -> Response:
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "font-src 'self'; img-src 'self' data:; connect-src 'self'; "
        "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
    )
    if path.startswith("/assets/"):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    elif path.startswith("/fonts/"):
        response.headers["Cache-Control"] = "public, max-age=86400"
    else:
        response.headers["Cache-Control"] = "no-store"
    return response


def create_app() -> FastAPI:
    application = FastAPI(title="Virtual Operator", version="0.1.0")
    application.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=["localhost", "127.0.0.1", "[::1]"],
    )

    @application.middleware("http")
    async def secure_responses(request: Request, call_next):
        response = await call_next(request)
        return secure_response(response, request.url.path)

    @application.middleware("http")
    async def require_local_key(request: Request, call_next):
        if request.url.path.startswith("/api/"):
            supplied = request.headers.get("X-VO-Key", "").encode("utf-8")
            expected = api_key().encode("utf-8")
            if not hmac.compare_digest(supplied, expected):
                rejection = JSONResponse({"detail": "Valid X-VO-Key required"}, status_code=401)
                return secure_response(rejection, request.url.path)
            declared = request.headers.get("content-length", "0")
            if not declared.isdigit() or int(declared) > MAX_REQUEST_BYTES:
                rejection = JSONResponse({"detail": "Request body is too large"}, status_code=413)
                return secure_response(rejection, request.url.path)
        return await call_next(request)

    @application.get("/api/health")
    def health():
        return {"status": "ok", "version": "0.1.0", "externalWritesEnabled": False}

    @application.get("/api/capabilities")
    def get_capabilities():
        return capabilities()

    @application.get("/api/connections")
    def get_connections():
        return connections()

    @application.get("/api/context/gmail")
    def get_gmail_context(
        account: Literal["personal", "cisai"] = "personal",
        limit: int = Query(default=10, ge=1, le=20),
    ):
        try:
            return gmail_messages(account, limit)
        except IntegrationError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    @application.get("/api/context/airtable")
    def get_airtable_context():
        try:
            return airtable_context()
        except IntegrationError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    @application.post("/api/agent/proposals", status_code=201)
    def create_agent_proposal(request: agent.AgentRequest):
        try:
            payload = agent.generate_payload(request)
            draft = DraftInput(
                kind=request.kind,
                title=request.title,
                context=request.context,
                payload=payload,
                native_target=None,
            )
        except (agent.AgentError, ValueError) as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        store = Store(data_dir() / "operator.db")
        result = store.create(draft, actor="hermes")
        if request.kind == "spreadsheet":
            path = create_workbook(result["id"], draft.payload, data_dir() / "artifacts")
            result = store.set_artifact(result["id"], path.name)
        return result

    @application.post("/api/drafts", status_code=201)
    def create_draft(draft: DraftInput):
        if draft.native_target:
            raise HTTPException(
                status_code=409,
                detail=f"Native {draft.native_target} creation is locked until its OAuth write scopes are configured",
            )
        if draft.kind == "email" and draft.payload.get("account") not in {"personal", "cisai"}:
            raise HTTPException(status_code=422, detail="Email account must be personal or cisai")
        if draft.kind == "spreadsheet":
            try:
                validate_workbook_payload(draft.payload)
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
        store = Store(data_dir() / "operator.db")
        result = store.create(draft)
        if draft.kind == "spreadsheet":
            try:
                path = create_workbook(result["id"], draft.payload, data_dir() / "artifacts")
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
            result = store.set_artifact(result["id"], path.name)
        return result

    @application.get("/api/saved-drafts")
    def get_saved_drafts():
        try:
            return list_saved_drafts()
        except SavedDraftsError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @application.get("/api/saved-drafts/{file_name}/content")
    def get_saved_draft_content(file_name: str):
        try:
            return read_saved_content(file_name)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Saved draft not found") from exc
        except SavedDraftsError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @application.get("/api/saved-drafts/{file_name}/download")
    def download_saved_draft(file_name: str):
        try:
            path = saved_download(file_name)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Saved draft not found") from exc
        except SavedDraftsError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        return FileResponse(path, filename=path.name)

    def saved_original(file_name: str) -> dict:
        try:
            return saved_markdown(file_name)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Saved draft not found") from exc
        except DocumentNotEditable as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except SavedDraftsError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @application.get("/api/saved-drafts/{file_name}/versions")
    def get_saved_draft_versions(file_name: str):
        original = saved_original(file_name)
        store = Store(data_dir() / "operator.db")
        latest = store.document_version(original["id"])
        return {
            "fileId": original["id"],
            "originalSha256": original["sha256"],
            "versions": store.document_versions(original["id"]),
            "latest": latest,
            "originalChanged": bool(latest and latest["originalSha256"] != original["sha256"]),
            "originalWritten": False,
        }

    @application.post("/api/saved-drafts/{file_name}/versions", status_code=201)
    def create_saved_draft_version(file_name: str, version: DocumentVersionInput):
        if len(version.text.encode("utf-8")) > TEXT_PREVIEW_LIMIT:
            raise HTTPException(status_code=413, detail="Edited document is too large")
        if "\x00" in version.text:
            raise HTTPException(status_code=422, detail="Edited document contains a NUL character")
        original = saved_original(file_name)
        if version.original_sha256 != original["sha256"]:
            raise HTTPException(status_code=409, detail={
                "code": "original_changed",
                "message": "The original document changed after you opened it.",
                "originalSha256": original["sha256"],
            })
        try:
            return Store(data_dir() / "operator.db").add_document_version(
                original["id"], version.text, version.base_version, original["sha256"],
            )
        except VersionConflict as exc:
            raise HTTPException(status_code=409, detail={
                "code": "version_conflict",
                "message": "A newer edited version was saved elsewhere.",
                "latestVersion": exc.latest_version,
            }) from exc

    @application.get("/api/saved-drafts/{file_name}/versions/{version}/download")
    def download_saved_draft_version(file_name: str, version: int):
        original = saved_original(file_name)
        result = Store(data_dir() / "operator.db").document_version(original["id"], version)
        if result is None:
            raise HTTPException(status_code=404, detail="Edited version not found")
        stem = original["name"][:-3] if original["name"].lower().endswith(".md") else original["name"]
        return Response(
            result["text"].encode("utf-8"),
            media_type="text/markdown; charset=utf-8",
            headers=attachment_headers(f"{stem}.edited-v{version}.md"),
        )

    @application.get("/api/drafts")
    def list_drafts():
        return Store(data_dir() / "operator.db").list()

    @application.get("/api/drafts/{draft_id}/artifact")
    def download_artifact(draft_id: str):
        path = Store(data_dir() / "operator.db").artifact(draft_id)
        if path is None or not path.is_file():
            raise HTTPException(status_code=404, detail="Artifact not found")
        return FileResponse(
            path,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename=f"{draft_id}.xlsx",
        )

    @application.get("/api/drafts/{draft_id}")
    def get_draft(draft_id: str):
        result = Store(data_dir() / "operator.db").get(draft_id)
        if result is None:
            raise HTTPException(status_code=404, detail="Draft not found")
        return result

    @application.patch("/api/drafts/{draft_id}")
    def update_draft(draft_id: str, draft: DraftInput):
        if draft.native_target:
            raise HTTPException(status_code=409, detail="Native targets remain permission locked")
        if draft.kind == "email" and draft.payload.get("account") not in {"personal", "cisai"}:
            raise HTTPException(status_code=422, detail="Email account must be personal or cisai")
        if draft.kind == "spreadsheet":
            try:
                validate_workbook_payload(draft.payload)
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
        result = Store(data_dir() / "operator.db").update(draft_id, draft)
        if result is None:
            raise HTTPException(status_code=404, detail="Draft not found")
        if draft.kind == "spreadsheet":
            store = Store(data_dir() / "operator.db")
            path = create_workbook(draft_id, draft.payload, data_dir() / "artifacts")
            result = store.set_artifact(draft_id, path.name)
            result = store.get(draft_id)
        return result

    @application.post("/api/drafts/{draft_id}/acknowledge")
    def acknowledge_draft(draft_id: str):
        result = Store(data_dir() / "operator.db").set_status(
            draft_id, "acknowledged", "draft.acknowledged"
        )
        if result is None:
            raise HTTPException(status_code=404, detail="Draft not found")
        result["externalResult"] = "No external action performed"
        return result

    @application.post("/api/drafts/{draft_id}/reject")
    def reject_draft(draft_id: str):
        result = Store(data_dir() / "operator.db").set_status(draft_id, "rejected", "draft.rejected")
        if result is None:
            raise HTTPException(status_code=404, detail="Draft not found")
        result["externalResult"] = "No external action performed"
        return result

    @application.get("/{static_path:path}", include_in_schema=False)
    def serve_frontend(static_path: str):
        root = frontend_dist().resolve()
        target = (root / (static_path or "index.html")).resolve()
        try:
            target.relative_to(root)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail="Not found") from exc
        if not target.is_file():
            raise HTTPException(status_code=404, detail="Not found")
        return FileResponse(target)

    return application


app = create_app()
