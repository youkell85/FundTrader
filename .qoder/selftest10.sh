#!/bin/bash
# 10轮自审自修 - Round 1: 批量分析接口+首页数据完整性
set -e
API="http://localhost:8766"
BFF="http://localhost:3000"
NGINX="http://localhost"

echo "========== Round 1: 批量分析接口+首页数据完整性 =========="

# 1.1 测试后端批量分析接口
echo "[R1.1] 测试 /analysis/batch 接口..."
python3 -c "
import urllib.request, json
data = json.dumps(['000001','000003','000004']).encode()
req = urllib.request.Request('$API/analysis/batch', data=data, headers={'Content-Type':'application/json'})
res = urllib.request.urlopen(req, timeout=60)
d = json.loads(res.read())
results = d.get('results', {})
print('batch_results_count=', len(results))
for code, analysis in results.items():
    nav_len = len(analysis.get('nav_data', []))
    has_name = bool(analysis.get('name'))
    print(f'{code}: nav_len={nav_len}, name={has_name}')
" 2>&1
echo ""

# 1.2 测试 BFF fund.list 返回数据
echo "[R1.2] 测试 BFF fund.list 数据完整性..."
python3 -c "
import urllib.request, json
req = urllib.request.Request('$BFF/fund/api/list?pageSize=100', headers={'Content-Type':'application/json'})
res = urllib.request.urlopen(req, timeout=60)
d = json.loads(res.read())
funds = d.get('result', {}).get('data', {}).get('funds', [])
print('fund_count=', len(funds))
if funds:
    f = funds[0]
    perf = f.get('performance', {})
    print('first_fund:', f.get('fundCode'), f.get('fundName'))
    print('sharpeRatio=', perf.get('sharpeRatio'))
    print('maxDrawdown=', perf.get('maxDrawdown'))
    print('return1y=', perf.get('return1y'))
    # 统计有多少基金有夏普/最大回撤
    has_sharpe = sum(1 for x in funds if float(x.get('performance', {}).get('sharpeRatio', '0')) != 0)
    has_dd = sum(1 for x in funds if float(x.get('performance', {}).get('maxDrawdown', '0')) != 0)
    print(f'funds_with_sharpe={has_sharpe}/{len(funds)}')
    print(f'funds_with_maxDD={has_dd}/{len(funds)}')
" 2>&1
echo ""

# 1.3 测试 marketOverview
echo "[R1.3] 测试 marketOverview..."
python3 -c "
import urllib.request, json
req = urllib.request.Request('$BFF/fund/api/marketOverview')
res = urllib.request.urlopen(req, timeout=30)
d = json.loads(res.read())
result = d.get('result', {}).get('data', {})
print('totalFunds=', result.get('totalFunds'))
print('avgReturn=', result.get('avgReturn'))
print('avgSharpe=', result.get('avgSharpe'))
print('avgMaxDD=', result.get('avgMaxDD'))
" 2>&1
echo ""

echo "========== Round 1 完成 =========="
