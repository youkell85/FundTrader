import efinance as ef

# 测试基金基本信息接口
code = "001938"
try:
    df = ef.fund.get_fund_base_info(code)
    if df is not None and not df.empty:
        print("Columns:", list(df.columns))
        for col in df.columns:
            val = df.iloc[0].get(col)
            print(col, "=", val)
except Exception as e:
    print("Error:", e)