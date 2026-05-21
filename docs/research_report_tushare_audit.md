# Tushare Pro 6000积分权限审查与 FundTrader 项目优化报告

**审查日期**：2026-05-15
**审查范围**：Tushare Pro 官方文档 vs FundTrader 项目数据层
**账户权限**：6000积分（5000+档位，每分钟500次调用，常规数据无每日上限）
**审查轮次**：5轮AI交叉审查（事实准确性 → 代码正确性 → 逻辑完整性 → 实用性 → 一致性）

---

## 一、核心发现

FundTrader 项目当前**完全不使用 Tushare**，仅依赖三个免费数据源：AkShare（主数据源）、efinance（净值与定投）、东方财富直连 API（备用）。这种架构存在以下关键问题：

1. AkShare/efinance 接口不稳定，随时可能因网站改版而失效
2. 东方财富直连 API 属于非官方爬虫方式，存在反爬风险
3. 缺少财务报表、资金流向、龙虎榜等高价值数据维度
4. 基金经理信息获取方式低效（全量拉取后筛选）
5. 持仓数据硬编码年份（`date="2024"`），无法动态获取最新报告期

---

## 二、6000积分权限下的可用接口清单与调用规范

### 2.1 积分频次对应表

| 积分等级 | 每分钟频次 | 每日总量 | 对应年费 |
|:---|:---|:---|:---|
| 120 | 50次 | 8,000次 | 免费 |
| 2000+ | 200次 | 100,000次/API | 200元 |
| **5000+（含6000）** | **500次** | **常规数据无上限** | 500元 |
| 10000+ | 500次 | 特色数据300次/分钟 | 1000元 |

### 2.2 基金相关接口（项目核心场景）

| 接口名 | API名称 | 最低积分 | 6000分可用 | 核心字段 |
|:---|:---|:---|:---|:---|
| 基金列表 | `fund_basic` | 2000 | ✅ | ts_code, name, fund_type, management, custodian, found_date, end_date |
| 基金公司 | `fund_company` | 2000 | ✅ | ts_code, name, chair, province, city |
| 基金经理 | `fund_manager` | 2000 | ✅ | ts_code, name, gender, begin_date, end_date, resume |
| 基金净值 | `fund_nav` | 2000 | ✅ | ts_code, ann_date, nav_date, unit_nav, accum_nav, accum_div, net_asset, total_netasset, adj_nav |
| 基金分红 | `fund_div` | 400 | ✅ | ts_code, ann_date, ex_date, pay_date, div_cash, record_date, base_date, div_proc |
| 基金持仓 | `fund_portfolio` | 5000 | ✅ | ts_code, ann_date, end_date, symbol, mkv, amount, stk_mkv_ratio, stk_float_ratio |
| 场内基金日线 | `fund_daily` | 5000 | ✅ | ts_code, trade_date, pre_close, open, high, low, close, change, pct_chg, vol, amount |
| 基金复权因子 | `fund_adj` | 600 | ✅ | ts_code, trade_date, adj_factor |

### 2.3 股票相关接口（持仓分析场景）

| 接口名 | API名称 | 最低积分 | 6000分可用 | 核心字段 |
|:---|:---|:---|:---|:---|
| 股票列表 | `stock_basic` | 120 | ✅ | ts_code, name, industry, market, list_date |
| 日线行情 | `daily` | 120 | ✅ | ts_code, trade_date, open, high, low, close, pre_close, change, pct_chg, vol, amount |
| 每日指标 | `daily_basic` | 2000 | ✅ | ts_code, trade_date, close, turnover_rate, turnover_rate_f, volume_ratio, pe, pe_ttm, pb, ps, ps_ttm, dv_ratio, dv_ttm, total_share, float_share, free_share, total_mv, circ_mv |
| 利润表 | `income` | 2000 | ✅ | ts_code, ann_date, end_date, total_revenue, revenue, oper_cost, total_profit, income_tax, n_income, n_income_attr_p |
| 资产负债表 | `balancesheet` | 2000 | ✅ | ts_code, ann_date, end_date, total_assets, total_liab, total_hldr_eqy_exc_min_int |
| 现金流量表 | `cashflow` | 2000 | ✅ | ts_code, ann_date, end_date, c_fr_sale_sg, n_cashflow_act, c_pay_acq_asset, c_fr_inv_act |
| 财务指标 | `fina_indicator` | 2000 | ✅ | ts_code, ann_date, end_date, roe, roe_dt, roe_waa, roe_g, np_margin, gp_margin, netprofit_margin, current_ratio, quick_ratio, debt_to_assets |
| 业绩预告 | `forecast` | 2000 | ✅ | ts_code, ann_date, end_date, type, p_change_min, p_change_max, net_profit_min, net_profit_max |
| 业绩快报 | `express` | 2000 | ✅ | ts_code, ann_date, end_date, revenue, operate_profit, total_profit, n_income, total_assets |
| 分红送股 | `dividend` | 2000 | ✅ | ts_code, end_date, ann_date, div_proc, stk_div, stk_bo_rate, stk_co_rate, cash_div, cash_div_tax |
| 个股资金流向 | `moneyflow` | 2000 | ✅ | ts_code, trade_date, buy_sm_amount, sell_sm_amount, buy_md_amount, sell_md_amount, buy_lg_amount, sell_lg_amount, buy_elg_amount, sell_elg_amount, net_mf_vol, net_mf_amount |
| 龙虎榜 | `top_list` | 2000 | ✅ | ts_code, trade_date, name, close, change, pct_change, amount, net_amount, reason |
| 前十大股东 | `top10_holders` | 2000 | ✅ | ts_code, ann_date, end_date, holder_name, hold_amount, hold_ratio |

