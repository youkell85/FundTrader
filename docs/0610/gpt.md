# FundTrader 智能配置功能数据真实性审计与改进方案

生成日期: 2026-06-10  
审计对象: FundTrader 智能配置功能 `/allocation/generate` 及其 14 步配置管线  
审计范围: 宏观数据、CMA 市场假设、SAA 战略配置、市场体制检测、TAA 战术调整、熔断器、约束检验、基金映射、蒙特卡洛、压力测试、因子暴露、情景分析、组合指标与前端展示

## 1. 总体结论

FundTrader 的智能配置不是整体虚假系统。它确实存在真实数据链路，包括 Tushare、AkShare、efinance、TickFlow、外汇 API、SQLite 缓存和本地基金数据快照等。但当前实现是“真实数据 + 静态先验 + 降级兜底”的混合系统，部分静态假设没有被充分标记，部分数据质量异常会直接污染最终输出。

综合可信度评估: 55/100。

主要原因:

1. 生产状态下宏观缓存存在，但 rolling stats 和 vol_ratio 不可用，CMA 信号层和熔断器无法完整使用真实数据。
2. 本地真实刷新后，货币基金代表资产 `511880` 的价格序列出现从约 `100.074` 到 `1.0` 的异常跳点，导致货基年化收益约 `-465.17%`、波动率约 `460.57%`。
3. 异常 CMA 输入导致蒙特卡洛输出 `NaN`，严格 JSON 序列化会失败，生成接口存在 500 风险。
4. 压力测试、因子暴露、情景概率、CMA anchor、基金池基础信息等大量来自硬编码或静态假设。
5. 数据来源、覆盖率、降级原因没有在最终响应中形成统一、可审计的数据质量合同。

## 2. 审计证据摘要

### 2.1 执行链路

后端入口:

- `backend/app/api/allocation.py`
- `/allocation/generate`
- `/allocation/generate/stream`

核心管线:

- `backend/app/allocation/orchestrator.py`
- `run(request)` 执行 14 步:
  1. risk_profiling
  2. cma_estimation
  3. saa_optimization
  4. regime_detection
  5. taa_adjustment
  6. circuit_breaker
  7. constraint_check
  8. fund_mapping
  9. monte_carlo
  10. stress_test
  11. factor_exposure
  12. scenario_analysis
  13. portfolio_metrics
  14. output_assembly

### 2.2 生产状态

生产 API 返回:

```json
{
  "last_refresh": "2026-06-10T02:31:45.848071",
  "macro_available": true,
  "macro_confidence": 0.7,
  "rolling_stats_available": false,
  "vol_ratio": null
}
```

含义:

- 宏观缓存可用，但置信度偏中等。
- CMA 信号层所需 rolling stats 不可用。
- 熔断器所需 vol_ratio 不可用。
- 生产环境如果生成配置，很可能偏向静态先验和默认不触发熔断。

### 2.3 本地真实刷新样本

本地刷新后:

- `macro_confidence`: 约 0.869
- `rolling_stats_available`: true
- `vol_ratio`: 1.284
- 熔断器 Level 1 触发，权益仓位降低 10%

但货基数据异常:

```text
511880 last5: [100.129, 100.106, 100.074, 1.0, 1.0]
money_fund rolling_return_long: -465.17
money_fund rolling_vol_long: 460.57
money_fund CMA expected_return: -184.87
```

随后蒙特卡洛输出:

```text
median_return: NaN
var_95: NaN
cvar_95: NaN
max_drawdown_95: NaN
```

严格 JSON 序列化错误:

```text
Out of range float values are not JSON compliant: nan
```

## 3. 模块问题与修复方案

## P0 - 必须优先修复

### 3.1 市场数据质量闸门

相关文件:

- `backend/app/allocation/data/market_data_fetcher.py`
- `backend/app/allocation/data/market_data_service.py`

问题:

