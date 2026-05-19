#!/bin/bash
cd /opt/fundtrader/v2/backend
python3 << 'PYEOF'
from app.data.efinance_fetcher import get_fund_nav_history
r = get_fund_nav_history("000001")
print("efinance len=", len(r))
if r:
    print("first=", r[0])
    print("last=", r[-1])

# 测试 analysis_service nav_data
import json
import urllib.request
req = urllib.request.urlopen("http://localhost:8766/analysis/000001", timeout=120)
d = json.loads(req.read())
nav = d.get("nav_data") or []
print("\nanalysis nav_len=", len(nav))
if nav:
    print("first=", nav[0])
    print("last=", nav[-1])
print("return1y=", d.get("return1y"), "return3y=", d.get("return3y"), "return5y=", d.get("return5y"))
print("annualized=", d.get("annualized_return"))
PYEOF
