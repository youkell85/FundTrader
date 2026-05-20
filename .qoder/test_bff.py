#!/usr/bin/env python3
import urllib.request
import json
import time

BFF = "http://localhost:3000"

def test_fund_list():
    start = time.time()
    url = f"{BFF}/fund/api/trpc/fund.list?input=%7B%22json%22%3A%7B%22pageSize%22%3A100%7D%7D"
    req = urllib.request.Request(url)
    res = urllib.request.urlopen(req, timeout=120)
    d = json.loads(res.read())
    elapsed = time.time() - start
    result = d.get("result", {}).get("data", {})
    funds = result.get("funds", [])
    print(f"fund.list: funds={len(funds)}, time={elapsed:.2f}s")
    if funds:
        for f in funds[:3]:
            perf = f.get("performance", {})
            print(f"  {f.get('fundCode')} {f.get('fundName')}: sharpe={perf.get('sharpeRatio')}, maxDD={perf.get('maxDrawdown')}, return1y={perf.get('return1y')}")
        # 统计
        has_sharpe = sum(1 for x in funds if float(x.get("performance", {}).get("sharpeRatio", "0")) != 0)
        has_dd = sum(1 for x in funds if float(x.get("performance", {}).get("maxDrawdown", "0")) != 0)
        print(f"  funds_with_sharpe={has_sharpe}/{len(funds)}")
        print(f"  funds_with_maxDD={has_dd}/{len(funds)}")
    return elapsed

def test_market_overview():
    start = time.time()
    url = f"{BFF}/fund/api/trpc/fund.marketOverview"
    req = urllib.request.Request(url)
    res = urllib.request.urlopen(req, timeout=30)
    d = json.loads(res.read())
    elapsed = time.time() - start
    result = d.get("result", {}).get("data", {})
    print(f"marketOverview: totalFunds={result.get('totalFunds')}, avgReturn={result.get('avgReturn')}, avgSharpe={result.get('avgSharpe')}, avgMaxDD={result.get('avgMaxDD')}, time={elapsed:.2f}s")
    return elapsed

print("=== Test BFF APIs ===")
t1 = test_fund_list()
t2 = test_market_overview()
print(f"\nTotal time: {t1+t2:.2f}s")