- `money_fund` 使用 `511880` 作为代表 ETF，并按普通价格序列计算 log return。
- 价格序列没有跳点检测。
- 异常数据会进入 rolling stats，再进入 CMA、SAA 和蒙特卡洛。
- `reits` 数据缺失时没有足够强的数据质量标记。

修复方案:

1. 增加价格序列质量校验函数。

建议新增:

```python
def _validate_price_series(asset_class: str, code: str, prices: np.ndarray) -> tuple[bool, str | None]:
    if prices is None or len(prices) < MIN_DAYS:
        return False, "insufficient_points"
    if not np.all(np.isfinite(prices)) or np.any(prices <= 0):
        return False, "non_positive_or_non_finite_price"
    log_returns = np.diff(np.log(prices))
    if not np.all(np.isfinite(log_returns)):
        return False, "non_finite_return"
    if np.nanmax(np.abs(log_returns)) > 0.25:
        return False, "abnormal_price_jump"
    if asset_class in {"money_fund", "cash"} and np.nanstd(log_returns[-60:]) > 0.02:
        return False, "money_fund_vol_too_high"
    return True, None
```

2. `money_fund` 不再使用普通 ETF NAV 计算收益。

短期方案:

- `money_fund` 使用货币基金 7 日年化或万份收益。
- 如真实收益率源不可用，则使用保守先验:
  - expected return: 1.5% - 2.2%
  - annualized vol: 0.2% - 0.8%
  - source: `model_assumption`
  - data_status: `partial`

中期真实源:

- AkShare 货币基金收益接口
- 天天基金/东方财富货币基金收益
- Tushare fund_daily 或 fund_nav 中可确认口径的数据
- iFinD 货币基金 7 日年化

3. 返回资产级数据质量。

建议 rolling stats 扩展为:

```python
{
  "returns_long": {...},
  "vols_long": {...},
  "correlation_matrix": [...],
  "quality": {
    "money_fund": {
      "status": "partial",
      "source": "model_assumption",
      "reason": "money_fund_price_jump_rejected",
      "as_of": "2026-06-10"
    }
  }
}
```

测试:

- 构造 `511880` 从 100 跳到 1 的价格序列，断言被拒绝。
- 断言被拒绝资产不会进入 CMA signal layer。
- 断言接口最终不返回 NaN。

### 3.2 CMA 输入校验和降级

相关文件:

- `backend/app/allocation/cma_manager.py`
- `backend/app/allocation/models.py`
- `backend/app/allocation/orchestrator.py`

问题:

- CMA signal layer 没有过滤极端年化收益和极端波动率。
- 单个资产异常可以污染整个组合。
- `saa.data_status` 只在 CMA 整体异常或协方差缺失时标记 partial，不够细。

修复方案:

1. 在 `_get_signal_layer()` 后增加资产级清洗。

建议阈值:

- 权益类年化收益: `[-80%, 120%]`
- 固收类年化收益: `[-30%, 40%]`
- 货币/现金年化收益: `[-2%, 8%]`
- 商品/黄金年化收益: `[-60%, 100%]`
- 年化波动率统一不得大于 100%，货币基金不得大于 3%

2. 异常资产只回退该资产的 anchor，不应污染其他资产。

伪代码:

```python
def _sanitize_signal_layer(signal_returns, signal_vols, quality):
    valid_assets = []
    invalid_assets = {}
    for asset in ASSET_CLASSES:
        ok, reason = _validate_signal(asset, signal_returns.get(asset), signal_vols.get(asset))
        if ok:
            valid_assets.append(asset)
        else:
            signal_returns[asset] = None
            signal_vols[asset] = None
            invalid_assets[asset] = reason
    return signal_returns, signal_vols, valid_assets, invalid_assets
```

3. CMAResult 增加数据质量字段。

建议模型:

