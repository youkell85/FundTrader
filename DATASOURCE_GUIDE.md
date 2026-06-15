# FundTrader 金融数据源与密钥指南

> 面向智能体（Agent）的权威参考。当你在构建、修改、扩展金融项目时，依据本文档选取合适的数据源。
> 更新日期: 2026-06-14 | 数据源可用: 9/9

---

## 一、密钥与认证速查

所有密钥存储在 `backend/.env`，项目启动时由 `backend/app/config.py` 自动加载（dotenv）。新增数据源时，密钥也写入此文件。

| 数据源 | 环境变量 | 密钥类型 | 获取方式 | 当前状态 |
|--------|----------|----------|----------|----------|
| iFinD MCP | `IFIND_TOKEN` | Bearer Token (JWE) | 同花顺iFinD MCP申请 | ✅ 已配置 |
| Tushare Pro | `TUSHARE_TOKEN` | API Token | tushare.pro注册(当前6000积分) | ✅ 已配置 |
| TickFlow | `TICKFLOW_API_KEY` | API Key | tickflow.org注册(月度99元付费权限) | ✅ 已配置 |
| 腾讯财经 | 无需 | - | - | ✅ 无需认证 |
| AkShare | 无需 | - | - | ✅ 无需认证 |
| 东方财富 | 无需 | - | - | ✅ 无需认证 |
| efinance | 无需 | - | - | ✅ 无需认证 |
| NeoData | Skill内置 | - | CodeBuddy平台内置 | ✅ 无需配置 |
| westock-data | Skill内置 | - | CodeBuddy平台内置 | ✅ 无需配置 |

**密钥使用注意事项**:
- iFinD Token 是 JWE 格式（约849字符），通过 HTTP Header `Authorization: Bearer <token>` 传递
- Tushare Token 通过 `ts.pro_api(token)` 初始化，或设置环境变量 `TUSHARE_TOKEN`
- TickFlow API Key 通过环境变量 `TICKFLOW_API_KEY` 或构造函数传入，支持免费版（仅日K）和付费版（月度99元权限：分钟K线、批量查询、日内分时、五档行情、除权因子）
- dotenv 必须在 fusion.py 导入前加载（通过 `from ...config import` 触发）

---

## 二、架构总览：三层设计

```
┌─────────────────────────────────────────────────────────┐
│                    调用方（API/前端）                       │
└──────────────────────┬──────────────────────────────────┘
                       │
          ┌────────────▼────────────┐
          │   DataFusion 融合层      │  统一入口，按优先级合并多源数据
          │   fusion.get_fund_detail │
          │   fusion.get_fund_nav    │
          │   fusion.get_trade_cal   │
          └────────────┬────────────┘
                       │
    ┌──────────────────┼──────────────────┐
    │                  │                  │
┌───▼───┐        ┌────▼────┐       ┌────▼────┐
│iFinD  │        │Tushare  │       │TickFlow │  Provider层
│P=5    │        │P=4      │       │P=3      │  (统一接口)
└───────┘        └─────────┘       └─────────┘
     ┌──────────────┐
     │ 腾讯财经 P=2  │
     └──────────────┘

┌──────────┐  ┌──────────┐  ┌──────────┐
│ AkShare  │  │ 东方财富  │  │ efinance │  Fetcher层
│ (独立函数)│  │ (独立函数)│  │ (独立函数)│  (直接调用)
└──────────┘  └──────────┘  └──────────┘

┌──────────────────┐  ┌──────────────────┐
│ NeoData Skill    │  │ westock-data CLI │  平台Skill层
│ (自然语言查询)    │  │ (命令行工具)      │  (Agent专用)
└──────────────────┘  └──────────────────┘
```

**关键设计决策**:
- Provider层实现统一接口（`DataProvider`基类），可被融合层自动调度
- Fetcher层是独立函数，需直接调用，不参与融合
- 平台Skill层是 CodeBuddy 内置能力，Agent通过 `use_skill` 或命令行调用
- 新增数据源时：若需参与融合→实现 `DataProvider` 基类加入 Provider 层；否则→写独立 Fetcher 函数

---

## 三、数据源选型决策树

当你需要获取某类数据时，按以下逻辑选取数据源：

### 基金数据

| 你需要什么 | 选哪个源 | 为什么 | 调用方式 |
|-----------|---------|--------|---------|
| 基金列表(全市场) | Tushare `get_fund_list` | 唯一覆盖全市场的结构化列表 | Provider |
| 基金排名(含收益) | AkShare `get_fund_ranking` | 自带各阶段收益排名，字段最全 | Fetcher |
| 基金详情(最全) | 融合层 `get_fund_detail` | 自动合并iFinD(风险)+Tushare(份额/分红/复权)+腾讯(实时) | Provider |
| 基金实时净值 | 腾讯财经 `get_fund_detail` | 毫秒级响应，非交易时段返回昨日净值 | Provider |
| 基金盘中估值 | 东方财富 `get_fund_detail_em` | 唯一来源，交易时间内每分钟更新 | Fetcher |
| 基金历史净值 | Tushare `get_fund_nav` | 含复权净值，日增长率本地计算 | Provider |
| 基金持仓 | Tushare `get_fund_holdings` | 自动查股票名称，字段最全 | Provider |
| 基金分红 | Tushare `get_fund_dividend` | 7个字段，最完整 | Provider |
| 基金份额/规模 | Tushare `get_fund_scale` | 唯一精确来源（fund_share接口） | Provider |
| 基金经理 | Tushare `get_fund_manager` | 含任职回报(reward) | Provider |
| 基金评级 | Tushare（从detail中） | fund_rating接口 | Provider |
| 风险指标 | iFinD `get_risk_indicators` | 唯一来源(volatility/sharpe/max_drawdown等) | Provider |
| 定投回测 | efinance `calculate_dca_backtest` | 唯一来源，支持固定/均线偏离/对比策略 | Fetcher |
| 复权因子 | Tushare `get_fund_adj` | 唯一来源；当前6000积分可调，覆盖完整性以接口返回为准 | Provider |

### ETF数据

| 你需要什么 | 选哪个源 | 为什么 | 调用方式 |
|-----------|---------|--------|---------|
| ETF日K线/分钟K线 | TickFlow `get_fund_nav`/`tf.klines.get` | 日K最快；付费权限支持A股/ETF 1m/5m/15m/30m/60m分钟K | Provider/SDK |
| ETF基本信息 | Tushare `get_etf_basic` | 最全 | Provider |
| ETF持仓明细 | westock-data `etf-holdings` | 唯一来源 | CLI |
| ETF日线(备选) | Tushare `get_etf_daily` | 使用fund_daily接口 | Provider |

### 股票数据

| 你需要什么 | 选哪个源 | 为什么 | 调用方式 |
|-----------|---------|--------|---------|
| 股票实时行情 | westock-data `quote` | 最结构化 | CLI |
| 股票财务报表 | westock-data `finance` | 多期对比 | CLI |
| 技术指标 | westock-data `technical` | MACD/KDJ/RSI/BOLL | CLI |
| 筹码成本 | westock-data `chip` | 唯一来源(仅A股) | CLI |
| 资金流向 | westock-data `asfund` | 唯一来源 | CLI |
| 风险指标 | iFinD `get_risk_indicators` | 唯一来源 | Provider |
| ESG评级 | iFinD `get_esg_data` | 唯一来源 | Provider |
| 股东结构 | westock-data `shareholder` | 仅A股/港股 | CLI |
| 龙虎榜 | westock-data `lhb` | 唯一来源(仅沪深) | CLI |
| 大宗交易 | westock-data `blocktrade` | 唯一来源(仅沪深) | CLI |
| 融资融券 | westock-data `margintrade` | 唯一来源(仅沪深) | CLI |
| PE/PB/市值 | Tushare `get_stock_daily_basic` | 结构化数据 | Provider |

### 宏观/其他

| 你需要什么 | 选哪个源 | 为什么 | 调用方式 |
|-----------|---------|--------|---------|
| 交易日历 | Tushare `get_trade_cal` | 唯一来源 | Provider |
| 指数日线 | Tushare `get_index_daily` | 唯一来源 | Provider |
| 宏观经济 | iFinD `get_macro_data` | 最专业 | Provider |
| 公司新闻 | iFinD `get_company_news` | 最聚焦 | Provider |
| 港股/美股 | NeoData | 自然语言查询，覆盖全球 | Skill |
| 行业板块 | AkShare `get_fund_industry_board` | 东方财富源 | Fetcher |

---

## 四、各数据源详细说明

### 1. iFinD MCP — 专业金融数据（优先级5，最高）

**定位**: 专业付费数据源，覆盖基金/股票/宏观/新闻，数据最全最深。

**认证**: Bearer Token，`backend/.env` 的 `IFIND_TOKEN`

**调用方式**: HTTP POST JSON-RPC 2.0 到 MCP Server，SSE 或 JSON 响应

**4个MCP服务器**:

| 服务器 | 端点URL | 工具数 |
|--------|---------|--------|
| fund | `https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-fund-mcp` | 7 |
| stock | `https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-stock-mcp` | 9 |
| edb | `https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-edb-mcp` | 1 |
| news | `https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-news-mcp` | 1 |

**请求格式**:
```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"工具名","arguments":{"query":"查询参数"}}}
```
**Headers**: `Authorization: Bearer <IFIND_TOKEN>`, `Content-Type: application/json`, `Accept: application/json, text/event-stream`

**响应解析**: `content[0].text` 是JSON字符串 → 解析后 `data.text` 是实际数据（可能是list或str）

**18个工具**:

| 服务器 | 工具名 | 功能 | 查询参数示例 |
|--------|--------|------|-------------|
| fund | `search_funds` | 自然语言搜索基金 | "沪深300ETF" |
| fund | `get_fund_profile` | 基金基本资料 | "000001" |
| fund | `get_fund_market_performance` | 行情与业绩 | "000001" |
| fund | `get_fund_ownership` | 份额与持有人 | "000001" |
| fund | `get_fund_portfolio` | 投资标的与配置 | "000001" |
| fund | `get_fund_financials` | 财务指标 | "000001" |
| fund | `get_fund_company_info` | 基金公司信息 | "华夏基金" |
| stock | `get_stock_summary` | 股票信息摘要 | "600519" |
| stock | `search_stocks` | 智能选股 | "贵州茅台" |
| stock | `get_stock_perfomance` | 历史行情与技术指标 | "600519" |
| stock | `get_stock_info` | 股票基本资料 | "600519" |
| stock | `get_stock_shareholders` | 股本与股东 | "600519" |
| stock | `get_stock_financials` | 财务数据与指标 | "600519" |
| stock | `get_risk_indicators` | 风险指标 | "600519" |
| stock | `get_stock_events` | 公开披露事件 | "600519" |
| stock | `get_esg_data` | ESG评级 | "600519" |
| edb | `get_macro_data` | 宏观经济数据 | "GDP" |
| news | `get_company_news` | 公司公告与新闻 | "600519" |

**Python调用**:
```python
from backend.app.data.providers.ifind_provider import iFinDProvider
p = iFinDProvider()
detail = p.get_fund_detail("000001")      # 基金详情(串行2次请求,6-10秒)
risk = p.get_risk_indicators("600519")     # 风险指标(唯一来源)
esg = p.get_esg_data("600519")             # ESG评级(唯一来源)
```

