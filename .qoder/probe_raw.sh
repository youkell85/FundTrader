#!/bin/bash
echo "=== fund llm review ==="
curl -s http://localhost:8766/analysis/000001/llm_review | python3 -c '
import json, sys
d = json.load(sys.stdin)
r = d.get("review", {}) or {}
print("keys=", list(r.keys()))
raw = r.get("raw") or ""
print("raw_len=", len(raw))
print("raw_head_500=", raw[:500])
print("raw_tail_200=", raw[-200:])
'
echo ""
echo "=== dca llm review ==="
curl -s -X POST http://localhost:8766/dca/llm_review \
  -H 'Content-Type: application/json' \
  -d '{"code":"000001","name":"test","dca":{"total_invested":35000,"final_value":46514,"total_return":32.9,"annualized_return":8.94,"max_drawdown":12.77},"benchmark":{"total_invested":35000,"final_value":40339,"profit_rate":15.25}}' \
  | python3 -c '
import json, sys
d = json.load(sys.stdin)
r = d.get("review", {}) or {}
print("keys=", list(r.keys()))
raw = r.get("raw") or ""
print("raw_len=", len(raw))
print("raw_head_500=", raw[:500])
'
