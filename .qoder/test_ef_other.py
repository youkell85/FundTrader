import efinance as ef

code = "001938"
methods = ["get_fund_manager", "get_invest_position", "get_types_percentage"]

for method in methods:
    print(f"\n=== {method} ===")
    try:
        func = getattr(ef.fund, method)
        result = func(code)
        print("Type:", type(result))
        if result is not None:
            if hasattr(result, 'columns'):
                print("Columns:", list(result.columns))
                print(result.head(3))
            elif hasattr(result, 'index'):
                for idx in result.index[:10]:
                    print(idx, "=", result[idx])
            else:
                print(result)
    except Exception as e:
        print("Error:", e)