**独有数据**: 风险指标(volatility/sharpe/max_drawdown/calmar/sortino)、ESG评级、持有人结构

**性能**: 单次2-5秒，`get_fund_detail` 串行2次请求需6-10秒

**踩坑记录**:
- `get_stock_perfomance` 拼写少一个r，这是iFinD MCP的工具名，不是Bug
- 返回数据格式不统一：有时dict，有时str，有时list，`_parse_mcp_content` 已做适配
- 超时30秒，偶有超时
- `get_fund_detail` 内部串行调用 `get_fund_profile` + `get_fund_market_performance`，可优化为并行

---


### 2. Tushare Pro — 结构化金融数据（优先级4）
**更新日期**: 2026-06-14（基于公开文档）

**定位**: 用于基金/市场的结构化接口，覆盖基金基础、基金净值与分红、组合/管理人、财务与指数日线等，当前用于 Tushare 融合支路。

**鉴权与安装**
- 安装：`pip install tushare`
- 推荐在 `backend/.env` 配置 `TUSHARE_TOKEN`
- 初始化方式（SDK）：
  - `ts.set_token(os.getenv('TUSHARE_TOKEN', ''))` -> `ts.pro_api()`
  - `ts.pro_api('your-token')`
  - 若未传 token，`pro_api()` 会按持久化方式读取 `~/.tushare_token`
- 当前已知 `tushare` PyPI 版本：`1.4.29`（2026-03-25）

**调用流程（按本仓库现状）**
1. 先取 `pro = ts.pro_api()`
2. 通过 `pro.<api_name>(...)` 拉取字段
3. 对关键查询加 `fields` 精简返回列
4. 时间范围统一使用 `YYYYMMDD` 字符串

**关键接口对照**
- `pro.fund_basic(market='O'|'E', status='L', fields=...)`（分页：`limit + offset`）
- `pro.fund_nav(ts_code='000001.OF', start_date='20250101', end_date='20260614', fields='trade_date,unit_nav,accum_nav,adj_nav')`
- `pro.fund_share(ts_code='000001.OF', fields='trade_date,fd_share')`
- `pro.fund_adj(ts_code='000001.OF', fields='trade_date,adj_factor')`
- `pro.fund_div(ts_code='000001.OF', fields='ex_date,div_cash,pay_date,record_date,ann_date,imp_anndate,base_date')`
- `pro.fund_portfolio(ts_code='000001.OF')`
- `pro.fund_manager(ts_code='000001.OF')`
- `pro.fund_rating(ts_code='000001.OF')`
- `pro.trade_cal(exchange='SSE', start_date='20260601', end_date='20260614', fields='exchange,cal_date,is_open,pretrade_date')`
- `pro.index_daily(ts_code='000001.SH', ...)`
- `pro.fund_daily(ts_code='000001.OF', ...)`
- `ts.pro_bar(ts_code='600519.SH', asset='E', adj='qfq', freq='D', factors=['tor','vr'])`

**pro_bar 使用边界（当前代码可对齐）**
- `asset` 常用值：`E`（股票ETF）, `I`（指数）, `FD`（基金）, `O`（期权）, `FT`（期货）, `C`（数字货币）
- `freq` 常见：`1/5/15/30/60`、`W/M/Q/Y`
- `adj` 常见：`None`、`qfq`、`hfq`
- `retry_count` 建议保留默认（3）

**错误处理建议**
- 先校验 token 有效性和参数 `ts_code/date/freq`；
- `pro_bar`/`fund_*` 返回空表要进行回退而不是中断主链路；
- 分页建议 `limit` 结合接口容量分批（本项目 `get_fund_list` 实现以 `limit=15000` 调用，建议保守不再提升）。

**示例**
```python
import os
import tushare as ts

os.environ.setdefault('TUSHARE_TOKEN', os.getenv('TUSHARE_TOKEN', ''))
ts.set_token(os.getenv('TUSHARE_TOKEN', ''))
pro = ts.pro_api()

fund_basic_df = pro.fund_basic(
    market='O',
    status='L',
    fields='ts_code,name,fund_type,management,status,found_date,benchmark',
    limit=2000,
)

nav_df = pro.fund_nav(
    ts_code='000001.OF',
    start_date='20250101',
    end_date='20260614',
    fields='trade_date,unit_nav,accum_nav,adj_nav',
)

bar_df = ts.pro_bar(
    ts_code='000001.OF',
    start_date='20250101',
    end_date='20260614',
    asset='FD',
    adj='qfq',
    freq='D',
)

cal_df = pro.trade_cal(
    exchange='SSE',
    start_date='20260601',
    end_date='20260614',
    fields='exchange,cal_date,is_open,pretrade_date',
)
```
#### 2.4 实践建议（避免踩坑）

1. 统一 `ts_code` 归一化：基金优先 `.OF`，再按场内场外兜底。
2. 列字段拉取：优先显式 `fields`，避免空拉全量字段。
3. 分页拉取：`limit` + `offset` 取全量，减少单次包体和限流冲击。
4. 接口报错时，优先打印 `code/msg` 与请求参数后续排查。
5. 融合层遵循“单接口降级不中断”：Tushare 子项失败不应导致整条详情链路失败。

#### 2.5 快速验证模板（官方语义 + 项目字段）

```python
import os
import tushare as ts

os.environ.setdefault('TUSHARE_TOKEN', os.getenv('TUSHARE_TOKEN', ''))
ts.set_token(os.getenv('TUSHARE_TOKEN', ''))
pro = ts.pro_api()

fund_basic_df = pro.fund_basic(
    market='O',
    status='L',
    fields='ts_code,name,fund_type,management,status,found_date,benchmark',
    limit=2000,
)

nav_df = pro.fund_nav(
    ts_code='000001.OF',
    start_date='20250101',
    end_date='20260614',
    fields='trade_date,unit_nav,accum_nav,adj_nav',
)

cal_df = pro.trade_cal(
    exchange='SSE',
    start_date='20260601',
    end_date='20260614',
    fields='exchange,cal_date,is_open,pretrade_date',
)

assert cal_df is not None and cal_df.shape[0] >= 0
```

#### 2.6 参考链接（官方）

- 接口总览与参数示例：`https://www.tushare.pro/document/2?doc_id=109`
- 基金净值/份额/持仓/复权/分红：`https://www.tushare.pro/document/2?doc_id=119`、`.../document/2?doc_id=121`、`.../document/2?doc_id=207`
- 交易日历与返回字段：`https://www.tushare.pro/document/2?doc_id=40`、`https://www.tushare.pro/document/2?doc_id=27`

#### 2.7 排障与验收规范（建议照抄）

- 错误优先级：接口失败先看 `code` 再看 `msg`，避免先读空字段。
  - `code=0`: 成功
  - 非 0: 常见 `msg` 包含 `token is invalid`（Token 无效）或 `no sufficient`（积分/权限不足）或参数错误。
- 日期统一口径：`trade_date`、`ann_date`、`record_date`、`end_date`、`pretrade_date` 统一按 `YYYYMMDD` 存储和比较。
- 分页防护：所有列表类接口（如 `fund_basic`）优先 `limit+offset`，每次取数后 `assert 返回条数 <= limit`。
- 字段兼容：下游模型消费前先 `rename`/`assign` 缺省字段（如 `ts_code`、`trade_date`、`name`、`is_open`），并记录 `fallbacks`。

#### 2.8 简化自检脚本（建议本地快速跑）

```python
import os
import tushare as ts
import pandas as pd


def _need_series_df(resp, label, required_cols):
    if resp is None:
        raise RuntimeError(f"{label}: response is None")
    if isinstance(resp, (list, tuple)):
        raise RuntimeError(f"{label}: expect DataFrame-like, got list/tuple")
    if isinstance(resp, pd.DataFrame):
        df = resp
    else:
        # 兼容部分返回结构（极少数情况下）
        if not isinstance(resp, dict):
            raise RuntimeError(f"{label}: unsupported response type {type(resp)}")
        if int(resp.get("code", 0)) != 0:
            raise RuntimeError(f"{label}: tushare api failed - {resp.get('code')} {resp.get('msg')}")
        data = resp.get("data") or {}
        fields = data.get("fields") or []
        items = data.get("items") or []
        df = pd.DataFrame(items, columns=fields)
    missing = [c for c in required_cols if c not in df.columns]
    if missing:
        raise RuntimeError(f"{label}: missing fields {missing}")
    if df.empty:
        raise RuntimeError(f"{label}: empty data")
    return df


def run_tushare_smoke():
    token = os.getenv("TUSHARE_TOKEN") or os.getenv("TUSHARE_TOKEN_FILE") or ""
    if not token:
        raise RuntimeError("missing TUSHARE_TOKEN")
    ts.set_token(token)
    pro = ts.pro_api()

    basic = _need_series_df(
        pro.fund_basic(
            market="O",
            status="L",
            fields="ts_code,name,fund_type,management,status,found_date,benchmark",
            limit=10,
        ),
        "fund_basic",
        required_cols=["ts_code", "name"],
    )

    nav = _need_series_df(
        pro.fund_nav(
            ts_code="000001.OF",
            start_date="20260101",
            end_date="20260614",
            fields="trade_date,unit_nav,accum_nav,adj_nav",
        ),
        "fund_nav",
        required_cols=["trade_date", "unit_nav", "accum_nav"],
    )
    cal = _need_series_df(
        pro.trade_cal(
            exchange="SSE",
            start_date="20260601",
            end_date="20260614",
            fields="exchange,cal_date,is_open,pretrade_date",
        ),
        "trade_cal",
        required_cols=["cal_date", "is_open"],
    )

    for df, name in ((basic, "fund_basic"), (nav, "fund_nav"), (cal, "trade_cal")):
        print(name, "rows", len(df), "first", df.iloc[0].to_dict())


if __name__ == "__main__":
    run_tushare_smoke()
```

---

## TickFlow（99元/月）最新接入说明（按你当前权限）

- 当前 `tickflow` 已核对官方中文文档（`https://docs.tickflow.org/zh-Hans`）后，建议按以下方式接入：
- **免费服务**：可走 `https://free-api.tickflow.org`，仅支持 `1d/1w/1M/1Q/1Y` 日线、标的信息、标的池；不含实时行情与分钟线。
- **99元/月正式版**（推荐）：持有 `TICKFLOW_API_KEY` 后走正式服务，可用实时行情、分钟线（`1m/5m/15m/30m/60m`）、标的池、财务数据等。
- **额度速率（已对齐你给的套餐条目）**：
  - 实时行情：120/min，100标的/次
  - 标的池：60/min
  - 日线K线：按标的 120/min（1标的/次）、按标的池 60/min（100标的/次）
  - 分钟K线：按标的 60/min（1标的/次）、批量 30/min（100标的/次）
  - 日内分时：30/min（1标的/次）
  - 市场深度：60/min（1标的/次）
  - 除权因子：60/min（100标的/次）
  - TickFlow 单次分钟K线建议不超过 `5000` 根；日内可按 `365` 天做窗口。

### TickFlow 官方接入（SDK）