### 2.4 指数相关接口（市场行情场景）

| 接口名 | API名称 | 最低积分 | 6000分可用 | 核心字段 |
|:---|:---|:---|:---|:---|
| 指数基本信息 | `index_basic` | 2000 | ✅ | ts_code, name, market, publisher, category, base_date, base_point |
| 指数日线行情 | `index_daily` | 2000 | ✅ | ts_code, trade_date, close, open, high, low, pre_close, change, pct_chg, vol, amount |
| 指数成分权重 | `index_weight` | 2000 | ✅ | index_code, trade_date, con_code, weight |
| 申万行业分类 | `index_classify` | 2000 | ✅ | index_code, industry_name, level, industry_code, is_pub |
| 申万行业成分 | `index_member_all` | 2000 | ✅ | index_code, con_code, con_name, in_date, out_date |
| 大盘指数指标 | `index_dailybasic` | 400 | ✅ | ts_code, trade_date, total_mv, float_mv, total_share, float_share, free_share, turnover_rate, pe, pe_ttm, pb |

### 2.5 宏观经济接口（市场环境场景）

| 接口名 | API名称 | 最低积分 | 6000分可用 |
|:---|:---|:---|:---|
| SHIBOR利率 | `shibor` | 2000 | ✅ |
| LPR贷款基础利率 | `shibor_lpr` | 120 | ✅ |
| LIBOR拆借利率 | `libor` | 120 | ✅ |
| HIBOR拆借利率 | `hibor` | 120 | ✅ |

### 2.6 6000积分无法访问的接口（需单独付费）

| 数据类型 | 费用 | 说明 |
|:---|:---|:---|
| 股票/期货历史分钟线 | 2000元/年 | 定投回测的日内精度场景 |
| 股票/期货实时分钟线 | 1000元/月 | 实时行情推送 |
| 股票实时日线 | 200元/月 | 开盘后当日实时日线 |
| 指数实时日线 | 200元/月 | 开盘后指数实时成交 |
| ETF实时日线 | 200元/月 | 开盘后ETF实时日线 |
| ETF实时参考（IOPV） | 300元/月 | 盘中ETF申赎和IOPV |
| 港股日线 | 1000元/年 | 港股基金分析 |
| 港股财报 | 500元/年 | 港股基本面 |
| 美股日线 | 2000元/年 | QDII基金底层资产分析 |
| 美股财报 | 500元/年 | 美股基本面 |
| 新闻资讯 | 1000元/年 | 快讯、长篇新闻 |
| 公告信息 | 1000元/年 | 股票/基金/固收公告 |
| 券商研报库 | 500元/年 | 券商研究报告 |

### 2.7 调用规范速查

**代码格式**：上交所 `.SH`、深交所 `.SZ`、北交所 `.BJ`、港交所 `.HK`

**日期格式**：`YYYYMMDD`（纯数字字符串），如 `'20260515'`

**基金代码格式**：`基金代码.交易所后缀`，场外基金统一用 `.OF`（如 `'110011.OF'`），场内ETF用 `.SH`/`.SZ`（如 `510300.SH`）。注意：`fund_nav` 官方示例中场外基金代码也使用 `.SZ` 后缀（如 `165509.SZ`），实际调用时 `.OF` 和 `.SZ` 均可返回数据，建议以 `fund_basic` 返回的 `ts_code` 为准