```python
class CMAQuality(BaseModel):
    data_status: Literal["real", "partial", "assumption", "missing"]
    blend_lambda: float
    valid_assets: list[str]
    invalid_assets: dict[str, str]
    rolling_coverage: float
    source: str
```

4. 只有当 rolling coverage 足够、关键资产通过校验时，`saa.data_status` 才能是 `real`。

测试:

- `money_fund=-465%` 时 CMA 应标记 partial。
- 蒙特卡洛应被跳过或降级。
- `saa.risk_contribution_source` 和 `missing_reason` 应解释原因。

### 3.3 蒙特卡洛 NaN 防护

相关文件:

- `backend/app/allocation/monte_carlo.py`
- `backend/app/allocation/orchestrator.py`

问题:

- `np.power(1 + annual_returns, 1 / 12.0)` 在 annual return 小于 -100% 时产生 NaN。
- 当前 NaN 没有被拦截，步骤仍可能显示 ok。

修复方案:

1. 在 `simulate()` 开头校验。

```python
annual_returns = np.array([...])
if not np.all(np.isfinite(annual_returns)):
    raise ValueError("CMA expected returns contain non-finite values")
if np.any(annual_returns <= -0.99):
    raise ValueError("CMA expected returns <= -99%, invalid for compounding")
```

2. 计算结果也做 finite 校验。

```python
values = [median_return, p10, p25, p75, p90, var_95, cvar_95, max_dd_95]
if not all(np.isfinite(v) for v in values):
    raise ValueError("Monte Carlo produced non-finite result")
```

3. orchestrator 中捕获后降级:

```python
except Exception as e:
    mc_result = None
    d.status = "degraded"
    d.detail = f"Monte Carlo unavailable: {str(e)[:80]}"
    warnings.append("蒙特卡洛模拟不可用，原因: CMA 输入异常或数据不足")
```

测试:

- 构造 `money_fund=-184.87%` 的 CMAResult，断言 `simulate()` 抛错。
- 断言 `run()` 返回 `monte_carlo=None` 或明确 degraded，而不是 NaN。
- 使用 `json.dumps(jsonable_encoder(resp), allow_nan=False)` 作为测试断言。

### 3.4 生产健康状态必须反映数据缺失

相关文件:

- `backend/app/allocation/data/market_data_service.py`
- `backend/app/allocation/orchestrator.py`
- `backend/app/main.py`
- `frontend/src/components/allocation/DataFreshnessBar.tsx`

问题:

- 生产 `rolling_stats_available=false`、`vol_ratio=null` 仍可能让用户认为配置真实有效。
- pipeline health 当前只记录最近一次运行，对启动后缓存状态不够敏感。

修复方案:

1. `market_data_service.get_status()` 增加:

```python
{
  "health": "healthy|degraded|critical",
  "missing": ["rolling_stats", "volatility"],
  "macro_sources": {...},
  "asset_coverage": 0.0,
  "stale_indicators": [...]
}
```

2. 如果 `rolling_stats_available=false`，CMA 标记 partial。

3. 如果 `vol_ratio=null`，熔断器返回:

```python
{
  "triggered": false,
  "data_status": "missing",
  "missing_reason": "vol_ratio unavailable"
}
```

4. 前端显示:

- 真实数据完整
- 部分真实数据
- 静态假设
- 数据缺失，不建议执行

测试:

- mock status: rolling false + vol null，断言 pipeline health 为 degraded。
- 前端快照测试 DataFreshnessBar 显示缺失状态。

## P1 - 替换硬编码和伪真实数据

### 4.1 宏观数据替换计划

相关文件:

- `backend/app/allocation/data/macro_fetcher.py`

当前问题:

- 财政赤字率硬编码 3.0。
- DR007 可能降级到 Shibor 或 LPR 代理。
- 美元指数来自免费外汇 API 公式计算。
- FED 模型使用中国 10Y 国债与美联储利率组合，口径不一致。

指标替换方案:

