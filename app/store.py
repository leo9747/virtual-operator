from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import secrets
import sqlite3

from app.models import DraftInput


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def text_sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class VersionConflict(RuntimeError):
    """A document version was saved from a stale base version."""

    def __init__(self, latest_version: int):
        super().__init__("A newer edited version already exists")
        self.latest_version = latest_version


def content_hash(draft: DraftInput) -> str:
    material = {
        "kind": draft.kind,
        "title": draft.title,
        "context": draft.context,
        "payload": draft.payload,
        "native_target": draft.native_target,
    }
    serialized = json.dumps(material, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


class Store:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path.parent.chmod(0o700)
        self.initialize()

    def connect(self):
        connection = sqlite3.connect(self.path)
        self.path.chmod(0o600)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def initialize(self):
        with self.connect() as db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS drafts (
                    id TEXT PRIMARY KEY,
                    kind TEXT NOT NULL,
                    title TEXT NOT NULL,
                    context TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    native_target TEXT,
                    status TEXT NOT NULL,
                    version INTEGER NOT NULL,
                    content_hash TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    artifact_name TEXT
                );
                CREATE TABLE IF NOT EXISTS audit_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    draft_id TEXT NOT NULL REFERENCES drafts(id),
                    event TEXT NOT NULL,
                    actor TEXT NOT NULL,
                    content_hash TEXT NOT NULL,
                    details_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS document_versions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    file_id TEXT NOT NULL,
                    version INTEGER NOT NULL,
                    text TEXT NOT NULL,
                    sha256 TEXT NOT NULL,
                    original_sha256 TEXT NOT NULL,
                    actor TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    UNIQUE (file_id, version)
                );
                """
            )

    def serialize(self, row: sqlite3.Row, audit: list | None = None) -> dict:
        return {
            "id": row["id"],
            "kind": row["kind"],
            "title": row["title"],
            "context": row["context"],
            "payload": json.loads(row["payload_json"]),
            "native_target": row["native_target"],
            "status": row["status"],
            "version": row["version"],
            "content_hash": row["content_hash"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "artifact_url": f"/api/drafts/{row['id']}/artifact" if row["artifact_name"] else None,
            "audit": audit or [],
        }

    def create(self, draft: DraftInput, actor: str = "user") -> dict:
        draft_id = "drf_" + secrets.token_hex(8)
        now = utc_now()
        digest = content_hash(draft)
        with self.connect() as db:
            db.execute(
                """INSERT INTO drafts
                (id,kind,title,context,payload_json,native_target,status,version,content_hash,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    draft_id, draft.kind, draft.title, draft.context,
                    json.dumps(draft.payload, ensure_ascii=False), draft.native_target,
                    "draft", 1, digest, now, now,
                ),
            )
            db.execute(
                """INSERT INTO audit_events
                (draft_id,event,actor,content_hash,details_json,created_at) VALUES (?,?,?,?,?,?)""",
                (draft_id, "draft.created", actor, digest, "{}", now),
            )
            row = db.execute("SELECT * FROM drafts WHERE id = ?", (draft_id,)).fetchone()
        return self.serialize(row)

    def list(self) -> list[dict]:
        with self.connect() as db:
            rows = db.execute("SELECT * FROM drafts ORDER BY updated_at DESC").fetchall()
        return [self.serialize(row) for row in rows]

    def _audit(self, db, draft_id: str) -> list[dict]:
        rows = db.execute(
            "SELECT * FROM audit_events WHERE draft_id = ? ORDER BY id", (draft_id,)
        ).fetchall()
        return [
            {
                "event": row["event"],
                "actor": row["actor"],
                "content_hash": row["content_hash"],
                "details": json.loads(row["details_json"]),
                "created_at": row["created_at"],
            }
            for row in rows
        ]

    def get(self, draft_id: str) -> dict | None:
        with self.connect() as db:
            row = db.execute("SELECT * FROM drafts WHERE id = ?", (draft_id,)).fetchone()
            if not row:
                return None
            return self.serialize(row, self._audit(db, draft_id))

    def update(self, draft_id: str, draft: DraftInput) -> dict | None:
        now = utc_now()
        digest = content_hash(draft)
        with self.connect() as db:
            current = db.execute("SELECT * FROM drafts WHERE id = ?", (draft_id,)).fetchone()
            if not current:
                return None
            db.execute(
                """UPDATE drafts SET kind=?,title=?,context=?,payload_json=?,native_target=?,
                status=?,version=?,content_hash=?,updated_at=? WHERE id=?""",
                (
                    draft.kind, draft.title, draft.context,
                    json.dumps(draft.payload, ensure_ascii=False), draft.native_target,
                    "draft", current["version"] + 1, digest, now, draft_id,
                ),
            )
            db.execute(
                """INSERT INTO audit_events
                (draft_id,event,actor,content_hash,details_json,created_at) VALUES (?,?,?,?,?,?)""",
                (draft_id, "draft.updated", "user", digest, "{}", now),
            )
            return self.serialize(
                db.execute("SELECT * FROM drafts WHERE id = ?", (draft_id,)).fetchone(),
                self._audit(db, draft_id),
            )

    def set_artifact(self, draft_id: str, artifact_name: str) -> dict:
        now = utc_now()
        with self.connect() as db:
            current = db.execute("SELECT content_hash FROM drafts WHERE id=?", (draft_id,)).fetchone()
            db.execute(
                "UPDATE drafts SET artifact_name=?,updated_at=? WHERE id=?",
                (artifact_name, now, draft_id),
            )
            db.execute(
                """INSERT INTO audit_events
                (draft_id,event,actor,content_hash,details_json,created_at) VALUES (?,?,?,?,?,?)""",
                (draft_id, "artifact.created", "system", current["content_hash"],
                 json.dumps({"type": "xlsx"}), now),
            )
            row = db.execute("SELECT * FROM drafts WHERE id=?", (draft_id,)).fetchone()
            return self.serialize(row)

    def artifact(self, draft_id: str) -> Path | None:
        with self.connect() as db:
            row = db.execute(
                "SELECT artifact_name FROM drafts WHERE id=?", (draft_id,)
            ).fetchone()
        if not row or not row["artifact_name"]:
            return None
        return self.path.parent / "artifacts" / row["artifact_name"]

    def set_status(self, draft_id: str, status: str, event: str) -> dict | None:

        now = utc_now()
        with self.connect() as db:
            current = db.execute("SELECT * FROM drafts WHERE id = ?", (draft_id,)).fetchone()
            if not current:
                return None
            db.execute(
                "UPDATE drafts SET status=?,updated_at=? WHERE id=?", (status, now, draft_id)
            )
            db.execute(
                """INSERT INTO audit_events
                (draft_id,event,actor,content_hash,details_json,created_at) VALUES (?,?,?,?,?,?)""",
                (draft_id, event, "user", current["content_hash"], "{}", now),
            )
            return self.serialize(
                db.execute("SELECT * FROM drafts WHERE id = ?", (draft_id,)).fetchone(),
                self._audit(db, draft_id),
            )

    # Edited copies of saved documents. The original file under VO_REVIEW_DIR is never
    # written; every save appends an immutable version row instead.

    VERSION_COLUMNS = (
        "version, sha256, original_sha256, actor, created_at, "
        "length(CAST(text AS BLOB)) AS bytes"
    )

    @staticmethod
    def _document_version(row: sqlite3.Row, include_text: bool) -> dict:
        result = {
            "version": row["version"],
            "sha256": row["sha256"],
            "originalSha256": row["original_sha256"],
            "bytes": row["bytes"],
            "actor": row["actor"],
            "createdAt": row["created_at"],
        }
        if include_text:
            result["text"] = row["text"]
        return result

    def document_versions(self, file_id: str) -> list[dict]:
        with self.connect() as db:
            rows = db.execute(
                f"SELECT {self.VERSION_COLUMNS} FROM document_versions WHERE file_id = ? ORDER BY version",
                (file_id,),
            ).fetchall()
        return [self._document_version(row, include_text=False) for row in rows]

    def document_version(self, file_id: str, version: int | None = None) -> dict | None:
        with self.connect() as db:
            if version is None:
                row = db.execute(
                    f"SELECT {self.VERSION_COLUMNS}, text FROM document_versions "
                    "WHERE file_id = ? ORDER BY version DESC LIMIT 1",
                    (file_id,),
                ).fetchone()
            else:
                row = db.execute(
                    f"SELECT {self.VERSION_COLUMNS}, text FROM document_versions "
                    "WHERE file_id = ? AND version = ?",
                    (file_id, version),
                ).fetchone()
        return self._document_version(row, include_text=True) if row else None

    def add_document_version(
        self, file_id: str, text: str, base_version: int, original_sha256: str,
    ) -> dict:
        """Append a version only if `base_version` is still the latest one."""
        connection = sqlite3.connect(self.path, isolation_level=None)
        self.path.chmod(0o600)
        connection.row_factory = sqlite3.Row
        try:
            connection.execute("BEGIN IMMEDIATE")
            try:
                latest = connection.execute(
                    "SELECT COALESCE(MAX(version), 0) AS latest FROM document_versions WHERE file_id = ?",
                    (file_id,),
                ).fetchone()["latest"]
                if latest != base_version:
                    raise VersionConflict(latest)
                connection.execute(
                    """INSERT INTO document_versions
                    (file_id,version,text,sha256,original_sha256,actor,created_at)
                    VALUES (?,?,?,?,?,?,?)""",
                    (file_id, latest + 1, text, text_sha256(text), original_sha256, "user", utc_now()),
                )
                row = connection.execute(
                    f"SELECT {self.VERSION_COLUMNS} FROM document_versions "
                    "WHERE file_id = ? AND version = ?",
                    (file_id, latest + 1),
                ).fetchone()
                connection.execute("COMMIT")
            except BaseException:
                connection.execute("ROLLBACK")
                raise
        finally:
            connection.close()
        return self._document_version(row, include_text=False)
