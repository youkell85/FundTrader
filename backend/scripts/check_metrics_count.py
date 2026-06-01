import sqlite3
conn = sqlite3.connect('/opt/fundtrader/backend/data/fundtrader.db')
c = conn.execute('SELECT COUNT(*) FROM fund_metrics_snapshot WHERE sharpe_ratio IS NOT NULL').fetchone()[0]
print(f'metrics_with_sharpe: {c}')
c2 = conn.execute('SELECT COUNT(*) FROM fund_metrics_snapshot WHERE max_drawdown IS NOT NULL AND max_drawdown != 0').fetchone()[0]
print(f'metrics_with_maxdd: {c2}')
s = conn.execute('SELECT AVG(sharpe_ratio), AVG(max_drawdown), AVG(volatility) FROM fund_metrics_snapshot').fetchone()
if s[0] is not None:
    print(f'avg_sharpe={s[0]:.4f} avg_maxdd={s[1]:.4f} avg_vol={s[2]:.4f}')
else:
    print('no data yet')
conn.close()
