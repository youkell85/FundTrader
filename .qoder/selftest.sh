#!/bin/bash
# 自审自修测试脚本
set +e
echo "=== R1.health ==="
curl -s http://localhost:8766/health
echo
echo "=== R2.fund.list ==="
curl -s 'http://localhost:8766/fund/list?page_size=2' | python3 -c "import sys,json;d=json.load(sys.stdin);print('total=',d.get('total'),'first_code=',d['funds'][0].get('code') if d.get('funds') else None)"
echo "=== R3.analysis_nav ==="
curl -s 'http://localhost:8766/analysis/000001' | python3 -c "
import sys,json
d=json.load(sys.stdin)
nav=d.get('nav_data') or []
print('nav_len=',len(nav))
if nav:
    print('first=',nav[0].get('date') if isinstance(nav[0],dict) else nav[0])
    print('last=',nav[-1].get('date') if isinstance(nav[-1],dict) else nav[-1])
print('manager=',(d.get('manager') or {}).get('name'))
print('holdings=',len(d.get('holdings') or []))
print('return1y=',d.get('return1y'),'return3y=',d.get('return3y'))
"
echo "=== R4.dca_backtest ==="
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"codes":["000001"],"amount":1000,"frequency":"monthly","strategy":"fixed","start_date":"2023-01-01","end_date":"2026-05-01"}' \
  http://localhost:8766/dca/backtest > /tmp/dca.json
python3 -c "
import json
d=json.load(open('/tmp/dca.json'))
print('top_keys=',list(d.keys()))
ind=d.get('individual') or []
print('individual_len=',len(ind))
if ind:
    s=ind[0]
    print('first_keys=',list(s.keys()))
    print('start_date=',s.get('start_date'))
    print('end_date=',s.get('end_date'))
    print('total_invested=',s.get('total_invested'))
    print('total_value=',s.get('total_value'))
    print('total_profit_rate=',s.get('total_profit_rate'))
    print('annual_return=',s.get('annual_return'))
    print('max_drawdown=',s.get('max_drawdown'))
    print('nav_curve_len=',len(s.get('nav_curve') or []))
    b=s.get('benchmark') or {}
    print('benchmark_keys=',list(b.keys()))
    print('bench_curve_len=',len(b.get('curve') or []))
    print('bench_final=',b.get('final_value'))
"
echo "=== R5.fund_llm_review ==="
curl -s --max-time 60 'http://localhost:8766/analysis/000001/llm_review' | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    r=d.get('review') or {}
    print('ok=',bool(r),'keys=',list(r.keys())[:8])
except Exception as e:
    print('ERR',e)
"
echo "=== R6.dca_llm_review ==="
curl -s --max-time 60 -X POST -H 'Content-Type: application/json' \
  -d '{"code":"000001","name":"华夏成长","dca":{"total_invested":40000,"final_value":52000,"total_return":30,"annualized_return":12,"max_drawdown":-15},"benchmark":{"total_invested":40000,"final_value":48000,"profit_rate":20}}' \
  http://localhost:8766/dca/llm_review | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    r=d.get('review') or {}
    print('ok=',bool(r),'keys=',list(r.keys())[:8])
except Exception as e:
    print('ERR',e)
"
echo "=== R7.recommend ==="
curl -s -X POST -H 'Content-Type: application/json' -d '{}' http://localhost:8766/recommend | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('risk_level=',d.get('risk_level'),'funds_count=',len(d.get('funds') or []))
"
echo "=== R8.bff_health ==="
curl -s -o /dev/null -w 'bff_ok=%{http_code}\n' http://localhost:3000/fund/
echo "=== R9.public_via_nginx ==="
curl -s -o /dev/null -w 'nginx=%{http_code}\n' http://localhost/fund/
echo "=== DONE ==="