- 安装：`pip install "tickflow[all]" --upgrade`
- `x-api-key` 认证 / 无 key 体验：
```python
from tickflow import TickFlow
import os

# 99元套餐
tf = TickFlow(api_key=os.getenv("TICKFLOW_API_KEY"))

# 仅临时调试
tf = TickFlow.free()
```
- 标的格式：`代码.市场后缀`（如 `600000.SH`、`000001.SZ`、`AAPL.US`、`00700.HK`）
- 统一 API 版本前缀：`https://api.tickflow.org/v1`

### Tushare 最新调用指引

- 安装：`pip install tushare`
- 初始化：
```python
import tushare as ts
ts.set_token("your-token")
pro = ts.pro_api()
```
- 或直接 `pro = ts.pro_api("your-token")`
- 常用 `pro.xxx`：
  - `fund_basic`、`fund_nav`、`fund_share`、`fund_adj`
  - `fund_portfolio`、`fund_manager`、`fund_div`
  - `trade_cal(exchange=..., start_date=YYYYMMDD, end_date=YYYYMMDD)`
- 常见配置：优先使用 `TUSHARE_TOKEN`，无 token 回退到 `~/.tushare_token`。

### 项目落地建议（与现有代码结合）

- 统一配置：`.env` 中设置 `TICKFLOW_API_KEY` + `TICKFLOW_API_LEVEL=paid`，`TUSHARE_TOKEN`。
- 本项目优先链路建议：`TushareProvider(priority=4)`、`iFinDProvider`、`TickflowProvider(priority=3)`，TickFlow 用于 ETF/实时行情与分钟线场景，Tushare 做基金治理与补充。
- 当需要大量补历史时，优先用带分页/批量参数的接口，命中失败时做重试 + 延时降级，避免 429。

### 3. TickFlow — 行情数据（优先级3）

**定位**: 行情数据源，专注A股/ETF/美股/港股的实时行情和历史K线，速度最快。支持免费服务（仅历史日K/标的信息/交易所/标的池）和付费服务（实时行情、A股/ETF分钟K、日内分时、五档行情、除权因子）。

**认证**: API Key，`backend/.env` 的 `TICKFLOW_API_KEY`（当前已开通月度99元付费权限）

**调用方式**: `tickflow` Python SDK，`TickFlow(api_key=...)` / `TickFlow()`（自动读取 `TICKFLOW_API_KEY`）或 `TickFlow.free()`；HTTP API 使用 `x-api-key` 请求头。完整服务地址 `https://api.tickflow.org`，免费服务地址 `https://free-api.tickflow.org`。

**当前99元月度权限**:

| 能力 | 查询方式 | 频率/容量 | 说明 |
|------|----------|-----------|------|
| 分钟K线 | 批量查询 | 30/min，100标的/次 | 历史分钟K，周期 `1m/5m/15m/30m/60m` |
| 分钟K线 | 按标的查询 | 60/min，1标的/次，最多5000条K线 | 最长365天历史，仅A股/ETF分钟级 |
| 日内分时 | 按标的查询 | 30/min，1标的/次 | 当日分钟K，官方标注 intraday 接口为 Beta |
| 市场深度（五档行情） | 按标的查询 | 60/min，1标的/次 | REST `/v1/depth` 单标的；WebSocket `depth` 频道需市场深度权限 |
| 除权因子 | 按标的查询 | 60/min，100标的/次 | REST `/v1/klines/ex-factors`，支持批量 symbols |

**代码格式**: `600000.SH`(上交所)、`000001.SZ`(深交所)、`AAPL.US`(美股)、`00700.HK`(港股)

**支持市场**:

| 后缀 | 市场 | 说明 |
|------|------|------|
| SH | 上海证券交易所 | 沪市A股、ETF、债券等 |
| SZ | 深圳证券交易所 | 深市A股、创业板、ETF等 |
| BJ | 北京证券交易所 | 北交所股票 |
| SHF | 上海期货交易所 | 上期所期货 |
| DCE | 大连商品交易所 | 大商所期货 |
| ZCE | 郑州商品交易所 | 郑商所期货 |
| CFX | 中国金融期货交易所 | 中金所股指/国债期货 |
| INE | 上海国际能源交易中心 | 原油等期货 |
| GFE | 广州期货交易所 | 广期所期货 |
| US | 美股 | 美国证券市场 |
| HK | 港股 | 香港联交所 |

**标的池 (Universe)**:

| 标的池ID | 说明 |
|----------|------|
| `CN_Equity_A` | 沪深A股 |
| `CN_ETF` | 沪深ETF |
| `CN_Index` | 沪深指数 |
| `US_Equity` | 美股 |
| `HK_Equity` | 港股 |

**接口**:

| 接口方法 | 功能 | 参数示例 | 支持范围 |
|----------|------|----------|----------|
| `tf.klines.get(symbol, period, count)` | K线数据 | "600000.SH", "1d", 10000 | A股/美股/港股 |
| `tf.klines.batch(symbols, period, count)` | 批量K线 | ["600000.SH", "000001.SZ"] | A股/美股/港股 |
| `tf.klines.get(symbol, period="1m", count=...)` | 历史分钟K线 | "600000.SH", "1m", 5000 | A股/ETF，最长365天 |
| `tf.klines.batch(symbols, period="1m", count=...)` | 批量分钟K线 | `batch_size`（默认100） + `symbols` | A股/ETF | 100标的/次，30/min |
| `tf.klines.intraday(symbol, period="1m")` | 当日分钟K线/日内分时 | "600000.SH", "1m" | A股/ETF，Beta |
| HTTP `/v1/klines/intraday/batch` | 批量当日分钟K线 | 逗号分隔 symbols | A股/ETF |
| `tf.klines.ex_factors(symbols)` | 除权因子 | ["600000.SH", "000001.SZ"] | A股/美股/港股日线复权 |
| `tf.quotes.get(symbols)` | 实时行情 | ["600000.SH", "AAPL.US"] | A股/美股/港股 |
| `tf.quotes.get(universes=["CN_Equity_A"])` | 全市场行情 | universes | 需付费权限 |
| HTTP `/v1/depth` / WebSocket `depth`频道 | 五档行情 | "600000.SH" | 单标的，60/min |
| `tf.instruments.get(symbol)` | 标的信息 | "600000.SH" | A股/美股/港股 |
| `tf.instruments.batch(symbols)` | 批量标的信息 | ["600000.SH", "AAPL.US"] | A股/美股/港股 |
| `tf.exchanges.get_instruments("SH")` | 交易所全部标的 | "SH"/"SZ"/"US"/"HK" | 按交易所 |
| `tf.universes.list()` | 列出所有标的池 | - | - |
| `tf.universes.get("CN_Equity_A")` | 获取标的池详情 | "CN_Equity_A" | 含全部标的代码 |
| `tf.financials.income([symbol])` | 利润表 | ["600000.SH"] | A股 |
| `tf.financials.balance([symbol])` | 资产负债表 | ["600000.SH"] | A股 |
| `tf.financials.cashflow([symbol])` | 现金流量表 | ["600000.SH"] | A股 |
| `tf.financials.shares([symbol])` | 股本表 | ["600000.SH"] | A股 |
| `tf.financials.core_metrics([symbol])` | 核心财务指标 | ["600000.SH"] | A股 |

**K线周期**:

| 周期 | A股 | 美股/港股 |
|------|-----|----------|
| 1d (日线) | ✅ | ✅ |
| 1w/1M/1Q/1Y | ✅ | ✅ |
| 1m/5m/15m/30m/60m | ✅（当前付费权限已解锁） | ❌ |

**HTTP API端点速查**:

| 端点 | 方法 | 功能 | 关键参数 |
|------|------|------|----------|
| `/v1/klines` | GET | 单标的K线/历史分钟K | `symbol`, `period`, `count`, `start_time`, `end_time`, `adjust` |
| `/v1/klines/batch` | GET | 批量K线/批量分钟K | `symbols`, `period`, `count`, `start_time`, `end_time`, `adjust` |
| `/v1/klines/intraday` | GET | 单标的当日分钟K | `symbol`, `period`, `count` |
| `/v1/klines/intraday/batch` | GET | 批量当日分钟K | `symbols`, `period`, `count` |
| `/v1/klines/ex-factors` | GET | 除权因子 | `symbols`, `start_time`, `end_time` |
| `/v1/depth` | GET | 市场深度/五档行情 | `symbol`（仅单标的） |
| `/v1/quotes` | GET/POST | 实时行情 | `symbols` 或 `universes` |

**复权方式**:

| adjust参数 | 说明 | 适用场景 |
|-----------|------|---------|
| `forward` | 比例前复权（默认） | 收益率计算、量化回测 |
| `forward_additive` | 差值前复权 | 与东方财富/同花顺价格对齐 |
| `backward` | 比例后复权 | 长期收益对比 |
| `backward_additive` | 差值后复权 | 与行情软件后复权价格对齐 |
| `none` | 不复权 | 原始价格 |

**标的信息返回字段**:

```python
{
    "symbol": "600000.SH",
    "exchange": "SH",
    "code": "600000",
    "name": "浦发银行",
    "region": "CN",
    "type": "stock",
    "ext": {
        "type": "cn_equity",
        "listing_date": "1999-11-10",
        "total_shares": 33305838300.0,
        "float_shares": 33305838300.0,
        "tick_size": 0.01,
        "limit_up": 9.85,      # 涨停价
        "limit_down": 8.06     # 跌停价
    }
}
```

**Python调用**:
```python
from tickflow import TickFlow

# 免费服务（仅日K，无需API Key）
tf_free = TickFlow.free()
df = tf_free.klines.get("600000.SH", period="1d", count=100, as_dataframe=True)

# 完整服务（自动读取 backend/.env 中的 TICKFLOW_API_KEY）
tf = TickFlow()

# 获取A股、美股、港股实时行情
quotes = tf.quotes.get(symbols=["600000.SH", "AAPL.US", "00700.HK"], as_dataframe=True)

# 一次性获取全部A股行情（需付费权限）
a_quotes = tf.quotes.get(universes=["CN_Equity_A"], as_dataframe=True)

# 获取日K线
df = tf.klines.get("600000.SH", period="1d", count=10000, as_dataframe=True)

# 获取分钟K线
df = tf.klines.get("600000.SH", period="1m", count=5000, as_dataframe=True)

# 批量获取分钟K线（当前99元权限：30/min，100标的/次）
dfs = tf.klines.batch(["600000.SH", "000001.SZ"], period="1m", count=5000, as_dataframe=True)

# 获取当日分钟K线
df = tf.klines.intraday("600000.SH", as_dataframe=True)

# 获取除权因子
factors = tf.klines.ex_factors(["600000.SH", "000001.SZ"], as_dataframe=True)

# 批量获取标的信息
insts = tf.instruments.batch(["600000.SH", "000001.SZ", "AAPL.US", "00700.HK"])

# 获取交易所全部标的
symbols = tf.exchanges.get_instruments("SH")

# 获取标的池详情
universe = tf.universes.get("CN_Equity_A")
print(f"A股共 {len(universe['symbols'])} 只")
```