**标准调用模式**：
```python
import tushare as ts
pro = ts.pro_api('your_token')

# 基本调用
df = pro.fund_nav(ts_code='110011.OF', start_date='20250101', end_date='20260515')

# 指定字段
df = pro.fund_basic(fields='ts_code,name,fund_type,management,found_date')

# 按日期批量获取
df = pro.fund_nav(nav_date='20260514')
```

**频次控制**：6000积分对应500次/分钟，建议间隔 >= 120ms

---

## 三、现有项目中的问题与修正方案

### 3.1 严重问题

**问题1：`_fetch_fund_performance()` 全量拉取后单条筛选**

位置：`fund_service.py:97-118`

```python
# 当前代码（严重低效）
df = ak.fund_open_fund_rank_em(symbol="全部")  # 拉取全市场基金排名
row = df[df["基金代码"] == code]  # 筛选单只基金
```

问题：每次调用都拉取全市场基金排名数据（约10000+条），只为获取1只基金的业绩。在国元基金列表遍历场景下，会重复拉取N次全量数据。

修正方案（Tushare）：
```python
pro = ts.pro_api()
# 方案A：按基金代码直接查询净值（注意：fund_nav不返回排名收益率）
df = pro.fund_nav(ts_code=f'{code}.OF', start_date=start_date, end_date=end_date)
# 方案B：批量预加载基金列表，本地筛选
df = pro.fund_basic(market='O')  # 一次性获取全量场外基金列表
# 注意：fund_nav仅返回净值数据，不包含近1月/近1年等排名收益率
# 排名收益率仍需从AkShare/efinance获取，或基于净值历史自行计算
```

**问题2：持仓数据硬编码年份**

位置：`akshare_fetcher.py:69`

```python
# 当前代码
stock_df = ak.fund_portfolio_hold_em(symbol=code, date="2024")  # 硬编码2024
```

问题：2025年及以后将无法获取最新持仓数据。

修正方案（Tushare）：
```python
pro = ts.pro_api()
# Tushare fund_portfolio 自动返回最新报告期数据
df = pro.fund_portfolio(ts_code=f'{code}.OF')
# 或指定报告期
df = pro.fund_portfolio(ts_code=f'{code}.OF', end_date='20250630')
```

**问题3：基金经理信息全量拉取**

位置：`akshare_fetcher.py:45-62`

```python
# 当前代码
df = ak.fund_manager_em()  # 拉取全市场基金经理
managers = df[df["基金代码"] == code]  # 筛选
```

问题：全量拉取约5000+条基金经理数据，只为获取1只基金的经理信息。

修正方案（Tushare）：
```python
pro = ts.pro_api()
# 注意：fund_manager的参数是manager_id/name，不是ts_code
# 需先通过fund_basic获取manager字段，再按manager_id查询
basic = pro.fund_basic(ts_code=f'{code}.OF', fields='ts_code,manager')
# 或直接全量获取后本地筛选（但Tushare返回结构化DataFrame，比AkShare更高效）
df = pro.fund_manager()
managers = df[df['ts_code'].str.startswith(code)] if df is not None else pd.DataFrame()
```

### 3.2 中等问题

**问题4：东方财富 JSONP 爬虫方式不稳定**

位置：`eastmoney_fetcher.py:26-38`

```python
# 当前代码：解析 JSONP 格式
url = f"https://fundgz.1702.com/js/{code}.js"
text = text[text.index("(") + 1:text.rindex(")")]  # 手动剥离 JSONP
```

问题：非官方接口，随时可能因网站改版而失效；JSONP 格式解析脆弱。

修正方案：Tushare `fund_nav` 接口直接返回结构化 DataFrame，无需解析。

**问题5：东方财富排名数据解析脆弱**

位置：`eastmoney_fetcher.py:41-89`

```python
# 当前代码：解析特殊格式 var rankData=...
data_str = text[text.index("=") + 2:text.rindex(";") - 1]
parts = item.split(",")  # 按逗号分割，依赖字段位置
```

问题：字段位置硬编码，东方财富格式变更即全部失效。

修正方案：Tushare `fund_basic` + `fund_nav` 组合查询，返回标准 DataFrame。

**问题6：基金名称批量获取逐条请求**

位置：`efinance_fetcher.py:29-44`

```python
# 当前代码：逐个请求
for code in codes:
    df = ef.fund.get_fund_base_info(code)  # 每次请求1只
```

