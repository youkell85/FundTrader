# FundTrader 金融数据源与密钥指南

> 面向智能体（Agent）的权威参考。当你在构建、修改、扩展金融项目时，依据本文档选取合适的数据源。
> 更新日期: 2026-05-30 | 数据源可用: 9/9

---

## 一、密钥与认证速查

所有密钥存储在 `backend/.env`，项目启动时由 `backend/app/config.py` 自动加载（dotenv）。新增数据源时，密钥也写入此文件。

| 数据源 | 环境变量 | 密钥类型 | 获取方式 | 当前状态 |
|--------|----------|----------|----------|----------|
| iFinD MCP | `IFIND_TOKEN` | Bearer Token (JWE) | 同花顺iFinD MCP申请 | ✅ 已配置 |
| Tushare Pro | `TUSHARE_TOKEN` | API Token | tushare.pro注册(6000积分) | ✅ 已配置 |
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
| 复权因子 | Tushare `get_fund_adj` | 唯一来源(6000积分可能返回空) | Provider |

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

**定位**: 结构化付费数据源，接口丰富（50+个），是交易日历/指数日线/复权因子/基金份额/财务数据的唯一来源。

**认证**: API Token，`backend/.env` 的 `TUSHARE_TOKEN`，备选 `~/.tushare_token`

**调用方式**: `tushare` Python SDK，`ts.pro_api(token)` 初始化

**代码格式**: `600519.SH`(上交所)、`000001.SZ`(深交所)、`920001.BJ`(北交所)、`000001.OF`(场外基金)、`510300.SH`(ETF)

**日期格式**: YYYYMMDD（如 `20260519`）

**频次限制**: 500次/分钟，代码内置0.15秒间隔

**积分与权限对应表（当前6000积分）**:

| 积分数 | 每分钟频次 | 每天总量上限 | 可访问接口 |
|--------|----------|------------|-----------|
| 120 | 50 | 8000次 | 股票非复权日线行情 |
| 2000+ | 200 | 100000次/个API | 常规数据 |
| 5000+ | 500 | 常规数据无上限 | 常规数据+特色数据 |
| 10000+ | 500 | 常规数据无上限，特色数据300次/分钟 | 特色数据（盈利预测、筹码分布等） |

**独立权限接口（需额外付费）**:

| 类型 | 包含数据 | 历史起始 | 捐助（元/年） |
|------|---------|---------|-------------|
| 股票历史分钟 | 1/5/15/30/60分钟 | 2009年 | 2000 |
| 股票实时分钟 | 1/5/15/30/60分钟 | 实时 | 1000/月 |
| 股票实时日线 | 当日实时日线成交 | 每天9:30开始 | 200/月 |
| 港股日线 | 日线+复权行情 | 全历史 | 1000 |
| 美股日线 | 日线+复权+估值指标 | 全历史 | 2000 |
| 新闻资讯 | 快讯/长篇新闻/新闻联播 | 3年以上 | 1000 |
| 公告信息 | 股票/基金/固收公告 | 10年以上 | 1000 |

**核心接口分类**:

#### A. 基础数据接口

| 接口方法 | Tushare API | 功能 | 积分要求 | 参数示例 |
|----------|-------------|------|----------|----------|
| `get_fund_list(market)` | `pro.fund_basic` | 基金列表 | 2000+ | market="O"(场外)/"E"(场内) |
| `get_stock_basic()` | `pro.stock_basic` | 股票基础信息 | 2000+ | exchange='SSE', list_status='L' |
| `get_stock_company()` | `pro.stock_company` | 上市公司基本信息 | 120+ | exchange='SZSE' |
| `get_trade_cal(exchange, start, end)` | `pro.trade_cal` | 交易日历 | 2000+ | exchange="SSE" |
| `get_namechange(ts_code)` | `pro.namechange` | 股票曾用名 | 120+ | ts_code='600848.SH' |
| `get_new_share(start, end)` | `pro.new_share` | IPO新股列表 | 120+ | start_date='20240101' |