**HTTP API调用**:
```bash
# 免费服务：获取历史日K线（无需API Key）
curl "https://free-api.tickflow.org/v1/klines?symbol=600000.SH&period=1d"

# 完整服务：获取实时行情
curl -H "x-api-key: $TICKFLOW_API_KEY" \
  "https://api.tickflow.org/v1/quotes?symbols=600000.SH,AAPL.US,00700.HK"

# 获取A股日K线
curl -H "x-api-key: $TICKFLOW_API_KEY" \
  "https://api.tickflow.org/v1/klines?symbol=600000.SH&period=1d"

# 获取A股/ETF历史分钟K线（当前99元权限：1m/5m/15m/30m/60m，最多5000条）
curl -H "x-api-key: $TICKFLOW_API_KEY" \
  "https://api.tickflow.org/v1/klines?symbol=600000.SH&period=1m&count=5000"

# 批量获取历史分钟K线（当前99元权限：30/min，100标的/次）
curl -H "x-api-key: $TICKFLOW_API_KEY" \
  "https://api.tickflow.org/v1/klines/batch?symbols=600000.SH,000001.SZ&period=5m&count=5000"

# 获取当日分钟K线/日内分时（Beta）
curl -H "x-api-key: $TICKFLOW_API_KEY" \
  "https://api.tickflow.org/v1/klines/intraday?symbol=600000.SH&period=1m"

# 一次性获取全部A股行情（需付费权限）
curl -H "x-api-key: $TICKFLOW_API_KEY" \
  "https://api.tickflow.org/v1/quotes?universes=CN_Equity_A"

# 获取除权因子
curl -H "x-api-key: $TICKFLOW_API_KEY" \
  "https://api.tickflow.org/v1/klines/ex-factors?symbols=600000.SH,000001.SZ"

# 获取市场深度（五档行情）
curl -H "x-api-key: $TICKFLOW_API_KEY" \
  "https://api.tickflow.org/v1/depth?symbol=600000.SH"

# 获取标的信息
curl -H "x-api-key: $TICKFLOW_API_KEY" \
  "https://api.tickflow.org/v1/instruments?symbols=600000.SH"
```

**WebSocket 实时推送**:

TickFlow 提供 WebSocket 实时行情推送，需包含 WebSocket 实时行情的套餐或单独开启；市场深度频道还需要「市场深度」权限。当前99元月度权限已包含 REST 五档行情，是否包含 WebSocket quotes/depth 以控制台权限为准。

| 接口 | 地址 | 说明 |
|------|------|------|
| 统一推送（推荐） | `wss://api.tickflow.org/v1/ws/stream` | 按频道订阅，支持 quotes 和 depth |
| 行情推送（旧版） | `wss://api.tickflow.org/v1/ws/quotes` | 仅推送行情数据 |

**WebSocket 订阅命令**:
```python
import asyncio
import json
import websockets

API_KEY = "your-api-key"
URL = f"wss://api.tickflow.org/v1/ws/stream?api_key={API_KEY}"

async def main():
    async with websockets.connect(URL) as ws:
        # 订阅行情
        await ws.send(json.dumps({
            "op": "subscribe",
            "channel": "quotes",
            "symbols": ["600000.SH", "000001.SZ"]
        }))
        # 订阅五档盘口
        await ws.send(json.dumps({
            "op": "subscribe",
            "channel": "depth",
            "symbols": ["600000.SH"]
        }))

        async for raw in ws:
            msg = json.loads(raw)
            if msg["op"] == "quotes":
                for q in msg["data"]:
                    print(f"{q['symbol']}: {q['last_price']}")
            elif msg["op"] == "depth":
                for d in msg["data"]:
                    print(f"[盘口] {d['symbol']} 买1:{d['bid_prices'][0]} 卖1:{d['ask_prices'][0]}")
            elif msg["op"] == "error":
                print(f"错误: {msg['message']}")

asyncio.run(main())
```

**Python SDK WebSocket 封装**:
```python
from tickflow import TickFlow

tf = TickFlow()
stream = tf.stream

@stream.on_quotes
def on_quotes(quotes):
    for q in quotes:
        print(f"{q['symbol']}: {q['last_price']}")

@stream.on_depth
def on_depth(depths):
    for d in depths:
        print(f"[盘口] {d['symbol']} 买1:{d['bid_prices'][0]}×{d['bid_volumes'][0]}")

@stream.on_error
def on_error(msg):
    print(f"错误: {msg}")

stream.subscribe("quotes", ["600000.SH", "000001.SZ"])
stream.subscribe("depth", ["600000.SH"])
stream.connect()  # 阻塞直到 close() 或 Ctrl+C

# 非阻塞模式
stream.connect(block=False)
stream.subscribe("quotes", ["AAPL.US"])  # 动态追加订阅
```

**WebSocket 消息格式**:

行情推送 (`quotes`):
```json
{
    "op": "quotes",
    "data": [{
        "symbol": "600000.SH",
        "region": "CN",
        "last_price": 9.72,
        "prev_close": 9.78,
        "open": 9.78,
        "high": 9.78,
        "low": 9.68,
        "volume": 426585,
        "amount": 422430500,
        "timestamp": 1776754802000,
        "ext": {
            "type": "cn_equity",
            "name": "浦发银行",
            "change_pct": -0.006135,
            "change_amount": -0.06,
            "amplitude": 0.010225,
            "turnover_rate": 0.001281
        }
    }]
}
```

市场深度推送 (`depth`):
```json
{
    "op": "depth",
    "data": [{
        "symbol": "600000.SH",
        "region": "CN",
        "timestamp": 1776754802000,
        "bid_prices": [9.72, 9.71, 9.7, 9.69, 9.68],
        "bid_volumes": [3192, 3870, 26168, 5849, 5480],
        "ask_prices": [9.73, 9.74, 9.75, 9.76, 9.77],
        "ask_volumes": [74, 1602, 1148, 1209, 1109]
    }]
}
```

**独有数据**: 美股/港股实时行情、A股/ETF历史分钟K线、日内分时、五档行情、除权因子、WebSocket实时推送

**性能/限制**: 历史分钟K单标的最多5000条、365天历史；批量分钟K 30/min、100标的/次；单标的分钟K 60/min；日内分时 30/min；五档行情 60/min；除权因子 60/min、100标的/次。实时行情通常<1秒，WebSocket适合低延迟连续推送。

**踩坑记录**:
- 免费版仅支持历史日K线、标的信息、交易所、标的池，不支持实时行情和分钟K线
- 当前99元权限解锁分钟K线、日内分时、市场深度（五档行情）和除权因子；不要再按旧的 Starter 49元权限判断
- 分钟K周期为 `1m/5m/15m/30m/60m`，其中 `5m/15m/30m/60m` 由1分钟数据聚合
- 美股/港股支持实时行情、全量历史日K和复权/除权因子；分钟K线目前仅A股/ETF侧使用
- HTTP API 认证头是 `x-api-key`，不是 `Authorization: Bearer`
- HTTP 除权因子端点是 `/v1/klines/ex-factors`（连字符），不要写成 `ex_factors`
- 批量接口自动分批并发，默认每批100个标的
- SDK内置智能重试机制（指数退避），默认重试3次
- 生产环境推荐 `TICKFLOW_API_KEY` + `TICKFLOW_BASE_URL=https://api.tickflow.org`，SDK 可用 `TickFlow()` 自动读取环境变量
- 使用 `with TickFlow() as tf:` 确保资源正确释放
- WebSocket 为额外权限项；REST 五档行情可用不代表 WebSocket `depth` 频道一定可用
- 连接断开后所有订阅自动清除，重连后需重新发送 subscribe
- 服务端每30秒发送一次 Ping 帧，客户端需回复 Pong 帧（大多数库自动处理）

---

### 4. 腾讯财经 — 实时行情（优先级2）

**定位**: 免费实时行情源，毫秒级响应，适合获取基金最新净值。

**认证**: 无需

**调用方式**: HTTP GET，GBK编码响应

**接口URL**: `https://qt.gtimg.cn/q=jj{code}`（前缀必须是 `jj`，不是 `fu`）

**返回格式**: `v_jj{code}="{code}~{name}~{nav}~{accum_nav}~~{prev_nav}~{prev_accum_nav}~{day_growth}~{date}~"`

**字段索引(0-based, `~`分隔)**:

| 索引 | 字段 | 示例 | 说明 |
|------|------|------|------|
| 0 | code | 000001 | 基金代码 |
| 1 | name | 华夏成长 | 基金名称(GBK编码) |
| 2 | nav | 0.0000 | 当前净值(非交易时段为0) |
| 3 | accum_nav | 0.0000 | 当前累计净值(非交易时段为0) |
| 4 | (空) | | 保留字段 |
| 5 | prev_nav | 1.2510 | 昨日单位净值 |
| 6 | prev_accum_nav | 3.8240 | 昨日累计净值 |
| 7 | day_growth | 0.4013 | 日增长率(%) |
| 8 | date | 2026-05-18 | 净值日期 |

**接口**:

| 接口方法 | 功能 | 参数示例 | 支持范围 |
|----------|------|----------|----------|
| `get_fund_detail(code)` | 实时行情 | "000001" | 场外基金+ETF |
| `get_fund_list()` | 不支持 | - | 返回空[] |
| `get_fund_nav()` | 不支持 | - | 返回空[] |
| `get_fund_holdings()` | 不支持 | - | 返回空[] |

**Python调用**:
```python
from backend.app.data.providers.tencent_provider import TencentProvider
p = TencentProvider()
detail = p.get_fund_detail("000001")    # 场外基金实时行情
detail = p.get_fund_detail("510050")    # ETF实时行情
```

**独有数据**: 毫秒级实时净值（非交易时段自动回退昨日净值）

**性能**: <100ms

**踩坑记录**:
- 前缀必须用 `jj`（`fu` 返回 `v_pv_none_match="1"`，完全不可用）
- 分隔符是 `~`（不是逗号）
- 非交易时段当前净值字段为0，代码自动回退使用昨日净值(prev_nav)
- 响应编码为GBK，需用 `decode("gbk", errors="ignore")`
- 批量查询: `https://qt.gtimg.cn/q=jj000001,jj110011`

---

### 5. AkShare — 开源金融数据（Fetcher层）

**定位**: 开源免费数据源，Python SDK 提供 200+ 个接口，覆盖股票/基金/期货/债券/期权/外汇/宏观/指数等全品类金融数据。数据来自东方财富、新浪财经、同花顺、腾讯财经等公开源。

**认证**: 无需

**调用方式**: `akshare` Python SDK，`pip install akshare`

**数据覆盖**:

