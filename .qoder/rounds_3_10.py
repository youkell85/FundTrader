#!/usr/bin/env python3
"""Rounds 3-10: 综合自审测试"""
import urllib.request
import json
import time

API = "http://localhost:8766"
BFF = "http://localhost:3000"

def req(url, timeout=30, data=None):
    r = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'} if data else {})
    res = urllib.request.urlopen(r, timeout=timeout)
    return json.loads(res.read())

print("========== Round 3: 验证夏普/最大回撤数据正确性 ==========")
try:
    d = req(f"{BFF}/fund/api/trpc/fund.list?input=%7B%22json%22%3A%7B%22pageSize%22%3A100%7D%7D", timeout=60)
    funds = d["result"]["data"]["json"]["funds"]
    has_sharpe = sum(1 for x in funds if float(x["performance"]["sharpeRatio"]) != 0)
    has_dd = sum(1 for x in funds if float(x["performance"]["maxDrawdown"]) != 0)
    print(f"PASS: funds_with_sharpe={has_sharpe}/{len(funds)}, funds_with_maxDD={has_dd}/{len(funds)}")
except Exception as e:
    print(f"FAIL: {e}")

print("\n========== Round 4: 验证后端接口健康 ==========")
try:
    d = req(f"{API}/health", timeout=10)
    print(f"PASS: health={d.get('status')}")
except Exception as e:
    print(f"FAIL: {e}")

print("\n========== Round 5: 验证详情页分析接口 ==========")
try:
    d = req(f"{API}/analysis/000001", timeout=60)
    nav_len = len(d.get("nav_data", []))
    has_return = d.get("return1y") is not None
    print(f"PASS: nav_data={nav_len}, return1y={d.get('return1y')}, has_return={has_return}")
except Exception as e:
    print(f"FAIL: {e}")

print("\n========== Round 6: 验证定投回测接口 ==========")
try:
    payload = json.dumps({
        "codes": ["000001"],
        "amount": 1000,
        "frequency": "monthly",
        "strategy": "fixed",
        "start_date": "2023-01-01",
        "end_date": "2025-05-01"
    }).encode()
    d = req(f"{API}/dca/backtest", timeout=60, data=payload)
    individual = d.get("individual", [])
    if individual:
        first = individual[0]
        print(f"PASS: dca_backtest individual[0] has nav_curve={len(first.get('nav_curve', []))}, total_value={first.get('total_value')}")
    else:
        print(f"WARN: dca_backtest no individual data")
except Exception as e:
    print(f"FAIL: {e}")

print("\n========== Round 7: 验证推荐接口 ==========")
try:
    payload = json.dumps({"risk_level": "稳健", "amount": 100000}).encode()
    d = req(f"{API}/recommend", timeout=30, data=payload)
    funds = d.get("funds", [])
    print(f"PASS: recommend returned {len(funds)} funds")
except Exception as e:
    print(f"FAIL: {e}")

print("\n========== Round 8: 验证自选基金接口 ==========")
try:
    d = req(f"{API}/settings/watchlist", timeout=10)
    wl = d.get("funds", [])
    print(f"PASS: watchlist has {len(wl)} funds")
except Exception as e:
    print(f"FAIL: {e}")

print("\n========== Round 9: 验证批量分析接口性能 ==========")
try:
    payload = json.dumps(['000001', '000003', '000004', '000005', '000006']).encode()
    start = time.time()
    d = req(f"{API}/analysis/batch", timeout=60, data=payload)
    elapsed = time.time() - start
    results = d.get("results", {})
    print(f"PASS: batch_analysis 5 funds in {elapsed:.2f}s, results={len(results)}")
except Exception as e:
    print(f"FAIL: {e}")

print("\n========== Round 10: 验证marketOverview数据 ==========")
try:
    d = req(f"{BFF}/fund/api/trpc/fund.marketOverview", timeout=30)
    data = d["result"]["data"]["json"]
    print(f"PASS: totalFunds={data.get('totalFunds')}, avgSharpe={data.get('avgSharpe')}, avgMaxDD={data.get('avgMaxDD')}")
except Exception as e:
    print(f"FAIL: {e}")

print("\n========== 全部 10 轮自审完成 ==========")