**fund_basic 详细字段**:
- `ts_code`: 基金代码(如512850.SH)
- `name`: 简称
- `management`: 管理人(如"中信建投基金")
- `custodian`: 托管人(如"招商银行")
- `fund_type`: 投资类型(股票型/混合型/债券型/货币型/指数型/QDII等)
- `found_date`: 成立日期
- `due_date`: 到期日期
- `list_date`: 上市时间
- `issue_amount`: 发行份额(亿)
- `m_fee`: 管理费
- `c_fee`: 托管费
- `duration_year`: 存续期
- `purc_startdate`: 日常申购起始日
- `redm_startdate`: 日常赎回起始日
- `status`: 存续状态(D摘牌/I发行/L上市中)
- `market`: E场内 O场外

**stock_basic 详细字段**:
- `ts_code`: TS代码(格式:000001.SZ)
- `symbol`: 股票代码(6位数字)
- `name`: 股票名称
- `area`: 地域
- `industry`: 所属行业
- `market`: 市场类型(主板/创业板/科创板/CDR/北交所)
- `list_date`: 上市日期
- `delist_date`: 退市日期
- `is_hs`: 是否沪深港通标的(N否/H沪股通/S深股通)
- `act_name`: 实控人名称
- `act_ent_type`: 实控人企业性质

**trade_cal 交易所代码**:
- SSE: 上海证券交易所
- SZSE: 深圳证券交易所
- CFFEX: 中金所
- SHFE: 上期所
- CZCE: 郑商所
- DCE: 大商所
- INE: 上能源

**namechange 输出字段**:
- `ts_code`: TS代码
- `name`: 历史名称
- `start_date`: 开始日期
- `end_date`: 结束日期
- `change_reason`: 变更原因(如"改名"/"撤销ST"/"ST")

**new_share 输出字段**:
- `ts_code`: TS股票代码
- `sub_code`: 申购代码
- `name`: 名称
- `ipo_date`: 上网发行日期
- `issue_date`: 上市日期
- `amount`: 发行总量(万股)
- `price`: 发行价格
- `pe`: 市盈率
- `limit_amount`: 个人申购上限(万股)
- `ballot`: 中签率

#### B. 行情数据接口

| 接口方法 | Tushare API | 功能 | 积分要求 | 参数示例 |
|----------|-------------|------|----------|----------|
| `get_daily(ts_code, start, end)` | `pro.daily` | A股日线行情 | 5000+ | ts_code='000001.SZ' |
| `get_daily_basic(ts_code, trade_date)` | `pro.daily_basic` | 股票每日指标(PE/PB/市值) | 2000+ | trade_date='20260519' |
| `get_adj_factor(ts_code, trade_date)` | `pro.adj_factor` | 复权因子 | 2000+ | ts_code='000001.SZ' |
| `get_moneyflow(ts_code, start, end)` | `pro.moneyflow` | 个股资金流向 | 2000+ | ts_code='002149.SZ' |
| `get_index_daily(ts_code, start, end)` | `pro.index_daily` | 指数日线 | 2000+ | ts_code='000300.SH' |
| `get_index_basic(market)` | `pro.index_basic` | 指数基础信息 | 120+ | market='SW' |
| `get_sw_daily(ts_code, trade_date)` | `pro.sw_daily` | 申万行业指数日行情 | 5000+ | ts_code='801010.SI' |
| `get_etf_daily(ts_code, start, end)` | `pro.fund_daily` | ETF日线行情 | 5000+ | ts_code='510330.SH' |
| `get_pro_bar(ts_code, asset, adj, freq)` | `ts.pro_bar()` | 通用行情接口(复权/分钟) | 见说明 | asset='E', adj='qfq' |
| `get_fut_daily(ts_code, exchange)` | `pro.fut_daily` | 期货日线行情 | 2000+ | ts_code='CU2507.SHF' |
| `get_opt_daily(ts_code, trade_date)` | `pro.opt_daily` | 期权日线行情 | 2000+ | ts_code='10001313.SH' |

**sw_daily 申万行业指数日行情字段**:
- `ts_code`: 指数代码(如801010.SI农林牧渔)
- `name`: 指数名称
- `open/high/low/close`: 开盘/最高/最低/收盘点位
- `change/pct_change`: 涨跌点/涨跌幅
- `vol/amount`: 成交量(万股)/成交额(万元)
- `pe/pb`: 市盈率/市净率
- `float_mv/total_mv`: 流通市值/总市值(万元)
- 默认返回申万2021版行业分类

**fut_daily 期货日线行情字段**:
- `pre_close/pre_settle`: 昨收盘/昨结算价
- `open/high/low/close/settle`: 开/高/低/收/结算价
- `change1`: 收盘价-昨结算价(涨跌1)
- `change2`: 结算价-昨结算价(涨跌2)
- `vol/amount/oi/oi_chg`: 成交量/成交额/持仓量/持仓量变化
- `delv_settle`: 交割结算价

