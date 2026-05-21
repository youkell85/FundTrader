# FundTrader 数据源增强研究报告

## 执行摘要

FundTrader 项目已具备多数据源 Provider 架构（Tushare/TickFlow/iFinD/腾讯），但当前 Tushare Provider 仅实现了 5 个基础接口（fund_basic/fund_nav/fund_portfolio/fund_manager/fund_rating），大量高价值数据尚未接入。本报告评估了 Tushare Pro 全量接口、TickFlow 和 iFinD MCP 的能力，制定了分优先级的增强方案。

---

## 一、当前数据源现状

### 1.1 已有 Provider 及能力

| Provider | 优先级 | 已实现接口 | 缺失能力 |
|----------|--------|-----------|---------|
| iFinD | 5 | fund_list/detail/nav/holdings | 需要付费Token，API端点未验证 |
| Tushare | 4 | fund_basic/nav/portfolio/manager/rating/share | 缺少分红/规模/ETF/复权/行业/宏观等 |
| TickFlow | 3 | 日K线(ETF/场内) | 无基金列表/持仓/分红，免费版仅日K |
| 腾讯 | 2 | 实时行情(基金) | 无历史净值/持仓 |

### 1.2 服务层对数据源的使用

- `fund_service.py` — 直接调用 AkShare（绕过 Provider 架构）
- `analysis_service.py` — 优先使用 DataFusion，回退到 AkShare/efinance
- `professional_service.py` — 优先使用 DataFusion，回退到 efinance/AkShare
- `dca_service.py` — 直接使用 efinance（绕过 Provider 架构）

**核心问题**：fund_service 和 dca_service 未接入 Provider 架构，导致 Tushare/TickFlow/iFinD 数据无法被这些服务使用。

---

## 二、Tushare Pro 可补充的数据（按优先级）

### 2.1 高优先级 — 直接增强现有功能

| 接口 | Tushare名称 | 权限 | 补充价值 |
|------|------------|------|---------|
| 基金分红 | `fund_div` | 400积分 | 定投回测分红再投资计算、分红历史展示 |
| 基金规模 | `fund_scale` | 2000积分 | 基金规模变化趋势、规模与业绩关系分析 |
| ETF基本信息 | `etf_basic` | 2000积分 | ETF基金完整基础档案 |
| ETF日线行情 | `etf_daily` | 120积分 | ETF历史K线（TickFlow免费版替代） |
| ETF份额规模 | `etf_fund_daily` | 5000积分 | ETF每日份额变化、资金流入流出 |
| 复权因子 | `fund_adj` | 5000积分 | 精确复权净值计算，定投回测更准确 |
| 基金公司 | `fund_company` | 2000积分 | 基金公司管理规模、产品线分析 |

### 2.2 中优先级 — 新增分析维度

| 接口 | Tushare名称 | 权限 | 补充价值 |
|------|------------|------|---------|
| 交易日历 | `trade_cal` | 120积分 | 定投日期判断、回测交易日对齐 |
| 每日指标 | `daily_basic` | 2000积分 | 持仓股票PE/PB/市值等估值数据 |
| 行业分类 | `index_classify` | 2000积分 | 申万行业分类，行业分布分析 |
| 行业成分 | `index_member` | 2000积分 | 行业成分股，行业轮动分析 |
| 指数日线 | `index_daily` | 120积分 | 基准指数对比、Beta计算 |
| 财务指标 | `fina_indicator` | 2000积分 | 持仓股票ROE/毛利率等财务质量 |
| 基金技术面因子 | `fund_factor` | 专业版 | 专业技术指标（MACD/RSI/KDJ等） |

### 2.3 低优先级 — 高级功能

| 接口 | Tushare名称 | 权限 | 补充价值 |
|------|------------|------|---------|
| 宏观经济 | `cn_gdp/cn_cpi/cn_ppi/cn_pmi` | 2000积分 | 宏观经济周期分析、大类资产配置 |
| Shibor/LPR | `shibor_quote/shibor_lpr` | 120积分 | 利率环境分析 |
| 资金流向 | `moneyflow` | 5000积分 | 持仓股票资金流向 |
| 龙虎榜 | `top_list/top_inst` | 5000积分 | 持仓股票龙虎榜数据 |
| 券商盈利预测 | `earnings_estimate` | 6000积分 | 持仓股票一致预期 |
| 机构调研 | `stk_surv` | 6000积分 | 持仓股票机构调研热度 |

---

## 三、TickFlow 能力评估

### 3.1 核心能力

| 等级 | 数据 | 价格 |
|------|------|------|
| Free | 日K线、实时行情 | 免费 |
| Starter | 标的池（申万行业映射） | 付费 |
| Pro | 分钟K线 | 付费 |
| Expert | 财务数据 | 付费 |