| 数据类别 | 代表接口 | 数据来源 | 说明 |
|----------|----------|----------|------|
| A股实时行情 | `stock_zh_a_spot_em` | 东方财富 | 全市场A股实时行情 |
| A股历史行情 | `stock_zh_a_daily` | 新浪/腾讯/东方财富 | 日K/分钟K |
| 港股实时行情 | `stock_hk_spot_em` | 东方财富 | 港股主板实时行情 |
| 美股行情 | `stock_us_spot` | 新浪 | 美股实时报价 |
| 指数行情 | `stock_zh_index_spot_em` | 东方财富 | 沪深京指数实时行情 |
| 指数历史 | `stock_zh_index_daily` | 新浪 | 指数日K历史数据 |
| 基金基本信息 | `fund_name_em` | 天天基金网 | 全市场基金列表 |
| 基金实时行情 | `fund_etf_spot_em` | 东方财富 | ETF实时行情(含IOPV) |
| 基金排行 | `fund_em_open_fund_ranking` | 天天基金网 | 开放式基金排行 |
| 基金净值 | `fund_open_fund_info_em` | 天天基金网 | 历史净值 |
| 期货数据 | `futures_zh_spot` | 新浪 | 国内期货实时行情 |
| 宏观数据 | `macro_china_gdp_yearly` | 金十数据/东方财富 | GDP/CPI/PPI/PMI等 |
| 债券数据 | `bond_debt_nafmii` | 银行间市场 | 债务融资工具 |
| 期权数据 | `option_finance_board` | 上交所 | 金融期权数据 |
| 外汇数据 | `get_fx_spot_quote` | 中国外汇交易中心 | 人民币外汇报价 |
| 加密货币 | `crypto_js_spot` | 聚合源 | 主流加密货币行情 |
| 申万行业 | `sw_index_third_info` | 申万宏源 | 申万三级行业信息 |
| 机构调研 | `stock_jgdy_tj_em` | 东方财富 | 机构调研统计 |
| 股权质押 | `stock_gpzy_profile_em` | 东方财富 | 股权质押市场概况 |
| 商誉数据 | `stock_sy_profile_em` | 东方财富 | A股商誉市场概况 |

**项目核心接口分类**:

#### A. 股票数据接口

| 接口函数 | 功能 | 参数示例 | 数据来源 |
|----------|------|----------|----------|
| `stock_sse_summary()` | 上交所市场总貌 | - | 上交所官网 |
| `stock_szse_summary(date)` | 深交所市场总貌 | date="20200619" | 深交所官网 |
| `stock_individual_info_em(symbol)` | 个股信息(东财) | symbol="000001" | 东方财富 |
| `stock_zh_a_spot_em` | A股实时行情(东财) | - | 东方财富 |
| `stock_zh_a_spot_tx` | A股实时行情(腾讯) | - | 腾讯财经 |
| `stock_zh_a_daily` | A股历史日K | symbol="000001" | 新浪 |
| `stock_zh_a_minute` | A股分钟K线 | symbol="000001" | 新浪 |
| `stock_zh_kcb_spot` | 科创板实时行情 | - | 新浪 |
| `stock_zh_b_spot_em` | B股实时行情 | - | 东方财富 |
| `stock_new_a_spot_em` | 新股实时行情 | - | 东方财富 |

#### B. 基金数据接口

| 接口函数 | 功能 | 参数示例 | 数据来源 |
|----------|------|----------|----------|
| `fund_name_em()` | 全市场基金列表 | - | 天天基金网 |
| `fund_info_ths(symbol)` | 基金基本信息(同花顺) | symbol="161130" | 同花顺 |
| `fund_individual_basic_info_xq(symbol)` | 基金基本信息(雪球) | symbol="000001" | 雪球 |
| `fund_info_index_em(symbol, indicator)` | 指数型基金信息 | symbol="沪深指数" | 天天基金网 |
| `fund_purchase_em()` | 基金申购状态 | - | 天天基金网 |
| `fund_etf_spot_em()` | ETF实时行情 | - | 东方财富 |
| `fund_etf_category_ths(symbol, date)` | ETF分类行情(同花顺) | symbol="ETF" | 同花顺 |
| `fund_open_fund_info_em(fund, start, end)` | 开放式基金净值 | fund="000001" | 天天基金网 |
| `fund_em_open_fund_ranking()` | 开放式基金排行 | - | 天天基金网 |
| `fund_em_money_fund_ranking()` | 货币型基金排行 | - | 天天基金网 |
| `fund_em_lcx_ranking()` | 理财型基金排行 | - | 天天基金网 |

#### C. 指数数据接口

| 接口函数 | 功能 | 参数示例 | 数据来源 |
|----------|------|----------|----------|
| `stock_zh_index_spot_em` | 指数实时行情(东财) | symbol="上证系列指数" | 东方财富 |
| `stock_zh_index_spot_sina` | 指数实时行情(新浪) | - | 新浪财经 |
| `stock_zh_index_daily` | 指数历史日K(新浪) | symbol="sz399552" | 新浪 |
| `stock_zh_index_daily_tx` | 指数历史日K(腾讯) | symbol="sh000001" | 腾讯 |
| `stock_zh_index_daily_em` | 指数历史日K(东财) | symbol="sz399812" | 东方财富 |
| `index_zh_a_hist` | 指数历史行情(通用) | symbol="399282" | 东方财富 |
| `index_zh_a_hist_min_em` | 指数分钟K线 | symbol="399006" | 东方财富 |
| `index_stock_cons` | 指数成份股 | symbol="000300" | 新浪 |
| `index_stock_cons_csindex` | 中证指数成份股 | symbol="000300" | 中证指数 |
| `sw_index_third_info` | 申万三级行业信息 | - | 申万宏源 |

#### D. 宏观数据接口

| 接口函数 | 功能 | 数据来源 |
|----------|------|----------|
| `macro_cnbs()` | 中国宏观杠杆率 | 国家金融与发展实验室 |
| `macro_china_gdp_yearly()` | 中国GDP年率 | 金十数据 |
| `macro_china_cpi_yearly()` | 中国CPI年率 | 金十数据 |
| `macro_china_cpi_monthly()` | 中国CPI月率 | 金十数据 |
| `macro_china_ppi_yearly()` | 中国PPI年率 | 金十数据 |
| `macro_china_pmi_yearly()` | 中国制造业PMI | 金十数据 |
| `macro_china_lpr()` | 中国LPR利率 | 东方财富 |
| `macro_china_shrzgm()` | 社会融资规模增量 | 商务部 |
| `macro_china_urban_unemployment()` | 城镇调查失业率 | 国家统计局 |
| `macro_usa_gdp_monthly()` | 美国GDP | 金十数据 |
| `macro_usa_cpi_monthly()` | 美国CPI月率 | 金十数据 |
| `macro_bank_usa_interest_rate()` | 美联储利率决议 | 金十数据 |

**项目封装接口（6个）**:

| 函数 | 功能 | 参数 | 返回数据 |
|------|------|------|----------|
| `get_fund_ranking(fund_type)` | 基金排名 | "全部"/"股票型"/"混合型"等 | code/name/nav/day_growth/near_1w/1m/3m/6m/1y/3y/ytd/since_inception |
| `get_fund_info(code)` | 基金基本信息 | "000001" | 键值对dict |
| `get_fund_manager_info(code)` | 基金经理 | "000001" | name/tenure_days/best_fund |
| `get_fund_portfolio(code)` | 基金持仓 | "000001" | stock_holdings: [{name,code,ratio}] |
| `get_fund_industry_board()` | 行业板块 | 无 | 行业板块列表(前20) |
| `get_market_index()` | 市场指数 | 无 | 上证/深证/创业板 |

**Python调用**:
```python
import akshare as ak
from backend.app.data.akshare_fetcher import get_fund_ranking, get_fund_portfolio

# AKShare 原生接口
stock_df = ak.stock_zh_a_spot_em()           # 全市场A股实时行情
fund_df = ak.fund_name_em()                  # 全市场基金列表
index_df = ak.stock_zh_index_spot_em(symbol="上证系列指数")  # 指数实时行情

# 项目封装接口
ranking = get_fund_ranking("混合型")           # 基金排名
holdings = get_fund_portfolio("000001")     # 基金持仓(自动适配最新报告期)
```

**独有数据**: 基金排名（含完整各阶段收益）、行业板块、全市场A股实时行情、ETF实时行情(含IOPV)、宏观数据(GDP/CPI/PPI/PMI/LPR)

**性能**: 3-10秒（爬虫方式，受网站限速影响）

**踩坑记录**:
- 依赖网页爬虫，接口可能随网站改版失效
- `get_fund_portfolio` 自动尝试当前年/前1年/前2年的报告期
- `get_fund_manager_info` 从全市场经理列表中筛选，效率较低
- AKShare 原生接口返回字段可能随版本更新变化，需关注版本兼容性

---

### 6. 东方财富 — Web API（Fetcher层）

**定位**: Web爬虫数据源，唯一提供盘中实时估值的来源。

**认证**: 无需

**调用方式**: HTTP GET，JSONP格式响应

**3个接口**:

| 函数 | 功能 | URL | 返回数据 |
|------|------|-----|----------|
| `get_fund_detail_em(code)` | 基金估值详情 | `https://fundgz.1702.com/js/{code}.js` | code/name/nav(估值)/nav_date/day_growth |
| `get_fund_ranking_em(fund_type, sort_by)` | 基金排名 | `rankhandler.aspx?...` | code/name/type/nav/day_growth/near_1w~3y/ytd |
| `get_fund_manager_em(code)` | 基金经理 | `fund.eastmoney.com/manager/{code}.html` | 仅返回HTML长度(未解析) |

**Python调用**:
```python
from backend.app.data.eastmoney_fetcher import get_fund_detail_em, get_fund_ranking_em
detail = get_fund_detail_em("000001")              # 盘中实时估值(唯一来源)
ranking = get_fund_ranking_em("混合型", sort_by="3nzf")  # 按近3月收益排序
```

**独有数据**: 盘中实时估值（fundgz接口，交易时间内每分钟更新）

**性能**: 1-3秒

**踩坑记录**:
- 估值接口(fundgz)仅在交易时间内有实时数据
- 排名接口返回格式特殊（`var rankData=...`），已做解析
- `get_fund_manager_em` 仅返回HTML长度，未做结构化解析（P3待优化）
- sort_by参数: `1yzf`(近1月)/`3yzf`(近3月)/`6yzf`(近6月)/`1nzf`(近1年)/`3nzf`(近3年)

---

### 7. efinance — 基金净值与定投（Fetcher层）

**定位**: 开源免费数据源，唯一提供定投回测计算的数据源。

**认证**: 无需

**调用方式**: `efinance` Python SDK

**3个接口**:

| 函数 | 功能 | 参数 | 返回数据 |
|------|------|------|----------|
| `get_fund_nav_history(code, start, end)` | 历史净值 | "000001" | [{code,date,nav,acc_nav,day_growth}] |
| `get_fund_names(codes)` | 批量基金名称 | ["000001","510300"] | {code:name} |
| `calculate_dca_backtest(code, amount, frequency, strategy, start, end, ma_window)` | 定投回测 | 见下方 | 见下方 |

**定投回测参数**: code(必填), amount=1000, frequency="monthly"/"weekly", strategy="fixed"/"ma"/"compare", start_date, end_date, ma_window=200

**定投回测返回**: strategy, start_date, end_date, years, total_invested, total_value, total_profit, total_profit_rate(%), annual_return(%), max_drawdown(%), trade_count, nav_curve(最近60点)

**均线偏离策略规则**: 低于均线>10%投1.5x，5-10%投1.2x，高于均线>10%投0.5x，5-10%投0.8x，否则1.0x

**Python调用**:
```python
from backend.app.data.efinance_fetcher import get_fund_nav_history, calculate_dca_backtest
navs = get_fund_nav_history("000001", start_date="2024-01-01")
result = calculate_dca_backtest("000001", amount=1000, strategy="compare", start_date="2023-01-01")
```

