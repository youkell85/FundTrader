import efinance as ef

code = "001938"
try:
    result = ef.fund.get_base_info(code)
    print("Type:", type(result))
    if result is not None:
        print("Data:")
        if hasattr(result, 'index'):
            for idx in result.index:
                print(idx, "=", result[idx])
        else:
            print(result)
except Exception as e:
    print("Error:", e)