import os
from pathlib import Path
import secrets


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def frontend_dist() -> Path:
    return Path(os.environ.get("VO_FRONTEND_DIST", PROJECT_ROOT / "frontend" / "dist"))


def data_dir() -> Path:
    path = Path(os.environ.get("VO_DATA_DIR", PROJECT_ROOT / "data"))
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    return path


def review_dir() -> Path:
    return Path(os.environ.get("VO_REVIEW_DIR", Path.home() / "operator-drafts"))


def api_key() -> str:
    configured = os.environ.get("VO_API_KEY", "").strip()
    if configured:
        return configured
    path = data_dir() / "api.key"
    if not path.exists():
        path.write_text(secrets.token_urlsafe(32) + "\n", encoding="utf-8")
    path.chmod(0o600)
    data_dir().chmod(0o700)
    return path.read_text(encoding="utf-8").strip()