| 指标 | 当前来源 | 改进来源 | 降级策略 |
| --- | --- | --- | --- |
| PMI | Tushare/AkShare | 国家统计局/Tushare/iFinD | stale cache |
| GDP | Tushare/AkShare | 国家统计局/Tushare/iFinD | stale cache |
| CPI/PPI | Tushare/AkShare | 国家统计局/Tushare/iFinD | stale cache |
| 10Y 中国国债 | Tushare/AkShare | 中债估值/iFinD/Tushare | stale cache |
| DR007 | AkShare/Tushare proxy | CFETS/iFinD/央行公开市场 | proxy with low confidence |
| 社融/M2 | Tushare/AkShare | PBOC/Tushare/iFinD | stale cache |
| 北向资金 | AkShare | 港交所/东方财富/iFinD | stale cache |
| 财政赤字率 | hardcoded 3.0 | 财政部预算报告/iFinD EDB | None, not static value |
| 美联储利率 | AkShare | FRED/iFinD/AkShare | stale cache |
| 美国 10Y | 当前缺失 | FRED/iFinD/AkShare | None |
| 美元指数 | forex formula | FRED DEXUSEU/DTWEXBGS/iFinD | formula with medium confidence |

实现步骤:

1. 新增 `MacroSource` 配置表。
2. 每个 fetcher 返回 `MacroIndicator(value, source, confidence, as_of, ttl_seconds)`。
3. 如果无法获取真实值，返回 `value=None`，不要用硬编码默认值。
4. 对于 proxy 数据，必须把 `source` 写成 `proxy:<name>`，并降低 confidence。

### 4.2 TAA 因子权重真实化

相关文件:

- `backend/app/allocation/taa_engine.py`
- `backend/app/allocation/data/market_data_service.py`

问题:

- 当前所谓 IC adaptive 不是严格 IC。它用单期宏观值和整体置信度构造 `ic_mean`。

修复方案:

短期:

- 改名为 `confidence_adaptive_weights`，不要叫 IC。
- UI 显示“置信度加权”，不是“历史预测力”。

中期:

- 建立宏观月度时间序列缓存表。
- 建立代表资产未来收益序列。
- 对每类信号计算:
  - 1 个月 forward return IC
  - 3 个月 forward return IC
  - 6 个月 forward return IC
  - ICIR
  - half-life
  - 样本数

建议新增表:

```sql
CREATE TABLE macro_history (
  indicator TEXT,
  as_of TEXT,
  value REAL,
  source TEXT,
  confidence REAL,
  PRIMARY KEY (indicator, as_of)
);

CREATE TABLE factor_ic_stats (
  category TEXT PRIMARY KEY,
  ic_1m REAL,
  ic_3m REAL,
  ic_6m REAL,
  icir REAL,
  half_life_months REAL,
  sample_size INTEGER,
  updated_at TEXT
);
```

测试:

- 样本数不足时回退静态权重，并标记 `data_status=partial`。
- IC 权重总和等于 1。
- 极端单个指标不得让某类权重超过上限，例如 35%。

### 4.3 压力测试真实化

相关文件:

- `backend/app/allocation/stress_test.py`
- `backend/app/allocation/config.py`

问题:

- 压力场景向量写死。
- 可转债三维冲击参数写死。
- 输出没有说明是历史实测还是专家假设。

修复方案:

1. 建立历史场景窗口:

```python
SCENARIO_WINDOWS = {
    "2008_global_crisis": ("2008-01-01", "2008-12-31"),
    "2015_a_share_crash": ("2015-06-01", "2015-09-30"),
    "2018_trade_war": ("2018-01-01", "2018-12-31"),
    "2020_covid": ("2020-02-01", "2020-04-30"),
    "2022_stock_bond_selloff": ("2022-01-01", "2022-12-31"),
}
```

2. 对每个代表 ETF 自动计算窗口最大回撤、区间收益、VaR。

3. 数据缺失资产使用专家假设，但输出:

