#!/usr/bin/env bash
set -euo pipefail

LIMIT="${1:-30}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT/backend"
export PYTHONPATH="$PWD"

python -c "import json; from app.data.market_context_fetcher import refresh_market_context_cache; print(json.dumps(refresh_market_context_cache(limit=int('$LIMIT')), ensure_ascii=False, indent=2))"
