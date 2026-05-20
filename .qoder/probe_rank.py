#!/usr/bin/env python3
import akshare as ak
df = ak.fund_open_fund_rank_em(symbol="混合型")
print("columns=", list(df.columns))
print("shape=", df.shape)
print("first_row=", df.iloc[0].to_dict())