**opt_daily 期权日线行情字段**:
- `pre_settle/pre_close`: 昨结算/前收盘价
- `open/high/low/close/settle`: 开/高/低/收/结算价
- `vol/amount/oi`: 成交量/成交额/持仓量

**daily 日线行情字段**:
- `ts_code`: 股票代码
- `trade_date`: 交易日期(YYYYMMDD)
- `open`: 开盘价
- `high`: 最高价
- `low`: 最低价
- `close`: 收盘价
- `pre_close`: 昨收价【除权价】
- `change`: 涨跌额
- `pct_chg`: 涨跌幅(%)(基于除权后的昨收计算)
- `vol`: 成交量(手)
- `amount`: 成交额(千元)

**daily_basic 每日指标字段**:
- `turnover_rate`: 换手率(%)
- `turnover_rate_f`: 换手率(自由流通股)
- `volume_ratio`: 量比
- `pe`: 市盈率(总市值/净利润)
- `pe_ttm`: 市盈率(TTM)
- `pb`: 市净率(总市值/净资产)
- `ps`: 市销率
- `ps_ttm`: 市销率(TTM)
- `dv_ratio`: 股息率(%)
- `dv_ttm`: 股息率(TTM)(%)
- `total_share`: 总股本(万股)
- `float_share`: 流通股本(万股)
- `free_share`: 自由流通股本(万)
- `total_mv`: 总市值(万元)
- `circ_mv`: 流通市值(万元)

**adj_factor 复权因子**:
- 盘前9:15~20分完成当日复权因子入库
- 复权因子用于计算复权价格: 前复权价格 = 当前价格 × 复权因子

**moneyflow 个股资金流向字段**:
- `buy_sm_vol/buy_sm_amount`: 小单买入量/金额(5万以下)
- `buy_md_vol/buy_md_amount`: 中单买入量/金额(5万～20万)
- `buy_lg_vol/buy_lg_amount`: 大单买入量/金额(20万～100万)
- `buy_elg_vol/buy_elg_amount`: 特大单买入量/金额(100万以上)
- `net_mf_vol/net_mf_amount`: 净流入量/额(万元)

**index_basic 指数基础信息**:
- 市场分类: SSE(上交所指数)/SZSE(深交所指数)/CSI(中证指数)/SW(申万指数)/CICC(中金指数)
- 指数类别: 主题指数/规模指数/策略指数/风格指数/综合指数/成长指数/价值指数/行业指数/债券指数/商品指数等

**index_daily 指数日线字段**:
- 与daily类似，含close/open/high/low/pre_close/change/pct_chg/vol/amount

**fund_daily ETF日线字段**:
- 与日线行情一致，含open/high/low/close/pre_close/change/pct_chg/vol/amount

#### C. 财务数据接口

| 接口方法 | Tushare API | 功能 | 积分要求 | 参数示例 |
|----------|-------------|------|----------|----------|
| `get_income(ts_code, start, end)` | `pro.income` | 利润表 | 2000+ | ts_code='600000.SH' |
| `get_balancesheet(ts_code, start, end)` | `pro.balancesheet` | 资产负债表 | 2000+ | ts_code='600000.SH' |
| `get_cashflow(ts_code, start, end)` | `pro.cashflow` | 现金流量表 | 2000+ | ts_code='600000.SH' |
| `get_fina_indicator(ts_code)` | `pro.fina_indicator` | 财务指标数据 | 2000+ | ts_code='600000.SH' |
| `get_fina_audit(ts_code, start, end)` | `pro.fina_audit` | 财务审计意见 | 2000+ | ts_code='600000.SH' |
| `get_fina_mainbz(ts_code, type)` | `pro.fina_mainbz` | 主营业务构成 | 2000+ | type='P'(按产品)/'D'(按地区) |
| `get_dividend(ts_code)` | `pro.dividend` | 分红送股 | 2000+ | ts_code='600848.SH' |
| `get_forecast(ts_code)` | `pro.forecast` | 业绩预告 | 2000+ | ts_code='600000.SH' |
| `get_express(ts_code)` | `pro.express` | 业绩快报 | 2000+ | ts_code='600000.SH' |