```json
{
  "scenario": "2008 全球金融危机",
  "impact": -37.5,
  "source": "historical_window",
  "coverage": 0.86,
  "assumption_assets": ["reits"]
}
```

4. 可转债参数使用历史中证转债指数或代表 ETF 校准。

测试:

- 历史窗口计算结果固定在测试 fixture 中。
- 数据缺失时 coverage 正确下降。
- 所有 stress impact 都 finite。

### 4.4 因子暴露真实化

相关文件:

- `backend/app/allocation/factor_exposure.py`
- `backend/app/allocation/config.py`

问题:

- 当前因子载荷完全来自静态 `FACTOR_LOADINGS`。

修复方案:

1. 建立动态因子收益序列:

- equity_beta: 沪深300/中证全指
- term_premium: 中债国债指数或 10Y 收益率变化
- credit_premium: 信用债指数 - 国债指数
- inflation: CPI/PPI 或商品指数
- liquidity: DR007、融资余额、北向资金

2. 对每个资产代表 ETF 做 rolling regression:

```python
asset_return = alpha + b1 * equity + b2 * term + b3 * credit + b4 * inflation + b5 * liquidity
```

3. 样本不足时:

- 使用静态载荷。
- 标记 `factor_source=static_assumption`。

测试:

- 回归样本不足时不报错。
- 动态载荷维度完整。
- 暴露计算结果 finite 且落入合理范围。

### 4.5 基金映射动态化

相关文件:

- `backend/app/allocation/fund_mapper.py`
- `backend/app/allocation/fund_data_refresher.py`
- `backend/app/allocation/fund_scorer.py`

问题:

- `_FUND_POOL` 是静态候选池。
- 费率、规模、基础质量大量硬编码。
- 动态刷新失败时静默回退静态元数据。
- `fund_data_refresher.py` 注释称四层 fallback，但实际 `_fetch_nav_series()` 没有 AkShare 最终 fallback。

修复方案:

1. 新增基金候选池表:

```sql
CREATE TABLE allocation_fund_universe (
  code TEXT PRIMARY KEY,
  name TEXT,
  asset_class TEXT,
  fund_type TEXT,
  company TEXT,
  management_fee REAL,
  custody_fee REAL,
  aum REAL,
  daily_turnover REAL,
  tracking_error REAL,
  source TEXT,
  as_of TEXT,
  updated_at TEXT
);
```

2. 数据来源:

- 基金基础信息: Tushare fund_basic、东方财富基金列表
- 费率: 东方财富基金详情、Tushare、iFinD
- 规模: 基金定期报告、Tushare fund_share、东方财富
- NAV: efinance/Tushare/AkShare
- ETF 成交额: TickFlow/efinance/交易所行情

3. `_FUND_POOL` 只作为 fallback allowlist，不作为默认真实池。

4. FundItem 增加:

```python
data_status: str
source: str
as_of: str | None
missing_reason: str | None
```

5. 如果某只基金只有静态评分，前端展示“静态候选，指标未刷新”。

测试:

- 动态池为空时使用 fallback，并标记 assumption。
- NAV 刷新失败不应伪装成真实评分。
- 基金映射覆盖率低于阈值时 warnings 必须包含原因。

## P2 - 参数合理化和产品优化

### 5.1 SAA 参数版本化

相关文件:

- `backend/app/allocation/config.py`
- `backend/app/allocation/saa_engine.py`

问题:

- `EQUILIBRIUM_RETURNS`
- `EQUILIBRIUM_VOLS`
- `DEFAULT_CORR`
- `RISK_BUDGETS`
- `FALLBACK_TEMPLATES`

这些均为源码内静态参数。

修复方案:

1. 建立模型参数表:

```sql
CREATE TABLE model_assumptions (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  version TEXT NOT NULL,
  source TEXT NOT NULL,
  reviewed_at TEXT,
  reviewer TEXT,
  notes TEXT
);
```

