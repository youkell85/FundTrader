import sqlite3
conn = sqlite3.connect('/opt/fundtrader/backend/data/fundtrader.db')
tables = [t[0] for t in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
print('tables:', tables)
for t in tables:
    count = conn.execute(f'SELECT COUNT(*) FROM [{t}]').fetchone()[0]
    print(f'  {t}: {count} rows')
    if count > 0:
        cols = [d[0] for d in conn.execute(f'SELECT * FROM [{t}] LIMIT 1').description]
        print(f'    cols: {cols}')
        if 'sharpe_ratio' in cols:
            nonzero = conn.execute(f'SELECT COUNT(*) FROM [{t}] WHERE sharpe_ratio IS NOT NULL AND sharpe_ratio != 0').fetchone()[0]
            print(f'    sharpe_ratio nonzero: {nonzero}')
        if 'max_drawdown' in cols:
            nonzero = conn.execute(f'SELECT COUNT(*) FROM [{t}] WHERE max_drawdown IS NOT NULL AND max_drawdown != 0').fetchone()[0]
            print(f'    max_drawdown nonzero: {nonzero}')
conn.close()
