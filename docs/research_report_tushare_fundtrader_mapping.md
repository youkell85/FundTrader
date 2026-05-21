# Tushare Pro 基金数据接口在 FundTrader 系统中的应用映射分析报告

**报告日期**：2026-05-16  
**分析标的**：FundTrader 公募基金智能分析平台  
**数据源**：Tushare Pro (tushare.com)  
**当前系统数据源**：AkShare + efinance + EastMoney + 腾讯财经 + Tickflow + iFinD MCP

---

## 一、执行摘要

FundTrader 当前以 AkShare 和 efinance 为主要数据源，存在接口不稳定、字段名频繁变更、数据缺失等问题。Tushare Pro 提供了结构化的公募基金基础信息、净值历史、持仓明细、基金经理、基金评级等接口，数据质量高、字段稳定、支持历史回溯。本报告将 Tushare 的基金接口与 FundTrader 的五大功能模块（基金列表、基金详情、定投回测、专业分析、智能推荐）进行逐一对照映射，提出可落地的替换和增强方案，并指出 Tushare 的覆盖盲区及多源融合补救策略。

---

## 二、FundTrader 功能模块与数据需求梳理

通过对后端代码的完整审阅，系统当前包含以下核心功能模块及对应的数据依赖：

| 功能模块 | 服务文件 | 当前数据源 | 关键数据需求 |
|---------|---------|-----------|-------------|
| 基金列表与排名 | `fund_service.py` | AkShare `fund_open_fund_rank_em` | 基金代码、名称、类型、近1月/3月/6月/1年/3年收益、今年来收益、单位净值、日增长率 |
| 基金详情分析 | `analysis_service.py` | AkShare + efinance + 融合层 | 基本信息、最新净值、净值历史、基金经理、持仓明细、策略信号、雷达评分 |
| 定投回测 | `dca_service.py` | efinance `get_fund_net_value` | 历史净值序列（日频，至少60天以上） |
| 专业分析 | `professional_service.py` | efinance + AkShare | 历史净值（计算夏普、最大回撤、波动率、Calmar、Sortino）、持仓（资产配置、行业分布） |
| 智能推荐 | `recommend_service.py` | AkShare | 市场指数、行业板块热度、基金类型分类 |
| 自选管理 | `watchlist_service.py` | JSON本地存储 + AkShare回查 | 基金代码、名称、业绩数据 |

---

## 三、Tushare Pro 基金接口能力全景

Tushare Pro 提供的公募基金相关接口（基于当前适配器和已知接口）可归纳为以下六大类：

### 3.1 基础信息类

| 接口名 | 说明 | 积分要求 | 关键字段 |
|-------|------|---------|---------|
| `fund_basic` | 公募基金基础信息 | 基础权限 | ts_code, name, management, custodian, fund_type, manager, found_date, benchmark, status |
| `fund_company` | 基金公司信息 | 基础权限 | name, setup_date, city, assets |
| `fund_share` | 基金份额规模 | 基础权限 | ts_code, trade_date, fd_share |

### 3.2 净值类

| 接口名 | 说明 | 积分要求 | 关键字段 |
|-------|------|---------|---------|
| `fund_nav` | 公募基金净值 | 基础权限 | nav_date, unit_nav, accum_nav, adj_nav |
| `fund_div` | 公募基金分红 | 基础权限 | ts_code, ann_date, div_date, base_date, amount |

### 3.3 持仓类

| 接口名 | 说明 | 积分要求 | 关键字段 |
|-------|------|---------|---------|
| `fund_portfolio` | 公募基金持仓明细 | 较高积分 | ts_code, ann_date, symbol, stk_mkv_ratio |
| `fund_daily` | 场内基金日线 | 基础权限 | ts_code, trade_date, open, high, low, close, vol |

### 3.4 业绩与评级类

| 接口名 | 说明 | 积分要求 | 关键字段 |
|-------|------|---------|---------|
| `fund_rating` | 基金评级（晨星等） | 较高积分 | ts_code, ann_date, star_rating |
| `fund_weekly_rank` | 基金周排名 | 较高积分 | ts_code, nav_date, rank, total_rank |
| `fund_monthly_rank` | 基金月排名 | 较高积分 | 同上，月维度 |
| `fund_yearly_rank` | 基金年排名 | 较高积分 | 同上，年维度 |

### 3.5 基金经理类

