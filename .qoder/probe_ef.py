#!/usr/bin/env python3
import efinance as ef
attrs = [n for n in dir(ef.fund) if not n.startswith("_")]
print("efinance.fund attrs:")
for n in attrs:
    print(" ", n)
print()
# 测试常见名称
for name in ["get_fund_net_value", "get_quote_history", "get_fund_history", "get_fund_nav", "get_fund_value"]:
    print(f"  has {name}: {hasattr(ef.fund, name)}")