**独有数据**: 定投回测计算（固定金额/均线偏离/对比策略）

**性能**: 3-8秒（净值数据量大）

---

### 8. NeoData (neodata-financial-search skill) — 自然语言搜索

**定位**: 平台内置Skill，自然语言查询金融数据，覆盖A股/港股/美股/宏观/外汇/商品。

**认证**: Skill内置，无需额外配置

**调用方式**: `use_skill("neodata-financial-search")` 加载后使用自然语言查询

**覆盖范围**: 基金净值、股票行情(A股/港股/美股)、宏观经济(GDP/CPI/PPI/PMI)、外汇、贵金属、大宗商品、板块/指数

**独有数据**: 港股/美股实时行情、自然语言查询

**性能**: 1-3秒

**典型限制**:
- 公募基金主要覆盖中国境内基金，不覆盖香港基金
- 板块/指数基础、板块资金和估值主要覆盖A股
- 不适合批量结构化数据获取（如全市场基金列表）

---

### 9. westock-data skill — 结构化行情

**定位**: 平台内置Skill，腾讯自选股结构化行情数据，命令行调用。

**认证**: Skill内置，无需额外配置

**调用方式**: 命令行 `westock-data <command> [args]`

**代码格式**: `sh600519`(沪市)/`sz000001`(深市)/`hk00700`(港股)/`usAAPL`(美股)

**23个命令**:

| 命令 | 功能 | 示例 |
|------|------|------|
| `search` | 搜索股票/ETF/指数 | `westock-data search 沪深300ETF` |
| `quote` | 实时行情 | `westock-data quote sh600519` |
| `kline` | K线数据 | `westock-data kline sh600519 --period day --limit 20` |
| `minute` | 分时数据 | `westock-data minute sh600519` |
| `finance` | 财务报表 | `westock-data finance sh600519 --num 4` |
| `profile` | 公司简况 | `westock-data profile sh600519` |
| `asfund` | A股资金流向 | `westock-data asfund sh600519` |
| `hkfund` | 港股资金 | `westock-data hkfund hk00700` |
| `usfund` | 美股卖空 | `westock-data usfund usAAPL` |
| `technical` | 技术指标 | `westock-data technical sh600519 --group macd` |
| `chip` | 筹码成本 | `westock-data chip sh600519` |
| `shareholder` | 股东结构 | `westock-data shareholder sh600519` |
| `etf` | ETF详情 | `westock-data etf sh510300` |
| `etf-holdings` | ETF持仓 | `westock-data etf-holdings sh510300` |
| `sector` | 板块搜索 | `westock-data sector --search 新能源` |
| `hot` | 热搜 | `westock-data hot stock` |
| `macro` | 宏观经济 | `westock-data macro --indicator gdp --year 2025` |
| `lhb` | 龙虎榜 | `westock-data lhb sz000001` |
| `blocktrade` | 大宗交易 | `westock-data blocktrade sz000001` |
| `margintrade` | 融资融券 | `westock-data margintrade sz000001` |
| `dividend` | 分红数据 | `westock-data dividend sh600519` |
| `reserve` | 业绩预告 | `westock-data reserve sh600519` |
| `calendar` | 投资日历 | `westock-data calendar 2026-04-22` |
| `ipo` | 新股日历 | `westock-data ipo hs` |

**独有数据**: 技术指标(MACD/KDJ/RSI/BOLL)、筹码成本、ETF持仓明细、龙虎榜、大宗交易、融资融券

**性能**: 1-5秒

**踩坑记录**:
- 龙虎榜/大宗交易/融资融券仅支持沪深(sh/sz)
- 筹码成本仅支持沪深京A股(sh/sz/bj)
- 股东结构仅支持A股和港股
- 港股/美股货币单位需注意标注，禁止使用人民币符号
- `search`/`minute` 不支持批量查询

---

## 五、融合层使用指南

融合层（`DataFusion`）是项目核心调度器，自动按优先级合并多个Provider的数据。

### 调用入口

```python
from backend.app.data.providers.fusion import get_fusion
fusion = get_fusion()
```

### 融合策略

| 方法 | 策略 | 说明 |
|------|------|------|
| `get_fund_detail(code)` | 字段合并 | 按优先级逐个获取，低优先级的非空字段补充高优先级的空字段 |
| `get_fund_nav(code)` | 日期去重 | 合并所有Provider的净值数据，按日期去重 |
| `get_fund_holdings(code)` | 取最多 | 取返回条数最多的Provider数据 |
| `get_fund_performance(code)` | Tushare优先 | 优先使用Tushare本地计算，其次从detail中提取 |
| `get_fund_dividends(code)` | 首个非空 | 遍历Provider取首个非空结果 |
| `get_fund_scale(code)` | 首个非空 | 遍历Provider取首个非空结果 |
| `get_fund_adj_factors(code)` | 首个非空 | 遍历Provider取首个非空结果 |
| `get_fund_company(code)` | 首个非空 | 遍历Provider取首个非空结果 |
| `get_trade_cal(exchange)` | 首个非空 | 仅Tushare提供 |
| `get_index_daily(ts_code)` | 首个非空 | 仅Tushare提供 |

### 字段合并细节（get_fund_detail）

融合层按 iFinD(5) → Tushare(4) → TickFlow(3) → 腾讯(2) 顺序获取数据，合并规则：
- nav/nav_date/day_growth/name/rating: 空值被非空值覆盖
- nav_history/manager_info/dividends/scale/adj_factors/company/risk/performance: 空列表/None被非空覆盖
- basic.fund_share: 空值被非空值覆盖

### 数据模型

所有Provider返回统一的数据模型（`backend/app/data/providers/base.py`）:

| 模型 | 用途 | 关键字段 |
|------|------|----------|
| `FundBasic` | 基金基础信息 | code, name, type, management, custodian, manager, found_date, benchmark, status, fund_share |
| `FundNav` | 净值数据 | date, nav, accum_nav, adj_nav, day_growth |
| `FundHolding` | 持仓 | name, code, ratio, industry |
| `FundPerformance` | 阶段收益 | near_1m, near_3m, near_6m, near_1y, near_3y, ytd, since_inception |
| `FundRisk` | 风险指标 | volatility, sharpe, max_drawdown, calmar, sortino, alpha, beta, info_ratio, win_rate |
| `FundDividend` | 分红记录 | ex_date, div_cash, pay_date, record_date, ann_date, imp_anndate, base_date |
| `FundScale` | 基金规模 | end_date, total_nav(亿元), fd_share(万份) |
| `AdjFactor` | 复权因子 | date, adj_factor |
| `FundCompany` | 基金公司 | name, manager_count, fund_count, total_scale |
| `TradeCal` | 交易日历 | cal_date, is_open(S=交易/H=休息) |
| `IndexDaily` | 指数日线 | date, close, open, high, low, pre_close, change, pct_chg, vol, amount |
| `FundDetail` | 基金详情聚合 | code, name, type, nav, nav_date, day_growth, basic, performance, risk, holdings, nav_history, manager_info, rating, dividends, scale, adj_factors, company |

---

## 六、典型场景代码示例

### 场景1: 基金详情页（需要最全数据）
```python
fusion = get_fusion()
detail = fusion.get_fund_detail("000001")
# 融合层自动合并: iFinD(风险指标) + Tushare(份额/分红/复权) + 腾讯(实时净值)
```

### 场景2: 基金排名/筛选
```python
from backend.app.data.akshare_fetcher import get_fund_ranking
ranking = get_fund_ranking("混合型")
```

### 场景3: 定投回测
```python
from backend.app.data.efinance_fetcher import calculate_dca_backtest
result = calculate_dca_backtest("000001", amount=1000, strategy="compare")
```

### 场景4: ETF分析
```python
from backend.app.data.providers.tickflow_provider import TickflowProvider
navs = TickflowProvider().get_fund_nav("510300")
# 持仓: westock-data etf-holdings sh510300
# 技术指标: westock-data technical sh510300 --group macd
```

### 场景5: 股票深度分析
```python
from backend.app.data.providers.ifind_provider import iFinDProvider
p = iFinDProvider()
risk = p.get_risk_indicators("600519")
financials = p.get_stock_financials("600519")
esg = p.get_esg_data("600519")
# 技术面: westock-data technical sh600519 --group macd
# 筹码: westock-data chip sh600519
```

### 场景6: 使用TickFlow获取多市场实时行情
```python
from tickflow import TickFlow

tf = TickFlow()

# A股+美股+港股实时行情
quotes = tf.quotes.get(
    symbols=["600000.SH", "AAPL.US", "00700.HK"],
    as_dataframe=True
)

# 全市场A股行情（需付费权限）
a_quotes = tf.quotes.get(universes=["CN_Equity_A"], as_dataframe=True)

# 批量获取分钟K线（当前99元权限：30/min，100标的/次）
dfs = tf.klines.batch(
    ["600000.SH", "000001.SZ", "600519.SH"],
    period="1m",
    count=5000,
    as_dataframe=True,
    show_progress=True
)
```

### 场景7: 新增数据源到融合层
```python
# 1. 在 backend/app/data/providers/ 下新建 xxx_provider.py
# 2. 继承 DataProvider 基类，实现 is_available/get_fund_list/get_fund_detail/get_fund_nav/get_fund_holdings
# 3. 在 fusion.py 的 DataFusion.__init__ 中添加: XxxProvider()
# 4. 设置 name 和 priority 属性
```

---

## 七、待优化项

| 优先级 | 问题 | 影响 | 修复方案 |
|--------|------|------|----------|
| P1 | iFinD get_fund_detail串行调用 | 6-10秒太慢 | 改为并行调用get_fund_profile + get_fund_market_performance |
| P2 | westock-data未集成到Provider层 | 无法通过融合层调用 | 新建westock_provider.py |
| P2 | NeoData未集成到Provider层 | 无法通过融合层调用 | 新建neodata_provider.py |
| P3 | 东方财富基金经理接口未解析 | 仅返回HTML长度 | 用BeautifulSoup解析 |
| P3 | Tushare fund_adj可能返回空 | 复权因子缺失 | 当前6000积分已满足官方基础权限；若为空优先检查标的后缀、日期范围和接口覆盖 |

---

## 八、数据源互补关系

```
基金详情 ─── iFinD(主:风险指标) + Tushare(份额/分红/复权) + 腾讯(实时净值) + 东方财富(估值)
基金排名 ─── AkShare(主:含各阶段收益) + 东方财富(补充)
基金净值 ─── Tushare(主:含复权) + efinance(补充) + iFinD(补充)
ETF行情 ─── TickFlow(日K最快) + westock-data(详情/持仓) + Tushare(日线)
股票分析 ─── iFinD(风险/ESG) + westock-data(技术/筹码/资金) + Tushare(PE/PB/市值) + TickFlow(实时/分钟K)
交易日历 ─── Tushare(唯一)
指数日线 ─── Tushare(唯一)
定投回测 ─── efinance(唯一)
实时估值 ─── 东方财富(唯一)
实时净值 ─── 腾讯财经(最快<100ms)
多市场实时 ── TickFlow(A股/美股/港股)
```

---