2. 启动时加载参数版本。

3. 响应中输出:

```json
{
  "model_version": "cma_anchor_2026q2",
  "assumption_source": "internal_research",
  "reviewed_at": "2026-06-10"
}
```

4. L4/L5 fallback 必须在输出中标明。

测试:

- 参数缺失时服务启动失败或明确降级。
- 参数版本变更有快照测试。

### 5.2 情景分析改造

相关文件:

- `backend/app/allocation/scenario_analysis.py`

问题:

- 固定概率 25/50/25。
- 固定 multiplier。
- 使用静态 `EQUILIBRIUM_RETURNS`，不使用动态 CMA。

修复方案:

1. 函数签名改为:

```python
def analyze_scenarios(allocations, regime, cma, macro_quality) -> ScenarioAnalysis:
```

2. 概率随 regime 调整:

- goldilocks: 乐观权重更高
- stagflation/deflation: 悲观权重更高
- baseline: 维持中性

3. 基准收益使用 `cma.expected_returns`。

4. 输出:

```json
{
  "method": "regime_adjusted_cma",
  "data_status": "partial",
  "weighted_return": 4.8
}
```

测试:

- 不同 regime 下概率总和等于 1。
- 无 CMA 时明确 fallback。

### 5.3 前端展示和用户保护

相关文件:

- `frontend/src/hooks/useAllocationData.ts`
- `frontend/src/pages/allocation/OverviewPage.tsx`
- `frontend/src/pages/allocation/StrategyPage.tsx`
- `frontend/src/pages/allocation/MarketPage.tsx`

当前已有优点:

- MOCK_DATA 被标记为演示数据。
- 保存、执行、回测等关键动作已有阻断。

改进:

1. 在真实输出中也显示数据质量，不只区分 mock/real。
2. 增加状态:

- real_complete
- real_partial
- assumption_heavy
- degraded
- invalid

3. 如果 `monte_carlo=None` 或 `saa.data_status != real`，执行计划页给出风险提示。

测试:

- mock 数据不可保存。
- partial 数据可查看但需确认风险。
- invalid 数据阻断保存和执行。

## 6. 测试验证方案

### 6.1 后端单元测试

新增测试文件建议:

- `backend/tests/test_allocation_data_quality.py`
- `backend/tests/test_allocation_cma_guardrails.py`
- `backend/tests/test_allocation_monte_carlo.py`
- `backend/tests/test_allocation_pipeline_contract.py`

关键用例:

1. `test_money_fund_abnormal_jump_rejected`
2. `test_rolling_stats_records_invalid_assets`
3. `test_cma_excludes_invalid_signal_asset`
4. `test_monte_carlo_rejects_return_below_minus_99_percent`
5. `test_allocation_response_strict_json_serializable`
6. `test_pipeline_health_degraded_when_rolling_stats_missing`
7. `test_fiscal_deficit_missing_does_not_affect_taa`
8. `test_stress_scenario_reports_coverage`
9. `test_fund_mapping_static_fallback_marked_partial`

### 6.2 集成测试

建议使用录制 fixture，不在 CI 中实时打外部 API。

目录:

```text
backend/tests/fixtures/allocation/
  macro_snapshot_real.json
  rolling_stats_valid.json
  rolling_stats_money_fund_jump.json
  fund_universe_sample.json
```

集成断言:

- `/allocation/generate` 返回 200。
- 响应不含 NaN/Inf。
- `data_quality` 完整。
- 如果 rolling stats 不足，响应必须 degraded。
- 如果 MC 降级，warnings 必须解释。

### 6.3 前端测试

新增或扩展 Vitest:

- `frontend/api/allocation-data-quality.test.ts`
- `frontend/src/pages/allocation/*.test.tsx`

用例:

- partial 数据显示黄色状态。
- invalid 数据阻断保存/执行。
- stress/source/coverage 正确渲染。
- monte_carlo 缺失时不渲染假图表。

