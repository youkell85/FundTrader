#!/usr/bin/env python3
import urllib.request
import json

BFF = "http://localhost:3000"
url = f"{BFF}/fund/api/trpc/fund.list?input=%7B%22json%22%3A%7B%22pageSize%22%3A100%7D%7D"
req = urllib.request.Request(url)
res = urllib.request.urlopen(req, timeout=120)
d = json.loads(res.read())
funds = d["result"]["data"]["json"]["funds"]
print(f"funds={len(funds)}")
for f in funds[:5]:
    perf = f["performance"]
    print(f"  {f['fundCode']} {f['fundName'][:15]}: sharpe={perf['sharpeRatio']}, maxDD={perf['maxDrawdown']}, return1y={perf['return1y']}")

has_sharpe = sum(1 for x in funds if float(x["performance"]["sharpeRatio"]) != 0)
has_dd = sum(1 for x in funds if float(x["performance"]["maxDrawdown"]) != 0)
print(f"\nfunds_with_sharpe={has_sharpe}/{len(funds)}")
print(f"funds_with_maxDD={has_dd}/{len(funds)}")