### 3.2 对 FundTrader 的价值

- **免费版**：ETF/场内基金日K线数据（补充 efinance 不稳定时的备选）
- **Starter+**：申万行业映射（增强行业分布分析）
- **Pro+**：分钟K线（日内定投时点优化）
- **Expert+**：财务数据（持仓股票基本面分析）

### 3.3 局限性

- 不提供基金列表、基金持仓、基金分红等基金专属数据
- 主要面向股票行情，基金数据覆盖有限
- 场外基金（OFC）不在覆盖范围内

---

## 四、iFinD MCP 能力评估

### 4.1 核心能力

| 服务器 | 工具 | 数据 |
|--------|------|------|
| hexin-ifind-stock | 9个工具 | 股票摘要/选股/行情/资料/股东/财务/风险/事件/ESG |
| hexin-ifind-fund | 7个工具 | 基金搜索/资料/业绩/持有人/持仓/财务/公司 |
| hexin-ifind-edb | 1个工具 | 宏观经济数据 |
| hexin-ifind-news | 1个工具 | 公司新闻/公告 |

### 4.2 对 FundTrader 的价值

- **基金工具**：最完整的基金数据覆盖（搜索/资料/业绩/持有人/持仓/财务/公司）
- **自然语言查询**：MCP协议支持自然语言交互
- **行业分布**：持仓股票行业分类
- **ESG评级**：持仓股票ESG评分

### 4.3 局限性

- 需要同花顺 iFinD 终端账号（商业付费）
- MCP Server 通过 HTTPS 调用，需要 Authorization Token
- 当前 Provider 实现的 API 端点（`quantapi.51ifind.com`）与 MCP Server 端点（`api-mcp.51ifind.com`）不同

---

## 五、增强方案

### 5.1 Tushare Provider 增强（核心）

在现有 `tushare_provider.py` 基础上新增以下方法：

- 高优先级：get_fund_dividend, get_fund_scale, get_etf_basic, get_etf_daily, get_fund_adj, get_fund_company
- 中优先级：get_trade_cal, get_index_daily, get_stock_daily_basic

### 5.2 数据模型扩展

在 `base.py` 中新增 FundDividend, FundScale, AdjFactor 数据类

### 5.3 服务层改造

1. fund_service.py — 接入 DataFusion，不再直接调用 AkShare
2. dca_service.py — 接入 DataFusion，使用复权净值计算定投回测
3. professional_service.py — 使用 Tushare 的交易日历、指数日线、行业分类

### 5.4 iFinD MCP Provider 改造

将现有 HTTP API 调用改为 MCP Server 调用方式

### 5.5 配置增强

在 config.py 中新增 TUSHARE_TOKEN, TICKFLOW_API_KEY, IFIND_TOKEN 等环境变量

---

## 六、实施优先级

| 阶段 | 内容 | 预计工作量 |
|------|------|-----------|
| P0 | Tushare Provider 增强（分红/规模/ETF/复权） | 2小时 |
| P0 | 服务层接入 DataFusion（fund_service/dca_service） | 1小时 |
| P1 | 数据模型扩展（FundDividend/FundScale/AdjFactor） | 0.5小时 |
| P1 | Tushare 交易日历/指数日线/行业分类 | 1小时 |
| P2 | iFinD MCP Provider 改造 | 1小时 |
| P2 | TickFlow 行业映射集成 | 0.5小时 |
| P3 | 宏观经济数据接入 | 1小时 |
| P3 | 持仓股票估值/财务分析 | 1小时 |

---

## 七、Tushare 积分与权限说明

- 注册+完善资料：120积分（可调用日线/交易日历等基础接口）
- 2000积分：可调用绝大部分常规数据（基金净值/持仓/分红/规模等）
- 5000积分：复权因子/ETF份额/资金流向/龙虎榜等
- 6000积分：券商盈利预测/机构调研等特色数据
- 付费入群：5000积分/年（200元）

当前用户已有6000积分权限，可调用绝大部分接口。

---

## References

1. [Tushare Pro 数据接口文档](https://tushare.pro/document/2)
2. [Tushare Pro 使用指南](https://tushare.pro/document/1)
3. [Tushare MCP Server 配置](https://tushare.pro/document/1?doc_id=463)
4. [TickFlow 官网](https://tickflow.org/)
5. [TickFlow Assist MCP](http://www.mcpmarket.cn/server/69d54bbe3734e6f40b6a61c8)
6. [iFinD MCP 官网](https://mcp.51ifind.cn/)
7. [iFinD MCP ClawHub](https://clawhub.ai/xingjianliu0417/ifind-mcp)
8. [FinanceMCP-Tushare](https://github.com/KozSummer/FinanceMCP-Tushare)