### 6.4 生产验证

部署后验证命令:

```bash
curl http://43.160.226.62/fund/api/market-data/status
curl http://43.160.226.62/fund/api/allocation/pipeline-health
curl http://43.160.226.62/fund/api/health
```

验收标准:

- `rolling_stats_available=true` 或明确 degraded。
- `vol_ratio` 有值或明确 missing。
- `asset_coverage >= 0.7`。
- `/allocation/generate` 无 NaN。
- `saa.data_status` 与真实数据覆盖一致。
- 货基收益和波动率在合理范围。

## 7. 实施路线图

### 第 1-2 天: P0 数据安全修复

任务:

1. 增加价格序列质量闸门。
2. 货币基金特殊处理。
3. CMA 极值过滤。
4. 蒙特卡洛 finite 校验。
5. 严格 JSON 序列化测试。

风险:

- 修复后可能更多输出被标记 degraded，短期看起来“可用性下降”。

缓解:

- 前端清楚展示 degraded 原因。
- 保留保守模型假设作为 fallback，但不得伪装真实。

### 第 3-5 天: 数据质量合同

任务:

1. CMAResult、SAASummary、TAASummary、FundItem 增加 data quality 字段。
2. market-data/status 增加资产覆盖、宏观来源、缺失原因。
3. pipeline-health 反映缓存缺失。
4. 前端展示数据质量。

风险:

- 前后端类型变更影响页面。

缓解:

- 字段向后兼容，新增 optional 字段。

### 第 6-10 天: 替换关键硬编码数据

任务:

1. 财政赤字率接入真实源或返回 None。
2. FED model 新增美国 10Y。
3. 压力测试改为历史窗口计算。
4. 基金候选池数据库化。
5. fund_data_refresher 补齐 AkShare fallback 或修正文档。

风险:

- 外部 API 稳定性和字段变化。

缓解:

- 所有外部数据进入缓存表。
- CI 使用 fixture，不依赖实时网络。

### 第 11-15 天: 模型参数和因子升级

任务:

1. model_assumptions 表。
2. factor loadings rolling regression。
3. 真实 IC 或改名 confidence adaptive。
4. 情景分析使用动态 CMA 和 regime probability。

风险:

- 样本不足导致模型不稳定。

缓解:

- 样本数阈值。
- winsorize。
- 参数上限。
- 明确 fallback。

### 第 16-20 天: 全链路验收和灰度上线

任务:

1. 完整测试套件。
2. 本地生成样本对比。
3. 生产只读验证。
4. 灰度部署。
5. 监控告警。

验收:

- 无 NaN。
- 无未标记硬编码假数据。
- 生产状态 degraded 时前端明确提示。
- 可信度提升到 75/100 以上。

## 8. 风险矩阵

| 风险 | 严重度 | 可能性 | 处理 |
| --- | --- | --- | --- |
| 异常 NAV 污染 CMA | 高 | 高 | P0 质量闸门 |
| NaN 导致接口 500 | 高 | 高 | P0 finite 校验 |
| 生产 rolling stats 缺失 | 高 | 中 | 健康检查和告警 |
| 硬编码被误认为真实数据 | 高 | 中 | data_quality 合同 |
| 外部 API 字段变更 | 中 | 高 | 缓存和 fixture |
| 动态因子样本不足 | 中 | 中 | 样本阈值和 fallback |
| 前端类型变更回归 | 中 | 中 | optional 字段和测试 |

## 9. 最终建议

短期不要把当前智能配置称为完全真实的量化配置系统。更准确的定位是:

```text
基于部分真实市场数据和版本化模型假设的辅助配置引擎。
```

完成 P0 后，可恢复基本输出可靠性。完成 P1 后，系统可以较可信地支持用户参考。完成 P2 并建立生产监控后，才适合将其定位为可信的智能资产配置引擎。