| 接口名 | 说明 | 积分要求 | 关键字段 |
|-------|------|---------|---------|
| `fund_manager` | 基金经理信息 | 基础权限 | ts_code, name, begin_date, end_date, reward |

### 3.6 市场指数类

| 接口名 | 说明 | 积分要求 | 关键字段 |
|-------|------|---------|---------|
| `index_daily` | 指数日线行情 | 基础权限 | ts_code, trade_date, close, pct_chg |
| `index_basic` | 指数基础信息 | 基础权限 | ts_code, name, market |

---

## 四、逐模块接口映射与替代方案

### 4.1 基金列表与排名模块 (`fund_service.py`)

**当前实现**：
- 全量排名：`ak.fund_open_fund_rank_em(symbol="全部")` → 返回带业绩排名的全量基金列表
- 单只业绩回查：`ak.fund_open_fund_rank_em(symbol="全部")` 后按代码筛选 → 获取单位净值、日增长率、近1月/3月/6月/1年/3年/今年来收益
- 备选：`eastmoney_fetcher.get_fund_ranking_em()`

**Tushare 替代方案**：

Tushare 没有直接的"全量基金排名"接口，但可以通过组合接口实现更稳定的数据获取：

| 数据项 | Tushare 接口 | 映射说明 |
|-------|-------------|---------|
| 基金代码列表 | `fund_basic(market="E")` | 获取全部开放式基金基础信息，代码需去除 `.OF` 后缀 |
| 基金名称 | `fund_basic` 的 `name` 字段 | 直接替换 |
| 单位净值 + 日增长率 | `fund_nav` 最新一条 | 需逐个基金查询，效率较低 |
| 阶段收益（近1月/3月/6月/1年/3年/今年来）| **无直接接口** | 需用 `fund_nav` 历史数据自行计算 |

**关键结论**：
- Tushare **不适合直接替换**全量基金排名功能，因为 `fund_nav` 逐个查询效率低，`fund_weekly_rank`/`fund_monthly_rank`/`fund_yearly_rank` 是排名接口但覆盖度和实时性不如 AkShare 的 `fund_open_fund_rank_em`
- **建议策略**：保留 AkShare/EastMoney 作为全量排名的主数据源，Tushare 的 `fund_basic` 用于** enriching（富化）** 基金列表的基础信息（如基金公司、托管行、成立日期、业绩基准）
- 自选基金列表的**单只业绩查询**可改用 Tushare `fund_nav` + 本地计算阶段收益，避免依赖 AkShare 易变的列名

### 4.2 基金详情分析模块 (`analysis_service.py`)

**当前实现**：多数据源融合层（DataFusion）优先，失败回退到 legacy（AkShare + efinance）

**Tushare 在融合层中的应用（已有适配）**：

当前 `tushare_provider.py` 已对接以下接口：

| 数据项 | Tushare 接口 | 当前适配状态 | 质量评估 |
|-------|-------------|------------|---------|
| 基金基本信息 | `fund_basic(ts_code=code.OF)` | 已适配 | 高，字段稳定 |
| 历史净值 | `fund_nav(ts_code=code.OF)` | 已适配 | 高，但**不含日增长率**字段 |
| 持仓明细 | `fund_portfolio(ts_code=code.OF)` | 已适配 | 中，持仓名称字段为 `symbol` 可能不完整 |

**增强建议**：

1. **净值日增长率补充**：Tushare `fund_nav` 返回的字段中没有日增长率（`day_growth`），需要在 `tushare_provider.py` 中增加本地计算逻辑：按日期排序后，用 `(当日单位净值 - 前一日单位净值) / 前一日单位净值 * 100` 计算。当前代码中 `day_growth=None` 是明显缺陷，导致融合层缺失日涨幅数据。

2. **基金经理信息增强**：当前通过 AkShare `fund_manager_em()` 获取，Tushare 提供 `fund_manager` 接口可直接查询单只基金的历任基金经理及任职回报，字段更精准。建议在融合层中增加 `fund_manager` 调用。

3. **基金评级数据**：Tushare `fund_rating` 可获取晨星评级，这是当前系统完全缺失的数据维度。评级信息可用于详情页展示和风险评估增强。

4. **份额规模数据**：Tshhare `fund_share` 可获取基金规模变动，用于详情页展示基金规模趋势，辅助判断基金是否过小（清盘风险）或过大（灵活性下降）。