问题：N只基金需要N次网络请求，效率极低。

修正方案（Tushare）：
```python
pro = ts.pro_api()
# 一次性获取全量基金列表
df = pro.fund_basic(market='O')
# 本地筛选
names = df[df['ts_code'].isin([f'{c}.OF' for c in codes])][['ts_code', 'name']]
```

### 3.3 轻微问题

**问题7：市场指数数据源不稳定**

位置：`akshare_fetcher.py:96-115`

AkShare 的 `stock_zh_index_daily` 接口偶尔因数据源变更而失效。Tushare 的 `index_daily` 接口更稳定，且支持 `start_date`/`end_date` 参数精确控制数据范围。

**问题8：行业板块数据仅取前20条**

位置：`akshare_fetcher.py:84-93`

```python
return df.to_dict(orient="records")[:20]  # 硬编码截断
```

Tushare 的申万行业分类 `index_classify` + `index_member_all` 可获取完整行业体系。

**问题9：资产配置分析逻辑粗糙**

位置：`professional_service.py:108-119`

```python
# 当前代码：简单估算
stock_ratio = sum(h.get("ratio", 0) for h in holdings)
bonds = round(max(0, 80 - stock_ratio), 2)  # 硬编码80%
cash = round(max(0, 20 - stock_ratio * 0.1), 2)  # 硬编码20%
```

Tushare `fund_portfolio` 返回完整的股票持仓比例（`stk_mkv_ratio`）和持仓市值，可精确计算资产配置。

---

## 四、数据价值最大化的接口扩展建议

### 4.1 高价值接口（当前项目完全未使用）

| 优先级 | Tushare接口 | 应用场景 | 数据价值 |
|:---|:---|:---|:---|
| P0 | `fina_indicator` | 基金持仓股票的ROE/利润率/负债率分析 | 从"看基金"升级到"看底层资产质量"；注意：按季度获取全市场需5000积分（fina_indicator_vip），按单股查询2000积分即可 |
| P0 | `moneyflow` | 持仓股票的资金流向监控 | 识别主力资金进出信号 |
| P0 | `fund_div` | 基金分红历史与分红率 | 评估基金分红能力，辅助定投决策 |
| P1 | `forecast`/`express` | 持仓股票的业绩预告/快报 | 提前预判持仓股票业绩风险 |
| P1 | `top_list` | 持仓股票上龙虎榜 | 识别短期异动风险 |
| P1 | `index_weight` | 指数型基金的成分权重 | 精确分析指数基金跟踪误差 |
| P1 | `index_dailybasic` | 市场整体PE/PB/换手率 | 判断市场估值水平，辅助择时 |
| P2 | `income`/`balancesheet`/`cashflow` | 持仓股票的财务三表 | 深度基本面分析 |
| P2 | `top10_holders` | 持仓股票的股东变化 | 识别机构增减持动向 |
| P2 | `hk_hold` | 沪深股通持股明细 | 北向资金动向（注意：2024年8月起改为季度披露，日度数据已停止） |
| P2 | `shibor`/`shibor_lpr` | 利率环境 | 宏观环境对债券型基金的影响 |

### 4.2 新功能扩展建议

**扩展1：基金持仓穿透分析**

利用 `fund_portfolio` 获取基金持仓股票列表，再通过 `fina_indicator` + `daily_basic` 获取每只持仓股票的财务指标和估值数据，实现"基金 -> 持仓股票 -> 基本面质量"的穿透式分析。

```python
def analyze_fund_holdings_quality(ts_code: str) -> Dict:
    """穿透分析基金持仓股票质量"""
    pro = ts.pro_api()
    # 1. 获取基金持仓
    portfolio = pro.fund_portfolio(ts_code=ts_code)
    if portfolio is None or portfolio.empty:
        return {}
    
    # 2. 获取持仓股票的财务指标
    results = []
    for _, row in portfolio.head(10).iterrows():
        stock_code = row['symbol']
        fina = pro.fina_indicator(ts_code=stock_code, fields='ts_code,ann_date,roe,np_margin,gp_margin,current_ratio,debt_to_assets')
        daily = pro.daily_basic(ts_code=stock_code, fields='ts_code,trade_date,pe_ttm,pb,ps_ttm,dv_ttm')
        results.append({
            'code': stock_code,
            'weight': row.get('stk_mkv_ratio', 0),
            'fina': fina.tail(1).to_dict('records') if fina is not None and not fina.empty else {},
            'valuation': daily.tail(1).to_dict('records') if daily is not None and not daily.empty else {},
        })
    return {'holdings_analysis': results}
```

