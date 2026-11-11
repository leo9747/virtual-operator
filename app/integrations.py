import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


GOOGLE_SCOPES = {
    "personal": ["gmail.readonly"],
    "cisai": ["gmail.readonly", "calendar.readonly", "drive.readonly"],
}


class IntegrationError(RuntimeError):
    pass


def hermes_home() -> Path:
    return Path(os.environ.get("HERMES_HOME", str(Path.home() / ".hermes")))


def account_home(account: str) -> Path:
    if account == "personal":
        return hermes_home()
    if account == "cisai":
        return hermes_home() / "google-accounts" / "cisai"
    raise IntegrationError("Unknown Google account")


def run_json(arguments: list[str], account_home_override: Path | None = None):
    env = os.environ.copy()
    if account_home_override is not None:
        env["HERMES_HOME"] = str(account_home_override)
    try:
        result = subprocess.run(
            arguments,
            capture_output=True,
            text=True,
            env=env,
            timeout=45,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise IntegrationError(f"Read adapter failed: {type(exc).__name__}") from exc
    if result.returncode:
        raise IntegrationError(result.stderr.strip()[:1500] or "Read adapter returned an error")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise IntegrationError("Read adapter returned invalid JSON") from exc


def connections() -> list[dict]:
    entries = []
    for account in ("personal", "cisai"):
        token = account_home(account) / "google_token.json"
        scopes = []
        if token.exists():
            try:
                scopes = json.loads(token.read_text(encoding="utf-8")).get("scopes", [])
            except (OSError, json.JSONDecodeError):
                scopes = []
        entries.append({
            "service": f"gmail_{account}",
            "label": f"Google · {account}",
            "status": "ready" if token.exists() else "setup_required",
            "mode": "read",
            "detail": f"Gmail read configured; {len(scopes)} granted OAuth scopes",
        })
    airtable_configured = "AIRTABLE_API_KEY" in os.environ or (hermes_home() / ".env").exists()
    entries.extend([
        {
            "service": "airtable", "label": "Airtable CRM",
            "status": "ready" if airtable_configured else "setup_required",
            "mode": "read", "detail": "Scoped REST token; updates remain draft-only",
        },
        {
            "service": "notion", "label": "Notion",
            "status": "agent_broker", "mode": "read",
            "detail": "Connected Hermes broker; page suggestions remain draft-only",
        },
        {
            "service": "slack", "label": "Slack",
            "status": "setup_required", "mode": "off",
            "detail": "Connect a workspace and select readable conversations later",
        },
        {
            "service": "whatsapp", "label": "WhatsApp · personal",
            "status": "setup_required", "mode": "off",
            "detail": "Personal linked-device pairing deferred; drafts are available locally",
        },
    ])
    return entries


def gmail_messages(account: str, limit: int):
    script = hermes_home() / "skills/productivity/google-workspace/scripts/google_api.py"
    python = os.environ.get("VO_GOOGLE_PYTHON") or shutil.which("python") or sys.executable
    return run_json(
        [python, str(script), "gmail", "search", "newer_than:30d", "--max", str(limit)],
        account_home(account),
    )


def airtable_context() -> dict:
    script = hermes_home() / "skills/productivity/airtable/scripts/airtable_api.py"
    bases = run_json([sys.executable, str(script), "bases"]).get("bases", [])
    result = []
    for base in bases:
        schema = run_json([sys.executable, str(script), "schema", base["id"]])
        result.append({**base, "tables": schema.get("tables", [])})
    return {"bases": result}


def capabilities() -> dict:
    return {
        "externalWritesEnabled": False,
        "draftKinds": ["email", "notion", "slack", "whatsapp", "spreadsheet", "airtable"],
        "nativeTargets": [
            {
                "target": "gmail", "enabled": False,
                "requiredScopes": ["https://www.googleapis.com/auth/gmail.compose"],
            },
            {
                "target": "google_sheets", "enabled": False,
                "requiredScopes": [
                    "https://www.googleapis.com/auth/spreadsheets",
                    "https://www.googleapis.com/auth/drive.file",
                ],
            },
        ],
        "policy": "Generate, edit, inspect, acknowledge locally, or reject. No external writes.",
    }