### 4.3 定投回测模块 (`dca_service.py`)

**当前实现**：`efinance.fund.get_fund_net_value(code)` 获取历史净值，本地计算定投策略

**Tushare 替代方案**：

| 数据需求 | Tushare 接口 | 可行性 |
|---------|-------------|--------|
| 历史净值序列（日频）| `fund_nav(ts_code=code.OF)` | 完全可行，数据质量高 |
| 定投回测计算 | 本地逻辑 | 无需变更 |

**关键结论**：
- Tushare `fund_nav` 完全可以替代 efinance 作为定投回测的净值数据源
- 优势：Tushare 的数据更稳定、字段名固定、支持更长的历史回溯
- **实施建议**：在 `dca_service.py` 中增加 Tushare 路径，优先使用融合层的 `get_fund_nav()`，失败时回退到 efinance

### 4.4 专业分析模块 (`professional_service.py`)

**当前实现**：
- 净值历史：`efinance_fetcher.get_fund_nav_history(code)` → 计算夏普、最大回撤、波动率、Calmar、Sortino
- 持仓信息：`akshare_fetcher.get_fund_portfolio(code)` → 资产配置、行业分布（当前行业分布为占位实现）

**Tushare 替代方案**：

| 分析维度 | 当前数据源 | Tushare 接口 | 替代可行性 |
|---------|-----------|-------------|-----------|
| 夏普比率 / 最大回撤 / 波动率 / Calmar / Sortino | efinance 净值 | `fund_nav` | 完全可行，数据源可无缝替换 |
| 资产配置（股债现金占比）| AkShare 持仓 | `fund_portfolio` | 可行，Tushare 持仓含 `stk_mkv_ratio`（股票市值占比）|
| 行业分布 | AkShare 持仓（待完善）| `fund_portfolio` + 股票行业映射 | **需补充**：Tushare 持仓只返回股票代码和占比，需额外调用 `stock_basic`/`stock_company` 或 `index_classify` 获取个股所属行业后才能汇总行业分布 |

**关键结论**：
- 风险指标计算的数据源可由 Tushare `fund_nav` 完全承载
- 行业分布是当前系统的未实现功能，Tushare 提供了基础持仓数据，但**需要二次开发**将股票代码映射到申万/中信行业分类后才能实现真正的行业分布饼图

### 4.5 智能推荐模块 (`recommend_service.py`)

**当前实现**：
- 市场指数：`akshare_fetcher.get_market_index()` → 上证指数、深证成指、创业板指
- 行业热度：`akshare_fetcher.get_fund_industry_board()` → 行业板块涨跌
- 基金配置：从国元证券内置名单按风险偏好模板匹配

**Tushare 替代方案**：

| 数据需求 | Tushare 接口 | 说明 |
|---------|-------------|------|
| 市场指数行情 | `index_daily(ts_code="000001.SH")` 等 | 可替换，数据更稳定 |
| 行业板块热度 | `stock_board_industry_name_em` (AkShare) 无直接 Tushare 对应 | Tushare 的行业数据需通过 `index_classify` + `index_member` 构建，较为复杂 |
| 基金筛选 | `fund_basic` + `fund_rating` | 可用 Tushare 的基金基础信息和评级数据增强推荐算法的筛选逻辑 |

**关键结论**：
- 市场指数部分可用 Tushare `index_daily` 替换
- 行业热度部分 Tushare 没有直接对等的便捷接口，建议保留 AkShare
- 推荐算法当前依赖国元内置名单，可引入 Tushare `fund_rating` 作为评分维度，提升推荐质量

---

## 五、数据融合层 (DataFusion) 优化建议

当前融合层已正确将 Tushare 设为优先级4（次于 iFinD 的5，高于 Tickflow 的3和腾讯的2），但存在以下可优化点：

### 5.1 TushareProvider 已知缺陷修复

1. **净值日增长率计算缺失**（高优先级）：
   - 位置：`tushare_provider.py:138`
   - 问题：`day_growth=None`
   - 修复：在 `get_fund_nav()` 中按日期排序后，计算相邻日期的净值变化率

2. **持仓名称字段不准确**（中优先级）：
   - 位置：`tushare_provider.py:156`
   - 问题：`name=row.get("symbol", "")` 返回的是股票代码而非名称
   - 修复：Tushare `fund_portfolio` 的返回字段中，股票名称通常为 `name` 或需通过 `stock_basic` 补充查询