**扩展2：智能定投择时增强**

利用 `index_dailybasic` 获取市场整体PE/PB，结合 `moneyflow` 获取资金流向，增强定投择时信号。

```python
def enhanced_dca_signal(code: str) -> Dict:
    """增强定投择时信号"""
    pro = ts.pro_api()
    
    # 市场估值水平
    index_basic = pro.index_dailybasic(ts_code='000001.SH', fields='ts_code,trade_date,pe,pb,total_mv')
    latest = index_basic.iloc[0] if not index_basic.empty else {}
    
    # 基金净值位置
    nav = pro.fund_nav(ts_code=f'{code}.OF')
    
    # 综合评分
    pe_score = _calc_pe_percentile(index_basic)  # PE历史百分位
    nav_score = _calc_nav_position(nav)  # 净值位置
    
    return {
        'market_valuation': pe_score,
        'nav_position': nav_score,
        'combined_signal': (pe_score + nav_score) / 2,
    }
```

**扩展3：基金对比分析**

利用 Tushare 批量获取多只基金的净值、持仓、分红数据，实现横向对比。

```python
def compare_funds(codes: List[str]) -> Dict:
    """基金对比分析"""
    pro = ts.pro_api()
    ts_codes = [f'{c}.OF' for c in codes]
    
    # 批量获取净值
    navs = {}
    for tc in ts_codes:
        df = pro.fund_nav(ts_code=tc)
        if df is not None and not df.empty:
            navs[tc] = df
    
    # 批量获取分红
    divs = {}
    for tc in ts_codes:
        df = pro.fund_div(ts_code=tc)
        if df is not None and not df.empty:
            divs[tc] = df
    
    return {'nav_comparison': navs, 'dividend_comparison': divs}
```

### 4.3 数据源定位策略

| 场景 | 主数据源 | 备用数据源 | 说明 |
|:---|:---|:---|:---|
| 基金列表/基本信息 | Tushare `fund_basic` | AkShare | Tushare 数据结构化、字段完整 |
| 基金净值历史 | Tushare `fund_nav` | efinance | Tushare 含复权净值、资产净值 |
| 基金持仓 | Tushare `fund_portfolio` | AkShare | Tushare 自动最新报告期 |
| 基金经理 | Tushare `fund_manager` | AkShare | Tushare 按代码直接查询 |
| 基金分红 | Tushare `fund_div` | 无 | 新增维度，AkShare 无对应接口 |
| 股票基本面 | Tushare `fina_indicator` | 无 | 新增维度 |
| 资金流向 | Tushare `moneyflow` | 无 | 新增维度 |
| 市场指数 | Tushare `index_daily` | AkShare | Tushare 更稳定 |
| 行业板块 | Tushare `index_classify` | AkShare | Tushare 申万标准分类 |
| 实时估值 | 东方财富 API | 无 | Tushare 无实时估值接口 |

---

## 五、标准化调用模板与最佳实践

### 5.1 Tushare Fetcher 基础模板

