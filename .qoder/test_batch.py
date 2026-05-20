#!/usr/bin/env python3
import urllib.request
import json
import time

API = "http://localhost:8766"

def test_batch(codes):
    start = time.time()
    data = json.dumps(codes).encode()
    req = urllib.request.Request(f"{API}/analysis/batch", data=data, headers={'Content-Type': 'application/json'})
    res = urllib.request.urlopen(req, timeout=120)
    d = json.loads(res.read())
    elapsed = time.time() - start
    results = d.get('results', {})
    print(f"batch_codes={len(codes)}, results={len(results)}, time={elapsed:.2f}s")
    for code, analysis in results.items():
        nav_len = len(analysis.get('nav_data', []))
        has_name = bool(analysis.get('name'))
        print(f"  {code}: nav_len={nav_len}, name={has_name}")
    return elapsed

# 测试单只
t1 = test_batch(['000001'])

# 测试3只
t3 = test_batch(['000001', '000003', '000004'])

# 测试全部14只
t14 = test_batch([
    '000001', '000003', '000004', '000005', '000006',
    '000007', '000008', '000009', '000010', '000011',
    '000012', '000013', '000014', '000015'
])

print(f"\n单只={t1:.2f}s, 3只={t3:.2f}s, 14只={t14:.2f}s")
