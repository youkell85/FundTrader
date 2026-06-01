import sqlite3, os
db_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'fundtrader.db')
conn = sqlite3.connect(db_path)
cur = conn.cursor()
cur.execute('SELECT COUNT(*) FROM fund_snapshots WHERE sharpe_ratio IS NOT NULL AND sharpe_ratio != 0')
print('sharpe_nonzero:', cur.fetchone()[0])
cur.execute('SELECT COUNT(*) FROM fund_snapshots WHERE max_drawdown IS NOT NULL AND max_drawdown != 0')
print('maxdd_nonzero:', cur.fetchone()[0])
cur.execute('SELECT COUNT(*) FROM fund_snapshots')
print('total:', cur.fetchone()[0])
cur.execute('SELECT code, sharpe_ratio, max_drawdown, data_quality FROM fund_snapshots LIMIT 5')
for row in cur.fetchall():
    print('sample:', row)
conn.close()