```python
"""Tushare 数据获取层 - 标准化模板"""
import tushare as ts
import os
from typing import Optional, List, Dict, Any
from functools import lru_cache


class TushareFetcher:
    """Tushare 数据获取器（单例模式）"""
    
    _instance = None
    _pro = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    @property
    def pro(self):
        """懒加载 pro_api 实例"""
        if self._pro is None:
            token = os.getenv('TUSHARE_TOKEN', '')
            if not token:
                # 尝试从文件读取
                token_path = os.path.expanduser('~/.tushare_token')
                if os.path.exists(token_path):
                    with open(token_path) as f:
                        token = f.read().strip()
            if not token:
                raise ValueError("TUSHARE_TOKEN not configured")
            self._pro = ts.pro_api(token)
        return self._pro
    
    def _safe_call(self, func, **kwargs) -> Optional[Any]:
        """安全调用封装 - 统一异常处理与频次控制"""
        import time
        try:
            result = func(**kwargs)
            time.sleep(0.15)  # 6000积分：500次/分钟，间隔120ms+余量
            return result
        except Exception as e:
            if '每分钟' in str(e) or 'freq' in str(e).lower():
                time.sleep(1)  # 频次超限，等待1秒重试
                return func(**kwargs)
            raise
    
    # ===== 基金数据 =====
    
    def get_fund_list(self, market: str = 'O') -> List[Dict]:
        """获取基金列表
        Args:
            market: E场内 O场外
        """
        df = self._safe_call(self.pro.fund_basic, market=market)
        if df is None or df.empty:
            return []
        return df.to_dict(orient='records')
    
    def get_fund_nav(self, ts_code: str, 
                     start_date: str = '', end_date: str = '') -> List[Dict]:
        """获取基金净值
        Args:
            ts_code: 基金代码，如 '110011.OF'
            start_date/end_date: YYYYMMDD格式
        """
        kwargs = {'ts_code': ts_code}
        if start_date:
            kwargs['start_date'] = start_date
        if end_date:
            kwargs['end_date'] = end_date
        df = self._safe_call(self.pro.fund_nav, **kwargs)
        if df is None or df.empty:
            return []
        return df.to_dict(orient='records')
    
    def get_fund_portfolio(self, ts_code: str, 
                           end_date: str = '') -> List[Dict]:
        """获取基金持仓（最低5000积分）
        Args:
            ts_code: 基金代码
            end_date: 报告期，如 '20250630'，为空则返回最新
        注意：此接口需要5000积分，6000积分可正常使用
        """
        kwargs = {'ts_code': ts_code}
        if end_date:
            kwargs['end_date'] = end_date
        df = self._safe_call(self.pro.fund_portfolio, **kwargs)
        if df is None or df.empty:
            return []
        return df.to_dict(orient='records')
    
    def get_fund_manager(self, ts_code: str = '') -> List[Dict]:
        """获取基金经理信息
        注意：fund_manager接口不支持ts_code参数，需按manager_id/name查询
        或全量获取后本地筛选
        """
        df = self._safe_call(self.pro.fund_manager)
        if df is None or df.empty:
            return []
        if ts_code:
            # 本地筛选：fund_manager返回的ts_code字段包含管理的基金代码
            df = df[df['ts_code'].str.contains(ts_code.split('.')[0])]
        return df.to_dict(orient='records')
    
    def get_fund_div(self, ts_code: str = '') -> List[Dict]:
        """获取基金分红数据（最低400积分）"""
        kwargs = {}
        if ts_code:
            kwargs['ts_code'] = ts_code
        df = self._safe_call(self.pro.fund_div, **kwargs)
        if df is None or df.empty:
            return []
        return df.to_dict(orient='records')
    
    # ===== 股票数据（持仓穿透） =====
    
    def get_stock_fina_indicator(self, ts_code: str, 
                                  start_date: str = '', end_date: str = '') -> List[Dict]:
        """获取股票财务指标（最低2000积分，按单股查询）
        注意：如需按季度获取全市场数据，需使用fina_indicator_vip（5000积分）
        """
        kwargs = {'ts_code': ts_code}
        if start_date:
            kwargs['start_date'] = start_date
        if end_date:
            kwargs['end_date'] = end_date
        df = self._safe_call(self.pro.fina_indicator, **kwargs)
        if df is None or df.empty:
            return []
        return df.to_dict(orient='records')
    
    def get_stock_daily_basic(self, ts_code: str, 
                               trade_date: str = '') -> List[Dict]:
        """获取股票每日指标（估值/换手率等，最低2000积分）
        注意：ts_code和trade_date至少填一个；单次最大返回6000条
        """
        kwargs = {}
        if ts_code:
            kwargs['ts_code'] = ts_code
        if trade_date:
            kwargs['trade_date'] = trade_date
        df = self._safe_call(self.pro.daily_basic, **kwargs)
        if df is None or df.empty:
            return []
        return df.to_dict(orient='records')
    
    def get_moneyflow(self, ts_code: str, 
                      start_date: str = '', end_date: str = '') -> List[Dict]:
        """获取个股资金流向（最低2000积分）
        返回字段含：buy_sm/sell_sm(小单)、buy_md/sell_md(中单)、
        buy_lg/sell_lg(大单)、buy_elg/sell_elg(特大单)、net_mf_vol/net_mf_amount(净流入)
        单次最大4000行，数据起始2010年
        """
        kwargs = {'ts_code': ts_code}
        if start_date:
            kwargs['start_date'] = start_date
        if end_date:
            kwargs['end_date'] = end_date
        df = self._safe_call(self.pro.moneyflow, **kwargs)
        if df is None or df.empty:
            return []
        return df.to_dict(orient='records')
    
    # ===== 指数数据 =====
    
    def get_index_daily(self, ts_code: str, 
                        start_date: str = '', end_date: str = '') -> List[Dict]:
        """获取指数日线行情"""
        kwargs = {'ts_code': ts_code}
        if start_date:
            kwargs['start_date'] = start_date
        if end_date:
            kwargs['end_date'] = end_date
        df = self._safe_call(self.pro.index_daily, **kwargs)
        if df is None or df.empty:
            return []
        return df.to_dict(orient='records')
    
    def get_index_dailybasic(self, ts_code: str = '', 
                              trade_date: str = '') -> List[Dict]:
        """获取大盘指数每日指标（PE/PB等，最低400积分）
        注意：仅支持上证综指、深证成指、上证50、中证500、中小板指、创业板指
        """
        kwargs = {}
        if ts_code:
            kwargs['ts_code'] = ts_code
        if trade_date:
            kwargs['trade_date'] = trade_date
        df = self._safe_call(self.pro.index_dailybasic, **kwargs)
        if df is None or df.empty:
            return []
        return df.to_dict(orient='records')
    
    def get_sw_industry(self) -> List[Dict]:
        """获取申万行业分类"""
        df = self._safe_call(self.pro.index_classify, level='L1', src='SW2021')
        if df is None or df.empty:
            return []
        return df.to_dict(orient='records')


# 全局实例
tushare_fetcher = TushareFetcher()
```

