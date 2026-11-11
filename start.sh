#!/usr/bin/env bash
# Private, loopback-only Virtual Operator service. No external write routes exist.
set -euo pipefail
umask 077

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PYTHON="$ROOT/.venv/bin/python"
if [[ ! -x "$PYTHON" ]]; then
  printf 'Missing project virtual environment. Follow README.md installation steps.\n' >&2
  exit 1
fi

export VO_FRONTEND_DIST="${VO_FRONTEND_DIST:-$ROOT/frontend/dist}"
if [[ ! -f "$VO_FRONTEND_DIST/index.html" ]]; then
  printf 'Frontend is not built. Run: cd frontend && npm ci && npm run build\n' >&2
  exit 1
fi

HOST="${VO_HOST:-127.0.0.1}"
PORT="${VO_PORT:-8765}"
printf 'Virtual Operator: http://%s:%s/\n' "$HOST" "$PORT"
printf 'Drafts and artifacts are local only; approval still requires explicit local acknowledgement.\n'
exec "$PYTHON" -m uvicorn app.main:app --host "$HOST" --port "$PORT"