**income 利润表主要字段**:
- `basic_eps/diluted_eps`: 基本/稀释每股收益
- `total_revenue/revenue`: 营业总收入/营业收入
- `operate_profit`: 营业利润
- `total_profit`: 利润总额
- `n_income`: 净利润(含少数股东损益)
- `n_income_attr_p`: 净利润(不含少数股东损益)
- `int_income`: 利息收入
- `comm_income`: 手续费及佣金收入
- `invest_income`: 投资净收益
- `total_cogs`: 营业总成本
- `oper_cost`: 营业成本
- `sell_exp/admin_exp/fin_exp`: 销售/管理/财务费用
- `rd_exp`: 研发费用
- `ebit/ebitda`: 息税前利润/息税折旧摊销前利润

**balancesheet 资产负债表主要字段**:
- 资产类: `cash_cap`(货币资金)/`trad_asset`(交易性金融资产)/`accounts_receiv`(应收账款)/`inventories`(存货)/`fix_assets`(固定资产)/`intan_assets`(无形资产)/`goodwill`(商誉)
- 负债类: `st_borr`(短期借款)/`lt_borr`(长期借款)/`bond_payable`(应付债券)/`accounts_payable`(应付账款)
- 权益类: `cap_rese`(资本公积金)/`surplus_rese`(盈余公积金)/`undistr_porfit`(未分配利润)

**cashflow 现金流量表主要字段**:
- `net_profit`: 净利润
- `n_cashflow_act`: 经营活动产生的现金流量净额
- `n_cashflow_inv_act`: 投资活动产生的现金流量净额
- `n_cash_flows_fnc_act`: 筹资活动产生的现金流量净额
- `free_cashflow`: 企业自由现金流量

**fina_indicator 财务指标(150+字段)**:
- 每股指标: `eps`/`bps`(每股净资产)/`ocfps`(每股经营活动现金流)/`cfps`(每股现金流)
- 盈利能力: `roe`(净资产收益率)/`roa`(总资产报酬率)/`grossprofit_margin`(毛利率)/`netprofit_margin`(净利率)
- 偿债能力: `current_ratio`(流动比率)/`quick_ratio`(速动比率)/`debt_to_assets`(资产负债率)
- 运营能力: `inv_turn`(存货周转率)/`ar_turn`(应收账款周转率)/`assets_turn`(总资产周转率)
- 成长能力: `netprofit_yoy`(净利润同比)/`eps_yoy`(每股收益同比)/`roe_yoy`(净资产收益率同比)

**dividend 分红送股字段**:
- `stk_div`: 每股送转
- `stk_bo_rate`: 每股送股比例
- `stk_co_rate`: 每股转增比例
- `cash_div`: 每股分红税后
- `cash_div_tax`: 每股分红税前
- `record_date`: 股权登记日
- `ex_date`: 除权除息日
- `pay_date`: 派息日
- `div_proc`: 实施进度(预案/实施)

**forecast 业绩预告字段**:
- `type`: 预告类型(预增/预减/扭亏/首亏/续亏/续盈/略增/略减)
- `p_change_min/max`: 预告净利润变动幅度下限/上限(%)
- `net_profit_min/max`: 预告净利润下限/上限(万元)
- `change_reason`: 业绩变动原因

**fina_audit 财务审计意见字段**:
- `audit_result`: 审计结果(标准无保留意见/保留意见/无法表示意见/否定意见)
- `audit_fees`: 审计总费用(元)
- `audit_agency`: 会计事务所
- `audit_sign`: 签字会计师

**fina_mainbz 主营业务构成**:
- type='P': 按产品分类(bz_item为产品名称)
- type='D': 按地区分类(bz_item为地区名称)
- type='I': 按行业分类
- 字段: bz_sales(主营收入)/bz_profit(主营利润)/bz_cost(主营成本)

#### D. 基金数据接口

| 接口方法 | Tushare API | 功能 | 积分要求 | 参数示例 |
|----------|-------------|------|----------|----------|
| `get_fund_nav(code, start, end)` | `pro.fund_nav` | 基金净值历史 | 2000+ | "000001", start_date="20250101" |
| `get_fund_holdings(code)` | `pro.fund_portfolio` | 基金持仓 | 2000+ | "000001" |
| `get_fund_manager(code)` | `pro.fund_manager` | 基金经理 | 2000+ | "000001" |
| `get_fund_dividend(code)` | `pro.fund_div` | 分红记录 | 2000+ | "000001" |
| `get_fund_scale(code)` | `pro.fund_share`+`pro.fund_nav` | 基金规模 | 2000+ | "000001" |
| `get_etf_basic(code)` | `pro.etf_basic` | ETF基本信息 | 2000+ | "510300" |
| `get_fund_adj(code)` | `pro.fund_adj` | 复权因子 | 2000+ | "000001" |
| `get_fund_company(code)` | `pro.fund_company` | 基金公司 | 2000+ | "000001" |