### 5.2 基金代码转换工具

```python
def convert_fund_code(code: str, to_format: str = 'tushare') -> str:
    """基金代码格式转换
    Args:
        code: 原始代码，如 '110011' 或 '110011.OF'
        to_format: 'tushare'(110011.OF) / 'eastmoney'(110011) / 'efinance'(110011)
    注意：Tushare场外基金代码后缀不统一，部分用.OF，部分用.SZ/.SH
    建议先从fund_basic获取正确的ts_code，再用于其他接口查询
    """
    # 标准化：去除后缀
    pure_code = code.split('.')[0]
    
    if to_format == 'tushare':
        # 场外基金默认用 .OF 后缀，但实际应以fund_basic返回为准
        # 部分LOF基金在深交所上市，ts_code为 xxxxx.SZ
        return f'{pure_code}.OF'
    elif to_format in ('eastmoney', 'efinance', 'akshare'):
        return pure_code
    return pure_code
```

### 5.3 最佳实践清单

1. **Token 管理**：环境变量 `TUSHARE_TOKEN` 或文件 `~/.tushare_token`，不硬编码
2. **频次控制**：每次调用后 `time.sleep(0.15)`，6000积分对应500次/分钟
3. **日期格式**：统一使用 `YYYYMMDD` 字符串，不使用 `datetime` 对象
4. **代码格式**：场外基金 `.OF`（部分LOF用 `.SZ`/`.SH`，以 `fund_basic` 返回为准）、上交所 `.SH`、深交所 `.SZ`、北交所 `.BJ`
5. **批量获取**：优先使用 `trade_date` 参数按日期批量获取，避免循环单条查询
6. **缓存策略**：Tushare 数据按日更新，日线数据缓存1天，基本面数据缓存7天
7. **降级策略**：Tushare 失败时 fallback 到 AkShare/efinance
8. **复权数据**：使用 `fund_nav` 的 `adj_nav` 字段，比手动计算更准确；也可用 `fund_adj`（600积分）获取复权因子自行计算
9. **报告期处理**：`fund_portfolio` 的 `end_date` 参数支持 `YYYYMMDD`，自动匹配最近报告期；注意该接口需5000积分
10. **字段选择**：使用 `fields` 参数只查询需要的字段，减少数据传输量
11. **ts_code获取**：不确定基金代码后缀时，先调用 `fund_basic` 获取正确的 `ts_code`，再用于其他接口
12. **数据量限制**：多数接口单次最大返回5000-6000条，需循环分页获取全量历史数据
13. **fund_nav注意**：该接口仅返回净值数据，不包含排名收益率（近1月/近1年等），排名数据仍需AkShare或自行计算

### 5.4 项目集成路线图

| 阶段 | 内容 | 预计工作量 |
|:---|:---|:---|
| Phase 1 | 创建 `tushare_fetcher.py`，实现基金核心接口（fund_basic/fund_nav/fund_portfolio/fund_manager/fund_div） | 2小时 |
| Phase 2 | 修改 `fund_service.py`，Tushare 优先 + AkShare 降级；注意fund_nav不含排名收益率，需保留AkShare排名接口 | 1.5小时 |
| Phase 3 | 修改 `analysis_service.py`，使用 Tushare 持仓穿透分析 | 2小时 |
| Phase 4 | 修改 `dca_service.py`，使用 Tushare 净值 + 复权数据 | 1小时 |
| Phase 5 | 新增持仓穿透分析功能（fina_indicator + daily_basic + moneyflow） | 3小时 |
| Phase 6 | 新增市场估值择时功能（index_dailybasic + shibor_lpr）；注意index_dailybasic仅支持6大指数 | 2小时 |

