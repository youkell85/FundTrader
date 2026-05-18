import os

# Fix efinance_fetcher.py
path = '/root/FundTrader_20260516203417/backend/app/data/efinance_fetcher.py'
with open(path, 'r') as f:
    content = f.read()

content = content.replace('"""efinance 数据获取层 - 基金净值与定投回测"""\nimport efinance as ef\nimport pandas as pd',
                         '"""efinance 数据获取层 - 基金净值与定投回测"""\nimport pandas as pd')

content = content.replace('    try:\n        df = ef.fund.get_fund_net_value(code)',
                         '    try:\n        import efinance as ef\n        df = ef.fund.get_fund_net_value(code)')

content = content.replace('    try:\n        for code in codes:\n            try:\n                df = ef.fund.get_fund_base_info(code)',
                         '    try:\n        import efinance as ef\n        for code in codes:\n            try:\n                df = ef.fund.get_fund_base_info(code)')

with open(path, 'w') as f:
    f.write(content)
print('efinance_fetcher.py fixed')

# Fix analysis_service.py
path2 = '/root/FundTrader_20260516203417/backend/app/services/analysis_service.py'
with open(path2, 'r') as f:
    content = f.read()

content = content.replace('from ..data.efinance_fetcher import get_fund_nav_history\n',
                         '')
content = content.replace('        nav_data = get_fund_nav_history(code)',
                         '        from ..data.efinance_fetcher import get_fund_nav_history\n        nav_data = get_fund_nav_history(code)')

with open(path2, 'w') as f:
    f.write(content)
print('analysis_service.py fixed')

# Fix dca_service.py
path3 = '/root/FundTrader_20260516203417/backend/app/services/dca_service.py'
with open(path3, 'r') as f:
    content = f.read()

content = content.replace('from ..data.efinance_fetcher import _calc_fixed_dca, _calc_ma_dca, get_fund_names\n',
                         '')

if 'from ..data.efinance_fetcher import _calc_fixed_dca, _calc_ma_dca' not in content:
    content = content.replace('    """基于融合层数据的定投回测计算"""',
                             '    """基于融合层数据的定投回测计算"""\n    from ..data.efinance_fetcher import _calc_fixed_dca, _calc_ma_dca')

with open(path3, 'w') as f:
    f.write(content)
print('dca_service.py fixed')