**fund_nav 基金净值历史字段**:
- `ts_code`: 基金代码
- `nav_date`: 净值日期
- `unit_nav`: 单位净值
- `accum_nav`: 累计净值
- `div_dt`: 分红日期(如有)
- `div_unit`: 每份分红金额

**fund_portfolio 基金持仓字段**:
- `ts_code`: 基金代码
- `ann_date`: 公告日期
- `end_date`: 报告期
- `stock_code`: 股票代码
- `stock_name`: 股票名称
- `hold_vol`: 持仓股数(万股)
- `hold_ratio`: 持仓占比(%)
- `mkt_cap`: 市值(万元)

**fund_manager 基金经理字段**:
- `ts_code`: 基金代码
- `name`: 基金经理姓名
- `gender`: 性别(M/F)
- `birth_year`: 出生年份
- `edu`: 学历
- `start_date`: 任职日期
- `end_date`: 离任日期(如无则空)
- `reward`: 任职回报(%)

**fund_div 分红记录字段**:
- `ts_code`: 基金代码
- `div_date`: 分红日期
- `record_date`: 权益登记日
- `pay_date`: 派息日
- `div_yield`: 每份分红(元)
- `process`: 分红进度(分红除息/红利再投)

**etf_basic ETF基本信息字段**:
- `ts_code`: 基金代码
- `name`: ETF名称
- `management`: 基金管理人
- `custodian`: 基金托管人
- `found_date`: 成立日期
- `list_date`: 上市日期
- `issue_date`: 发行日期
- `track_index`: 跟踪指数
- `fund_type`: ETF类型(股票型/债券型/货币型/商品型)
- `fee`: 管理费率(%)
- `track_nm`: 跟踪指数名称
- `underlying`: 标的资产类型
- `market`: 上市市场(SSE/SZSE)

#### E. 特色数据接口（10000+积分）

| 接口方法 | Tushare API | 功能 | 积分要求 | 参数示例 |
|----------|-------------|------|----------|----------|
| `get_stk_forecast(ts_code)` | `pro.stk_forecast` | 券商盈利预测 | 10000+ | ts_code='600000.SH' |
| `get_stk_chip(ts_code)` | `pro.stk_chip` | 每日筹码成本和胜率 | 10000+ | ts_code='600000.SH' |
| `get_stk_chip_dist(ts_code)` | `pro.stk_chip_dist` | 每日筹码分布 | 10000+ | ts_code='600000.SH' |
| `get_broker_gold_stock()` | `pro.broker_gold_stock` | 券商金股数据 | 2000+ | - |

**report_rc 卖方盈利预测字段**:
- `ts_code/name`: 股票代码/名称
- `report_date/title/type/classify`: 研报日期/标题/类型/分类
- `org_name/author_name`: 机构名称/作者
- `quarter`: 预测报告期(如2024Q4)
- `op_rt/op_pr/tp/np`: 预测营业收入/营业利润/利润总额/净利润
- `eps/pe/rd/roe`: 预测每股收益/市盈率/股息率/净资产收益率
- `rating`: 卖方评级
- `max_price/min_price`: 预测最高/最低目标价

**cyq_perf 每日筹码成本和胜率字段**:
- `his_low/his_high`: 历史最低/最高价
- `cost_5pct/cost_15pct/cost_50pct/cost_85pct/cost_95pct`: 各分位成本
- `weight_avg`: 加权平均成本
- `winner_rate`: 胜率(持有1天后获利的概率)

**cyq_chips 每日筹码分布字段**:
- `price`: 成本价格
- `percent`: 价格占比(%)

**broker_recommend 券商金股字段**:
- `month`: 月度(YYYYMM格式)
- `broker`: 券商名称
- `ts_code/name`: 股票代码/名称

#### F. 港股/美股数据接口（需单独开权限）

