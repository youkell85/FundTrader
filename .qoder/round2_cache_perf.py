#!/usr/bin/env python3
import urllib.request
import json
import time

BFF = "http://localhost:3000"

def test_cached_response():
    """测试第二次请求是否从缓存返回（应该更快）"""
    url = f"{BFF}/fund/api/trpc/fund.list?input=%7B%22json%22%3A%7B%22pageSize%22%3A100%7D%7D"
    
    # 第一次请求（可能触发缓存填充）
    t1_start = time.time()
    req1 = urllib.request.Request(url)
    res1 = urllib.request.urlopen(req1, timeout=120)
    d1 = json.loads(res1.read())
    t1 = time.time() - t1_start
    
    # 第二次请求（应该从缓存返回）
    t2_start = time.time()
    req2 = urllib.request.Request(url)
    res2 = urllib.request.urlopen(req2, timeout=120)
    d2 = json.loads(res2.read())
    t2 = time.time() - t2_start
    
    funds1 = d1["result"]["data"]["json"]["funds"]
    funds2 = d2["result"]["data"]["json"]["funds"]
    
    print(f"[Cache Test] First request: {t1:.2f}s, funds={len(funds1)}")
    print(f"[Cache Test] Second request: {t2:.2f}s, funds={len(funds2)}")
    print(f"[Cache Test] Speedup: {t1/t2:.1f}x" if t2 > 0 else "[Cache Test] Speedup: instant")
    
    if t2 < t1 * 0.5:
        print("[Cache Test] PASS: Cache is working")
    else:
        print("[Cache Test] WARN: Cache may not be effective")

def test_market_overview():
    """测试市场概览缓存"""
    url = f"{BFF}/fund/api/trpc/fund.marketOverview"
    
    t1_start = time.time()
    req1 = urllib.request.Request(url)
    res1 = urllib.request.urlopen(req1, timeout=30)
    d1 = json.loads(res1.read())
    t1 = time.time() - t1_start
    
    t2_start = time.time()
    req2 = urllib.request.Request(url)
    res2 = urllib.request.urlopen(req2, timeout=30)
    d2 = json.loads(res2.read())
    t2 = time.time() - t2_start
    
    data1 = d1["result"]["data"]["json"]
    data2 = d2["result"]["data"]["json"]
    
    print(f"\n[MarketOverview] First: {t1:.2f}s, avgSharpe={data1.get('avgSharpe')}")
    print(f"[MarketOverview] Second: {t2:.2f}s, avgSharpe={data2.get('avgSharpe')}")
    
    if t2 < 0.1:
        print("[MarketOverview] PASS: Cache is working")
    else:
        print("[MarketOverview] WARN: Cache may not be effective")

print("========== Round 2: 缓存机制+性能测试 ==========")
test_cached_response()
test_market_overview()
print("\n========== Round 2 完成 ==========")
