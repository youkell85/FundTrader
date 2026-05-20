#!/usr/bin/env python3
import urllib.request
import json
import time

API = "http://localhost:8766"

def test_backend_batch():
    start = time.time()
    data = json.dumps(['000001']).encode()
    req = urllib.request.Request(f"{API}/analysis/batch", data=data, headers={'Content-Type': 'application/json'})
    res = urllib.request.urlopen(req, timeout=60)
    d = json.loads(res.read())
    elapsed = time.time() - start
    print(f"backend batch: keys={list(d.keys())}, results={len(d.get('results', {}))}, time={elapsed:.2f}s")

def test_backend_fund_list():
    start = time.time()
    req = urllib.request.Request(f"{API}/fund/list?guoyuan_only=true&page_size=100")
    res = urllib.request.urlopen(req, timeout=30)
    d = json.loads(res.read())
    elapsed = time.time() - start
    funds = d.get('funds', [])
    print(f"backend fund.list: funds={len(funds)}, time={elapsed:.2f}s")

test_backend_batch()
test_backend_fund_list()