| 接口方法 | Tushare API | 功能 | 权限要求 | 参数示例 |
|----------|-------------|------|----------|----------|
| `get_hk_daily(ts_code, start, end)` | `pro.hk_daily` | 港股日线 | 单独权限 | ts_code='00001.HK' |
| `get_hk_daily_adj(ts_code, start, end)` | `pro.hk_daily_adj` | 港股复权行情 | 单独权限 | ts_code='00001.HK' |
| `get_hk_mins(ts_code, freq)` | `pro.hk_mins` | 港股分钟行情 | 单独权限 | freq='1min' |
| `get_hk_income(ts_code, period)` | `pro.hk_income` | 港股利润表 | 单独权限 | period='20241231' |
| `get_us_daily(ts_code, start, end)` | `pro.us_daily` | 美股日线 | 单独权限 | ts_code='AAPL' |
| `get_us_daily_adj(ts_code, start, end)` | `pro.us_daily_adj` | 美股复权行情 | 单独权限 | ts_code='AAPL' |
| `get_us_income(ts_code, period)` | `pro.us_income` | 美股利润表 | 15000积分/单独权限 | period='20241231' |

**hk_daily 港股日线字段**:
- 与A股日线类似，含open/high/low/close/pre_close/change/pct_chg/vol/amount
- 每日18点左右更新当日数据

**hk_daily_adj 港股复权行情额外字段**:
- `adj_factor`: 复权因子
- `turnover_ratio`: 换手率(基于总股本)
- `free_share/total_share`: 流通/总股本
- `free_mv/total_mv`: 流通/总市值

**hk_mins 港股分钟行情字段**:
- `trade_time`: 交易时间(格式: YYYY-MM-DD HH:MM:SS)
- `open/close/high/low`: 开盘/收盘/最高/最低价
- `vol/amount`: 成交量/成交金额
- 支持频度: 1min/5min/15min/30min/60min

**hk_income 港股利润表**:
- `ind_name`: 财务科目名称(营业额/毛利/经营溢利/净利润等)
- `ind_value`: 财务科目值

**us_daily 美股日线字段**:
- `vwap`: 平均价
- `turnover_ratio`: 换手率
- `total_mv/pe/pb`: 总市值/PE/PB

**us_daily_adj 美股复权行情额外字段**:
- 与港股类似，含adj_factor/turnover_ratio/free_share/total_share/free_mv/total_mv

**us_income 美股利润表**:
- `ind_type`: 报告期类型(Q1一季报/Q2半年报/Q3三季报/Q4年报)
- `ind_name`: 财务科目名称(营业收入/毛利/营业成本/研发费用等)
- `report_type`: 报告类型(单季报/累计报)

#### G. 新闻资讯接口（需单独开权限）

| 接口方法 | Tushare API | 功能 | 权限要求 | 参数示例 |
|----------|-------------|------|----------|----------|
| `get_news(src, start, end)` | `pro.news` | 新闻快讯 | 单独权限 | src='sina' |
| `get_major_news(src, start, end)` | `pro.major_news` | 长篇新闻通讯 | 单独权限 | src='新浪财经' |
| `get_cctv_news(date)` | `pro.cctv_news` | 新闻联播文字稿 | 单独权限 | date='20250101' |

**news 新闻快讯字段**:
- `datetime`: 新闻时间(格式: YYYY-MM-DD HH:MM:SS)
- `content`: 内容
- `title`: 标题
- `channels`: 分类

**支持的新闻来源**:
- sina: 新浪财经
- wallstreetcn: 华尔街见闻
- 10jqka: 同花顺
- eastmoney: 东方财富
- yuncaijing: 云财经
- fenghuang: 凤凰新闻
- jinrongjie: 金融界
- cls: 财联社
- yicai: 第一财经

**major_news 长篇新闻字段**:
- `pub_time`: 发布时间
- `content`: 内容(需在fields中指定)

**cctv_news 新闻联播字段**:
- `date`: 日期(YYYYMMDD格式)
- `title`: 标题
- `content`: 内容(已分段，每段含小标题)

**通用行情接口 pro_bar 详解**:

`ts.pro_bar()` 是Tushare的集成行情接口，支持股票/指数/基金/期货/期权/数字货币：

