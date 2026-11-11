"""Strictly read-only access to the locally persisted operator-draft index."""
from collections import Counter
import csv
import io
import os
from pathlib import Path
import re
from urllib.parse import urlsplit
from zipfile import BadZipFile, ZipFile

from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException

from app.config import review_dir


class SavedDraftsError(RuntimeError):
    """The configured private review folder cannot be exposed safely."""


ALLOWED_KINDS = {".md": "markdown", ".csv": "csv", ".xlsx": "xlsx"}
ALLOWED_STATUSES = {"completed", "blocked", "skipped"}


def _check_private(path: Path, directory: bool) -> None:
    if (directory and not path.is_dir()) or (not directory and not path.is_file()):
        raise SavedDraftsError("Saved-draft file is unavailable")
    stat = path.stat()
    if stat.st_uid != os.getuid() or stat.st_mode & 0o077:
        raise SavedDraftsError("Saved-draft files must be owner-only")


def _private_root() -> Path:
    root = review_dir().resolve()
    _check_private(root, directory=True)
    return root


def _listed_file(root: Path, name: str) -> tuple[Path, dict]:
    requested = Path(name)
    kind = ALLOWED_KINDS.get(requested.suffix.lower())
    if (not name or not requested.is_absolute() or requested.parent != root
            or not kind or "…" in requested.name or "\\" in requested.name):
        raise SavedDraftsError("Saved-draft file is outside the configured directory or unsupported")
    source = root / name
    if source.is_symlink():
        raise SavedDraftsError("Saved-draft files cannot be symbolic links")
    path = source.resolve()
    if path.parent != root:
        raise SavedDraftsError("Saved-draft file is outside the configured directory")
    _check_private(path, directory=False)
    return path, {"id": path.name, "name": path.name, "kind": kind}


def _cells(line: str) -> list[str]:
    stripped = line.strip()
    if not (stripped.startswith("|") and stripped.endswith("|")):
        return []
    return [cell.strip().replace("\\|", "|")
            for cell in re.split(r"(?<!\\)\|", stripped[1:-1])]


def _index_items(root: Path) -> list[dict]:
    index = root / "INDEX.md"
    if index.is_symlink():
        raise SavedDraftsError("Saved-draft index cannot be a symbolic link")
    _check_private(index.resolve(), directory=False)
    try:
        lines = index.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError) as exc:
        raise SavedDraftsError("Saved-draft index cannot be read") from exc
    items = []
    seen = set()
    for line in lines:
        cells = _cells(line)
        if len(cells) != 5 or cells[0] in {"Task title", "---"}:
            continue
        title, source, paths, status, blocker = cells
        if status not in ALLOWED_STATUSES or not title:
            raise SavedDraftsError("Saved-draft index has an invalid entry")
        files = []
        for raw in paths.split("<br>"):
            raw = raw.strip()
            path, metadata = _listed_file(root, raw)
            if metadata["id"] in seen:
                raise SavedDraftsError("Saved-draft index contains a duplicate file")
            seen.add(metadata["id"])
            files.append(metadata)
        if not files:
            raise SavedDraftsError("Saved-draft index entry has no file")
        source = source.strip()
        source_url = source if urlsplit(source).scheme in {"http", "https"} and urlsplit(source).netloc else None
        if source_url is None and not (source.startswith("Not applicable") or source.startswith("Associated task:")):
            raise SavedDraftsError("Saved-draft index has an invalid source URL")
        priority = re.search(r"\[Priority:\s*([^;\]]+)", title)
        due = re.search(r";\s*due:\s*([^\]]+)\]", title)
        items.append({
            "id": files[0]["id"], "title": title, "sourceUrl": source_url,
            "status": status, "priority": priority.group(1).strip() if priority else None,
            "due": due.group(1).strip() if due else None,
            "blocker": blocker, "files": files,
        })
    if not items:
        raise SavedDraftsError("Saved-draft index has no readable entries")
    return items


def _find_file(file_name: str) -> Path:
    root = _private_root()
    for item in _index_items(root):
        for entry in item["files"]:
            if entry["id"] == file_name:
                path, _ = _listed_file(root, str(root / file_name))
                return path
    raise KeyError("Saved draft is not listed")


def _workbook_content(path: Path) -> dict:
    if path.stat().st_size > 20_000_000:
        raise SavedDraftsError("This workbook is too large for inline preview; download it locally")
    try:
        with ZipFile(path) as archive:
            sizes = [member.file_size for member in archive.infolist()]
            if max(sizes, default=0) > 20_000_000 or sum(sizes) > 50_000_000:
                raise SavedDraftsError("This workbook expands beyond the preview size limit")
        workbook = load_workbook(path, read_only=True, data_only=False, keep_links=False)
        try:
            sheets = []
            for worksheet in workbook.worksheets[:30]:
                column_count = min(40, max(1, worksheet.max_column or 1))
                collected = list(worksheet.iter_rows(max_row=201, max_col=column_count, values_only=True))
                rows = [["" if value is None else value.isoformat() if hasattr(value, "isoformat") else str(value)
                         for value in row] for row in collected[:200]]
                sheets.append({
                    "name": worksheet.title, "rows": rows, "hasMoreRows": len(collected) > 200,
                    "hasMoreColumns": (worksheet.max_column or 0) > column_count,
                })
        finally:
            workbook.close()
    except SavedDraftsError:
        raise
    except (BadZipFile, InvalidFileException, KeyError, OSError, ValueError) as exc:
        raise SavedDraftsError("Saved-draft workbook cannot be previewed") from exc
    return {
        "id": path.name, "name": path.name, "kind": "xlsx", "sheets": sheets,
        "formulasEvaluated": False, "rowLimit": 200, "columnLimit": 40,
        "sheetPreviewLimit": 30,
    }


def saved_download(file_name: str) -> Path:
    return _find_file(file_name)


def read_saved_content(file_name: str) -> dict:
    path = _find_file(file_name)
    if path.suffix.lower() == ".xlsx":
        return _workbook_content(path)
    if path.stat().st_size > 2_000_000:
        raise SavedDraftsError("This document is too large for inline preview; download it locally")
    if path.suffix.lower() not in {".md", ".csv"}:
        raise SavedDraftsError("This document does not yet support inline preview")
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise SavedDraftsError("Saved-draft text cannot be read") from exc
    if path.suffix.lower() == ".csv":
        try:
            records = list(csv.reader(io.StringIO(text, newline="")))
        except csv.Error as exc:
            raise SavedDraftsError("Saved-draft CSV is malformed") from exc
        return {
            "id": path.name, "name": path.name, "kind": "csv",
            "headers": records[0] if records else [], "rows": records[1:201],
            "rowCount": max(0, len(records) - 1), "hasMoreRows": len(records) > 201,
        }
    return {"id": path.name, "name": path.name, "kind": "markdown", "text": text}


def list_saved_drafts() -> dict:
    items = _index_items(_private_root())
    return {
        "items": items,
        "itemCount": len(items),
        "fileCount": sum(len(item["files"]) for item in items),
        "statusCounts": dict(sorted(Counter(item["status"] for item in items).items())),
        "readOnly": True,
        "externalWritesEnabled": False,
        "source": "INDEX.md",
    }