*本文档基于代码审查和实际测试编写，供所有智能体在构建和修改金融项目时参考选源。*

## 真实调用链最终索引（指数 / 股票持仓 / 融资融券 / 港股财务 / 美股 / 财经日历 / 公告）

> 说明：下表仅覆盖「当前代码仓真实可达调用链」；文档/技能中可能出现的能力，如未在下游链路落到 FastAPI/BFF 路由中，用 `缺口` 标注。

| 场景 | 前端入口 | BFF 调用 | 后端真实路由 | 下游链路（供应商/服务） | 状态 |
|---|---|---|---|---|---|
| 指数 | `getMarketOverview`（`frontend/src/lib/api.ts`） | `GET /fund/api/recommend/market` | `GET /recommend/market`（`backend/app/api/recommend.py`） | `akshare_fetcher.get_market_index` / `get_fund_industry_board` | 已接入（已在线） |
| 股票持仓 | `getFundAnalysis(code)`（`frontend/src/lib/api.ts`） | `GET /fund/api/analysis/{code}` | `GET /{code}`（`backend/app/api/analysis.py`） | `analysis_service.analyze_fund` → `fund_detail` 与 `TushareProvider.get_fund_holdings` / `ensure_exchange_fund_holdings_snapshot` | 已接入（基金持仓） |
| 融资融券 | 无独立前端查询页面或接口入口 | `无`（未见 /fund/api 跨层代理） | `无` | `westock-data` 仅在文档能力层出现，当前未挂接到现网路由 | 缺口（未接入） |
| 港股财务 | 无独立前端查询页面或接口入口 | `无`（未见 /fund/api 代理） | `无` | 文档提及数据源能力与备选实现，但当前未挂接到现网路由 | 缺口（未接入） |
| 美股 | 无独立前端查询页面或接口入口 | `无`（未见 /fund/api 代理） | `无` | 文档提及数据源能力与备选实现，但无现网调用链 | 缺口（未接入） |
| 财经日历 | 无独立前端查询页面或接口入口 | `无`（未见 /fund/api 代理） | `无` | 文档提及能力说明但无真实 REST/tRPC 挂载 | 缺口（未接入） |
| 公告 | `managerReport`（`frontend/api/fund-router.ts` tRPC） | `POST /fund/api/fund/manager-report`（via Hono proxy） | `GET /manager-report`（`backend/app/api/fund.py`） | `fund_service.get_manager_report` → `eastmoney.fund_announcement_report_em` / `akshare` | 已接入（基金公告聚合为主） |

*链条文档中更多细节请参考前面章节中的 provider/route/table 说明。*

## Fundtrader 项目级接入清单（可直接粘贴）

### 1) 服务层（backend）
- backend/app/allocation/data/market_data_service.py
  - class MarketDataService
    - def get_status(self) -> MarketDataStatus
    - def get_market_data_health_snapshot(self) -> dict
    - def get_market_data(self, code: str) -> dict
- backend/app/data/providers/fusion.py
  - class DataFusion
    - def get_provider_health_snapshot(self) -> dict
    - def get_providers_status(self) -> list[dict]
    - def _mark_provider_status(self, ...)
- backend/app/data/providers/tickflow_provider.py
  - class TickflowProvider
    - async def get_realtime_quotes(self, symbols: list[str])
    - async def get_kline_bars(self, ...)
    - async def get_minute_bars(self, ...)
    - async def get_market_depth(self, ...)
    - async def get_adjustment_factors(self, ...)
  - class TickflowQuotaPolicy
    - @staticmethod def normalize_period(period: str) -> str
    - @staticmethod def validate_batch_size(size: int, period: str) -> bool
    - @staticmethod def normalize_request_window(period: str, count: int) -> int
- backend/app/data/cache_manager.py
  - class DataCacheManager
    - def has(self, key: str) -> bool
    - def get(self, key: str)
    - def set(self, key: str, value, ttl: int | None = None)
    - def get_with_ttl(self, key: str, ttl: int | None = None)
    - def get_ttl_remaining_seconds(self, key: str) -> int | None
    - def clear_expired(self) -> int

### 2) 路由层（backend）
- backend/app/main.py
  - @app.get("/market-data/status")
    - 返回 get_market_data_service().get_status()
  - @app.get("/market-data/data-sources")
    - 返回 TickflowQuotaPolicy + DataFusion 的 provider 清单与配额说明
  - @app.get("/market-data/source-status")
    - 返回 get_market_data_service().get_market_data_health_snapshot()
  - @app.websocket("/market-data/stream")
    - 订阅类型: { type: "market_data_health", data: MarketDataHealthSnapshot }

### 3) 缓存层（backend）
- backend/app/data/cache_manager.py
  - DataCacheManager.set/get/get_with_ttl
- 示例:
  - cache.set("market-data:refresh:snapshot", payload, ttl=3600)
  - cache.get_with_ttl("market-data:refresh:snapshot", ttl=3600)

### 4) WebSocket 订阅层（前后端）
- 后端推送:
  - backend/app/main.py -> market_data_stream
    - 每 interval 秒推送:
      - market_data_service.get_market_data_health_snapshot()
      - payload: {"type": "market_data_health", "timestamp": "...", "data": {...}}
- BFF/前端封装:
  - frontend/src/lib/api.ts
    - export function subscribeMarketDataStream(options: {
        interval?: number;
        onMessage: (payload: MarketDataStreamPayload) => void;
        onOpen?: () => void;
        onClose?: () => void;
        onError?: (err: Error | Event) => void;
      })
  - frontend/src/pages/allocation/MarketPage.tsx
    - useEffect 内使用 subscribeMarketDataStream
    - onOpen => setStreamOk(true)
    - onClose/onError => setStreamOk(false)
    - 与轮询 fetchHealth/fetchSourceStatus/getMarketDataStatus 做 fallback
  - frontend/src/components/allocation/MarketDataDiagnosticsPanel.tsx
    - props: { health: DataSourceHealthSnapshot | null; dataSourceStatus: MarketDataSourcesStatus | null }

### 5) 公开类型清单（前端）
- frontend/src/types/allocation.ts
  - interface DataSourceProviderStatus
  - interface MarketDataHealthSnapshot
  - interface MarketDataSourcesStatus
  - interface MarketDataStreamPayload

### 6) 可直接复制的调用链（最低侵入）
- 前端页面进入：MarketPage.tsx
  - 先调用 getMarketDataStatus / getMarketDataSourceHealth / getMarketDataSourcesStatus
  - 建立 subscribeMarketDataStream 连接并监听 market_data_health
- 统一诊断信息展示：MarketDataDiagnosticsPanel.tsx
- 异常降级：WebSocket 未连接时，以轮询 REST 维持可用（60s）

### Fundtrader integration checklist (copy-paste)

### Service layer
- backend/app/allocation/data/market_data_service.py
  - class MarketDataService
    - get_status
    - get_market_data_health_snapshot
    - get_market_data
- backend/app/data/providers/fusion.py
  - class DataFusion
    - get_provider_health_snapshot
    - get_providers_status
    - get_fund_detail / _merge_holdings / _merge_nav_history
- backend/app/data/providers/tickflow_provider.py
  - class TickflowQuotaPolicy
    - normalize_period
    - validate_batch_size
    - normalize_request_window
  - class TickflowProvider
    - get_realtime_quotes
    - get_kline_bars
    - get_minute_bars
    - get_market_depth
    - get_adjustment_factors
- backend/app/data/cache_manager.py
  - class DataCacheManager
    - has
    - get
    - set
    - get_with_ttl
    - get_ttl_remaining_seconds
    - clear_expired

### Router layer
- backend/app/main.py
  - market_data_data_sources (GET /market-data/data-sources)
  - market_data_source_status (GET /market-data/source-status)
  - market_data_stream (WS /market-data/stream)
  - market_data_status (GET /market-data/status)

### Frontend layer
- frontend/src/lib/api.ts
  - getMarketDataSourcesStatus
  - getMarketDataSourceHealth
  - subscribeMarketDataStream
- frontend/src/pages/allocation/MarketPage.tsx
  - useEffect bootstrap
    - getMarketDataStatus()
    - getMarketDataSourcesStatus()
    - getMarketDataSourceHealth()
    - subscribeMarketDataStream({...})
- frontend/src/types/allocation.ts
  - DataSourceProviderStatus
  - DataSourceHealthSnapshot
  - MarketDataSourcesStatus
  - MarketDataStreamPayload
- frontend/src/components/allocation/MarketDataDiagnosticsPanel.tsx
  - props: { health, dataSourceStatus }

---

## 2026-06-14 数据源学习与实践复盘（TickFlow / Tushare / iFinD）

本节记录最近一轮数据源文档阅读、代码接入排查、生产接口核对后的可复用结论。后续新增数据源、修复基金详情页字段、排查行情缺口时，应优先遵循这里的实践规则。

### 1. 总体结论

当前 FundTrader 不是单一数据源架构，而是“Provider 融合层 + Fetcher 兜底 + SQLite 快照 + 页面级 dataStatus”的组合。数据源选型不能只看谁字段最多，还要看响应速度、历史回溯、接口稳定性、字段口径和是否能在详情页形成可解释的 `available / partial / stale / missing` 状态。

推荐分工如下：

| 数据源 | 最适合承担 | 不适合承担 | 当前实践结论 |
|---|---|---|---|
| TickFlow | ETF/股票行情、日 K、分钟 K、批量 K 线、盘口、除权因子、行情诊断 | 公募基金基础资料、基金经理、基金评级、季报持仓 | 用作高速行情源和市场数据健康监控源，不应替代 Tushare 的基金结构化数据 |
| Tushare | 基金基础、净值、份额、规模、持仓、基金经理、评级、分红、复权、交易日历、指数日线、宏观指标 | 交易时段基金估值、全市场基金收益排名的直接展示、部分实时行情 | 当前基金详情补字段最可靠的数据源；字段稳定但要处理权限、后缀和空表 |
| iFinD | 专业风险指标、宏观、新闻、ESG、自然语言式专业金融查询 | 高频行情、低延迟批量 K 线、无降级的主链路依赖 | 适合作为高价值增强源；接入时必须处理慢响应和返回结构不统一 |

### 2. TickFlow 实践记录

官方资料的可靠入口是：

| 用途 | 地址 / 路径 | 实践结论 |
|---|---|---|
| 文档索引 | `https://docs.tickflow.org/llms.txt` | 避免猜中文路径；先从 `llms.txt` 找真实子页面 |
| REST OpenAPI | `https://api.tickflow.org/openapi.json` | 以 OpenAPI 为准确认真实 endpoint |
| WebSocket AsyncAPI | `https://docs.tickflow.org/zh-Hans/api-reference/websocket.yaml` | WebSocket 使用 query 参数 `api_key`，推荐 `/v1/ws/stream` |
| REST 鉴权 | Header `x-api-key` | SDK 里由 `TickFlow(api_key=...)` 封装 |

已验证的核心 REST 能力包括：