| 参数 | 说明 | 示例 |
|------|------|------|
| `ts_code` | 证券代码 | '000001.SZ' |
| `asset` | 资产类别: E股票 I指数 C数字货币 FT期货 FD基金 O期权 CB可转债 | 'E' |
| `adj` | 复权类型: None/qfq前复权/hfq后复权 | 'qfq' |
| `freq` | 频度: 1min/5min/15min/30min/60min/D/W/M | 'D' |
| `ma` | 均线列表 | [5, 20, 50] |
| `factors` | 股票因子: ['tor', 'vr'] | ['tor'] |
| `start_date`/`end_date` | 日期范围 | '20240101' |

```python
# 前复权日线
df = ts.pro_bar(ts_code='000001.SZ', adj='qfq', start_date='20240101', end_date='20260519')

# 上证指数
df = ts.pro_bar(ts_code='000001.SH', asset='I', start_date='20240101', end_date='20260519')

# 带均线
df = ts.pro_bar(ts_code='000001.SZ', start_date='20240101', end_date='20260519', ma=[5, 20, 50])

# 换手率+量比
df = ts.pro_bar(ts_code='000001.SZ', start_date='20240101', end_date='20260519', factors=['tor', 'vr'])
```

**Tushare MCP Server（新增）**:

通过SSE/StreamableHTTP连接服务：
```json
{
    "mcpServers": {
        "tushareMcp": {
            "url": "https://api.tushare.pro/mcp/?token=98e5e81569f4794e9e673cf812c725264bca0d23df542e7a227f4de3"
        }
    }
}
```

**Python调用**:
```python
from backend.app.data.providers.tushare_provider import TushareProvider
p = TushareProvider()

# 基础数据
funds = p.get_fund_list(market="O")                                    # 全市场基金
stocks = p.get_stock_basic(exchange='SSE', list_status='L')            # 上交所股票列表
cal = p.get_trade_cal(exchange="SSE", start_date="20260101")           # 交易日历(唯一)

# 行情数据
idx = p.get_index_daily("000300.SH", start_date="20250101")            # 指数日线(唯一)
daily = p.get_daily("000001.SZ", start_date="20250101")                # A股日线
basic = p.get_daily_basic("600519.SH", trade_date="20260519")          # 每日指标(PE/PB)
adj = p.get_adj_factor("000001.SZ")                                    # 复权因子

# 财务数据
income = p.get_income("600000.SH", start_date="20240101")              # 利润表
bs = p.get_balancesheet("600000.SH", start_date="20240101")          # 资产负债表
cf = p.get_cashflow("600000.SH", start_date="20240101")              # 现金流量表
fina = p.get_fina_indicator("600000.SH")                               # 财务指标

# 通用行情接口（支持复权/分钟）
df = ts.pro_bar(ts_code='000001.SZ', adj='qfq', start_date='20240101', end_date='20260519')
```

**独有数据**: 交易日历、指数日线、复权因子、基金份额(fund_share)、财务三表、财务指标、本地阶段收益计算

**性能**: 单次0.5-2秒，有0.15秒频控间隔

**Tushare官方API调用示例**:

```python
import tushare as ts
ts.set_token('98e5e81569f4794e9e673cf812c725264bca0d23df542e7a227f4de3')
pro = ts.pro_api()

# 基础数据
pro.fund_basic(market='E')                                    # 公募基金列表
pro.stock_basic(exchange='', list_status='L')                 # 股票基础信息
pro.stock_company(exchange='SZSE')                             # 上市公司信息
pro.trade_cal(exchange='SSE', start_date='20260101', end_date='20261231')  # 交易日历
pro.namechange(ts_code='600848.SH')                           # 股票曾用名
pro.new_share(start_date='20250101', end_date='20250630')      # IPO新股列表

# 行情数据
pro.daily(ts_code='000001.SZ', start_date='20250101', end_date='20250630')  # 日线行情
pro.daily_basic(ts_code='', trade_date='20260519')             # 每日指标
pro.adj_factor(ts_code='000001.SZ', trade_date='20260519')    # 复权因子
pro.moneyflow(trade_date='20260519')                           # 个股资金流向
pro.index_daily(ts_code='000300.SH')                          # 指数日线
pro.index_basic(market='SW')                                   # 指数基本信息
pro.fund_daily(ts_code='510330.SH', start_date='20250101')   # ETF日线
ts.pro_bar(ts_code='000001.SZ', adj='qfq', freq='D')         # 通用行情(复权)
ts.pro_bar(ts_code='000001.SZ', freq='60')                    # 分钟行情

# 财务数据
pro.income(ts_code='600000.SH', period='20241231')            # 利润表
pro.balancesheet(ts_code='600000.SH', period='20241231')     # 资产负债表
pro.cashflow(ts_code='600000.SH', period='20241231')         # 现金流量表
pro.fina_indicator(ts_code='600000.SH', period='20241231')   # 财务指标
pro.fina_audit(ts_code='600000.SH')                          # 财务审计意见
pro.fina_mainbz(ts_code='600000.SH', type='P')               # 主营业务(按产品)
pro.dividend(ts_code='600000.SH')                            # 分红送股
pro.forecast(ts_code='600000.SH')                            # 业绩预告
pro.express(ts_code='600000.SH')                             # 业绩快报

# 基金数据
pro.fund_nav(ts_code='000001.OF')                           # 基金净值
pro.fund_portfolio(ts_code='000001.OF')                     # 基金持仓
pro.fund_manager(ts_code='000001.OF')                       # 基金经理
pro.fund_div(ts_code='000001.OF')                           # 分红记录
pro.etf_basic()                                             # ETF基本信息

# 特色数据
pro.report_rc(trade_date='20260519')                        # 券商盈利预测
pro.cyq_perf(ts_code='600000.SH')                           # 每日筹码成本
pro.cyq_chips(ts_code='600000.SH')                         # 每日筹码分布
pro.broker_recommend(month='202605')                       # 券商金股

# 港股/美股
pro.hk_daily(ts_code='00700.HK', start_date='20250101')     # 港股日线
pro.hk_daily_adj(ts_code='00700.HK')                       # 港股复权行情
pro.hk_mins(ts_code='00700.HK', freq='5min')               # 港股分钟
pro.hk_income(ts_code='00700.HK', period='20241231')       # 港股利润表
pro.us_daily(ts_code='AAPL', start_date='20250101')         # 美股日线
pro.us_daily_adj(ts_code='AAPL')                           # 美股复权行情
pro.us_income(ts_code='NVDA', period='20241231')           # 美股利润表

# 新闻资讯
pro.news(src='sina', start_date='2026-05-30 09:00:00', end_date='2026-05-30 10:00:00')  # 快讯
pro.major_news(src='新浪财经')                             # 长篇新闻
pro.cctv_news(date='20260529')                             # 新闻联播
```

**踩坑记录**:
- `fund_scale` 接口不存在，代码使用 `fund_share` 获取份额数据
- `etf_daily` 接口不存在，代码使用 `fund_daily` 获取ETF日线
- `fund_adj` 在6000积分下可能返回空数据
- 日增长率(day_growth)由本地计算（前后日净值比较），非API直接返回
- `get_fund_detail` 内部串行调用多个接口（basic+nav+holdings+manager+share+rating+dividends+scale+adj+company），耗时较长
- `pro_bar` 通用行情接口目前只支持日线复权，分钟数据需单独开权限
- 财务数据接口(income/balancesheet/cashflow)每次最多返回100条记录，需循环获取
- 港股/美股/新闻资讯等接口需单独开权限，与积分无关
- `moneyflow` 按小单(5万以下)/中单(5-20万)/大单(20-100万)/特大单(100万以上)分类统计净流入
- `fina_indicator` 含150+字段，每股指标/盈利能力/偿债能力/运营能力/成长能力全覆盖
- `dividend` 字段有 `div_proc`(实施进度)区分预案和实施
- `forecast` 业绩预告的 `type` 包含:预增/预减/扭亏/首亏/续亏/续盈/略增/略减
- `sw_daily` 申万行业指数日行情是独立接口，不含在index_daily中
- 复权因子在盘前9:15~20分入库，复权价格计算: 前复权价格 = 当前价格 × 复权因子
- `fina_mainbz` 支持按产品(P)/按地区(D)/按行业(I)三种分类方式
- 港股/美股利润表(hk_income/us_income)返回格式是科目-值形式(ind_name/ind_value)
- 美股利润表区分报告期类型(Q1/Q2/Q3/Q4)和报告类型(单季报/累计报)

---

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
| `tf.klines.batch(symbols, period="1m", count=...)` | 批量历史分钟K线 | 100标的/次 | A股/ETF，30/min |
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
| P3 | Tushare fund_adj可能返回空 | 复权因子缺失 | 6000积分限制，需升级或用其他源补充 |

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