---

## 六、结论

FundTrader 项目当前完全依赖免费爬虫类数据源，存在稳定性风险和数据维度缺失。6000积分的 Tushare 账户已覆盖基金、股票、指数、宏观等全品类日线级数据，且每分钟500次的高频调用完全满足项目需求。建议按 Phase 1-6 路线图逐步引入 Tushare 作为主数据源，AkShare/efinance 降级为备用，同时利用 Tushare 独有的财务指标、资金流向、分红等接口扩展分析维度，将项目从"基金排名展示"升级为"持仓穿透分析 + 智能择时"的专业级平台。

**关键注意事项**（5轮审查后补充）：
1. `fund_portfolio` 需5000积分（非2000），是项目核心接口，6000积分刚好满足
2. `fund_daily` 需5000积分（非2000），场内ETF日线场景需注意
3. `fund_nav` 不含排名收益率数据，排名类需求仍需AkShare补充
4. `fund_manager` 不支持 `ts_code` 参数查询，需全量获取后本地筛选
5. `index_dailybasic` 仅支持6大指数（上证综指/深证成指/上证50/中证500/中小板指/创业板指），不支持任意指数
6. `hk_hold` 自2024年8月起北向资金改为季度披露，日度数据已停止发布
7. 场外基金代码后缀不统一（.OF/.SZ/.SH），建议先从 `fund_basic` 获取正确 `ts_code`

---

## References

1. [Tushare Pro 积分与频次权限对应表](https://tushare.pro/document/1?doc_id=290)
2. [Tushare Pro 接口分类列表](https://tushare.pro/document/2)
3. [Tushare Pro fund_nav 接口文档](https://tushare.pro/document/2?doc_id=119)
4. [Tushare Pro fund_basic 接口文档](https://tushare.pro/document/2?doc_id=19)
5. [Tushare Pro fund_portfolio 接口文档](https://tushare.pro/document/2?doc_id=19)
6. [Tushare Pro fund_div 接口文档](https://tushare.pro/document/2?doc_id=120)
7. [Tushare Pro fund_adj 接口文档](https://tushare.pro/document/2?doc_id=199)
8. [Tushare Pro fund_daily 接口文档](https://tushare.pro/document/2?doc_id=127)
9. [Tushare Pro fina_indicator 接口文档](https://tushare.pro/document/2?doc_id=79)
10. [Tushare Pro moneyflow 接口文档](https://tushare.pro/document/2?doc_id=170)
11. [Tushare Pro index_dailybasic 接口文档](https://tushare.pro/document/2?doc_id=128)
12. [Tushare Pro index_classify 接口文档](https://tushare.pro/document/2?doc_id=181)
13. [Tushare Pro hk_hold 接口文档](https://tushare.pro/document/2?doc_id=188)
14. [Tushare Pro daily_basic 接口文档](https://tushare.pro/document/2?doc_id=32)
15. [Tushare积分规则 - CSDN](https://blog.csdn.net/geniusChinaHN/article/details/148023510)

---

## 附录：5轮AI交叉审查修正记录

| 轮次 | 审查维度 | 发现问题数 | 关键修正 |
|:---|:---|:---|:---|
| 第1轮 | 事实准确性 | 7 | fund_div积分400(非2000)、fund_portfolio积分5000(非2000)、fund_daily积分5000(非2000)、fund_adj积分600(非5000)、index_dailybasic积分400(非4000)、moneyflow字段不全、hk_hold数据停止发布 |
| 第2轮 | 代码正确性 | 3 | fund_manager不支持ts_code参数、fund_nav不含排名收益率、基金代码后缀不统一(.OF/.SZ/.SH) |
| 第3轮 | 逻辑完整性 | 4 | fina_indicator全市场需5000积分、index_dailybasic仅支持6大指数、独立权限接口表不完整、fund_nav局限性未说明 |
| 第4轮 | 实用性 | 3 | TushareFetcher模板中fund_manager调用方式错误、代码转换工具未考虑后缀不统一、路线图未标注接口限制 |
| 第5轮 | 一致性 | 2 | 积分频次表与接口清单积分值不一致、References缺少关键接口文档链接 |