3. **基金经理信息缺失**（中优先级）：
   - 当前 `get_fund_detail()` 只从 `fund_basic` 取了 `manager` 字段（单个名字）
   - 建议增加 `fund_manager` 接口调用，返回任职日期、回报等详细信息

### 5.2 融合策略增强

1. **阶段收益计算**：当前 `fund_service.py` 的 `_fetch_fund_performance()` 依赖 AkShare 排名接口返回的阶段收益。建议增加一个**Tushare 本地计算阶段收益**的路径：用 `fund_nav` 获取近3年净值，本地计算近1月/3月/6月/1年/3年/今年来收益，降低对 AkShare 排名接口的依赖。

2. **基金评级融合**：Tushare `fund_rating` 获取的评级数据可作为独立字段加入 `FundDetail` 数据类，在详情页展示晨星评级。

3. **规模数据融合**：Tushare `fund_share` 可加入 `FundBasic`，在详情页展示最新规模及规模趋势。

---

## 六、Tushare 覆盖盲区与多源补救策略

| 数据需求 | Tushare 支持情况 | 补救数据源 | 说明 |
|---------|-----------------|-----------|------|
| 实时行情快照 | 不支持实时 | 腾讯财经 `qt.gtimg.cn` | 腾讯提供实时净值和估算涨跌幅 |
| 基金估值（盘中估算）| 不支持 | Tickflow / 腾讯财经 | 用于盘中参考 |
| 全量基金业绩排名 | 无直接接口 | AkShare / EastMoney | 保留现有实现 |
| 行业板块热度 | 无便捷接口 | AkShare | 保留现有实现 |
| 港股基金 / QDII 海外持仓 | 覆盖有限 | iFinD MCP | iFinD 覆盖更广 |
| ETF 申赎清单 | 不支持 | 需专用数据源 | 当前系统不涉及 |

---

## 七、实施路线图

### Phase 1：修复 TushareProvider 缺陷（1-2天）
- [ ] 修复 `fund_nav` 日增长率计算
- [ ] 修复 `fund_portfolio` 持仓名称解析
- [ ] 增加 `fund_manager` 接口调用

### Phase 2：增强融合层能力（2-3天）
- [ ] 在 `FundDetail` 中增加 `rating`（基金评级）和 `share`（份额规模）字段
- [ ] 实现 Tushare 本地阶段收益计算（替代 AkShare 排名接口的部分场景）
- [ ] 在 `analysis_service.py` 中优先使用融合层的风险指标数据

### Phase 3：逐步替换 legacy 数据源（3-5天）
- [ ] 定投回测模块：`dca_service.py` 接入融合层 `get_fund_nav()`
- [ ] 专业分析模块：`professional_service.py` 接入融合层
- [ ] 基金列表模块：保留 AkShare 全量排名，但用 `fund_basic` 富化基础信息

### Phase 4：数据质量验证（持续）
- [ ] 对比 Tushare 与 efinance/AkShare 的净值数据一致性
- [ ] 验证持仓数据的完整性和时效性
- [ ] 监控各数据源的可用性，自动降级

---

## 八、核心结论

1. **Tushare 是 FundTrader 的理想结构化数据底座**：`fund_basic`、`fund_nav`、`fund_portfolio` 三个核心接口的数据质量显著优于 AkShare 和 efinance，字段稳定、历史完整、更新及时。

2. **Tushare 不能100%替代现有数据源**：全量排名、实时行情、行业热度等场景仍需依赖 AkShare/EastMoney/腾讯财经。多源融合架构（当前已实现的 DataFusion）是正确的方向。

3. **当前 TushareProvider 存在3个可快速修复的缺陷**：日增长率缺失、持仓名称不准确、基金经理信息单薄。修复后 Tushare 在融合层的价值将显著提升。

4. **最大收益点在定投回测和专业分析**：这两个模块完全依赖历史净值序列，Tushare `fund_nav` 可以稳定替代 efinance，消除 efinance 接口不稳定导致的回测失败问题。

5. **行业分布是下一个可开发的功能**：Tushare `fund_portfolio` 提供持仓股票代码和占比，结合 `stock_basic` 的行业分类字段，可以实现真正的行业分布分析，填补当前系统的空白。

---

*本报告基于 FundTrader 后端代码完整审阅及 Tushare Pro 接口文档分析生成。*