| 能力 | 典型 endpoint / SDK | 用途 |
|---|---|---|
| 实时行情 | `/v1/quotes`, `tf.quotes.get(...)` | 多市场 quote，适合市场诊断和行情看板 |
| K 线 | `/v1/klines`, `tf.klines.get(...)` | 单标的日 K / 分钟 K |
| 批量 K 线 | `/v1/klines/batch`, `tf.klines.batch(...)` | 多标的批量取数，需控制批量大小 |
| 日内分时 | `/v1/klines/intraday` | 日内曲线，适合实时看板 |
| 盘口深度 | `/v1/depth`, `tf.depth.get(...)` | 五档行情 / market depth |
| 除权因子 | `/v1/klines/ex-factors`, `tf.klines.ex_factors(...)` | 复权计算辅助 |
| 标的与市场 | `/v1/instruments`, `/v1/universes`, `/v1/exchanges` | 搜索、市场范围、批量 universe |
| WebSocket | `/v1/ws/stream` | quote/depth 订阅，适合后续实时推送 |

仓库实现要点：

| 文件 | 当前行为 |
|---|---|
| `backend/app/data/providers/tickflow_provider.py` | `TickflowClientFactory` 支持 `paid/free/auto`；有 `TICKFLOW_API_KEY` 时优先付费客户端，失败回落 `TickFlow.free()` |
| `backend/app/data/providers/tickflow_provider.py` | `TickflowQuotaPolicy` 统一 period、batch size 和分钟 K 最大窗口 |
| `backend/app/data/providers/tickflow_provider.py` | `TickflowProvider.get_fund_nav()` 当前本质是用交易所 K 线映射 ETF/LOF，不是公募基金结构化净值源 |
| `backend/app/main.py` | `/market-data/data-sources` 返回 TickFlow paid/free 配额说明，前端诊断面板消费这些字段 |
| `frontend/src/components/allocation/MarketDataDiagnosticsPanel.tsx` | 已展示 `tickflow_paid` 和 `tickflow_free` 状态 |

TickFlow 使用规则：

1. ETF、股票行情优先 TickFlow；开放式基金详情字段不要从 TickFlow 补。
2. `TICKFLOW_API_LEVEL=auto` 是默认安全配置；本地无 key 时走免费模式，有 key 时走付费模式。
3. 分钟 K 请求必须走 `TickflowQuotaPolicy.normalize_request_window()`，避免一次请求超过当前包限制。
4. 批量请求必须走 `TickflowQuotaPolicy.validate_batch_size()`，当前按 100 标的上限控制。
5. WebSocket 新接入应优先 `/v1/ws/stream`，鉴权用 `api_key` query 参数，不要照搬 REST 的 `x-api-key` header。
6. 文档调研时不要猜 URL；先读 `llms.txt`，再用 OpenAPI / AsyncAPI 校验 endpoint。

### 3. Tushare 实践记录

Tushare 是当前基金结构化数据的主力增强源。它的优势不是实时性，而是字段稳定、历史可回溯、适合写入本地快照。

仓库实现要点：

| 文件 | 当前行为 |
|---|---|
| `backend/app/data/providers/tushare_provider.py` | 使用 `TUSHARE_TOKEN`，缺失时尝试读取 `~/.tushare_token` |
| `backend/app/data/providers/tushare_provider.py` | `_safe_call()` 对接口异常降级并做短暂停顿，避免单接口失败拖垮详情链路 |
| `backend/app/data/providers/tushare_provider.py` | 基金代码优先 `.OF`，ETF/LOF 根据代码前缀尝试 `.SH` / `.SZ` |
| `backend/app/data/providers/tushare_provider.py` | `fund_nav` 不直接给日涨幅时，本地按前一日单位净值计算 `day_growth` |
| `backend/app/services/fund_service.py` | 规模历史可用 `fund_share * unit_nav` 回填季度规模并入库 |
| `backend/app/services/fund_service.py` | 基金经理历史可从 `fund_manager` 回填，包含任职回报 |
| `backend/app/api/fund.py` | `rating` 优先 Tushare `fund_rating`，缺失时用本地 score 作 partial 兜底 |
| `backend/app/allocation/data/macro_fetcher.py` | PMI、GDP、CPI、PPI、10Y 国债、社融、M2、融资余额等宏观指标优先 Tushare，再回退 AkShare |

关键接口与用途：

| 接口 | 用途 | 项目实践 |
|---|---|---|
| `fund_basic` | 基金基础、公司、类型、成立日、基准 | 基金列表、详情基础字段、公司信息补齐 |
| `fund_nav` | 单位净值、累计净值、复权净值 | 基金详情、风险指标、阶段收益、定投/回测候选源 |
| `fund_share` | 基金份额 | 与 `unit_nav` 组合计算规模 |
| `fund_portfolio` | 季报持仓 | 股票持仓、股债配置、部分持有人/券种相关字段 |
| `fund_manager` | 基金经理和任职回报 | 经理历史、现任经理字段补齐 |
| `fund_rating` | 基金评级 | 详情页评级字段 |
| `fund_div` | 分红记录 | 分红展示和收益口径增强 |
| `fund_adj` | 复权因子 | 复权收益计算辅助 |
| `trade_cal` | 交易日历 | 交易日判断 |
| `index_daily` | 指数日线 | 沪深 300 等基准曲线 |

Tushare 使用规则：

1. 日期统一使用 `YYYYMMDD` 请求，入库和前端展示再转换成 `YYYY-MM-DD`。
2. 基金 `ts_code` 后缀必须显式处理：开放式基金 `.OF`，沪市 ETF/LOF `.SH`，深市 ETF/LOF `.SZ`。
3. 每个接口都要接受空 DataFrame；空表是正常业务结果，不应抛出到页面。
4. 列字段优先显式 `fields`，避免接口返回结构变化影响解析。
5. 列表类接口必须分页或限量，避免一次拉全量造成限流或超时。
6. `fund_nav` 的 `day_growth` 可以本地计算；不要因为 Tushare 未给日涨幅就判定净值源不可用。
7. 规模字段不要只信单一口径；当前更可靠做法是 `fund_share(fd_share) * fund_nav(unit_nav)`，再按亿元归一。
8. 页面字段补齐时，Tushare 只做真实数据或可解释回填；如果缺真实基准，例如业绩比较基准净值，不要伪造成沪深 300。

### 4. iFinD 实践记录

iFinD 在文档层面是专业金融数据源，适合补专业指标，但当前仓库里的 `iFinDProvider` 仍是轻量 HTTP provider。后续继续深化 iFinD 时，要区分“已接入实现”和“文档/账号可用能力”。

仓库实现要点：

| 文件 | 当前行为 |
|---|---|
| `backend/app/data/providers/ifind_provider.py` | 使用 `IFIND_TOKEN`，通过 Bearer Token 请求 `https://quantapi.51ifind.com/api/v1` |
| `backend/app/data/providers/ifind_provider.py` | 当前实现包含基金列表、基金详情、基金净值、基金持仓等轻量接口 |
| `backend/app/data/providers/fusion.py` | `iFinDProvider` 已纳入融合层，优先级高于 TickFlow |

实践规则：

1. iFinD 适合风险指标、宏观、新闻、ESG、专业查询；不适合作为低延迟行情主源。
2. iFinD 返回结构可能不统一，解析层必须接受 dict、list、str 等变体。
3. iFinD 调用要设置明确超时，并在页面字段上标记 `partial/stale/missing`，避免等待专业源拖慢主页面。
4. 如果切到 iFinD MCP JSON-RPC 方案，必须新建清晰适配层，不要把 MCP 协议细节混进现有普通 REST provider。
5. 基金详情页需要的风险摘要可以优先用本地净值指标兜底，再由 iFinD 风险指标增强。

### 5. 基金详情页数据实践

详情页现在不是一个接口解决全部字段，而是多接口并行：

| 前端 tRPC | 后端 REST | 主要数据源 |
|---|---|---|
| `detailByCode` | `/fund/snapshot/{code}` | 本地快照、Tushare、东方财富、efinance |
| `rating` | `/fund/rating` | Tushare `fund_rating`，本地 score 兜底 |
| `purchaseInfo` | `/fund/purchase-info` | 本地 metrics，缺失时默认费率 partial |
| `holderStructure` | `/fund/holder-structure` | 季报快照 / Tushare |
| `yearReturns` | `/fund/year-returns` | NAV 计算、沪深 300、同类均值 |
| `peerPerformance` | `/fund/peer-performance` | 本基金 NAV、沪深 300、同类统计 |
| `scaleHistory` | `/fund/scale-history` | 季度快照，Tushare `fund_share * unit_nav` 回填 |
| `turnoverHistory` | `/fund/turnover-history` | 季报快照 |
| `managerHistory` | `/fund/manager-history` | Tushare `fund_manager` |
| `bondAllocation` | `/fund/bond-allocation` | 季报快照 / Tushare |
| `bondHoldings` | `/fund/bond-holdings` | 季报快照 / Tushare |
| `managerReport` | `/fund/manager-report` | 东财公告 / AkShare |
| `riskSummary` | `/fund/risk-summary` | 本地净值风险指标 + 同类均值 |
| `detailCompleteness` | `/fund/detail-completeness` | 字段覆盖度聚合 |

实践规则：

1. 页面字段是否“可用”以 `detailCompleteness` 和具体 section payload 同时判断。
2. 可计算回填必须标记为 `partial` 或保留 source 说明，不要伪装成原始数据。
3. `peerPerformance.benchmark` 只有在有真实业绩比较基准净值时才填；不能默认等同沪深 300。
4. 本基金、沪深 300、同类均值可以分别使用不同来源，但页面上要保留 `source/asOf/coverage/missingReason`。
5. BFF 路径排查要保留 `/fund/api/...` 形状；FastAPI 下游路由是 `/fund/...`，BFF 会剥离 `/fund/api` 前缀。

### 6. 新增或修复数据源的标准流程

1. 先确定字段归属：结构化基金字段优先 Tushare，行情优先 TickFlow，专业风险/宏观优先 iFinD。
2. 再确认调用链：Provider / Fetcher / SQLite 快照 / FastAPI / BFF tRPC / 前端消费点。
3. 接口级验证一个代表基金或 ETF，不要只看文档能力。
4. 每个字段都写清楚 source、asOf、coverage、missingReason。
5. 任何外部源失败都降级为 `partial/stale/missing`，不要让页面主链路失败。
6. 对用户可见字段，真实缺失时显示缺口，不用模板假数据补空白。

### 7. 当前优先级建议

| 优先级 | 建议项 | 原因 |
|---|---|---|
| P0 | 继续完善 `detailCompleteness` 与具体 section 的字段级一致性 | 这是产品详情页判断“还缺什么”的唯一稳定入口 |
| P0 | 保持 `peerPerformance.benchmark` 空缺直到有真实业绩基准净值源 | 避免把沪深 300 伪装成基金合同基准 |
| P1 | 为 TickFlow WebSocket 新建独立实时行情 adapter | 当前 REST/SDK 已接入，实时推送还未进入 Provider 层 |
| P1 | 将 Tushare 关键接口 smoke 脚本固化 | 方便快速区分 token/权限/字段变化问题 |
| P2 | iFinD MCP JSON-RPC 适配独立化 | 现有 `iFinDProvider` 是轻量 REST 形态，和 MCP 文档能力不是同一层 |
| P2 | westock-data / NeoData 只在有真实产品入口时再接 Provider | 当前更多是 Agent 能力，不宜提前混入核心链路 |
