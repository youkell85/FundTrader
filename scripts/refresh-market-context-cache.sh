#!/usr/bin/env bash
set -euo pipefail

LIMIT="${1:-30}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-}"

if [[ -z "$PYTHON_BIN" ]]; then
  if command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="python3"
  elif command -v python >/dev/null 2>&1; then
    PYTHON_BIN="python"
  else
    echo "python3 or python is required" >&2
    exit 127
  fi
fi

cd "$ROOT/backend"
export PYTHONPATH="$PWD"

"$PYTHON_BIN" -c "import json; from app.data.market_context_fetcher import refresh_market_context_cache; print(json.dumps(refresh_market_context_cache(limit=int('$LIMIT')), ensure_ascii=False, indent=2))"
