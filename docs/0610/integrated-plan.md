# FundTrader 智能配置功能融合改进方案

生成日期: 2026-06-10

输入材料: `gpt.md`, `opus.md`, `glm.md`, `qwen.md`, `ds.md` 五份报告，以及当前工作树中智能配置相关代码的只读复核结果。

收口更新: 2026-06-11，基于 PM-Claude 工作流产物、`PLAN-ALIGNMENT-AUDIT-001`、`P1-1-LONG-WINDOW-FINAL-ACCEPT-001` 以及当前工作树只读盘点补充。本文档从此作为 FundTrader 智能配置收口执行的单一总方案；其他 agent 继续推进时，优先读取本文件，再读取对应 `docs/pm/outbox/*` 任务。

## 0A. 2026-06-11 当前进度收口版

### 0A-1. 总体状态

当前项目不是从零开始执行本方案，而是已经完成了大量 PM-Claude 任务。按本方案的 P0/P1/P2/P3 口径重新归档后，结论如下:

| 阶段 | 当前状态 | 收口判断 | 证据入口 |
|---|---|---|---|
| P0 数据和输出安全 | 功能大体覆盖，但缺少 P0 命名的正式验收报告 | 需要补一份 `P0-RETRO-ACCEPTANCE-001`，用现有代码和测试证据追认 P0 完成度 | `docs/pm/reports/PLAN-ALIGNMENT-AUDIT-001.md` |
| P1-1 CMA Anchor 动态校准 | 已完成并验收；原 `P4-*` 工作并入 P1-1 扩展 | 可作为 P1 已完成项，但 REITs 长窗口数据仍是 `partial` | `docs/pm/reports/P1-1-LONG-WINDOW-FINAL-ACCEPT-001.md` |
| P1-2 因子载荷动态校准 | 部分完成 | 需要补齐代理质量、R2、样本数、窗口元数据和验收报告 | 待建 `P1-2-FACTOR-CALIBRATION-CLOSEOUT-001` |
| P1-3 宏观数据真实源和代理源治理 | 未正式完成 | 下一批高优先级实现项 | 待建 `P1-3-MACRO-SOURCE-GOVERNANCE-001` |
| P1-4 IC 衰减历史化 | 已完成并验收 | 可作为 P1 已完成项 | `docs/pm/reports/P1-REAL-IC-DECAY-001.md` |
| P1-5 基金映射元数据动态刷新 | 未完成 | P1 关闭前必须实现或由 PM 明确降级延期 | 待建 `P1-5-FUND-METADATA-REFRESH-001` |
| P1-6 压力测试和 MC 跳跃参数历史校准 | 已完成并验收 | 可作为 P1 已完成项 | `docs/pm/reports/HF1-P1-STRESS-MC-VALIDATION-001.md` |
| P2 模型和解释增强 | 已完成并验收 | 不需要重开，除非 P1 改动引入回归 | `P2-REGIME-THRESHOLDS-001`、`P2-CIRCUIT-DESTINATION-001`、`P2-SCENARIO-DYNAMIC-001`、`P2-RISK-QUESTIONNAIRE-001` |
| P3 生产运维和持续审计 | 已完成并部署验收 | P3 关闭；`calibration.health=degraded` 是已知非阻塞观察项 | `docs/pm/reports/P3-CLOSEOUT-001.md` |

因此，当前真实进度应定义为: **P2/P3 已关闭，P1 处于收口阶段，P0 需要补治理追认；项目不能因为 P2/P3 已验收就宣布全方案完成。** 后续所有 agent 必须按 P0 追认、P1 缺口收敛、P1 最终验收、P2/P3 回归确认的顺序执行。

### 0A-2. 偏差和纠偏结论

1. `P4-*` 不是本方案的新阶段。`P4-SCOPE-AUDIT-001`、`P4-CMA-EQUILIBRIUM-V2`、`P4-LONG-WINDOW-*`、`P4-ETF-CACHE-*` 均应归档为 **P1-1 CMA Anchor 动态校准扩展**。保留原文件名可以接受，但在所有新报告中必须写明“P4 label is reclassified as P1-1 extension”。
2. P0 代码证据存在，但 PM 治理证据缺失。后续不得跳过 P0 追认；必须补 `P0-RETRO-ACCEPTANCE-001`，列出 P0-1 到 P0-5 的代码、测试和生产 smoke 证据。
3. P1 不能整体关闭。P1-1、P1-4、P1-6 已可验收；P1-2 仍需 closeout；P1-3、P1-5 仍是明确缺口。
4. P2/P3 已完成，不应反复重做。后续只在 P1 修改后跑回归验证，发现失败再派 HF 修复任务。
5. ETF 长窗口缓存已通过批准路径写入本地 SQLite，覆盖率从不足提升到可用，但 `reits` / `508000` 仍缺失；相关输出必须保持 `data_status=partial`，不能标记为 `real`。

### 0A-3. 最近已完成的纠偏动作

| 任务 | 结果 | 关键证据 |
|---|---|---|
| `PLAN-ALIGNMENT-AUDIT-001` | 完成 | 发现 P0 治理缺口、P1-3/P1-5 缺口、P4 误归类 |
| `HF1-P1-1-ETF-CACHE-POPULATION-001` | 完成 | 新增 dry-run-first ETF cache 填充脚本和测试 |
| `HF2-P1-1-ETF-CACHE-APPLY-001` | 完成 | `ETFPriceCache` 写入 8677 行；覆盖率达到 0.9286 |
| `HF3-P1-1-CALIBRATOR-DATA-STATUS-001` | 完成 | `HistoricalCalibrator` 输出 `data_status=partial/real/assumption` |
| `P1-1-LONG-WINDOW-FINAL-ACCEPT-001` | 完成 | `long_window_cache` 被消费；`91 passed`；REITs 缺失正确标为 `partial` |

### 0A-4. 当前本地状态和边界

- 当前工作树包含未提交/未跟踪文件，包含 PM 产物、`docs/0610/*`、长窗口校准代码、脚本和测试。后续 agent 不得清理或回滚不属于自己任务的改动。
- 本次收口文档更新只修改 `docs/0610/integrated-plan.md`，不代表提交、推送或部署。
- 本地 `backend/data/fundtrader.db` 已经过 approved `-Apply` 路径写入 ETF cache 和 `long_window_stats`，但数据库属于运行态数据，不应被当作源码变更提交。
- `docs/pm/locks` 里可能存在历史超时留下的 stale lock；除非 PM 明确要求清理，否则不要删除。

## 0. 方案定位

本方案以 `gpt.md` 的证据链为事实基线，吸收 `opus.md` 的工程分层和实施路线，补充 `glm.md` 对伪计算、不合理参数和文案不一致的排查项，同时保留 `qwen.md` / `ds.md` 中较清晰的模块化评估结构。

本方案不把未验证的本地修改视为已完成生产修复。当前工作树已经出现若干未提交改动，例如:

- `backend/app/allocation/data/macro_fetcher.py`: 财政赤字率和 DXY 相关改动。
- `backend/app/allocation/factor_calibrator.py`: 新增动态因子载荷校准器。
- `backend/app/allocation/factor_exposure.py`: 改为优先使用动态载荷。
- `backend/app/allocation/data/market_data_service.py`: 增加因子校准触发。
- `backend/app/allocation/monte_carlo.py`: 已有输入和输出有限值校验。
- `frontend/src/pages/allocation/OverviewPage.tsx`、`StrategyPage.tsx`: 修正文案中 Black-Litterman 和 Monte Carlo 描述。

这些改动应进入 P0/P1 的验收清单，而不是直接宣布系统已经可信。

## 1. 总体结论与目标可信度

当前智能配置不是完全虚假的系统，它有真实数据链路，包括 Tushare、AkShare、efinance、TickFlow、SQLite 缓存、本地基金数据快照等。但系统仍是“真实数据 + 静态假设 + 多层降级”的混合体，最大风险不是单个参数硬编码，而是硬编码、异常行情和降级结果没有形成统一可审计的数据质量契约，导致用户可能把部分假设或异常污染后的结果当成真实计算结果。

初始建议可信度: 55/100。按 2026-06-11 PM 验收账本更新后，当前工程可信度可视为 **P1 收口中**: P0 代码能力接近 70-75 目标但缺正式追认，P1 尚未整体关闭，P2/P3 已验收。对外表述不得写成“全方案完成”或“完全真实数据驱动”，应写成“核心校准和审计能力已上线，仍有宏观源治理、基金元数据刷新和 P0 治理追认缺口”。

目标分阶段:

| 阶段 | 目标可信度 | 判定条件 |
|---|---:|---|
| P0 完成 | 70-75 | 不再返回 NaN/Inf；异常行情不会污染 CMA/MC；最终响应明确标注数据质量 |
| P1 完成 | 82-85 | CMA、因子、基金元数据、压力参数进入动态校准和缓存；静态值只作为显式 fallback |
| P2 完成 | 88-90 | Regime/TAA/情景/熔断阈值可回测校准；前端完整展示数据来源、覆盖率和降级原因 |
| P3 完成 | 90+ | 引入持续监控、漂移检测、参数版本管理和生产验收面板 |

## 2. 最高优先级原则

1. 任何会进入最终推荐的数字，都必须有 `source`、`as_of`、`coverage`、`data_status`、`missing_reason`。
2. 静态配置可以存在，但只能作为 `assumption` 或 `fallback`，不能被标记为 `real`。
3. API 不允许返回 `NaN`、`Inf` 或超出金融常识边界的结果。
4. 单个资产的数据异常只能降级该资产，不能污染整套 CMA、SAA、Monte Carlo 和报告。
5. 前端必须能让用户看到“哪些是真实数据，哪些是估计，哪些是降级”。

建议统一状态枚举:

```python
DataStatus = Literal["real", "partial", "assumption", "stale", "missing", "rejected"]
```

建议统一质量对象:

```python
class DataQualityItem(BaseModel):
    status: DataStatus
    source: str | None = None
    as_of: str | None = None
    coverage: float | None = None
    reason: str | None = None
    confidence: float | None = None

class AllocationDataQuality(BaseModel):
    overall_status: DataStatus
    macro: dict[str, DataQualityItem]
    market: dict[str, DataQualityItem]
    cma: DataQualityItem
    factor: DataQualityItem
    fund_mapping: DataQualityItem
    invalid_assets: dict[str, str] = {}
    assumptions_used: list[str] = []
```

应在 `backend/app/allocation/models.py` 的 `AllocationResponse` 增加:

```python
data_quality: AllocationDataQuality | None = None
```

前端在 `frontend/src/pages/allocation/OverviewPage.tsx`、`StrategyPage.tsx`、`MarketPage.tsx` 展示数据质量摘要和降级原因。

## 3. P0 修复: 先阻断无效输出和伪真实数据

### P0-1 市场价格序列质量门禁

问题来源:

- `gpt.md` 发现 `511880` 出现约 `100.074 -> 1.0` 的异常跳点。
- 该异常导致 `money_fund` 年化收益和波动极端失真，并继续污染 CMA 和 Monte Carlo。
- 当前 `backend/app/allocation/data/market_data_fetcher.py` 已有 `_validate_price_series()`，但仍需补齐测试、质量传播和货币基金特殊处理。

修复文件:

- `backend/app/allocation/data/market_data_fetcher.py`
- `backend/app/allocation/data/market_data_service.py`
- `backend/tests/test_market_data_quality.py`

实现要求:

1. 所有 ETF 价格序列进入 rolling stats 前必须经过 `_validate_price_series()`。
2. 对 `money_fund`、`cash` 使用更严格规则:
   - 日对数收益绝对值不能出现大跳点。
   - 60 日波动不能异常放大。
   - 年化收益合理区间建议为 `[-2%, 8%]`。
   - 年化波动合理区间建议为 `[0%, 3%]`。
3. `compute_rolling_stats_ex()` 必须返回 `quality`，并由 `market_data_service.get_status()` 暴露关键摘要:

```python
{
    "rolling_stats_available": true,
    "asset_quality": {
        "money_fund": {
            "status": "rejected",
            "source": "representative_etf:511880",
            "reason": "abnormal_price_jump"
        }
    }
}
```

4. 被拒绝资产不得进入 signal layer 的收益、波动、相关矩阵估计。允许该资产回退到 Anchor，但必须在 `data_quality.invalid_assets` 中记录。

验收标准:

- 构造 `511880 = [100.129, 100.106, 100.074, 1.0, 1.0]`，断言被拒绝。
- 被拒绝资产的收益和波动不进入 CMA signal layer。
- `/allocation/generate` 最终响应不包含 `NaN`/`Inf`。
- 前端能显示 “money_fund 数据被拒绝，使用假设/anchor”。

### P0-2 CMA 输入清洗和质量传播

问题来源:

- `cma_manager.py` 目前仍以静态 Anchor 为基础，Signal 层来自 rolling stats。
- 只按覆盖率决定 `blend_lambda` 不够，单资产异常需要资产级清洗。
- `CMAResult` 当前只有收益、波动、协方差，缺少质量元数据。

修复文件:

- `backend/app/allocation/cma_manager.py`
- `backend/app/allocation/models.py`
- `backend/app/allocation/orchestrator.py`
- `backend/tests/test_cma_quality.py`

新增模型:

```python
class CMAQuality(BaseModel):
    data_status: DataStatus
    blend_lambda: float
    rolling_coverage: float
    valid_assets: list[str]
    invalid_assets: dict[str, str]
    anchor_assets: list[str]
    source: str
```

扩展:

```python
class CMAResult(BaseModel):
    expected_returns: dict[str, float]
    volatilities: dict[str, float]
    covariance_matrix: list[list[float]]
    quality: CMAQuality | None = None
```

实现逻辑:

1. `_get_signal_layer()` 返回 `returns`、`vols`、`corr`、`quality`。
2. 新增 `_sanitize_signal_layer()`:

```python
def _sanitize_signal_layer(signal_returns, signal_vols, quality):
    invalid = {}
    for asset in ASSET_CLASSES:
        ret = signal_returns.get(asset)
        vol = signal_vols.get(asset)
        ok, reason = _validate_signal_value(asset, ret, vol, quality.get(asset))
        if not ok:
            signal_returns[asset] = None
            signal_vols[asset] = None
            invalid[asset] = reason
    return signal_returns, signal_vols, invalid
```

3. 建议资产边界:

| 资产 | 收益边界 | 波动边界 |
|---|---:|---:|
| 权益 | -80% 到 120% | 5% 到 100% |
| 债券 | -30% 到 40% | 0.5% 到 35% |
| 货币/现金 | -2% 到 8% | 0% 到 3% |
| 黄金/商品/REITs | -60% 到 100% | 5% 到 100% |

4. 只有 `rolling_coverage >= 0.7` 且关键资产通过校验时，CMA 才能标记为 `real`；否则是 `partial` 或 `assumption`。

验收标准:

- `money_fund=-465%` 时，CMA 不能标记为 `real`。
- 单资产异常只回退该资产，不导致所有资产回退。
- `saa.data_status`、`saa.missing_reason` 与 CMA 质量一致。

### P0-3 Monte Carlo 和 API 输出有限值防护

问题来源:

- `gpt.md` 发现 Monte Carlo 曾输出 `NaN`，严格 JSON 序列化失败。
- 当前 `backend/app/allocation/monte_carlo.py` 已经加入输入、协方差和输出有限值校验，但需要补齐 API 层兜底和回归测试。

修复文件:

- `backend/app/allocation/monte_carlo.py`
- `backend/app/allocation/orchestrator.py`
- `backend/app/api/allocation.py`
- `backend/tests/test_monte_carlo_no_nan.py`
- `backend/tests/test_allocation_contract.py`

实现要求:

1. `simulate()` 保持当前有限值检查，任何非法输入抛出 `ValueError`。
2. `orchestrator.run()` 捕获 Monte Carlo 异常后:
   - `monte_carlo = None`
   - `warnings` 增加具体原因
   - `data_quality` 标记 `monte_carlo.status = "missing"` 或 `partial`
3. API 层增加最终响应扫描:

```python
def assert_json_finite(obj: Any) -> None:
    if isinstance(obj, float) and not math.isfinite(obj):
        raise ValueError("non_finite_response_value")
    if isinstance(obj, dict):
        for value in obj.values():
            assert_json_finite(value)
    if isinstance(obj, list):
        for value in obj:
            assert_json_finite(value)
```

4. 不建议把 `NaN` 静默替换为 0。正确做法是跳过相关模块并明确降级。

验收标准:

- 构造非法 CMA 输入，API 返回 200 + `monte_carlo: null` + warning，或返回明确 422/500 诊断；不得返回非标准 JSON。
- Pydantic/JSON 严格序列化通过。
- 前端不因 `monte_carlo=null` 崩溃。

### P0-4 智能配置数据质量契约

问题来源:

- 当前响应已有 `warnings`、`saa.data_status`、`missing_reason`，但覆盖不完整。
- 宏观、市场、CMA、因子、基金映射、压力测试、情景分析各自降级原因没有统一出口。

修复文件:

- `backend/app/allocation/models.py`
- `backend/app/allocation/orchestrator.py`
- `frontend/src/components/allocation/DataFreshnessBar.tsx`
- `frontend/src/components/allocation/PipelineHealthPanel.tsx`
- `frontend/src/pages/allocation/OverviewPage.tsx`
- `frontend/src/pages/allocation/StrategyPage.tsx`

实现要求:

1. 后端 `AllocationResponse` 增加 `data_quality`。
2. 每个步骤把质量信息写入统一对象。
3. `PipelineHealthPanel` 展示:
   - 最后刷新时间
   - rolling stats 是否可用
   - vol ratio 是否可用
   - 无效资产列表
   - 静态假设使用列表
4. 前端把 `simulated`、`assumption`、`missing` 显示为风险提示，不允许渲染成“真实数据”。

验收标准:

- 使用静态 Anchor 时，前端显示 “部分参数来自模型假设”。
- 使用 fallback fund mapping 时，前端显示 “基金池未覆盖，使用替代资产/ETF”。
- 所有 warnings 均有用户可读解释。

### P0-5 生产刷新和健康状态门禁

问题来源:

- 生产状态曾出现 `macro_available=true`，但 `rolling_stats_available=false`、`vol_ratio=null`。
- 这意味着生产智能配置可能主要依赖静态 Anchor 和默认熔断状态。

修复文件:

- `backend/app/main.py`
- `backend/app/api/allocation.py`
- `backend/app/allocation/data/market_data_service.py`
- `frontend/src/components/allocation/PipelineHealthPanel.tsx`

实现要求:

1. 服务启动后触发后台刷新，但 API 请求不得同步拉外部网络。
2. 增加 `/allocation/market-data/status` 或扩展现有状态接口:

```json
{
  "last_refresh": "...",
  "macro_available": true,
  "macro_confidence": 0.86,
  "rolling_stats_available": true,
  "rolling_coverage": 0.78,
  "vol_ratio": 1.28,
  "invalid_assets": {"money_fund": "abnormal_price_jump"},
  "data_status": "partial"
}
```

3. 当 rolling stats 缺失时，智能配置仍可返回，但必须标注 `partial`，并降低推荐置信度。
4. 增加生产 smoke check 脚本，至少验证:
   - `/fund/api/health`
   - `/fund/api/allocation/market-data/status`
   - 一次 `/fund/api/allocation/generate`
   - 响应中无 `NaN`、`Infinity`

验收标准:

- 生产缺 rolling stats 时不再表现为“完全真实数据”。
- 状态面板能直接解释为什么本次配置降级。

## 4. P1 修复: 替换关键硬编码为真实数据和可审计校准

### P1-1 CMA Anchor 动态校准

问题:

- `config.py` 中 `EQUILIBRIUM_RETURNS`、`EQUILIBRIUM_VOLS`、`DEFAULT_CORR` 是核心硬编码。
- 它们作为长期先验可以保留，但不能永远不校准。

新增文件:

- `backend/app/allocation/data/historical_calibrator.py`
- `backend/tests/test_historical_calibrator.py`

职责:

```python
class HistoricalCalibrator:
    def calibrate_equilibrium_returns(self) -> CalibratedSeries: ...
    def calibrate_equilibrium_vols(self) -> CalibratedSeries: ...
    def calibrate_correlation_matrix(self) -> CalibratedMatrix: ...
    def calibrate_jump_params(self) -> dict: ...
    def calibrate_stress_scenarios(self) -> dict: ...
```

数据源优先级:

1. TickFlow / efinance / Tushare / AkShare 的代表 ETF 历史价格。
2. SQLite 快照缓存。
3. 静态 `config.py`，但标记为 `assumption`。

校准原则:

- 收益: 3 年、5 年、10 年滚动年化，使用 shrinkage 向长期先验收缩。
- 波动: 252 日、3 年、5 年实现波动加权。
- 相关矩阵: EWMA + Ledoit-Wolf shrinkage + 正定修复。
- 低样本资产: 不强行估计，使用 peer group 或 Anchor，并记录原因。

验收标准:

- 校准结果有版本号和 `as_of`。
- 动态参数与静态参数偏差超过阈值时写入 warning。
- 相关矩阵正定。

### P1-2 因子载荷动态校准

当前状态:

- 本地已有 `backend/app/allocation/factor_calibrator.py`，实现了 252 日窗口 OLS。
- 但仍需增强代理数据质量、滚动历史版本、R2/样本量元数据和异常代理剔除。

修复文件:

- `backend/app/allocation/factor_calibrator.py`
- `backend/app/allocation/factor_exposure.py`
- `backend/app/allocation/data/market_data_service.py`
- `backend/tests/test_factor_calibrator.py`

改进点:

1. 对所有因子代理复用 `_validate_price_series()` 或等价质量门禁。
2. `liquidity` 不应无条件使用 `511880` 日价格；若价格口径异常，应改用货币基金 7 日年化收益或显式假设。
3. OLS 输出增加:
   - `n_obs`
   - `r_squared`
   - `window_start`
   - `window_end`
   - `proxy_sources`
   - `invalid_proxies`
4. 当有效代理少于 3 个或 R2 过低时，回退静态载荷并标记 `assumption`。
5. 若要声明 “rolling OLS”，需要保存多个窗口的历史载荷；当前单次尾部窗口 OLS 应描述为 “latest-window OLS”。

验收标准:

- `factor_exposures` 附带 `source=rolling_regression/latest_window/static_expert_estimate`。
- 代理异常时不输出看似精确的动态 beta。
- 前端显示因子载荷来源。

### P1-3 宏观数据真实源和代理源治理

问题:

- 财政赤字率不能只 `return 3.0`。
- DXY 不能用方向错误的汇率公式。
- DR007、社融、北向资金等代理链路需要标记置信度。

修复文件:

- `backend/app/allocation/data/macro_fetcher.py`
- `backend/tests/test_macro_fetcher.py`

实现要求:

1. 财政赤字率:
   - 优先 AkShare/Tushare/iFinD 可用宏观财政数据。
   - 其次官方目标值。
   - 最后静态值 3.0，但 `confidence=0.3`，`source=static_target`。
   - 不允许根据数值等于 3.0 推断来源，必须由 fetcher 设置来源。
2. DXY:
   - 优先真实 DXY 数据源。
   - 外汇 API 反推时，必须注明 `source=derived_fx_formula`。
   - 单元测试验证 USD base 方向。
3. 代理数据:
   - DR007 fallback 链路要写出 `source=FR007/SHIBOR_PROXY/...`。
   - TAA 对低置信指标做衰减，而不是完全当真。

验收标准:

- 每个宏观指标都有 `source`、`confidence`、`fetch_time`。
- 静态 fallback 不参与强信号打分。

### P1-4 IC 衰减从伪计算改为历史序列

问题:

- `market_data_service._compute_ic_decay()` 当前仍以当前信号和 confidence 估计 `ic_mean`，不是真正 IC 历史。
- `backend/app/allocation/data/ic_decay.py` 已有更完整函数，但需要接入信号历史和未来收益验证。

修复文件:

- `backend/app/allocation/data/market_data_service.py`
- `backend/app/allocation/data/ic_decay.py`
- `backend/app/storage/database.py`
- `backend/tests/test_ic_decay_integration.py`

实现要求:

1. 存储宏观信号历史快照。
2. 存储对应未来 1M/3M/6M 资产收益。
3. 计算每类信号的 Spearman/Pearson IC、半衰期和稳定性。
4. TAA 使用 `ic_mean * quality`，并对低样本标记 `partial`。

验收标准:

- 没有足够历史时，IC 质量为 `missing/partial`，不能伪装为真实 IC。
- TAA 的 `signal_quality` 在前端可解释。

### P1-5 基金映射元数据动态刷新

问题:

- `fund_mapper.py` 中基金池元数据、AUM、成交额、跟踪误差、base_quality 多为静态。
- 这会影响最终基金推荐的可买性和质量排序。

新增/修改:

- `backend/app/allocation/fund_pool_refresher.py`
- `backend/app/allocation/fund_mapper.py`
- `backend/app/allocation/fund_scorer.py`
- `backend/tests/test_fund_pool_refresher.py`

数据源:

1. 东方财富 / efinance: 基金名称、费率、规模、净值、成交。
2. Tushare: 基金基本资料、规模、申赎状态。
3. 本地 SQLite: 最近一次成功快照。

实现要求:

- 静态池只保留为白名单和资产类别映射，不保留永久 AUM/成交/费率。
- 每只基金输出:

```python
{
    "code": "510300",
    "metadata_status": "real|stale|assumption|missing",
    "as_of": "2026-06-10",
    "source": "eastmoney/efinance/tushare/sqlite_cache",
    "stale_days": 3
}
```

- 若基金数据陈旧超过阈值，降权或剔除。
- 若基金退市、暂停申购、成交过低，不能推荐为主力仓位。

验收标准:

- 推荐基金列表能显示数据日期和来源。
- 过时 AUM/成交额不再被当作实时数据。

### P1-6 压力测试和 Monte Carlo 跳跃参数历史校准

问题:

- `STRESS_SCENARIOS`、`_JUMP_PARAMS`、`_ASSET_JUMP_SENSITIVITY` 仍是经验参数。

修复文件:

- `backend/app/allocation/stress_test.py`
- `backend/app/allocation/monte_carlo.py`
- `backend/app/allocation/data/historical_calibrator.py`
- `backend/tests/test_stress_calibration.py`

实现要求:

1. 压力测试:
   - 2008 金融危机、2015 A 股、2020 疫情、2022 加息等历史窗口用真实 ETF/指数回放。
   - 缺失资产用同组代理，不得直接填专家值为真实值。
2. Monte Carlo:
   - 跳跃概率由历史极端月/周收益频率估计。
   - 跳跃均值和波动由左尾分布估计。
   - 资产敏感度由历史 beta 或压力窗口回归估计。
3. 静态参数保留为 `fallback_static_jump_params`，并写入质量标记。

验收标准:

- 每个压力场景有 `source_window`。
- MC 跳跃参数有 `as_of` 和样本数。
- 生产数据不足时仍可运行，但标注 `assumption`。

## 5. P2 修复: 模型合理性和用户可解释性增强

### P2-1 Regime 检测阈值校准

问题:

- 固定阈值可能过敏或迟钝。
- 当前并发锁机制需要保留，不能为了重构移除线程安全保护。

修复:

- 用历史宏观数据回测 goldilocks、overheat、stagflation、deflation 分类。
- 阈值改为分位数或 z-score。
- 引入状态转移惩罚，避免频繁跳变。
- 增加并发回归测试，确保锁仍有效。

### P2-2 TAA 低置信信号平滑衰减

问题:

- 低置信信号直接 `score=0` 会丢信息。
- 但低置信静态 fallback 也不能强影响仓位。

修复:

```python
effective_score = raw_score * min(max(confidence, 0.0), 1.0) ** gamma
```

建议:

- `gamma=1.5` 或通过回测校准。
- 对 `source=static` 的指标设置上限权重，例如最大 20%。
- TAA 输出每个信号的贡献、置信度、数据源和是否被衰减。

### P2-3 熔断器资金去向优化

问题:

- 熔断器降低权益仓位后，资金不应只机械转现金。
- 应按体制和通胀风险转入现金、货币、短债、黄金等防御篮子。

修复:

- deflation: 短债/利率债权重更高。
- stagflation: 黄金/商品/货币权重更高。
- liquidity shock: 现金/货币权重更高。

验收:

- 熔断触发后，权益仓位降低原因和资金去向可解释。
- 约束检查仍通过。

### P2-4 情景分析动态化

问题:

- `scenario_analysis.py` 依赖静态 `EQUILIBRIUM_RETURNS` 和固定概率/乘数。

修复:

- 概率由 regime 决定。
- 冲击幅度由历史校准器和当前波动环境决定。
- 情景基准收益优先使用 CMA 当前结果，而不是静态 config。

### P2-5 风险画像增强

问题:

- 当前风险问卷和行为调节系数偏经验化。

修复:

- 增加流动性需求、亏损容忍、收入稳定性、投资经验、再平衡接受度。
- 行为系数用问卷分数线性或分段映射，并输出解释。
- 对高龄、短周期、低亏损容忍加入硬约束。

## 6. P3 优化: 生产可运维和持续审计

1. 参数版本管理:
   - 每次校准生成 `calibration_version`。
   - 保存参数、数据源、样本区间、校准时间。
2. 漂移监控:
   - 动态参数与静态先验偏差超过阈值报警。
   - 单资产价格异常、覆盖率下降、API 失败率升高报警。
3. 回测评估:
   - 月度滚动回测动态参数 vs 静态参数 vs 60/40 vs 等权。
   - 指标包括收益、波动、最大回撤、Sharpe、Calmar、换手。
4. 前端透明化:
   - 数据来源徽标。
   - `real/partial/assumption/stale/missing` 状态提示。
   - 一键导出审计报告。

## 7. 模块级问题和修复映射

| 模块 | 核心问题 | 优先级 | 修复动作 |
|---|---|---:|---|
| 宏观数据 | 财政赤字、DXY、代理链路置信度 | P1 | 多源获取；真实 source；静态低置信 |
| 市场数据 | 价格跳点污染 rolling stats | P0 | 价格质量门禁；资产级 rejected |
| CMA | Anchor 硬编码；Signal 异常不隔离 | P0/P1 | 输入清洗；质量元数据；历史校准 |
| SAA | 依赖 CMA 质量；降级文案不充分 | P0/P2 | 继承 CMA quality；前端解释 fallback |
| Regime | 阈值经验化；状态切换敏感 | P2 | 历史分位数校准；状态转移惩罚 |
| TAA | IC 伪计算；低置信硬截断 | P1/P2 | 接入真实 IC 历史；置信度平滑衰减 |
| 熔断器 | 防御资产去向单一 | P2 | 按 regime 分配防御篮子 |
| 约束检验 | 约束结果与数据质量弱关联 | P2 | 约束失败写入质量和 warnings |
| 基金映射 | 基金池/AUM/成交/费率静态 | P1 | 动态刷新；stale 降权；退市检查 |
| Monte Carlo | 曾出现 NaN；跳跃参数硬编码 | P0/P1 | 有限值防护；历史尾部校准 |
| 压力测试 | 场景冲击值硬编码 | P1 | 历史窗口回放；代理资产标记 |
| 因子暴露 | 静态载荷/代理不稳定 | P1 | 动态 OLS + 质量元数据 |
| 情景分析 | 概率和乘数固定 | P2 | regime 条件概率；CMA 当前基准 |
| 组合指标 | MDD/Sharpe/Rf 假设粗糙 | P2 | 无风险利率真实源；MC 缺失降级 |
| 前端输出 | 用户难分辨真实/假设 | P0 | 数据质量面板；降级提示 |

## 8. 代码层实施顺序

### 第 1 批: P0 数据和输出安全

1. `backend/tests/test_market_data_quality.py`
   - 先写 `511880` 跳点测试。
   - 测试 `_validate_price_series()`。
2. `backend/app/allocation/data/market_data_fetcher.py`
   - 固化质量门禁和 `quality` 输出。
3. `backend/app/allocation/cma_manager.py`
   - 增加 signal sanitizer。
   - 扩展 `CMAResult.quality`。
4. `backend/app/allocation/orchestrator.py`
   - 汇总 `data_quality`。
   - Monte Carlo 降级不阻断全流程。
5. `backend/app/api/allocation.py`
   - 增加最终 finite JSON guard。
6. 前端 allocation 页面
   - 展示 `warnings`、`data_quality`、`invalid_assets`。

### 第 2 批: P1 动态校准核心参数

1. 新增 `historical_calibrator.py`。
2. 把 CMA Anchor 从纯 `config.py` 改为:

```python
anchor = historical_calibrator.get_anchor_or_static()
```

3. 扩展 `factor_calibrator.py`:
   - 质量门禁。
   - 元数据。
   - DB 持久化。
4. 新增 `fund_pool_refresher.py`。
5. 改造 `stress_test.py` 和 `monte_carlo.py` 的参数来源。

### 第 3 批: P2 模型和解释增强

1. Regime 阈值校准。
2. TAA IC 历史接入。
3. 熔断防御篮子。
4. 情景分析动态概率。
5. 风险问卷增强。

## 9. 测试验证方案

### 单元测试

| 测试文件 | 核心断言 |
|---|---|
| `backend/tests/test_market_data_quality.py` | 价格跳点、非正数、NaN、货币基金异常波动被拒绝 |
| `backend/tests/test_cma_quality.py` | 异常资产回退 Anchor；CMA 不误标 real |
| `backend/tests/test_monte_carlo_no_nan.py` | 非法输入抛错；合法降级不返回 NaN |
| `backend/tests/test_allocation_contract.py` | 最终响应 JSON finite；含 data_quality |
| `backend/tests/test_macro_fetcher.py` | 财政赤字来源、DXY 方向、静态 fallback 低置信 |
| `backend/tests/test_factor_calibrator.py` | 代理不足回退；R2/样本元数据完整 |
| `backend/tests/test_fund_pool_refresher.py` | stale/退市/低流动性基金被降权或剔除 |
| `frontend/api/lib/detail-status.test.ts` 或新增 allocation 测试 | `assumption/missing` 不渲染为真实可用 |

### 集成测试

1. 本地刷新:

```powershell
cd D:\Workspace\Fundtrader\backend
python -m unittest discover -s tests
```

2. API 响应有限值扫描:

```powershell
python - <<'PY'
import json, math, requests
r = requests.post("http://127.0.0.1:8766/allocation/generate", json={
    "risk_tolerance": "balanced",
    "age": 35,
    "amount": 100000,
    "horizon": "medium",
    "goal_type": "wealth_growth",
    "max_drawdown": 20
})
data = r.json()
def walk(x):
    if isinstance(x, float):
        assert math.isfinite(x), x
    elif isinstance(x, dict):
        for v in x.values(): walk(v)
    elif isinstance(x, list):
        for v in x: walk(v)
walk(data)
print("FINITE_OK")
PY
```

3. 前端:

```powershell
cd D:\Workspace\Fundtrader\frontend
npm test
npm run build
```

如 `npm run check` 因既有 TypeScript 债务失败，需区分是否为本次修改引入。

### 生产验收

部署后必须验证:

```bash
curl http://43.160.226.62/fund/api/health
curl http://43.160.226.62/fund/api/allocation/market-data/status
```

再执行一次智能配置生成，检查:

- HTTP 200 或明确的业务错误。
- 无 `NaN`、`Infinity`。
- `data_quality` 存在。
- 若 rolling stats 缺失，`overall_status != real`。
- 前端页面显示降级提示。

## 10. 实施路线图

| 时间 | 阶段 | 交付物 | 主要风险 |
|---|---|---|---|
| Day 1 | 基线冻结 | 当前未提交改动清单；五份报告差异表；P0 测试用例 | 工作树已有他人改动，需避免误覆盖 |
| Day 2-4 | P0 数据安全 | 价格质量门禁、CMA quality、MC finite、响应契约 | API 响应模型改动影响前端 |
| Day 5 | P0 验收 | 本地后端测试、前端构建、一次页面 sanity check | 外部数据源不稳定 |
| Week 2 | P1 动态校准 | `historical_calibrator.py`、因子校准增强、宏观源治理 | 历史数据覆盖不足 |
| Week 3 | P1 基金和压力 | 基金池刷新、压力窗口回放、MC 参数校准 | 基金元数据口径不一致 |
| Week 4 | P2 模型增强 | Regime/TAA/情景/熔断优化 | 回测收益不显著或换手升高 |
| Week 5-6 | 前端透明化和生产监控 | 数据质量面板、校准版本、生产健康检查 | 用户理解成本上升 |
| Month 2-3 | 持续审计 | 漂移监控、月度回测、参数版本报告 | 维护成本增加 |

## 11. 风险评估

| 风险 | 等级 | 影响 | 缓解 |
|---|---:|---|---|
| 外部 API 不稳定 | 高 | 动态校准失败 | SQLite 快照、source fallback、明确 `stale` |
| 价格复权/单位口径错误 | 高 | 收益和波动严重失真 | 价格跳点门禁、跨源比对、资产级拒绝 |
| 响应模型改动破坏前端 | 中 | 页面渲染错误 | 向后兼容字段；前端空值兜底 |
| 动态参数过拟合 | 中 | 配置频繁变化 | shrinkage、参数边界、月度校准 |
| 静态 fallback 被误解为真实 | 高 | 用户信任误导 | `assumption` 状态和前端醒目提示 |
| 现有未提交改动来源不清 | 中 | 合并冲突或重复修复 | 先验收 diff，再精确提交 |

## 12. 最终推荐执行策略

第一步不要继续扩大模型复杂度，而是先把系统变成“不会输出假装真实的坏结果”。具体做法是:

1. 以 `511880` 异常为核心回归用例，验证市场数据质量门禁。
2. 把 CMA、SAA、Monte Carlo、最终响应全部接入 `data_quality`。
3. 保证任何异常都以 `partial/missing/assumption` 呈现，而不是静默兜底。
4. 再推进动态校准器、基金池刷新和压力/跳跃参数历史化。

只有 P0 完成后，才建议讨论“智能配置是否可用于真实资金决策”。P0 完成前，系统最多可定位为研究演示或辅助参考工具；P1/P2 完成并通过生产验收后，才可以称为具有中高可信度的资产配置引擎。

## 13. 2026-06-11 后续收口执行计划

本节是后续 agent 的执行入口。除非 PM 明确改优先级，否则按本节顺序推进。每轮都必须走 PM-Claude 工作流: 创建 `docs/pm/outbox/<TASK>.md`，尽量通过 `scripts/pm-dispatch.ps1` 自动派发，完成后执行 `scripts/pm-accept.ps1 -Task <handoff> -Run`，失败则创建 `HF*` 修复任务，修复后重新验收。

### 13-1. 收口队列总览

| 顺序 | 任务 ID | 目标 | 类型 | 完成后状态 |
|---:|---|---|---|---|
| 1 | `P0-RETRO-ACCEPTANCE-001` | 追认 P0-1 到 P0-5 是否被现有实现覆盖 | report-only / validation | P0 治理闭环 |
| 2 | `P1-3-MACRO-SOURCE-GOVERNANCE-001` | 完成财政赤字、DXY、DR007/SHIBOR 等宏观源治理 | code + tests | P1-3 可验收 |
| 3 | `P1-5-FUND-METADATA-REFRESH-001` | 实现基金元数据动态刷新、stale/退市/低流动性降权 | code + tests | P1-5 可验收 |
| 4 | `P1-2-FACTOR-CALIBRATION-CLOSEOUT-001` | 补齐因子载荷质量元数据和验收报告 | code/review + tests | P1-2 可验收 |
| 5 | `P1-FINAL-ACCEPTANCE-001` | 汇总 P1-1 到 P1-6 的验收证据 | report-only / validation | P1 正式关闭 |
| 6 | `P2-P3-REGRESSION-RECONFIRM-001` | P1 收口后确认 P2/P3 未回归 | validation-only | 全方案进入可验收状态 |
| 7 | `CALIBRATION-HEALTH-IMPROVE-001` | 可选: 改善生产 `calibration.health=degraded` | code/data ops | 非阻塞增强 |

若资源有限，必须先完成 1-6。第 7 项不是 P1/P2/P3 收口阻塞项。

### 13-2. `P0-RETRO-ACCEPTANCE-001`

目标: 不重写 P0 代码，先确认现有实现是否满足本方案 P0-1 到 P0-5。如果发现实际缺口，创建 HF 任务，不得强行关闭。

必须核对:

- P0-1: `_validate_price_series()`、`511880` 异常跳点拒绝、被拒绝资产不进入 signal layer。
- P0-2: CMA signal sanitizer、`CMAResult.quality` 或等价 quality dict、`saa.data_status` 继承。
- P0-3: Monte Carlo 输入/输出有限值、API `assert_json_finite()`、`monte_carlo=null` 时前端不崩。
- P0-4: `AllocationResponse.data_quality`、`AllocationDataQuality`、前端质量面板。
- P0-5: `/allocation/market-data/status`、生产 smoke 脚本、rolling stats 缺失时不标 `real`。

建议验证命令:

```powershell
cd D:\Workspace\Fundtrader
git status --short --untracked-files=all
rg -n "_validate_price_series|_sanitize_signal_layer|assert_json_finite|AllocationDataQuality|market-data/status|PipelineHealthPanel" backend frontend scripts
cd backend
python -m pytest tests/test_allocation_data_quality.py tests/test_cma_data_quality.py tests/test_allocation_api_contract.py -q
```

验收报告必须写入:

- P0-1 到 P0-5 的逐项状态: `done` / `partial` / `missing`。
- 如果测试文件名和本方案不同，要说明等价覆盖关系。
- 若任何 P0 项为 `partial/missing`，`PM Digest` 必须是 `needs_fix` 并给出 HF 任务名。

### 13-3. `P1-3-MACRO-SOURCE-GOVERNANCE-001`

目标: 宏观数据不能再通过数值猜来源，必须由 fetcher 显式设置 `source/confidence/fetch_time`。静态 fallback 可以存在，但必须低置信并被 TAA 衰减。

预计文件:

- `backend/app/allocation/data/macro_fetcher.py`
- `backend/tests/test_macro_fetcher.py`
- 如 TAA 需要消费置信度: `backend/app/allocation/data/market_data_service.py`

执行要求:

1. 编辑任何函数/类前，按 AGENTS.md 运行 GitNexus impact。例如修改 `MacroDataFetcher` 或具体 fetch 方法前先跑:

```powershell
npx gitnexus impact MacroDataFetcher --repo FundTrader --direction upstream
```

2. 财政赤字率:
   - 优先真实源或官方目标源。
   - 最后 fallback `3.0` 时输出 `source=static_target`、`confidence<=0.3`。
   - 不允许用“值等于 3.0”推断来源。
3. DXY:
   - 优先真实 DXY 源。
   - 若由 FX 公式推导，必须输出 `source=derived_fx_formula`。
   - 测试 USD base 方向，避免倒数方向错误。
4. DR007/SHIBOR/FR007 等代理源:
   - 每个指标输出明确 `source`。
   - 低置信指标不能作为强信号直接影响 TAA。

验收命令:

```powershell
cd D:\Workspace\Fundtrader\backend
python -m pytest tests/test_macro_fetcher.py tests/test_allocation_api_contract.py -q
```

如果改到 TAA 或市场数据服务，再追加相关测试:

```powershell
python -m pytest tests/test_market_data_service.py tests/test_taa_engine.py -q
```

### 13-4. `P1-5-FUND-METADATA-REFRESH-001`

目标: 基金推荐不能继续把静态 AUM、成交额、费率、申赎状态当成实时数据。静态基金池只保留白名单和资产类别映射，动态字段必须有来源、日期和 stale 判断。

预计文件:

- `backend/app/allocation/fund_pool_refresher.py`
- `backend/app/allocation/fund_mapper.py`
- `backend/app/allocation/fund_scorer.py`
- `backend/app/storage/database.py`
- `backend/tests/test_fund_pool_refresher.py`

执行要求:

1. 编辑 `fund_mapper.py` / `fund_scorer.py` 前必须跑对应 GitNexus impact。
2. 新增或复用 SQLite 缓存表，保存:
   - `code`
   - `name`
   - `asset_class`
   - `aum`
   - `volume`
   - `fee`
   - `subscription_status`
   - `metadata_status`
   - `as_of`
   - `source`
   - `stale_days`
3. stale、退市、暂停申购、成交过低的基金必须降权或剔除。
4. API 或推荐结果中必须能看到基金元数据来源，不能只输出分数。

验收命令:

```powershell
cd D:\Workspace\Fundtrader\backend
python -m pytest tests/test_fund_pool_refresher.py tests/test_allocation_api_contract.py -q
```

若前端展示基金来源，则追加:

```powershell
cd D:\Workspace\Fundtrader\frontend
npm run check
npm run build
```

### 13-5. `P1-2-FACTOR-CALIBRATION-CLOSEOUT-001`

目标: 把已有因子载荷动态校准从“有实现”推进到“可验收”。该任务可以先审查现状，若缺口很小则直接补齐；若缺口较大，拆 HF。

必须核对:

- 所有因子代理是否经过价格质量门禁。
- `liquidity` 是否还无条件依赖异常风险较高的 `511880` 日价格。
- OLS 输出是否有 `n_obs`、`r_squared`、`window_start`、`window_end`、`proxy_sources`、`invalid_proxies`。
- 有效代理少于 3 个或 R2 过低时是否回退静态载荷并标记 `assumption`。
- 文案是否把当前尾部窗口 OLS 正确描述为 `latest-window OLS`，而不是未持久化历史的 `rolling OLS`。

验收命令:

```powershell
cd D:\Workspace\Fundtrader\backend
python -m pytest tests/test_factor_calibrator.py tests/test_allocation_api_contract.py -q
```

验收报告必须列出每个因子代理的 source/status 示例，至少覆盖正常、代理不足、异常代理三类。

### 13-6. `P1-FINAL-ACCEPTANCE-001`

目标: 在 P1-2/P1-3/P1-5 完成后，正式关闭 P1。该任务不应新增业务代码，除非验收失败后派 HF。

必须汇总:

- P1-1: `P1-1-LONG-WINDOW-FINAL-ACCEPT-001`，`coverage=0.9286`，`data_status=partial`，REITs 缺失非阻塞。
- P1-2: `P1-2-FACTOR-CALIBRATION-CLOSEOUT-001`。
- P1-3: `P1-3-MACRO-SOURCE-GOVERNANCE-001`。
- P1-4: `P1-REAL-IC-DECAY-001` 和 `HF1-P1-REAL-IC-DECAY-001`。
- P1-5: `P1-5-FUND-METADATA-REFRESH-001`。
- P1-6: `P1-STRESS-MC-PROVENANCE-001` 和 `HF1-P1-STRESS-MC-VALIDATION-001`。

建议总验收命令:

```powershell
cd D:\Workspace\Fundtrader\backend
python -m pytest tests/test_historical_calibrator.py tests/test_long_window_producer.py tests/test_macro_fetcher.py tests/test_factor_calibrator.py tests/test_fund_pool_refresher.py tests/test_ic_decay.py tests/test_stress_monte_carlo_calibration.py tests/test_allocation_api_contract.py -q
cd D:\Workspace\Fundtrader\frontend
npm run check
npm run build
```

如某些测试文件名不存在，验收 agent 必须用 `rg` 找到等价覆盖并在报告里说明替代关系，不能静默跳过。

### 13-7. `P2-P3-REGRESSION-RECONFIRM-001`

目标: P1 收口后确认已完成的 P2/P3 没被破坏。该任务主要是验证，不重做功能。

建议验证命令:

```powershell
cd D:\Workspace\Fundtrader\backend
python -m pytest tests/test_regime_thresholds.py tests/test_circuit_breaker_destination.py tests/test_scenario_analysis_dynamic.py tests/test_risk_profiler_questionnaire.py tests/test_calibration_audit.py tests/test_allocation_api_contract.py -q
cd D:\Workspace\Fundtrader\frontend
npm run check
npm run build
```

如要做生产验收，必须先获得 PM 明确授权提交、推送、部署。未授权时只做本地和报告验收。

## 14. 后续 agent 执行规则

1. **先读本文档，再读任务 handoff。** 本文档是总方案；`docs/pm/outbox/<TASK>.md` 是当前轮执行细则。
2. **不再创建 P4 阶段。** 长窗口校准、ETF cache、CMA anchor 深化都归入 P1-1 或 P1 后续增强。
3. **每轮都要自动验收。** `pm-accept.ps1 -Run` 失败时，不要口头解释后停止；创建 `HF*` 修复任务并继续。
4. **遇到产品决策才停。** 例如是否牺牲召回率剔除低流动性基金、是否采用某个商业数据源、是否变更用户可见风险文案。普通测试失败、类型错误、脚本小问题不属于产品决策。
5. **不提交、不推送、不部署，除非 PM 明确说提交/部署。** AGENTS.md 给出了部署方法，但本方案收口阶段默认只做本地实现和验收。
6. **代码符号编辑前必须跑 GitNexus impact。** 若 impact 为 HIGH 或 CRITICAL，先在 PM 报告中说明风险并等待用户确认。
7. **提交前必须跑 GitNexus detect_changes。** 如果用户明确要求提交，先确认 dirty scope，只 stage 本轮相关文件，不使用 `git add .`。
8. **保留脏工作树。** 不删除 `.codegraph/`、`.mavis/`、`.reasonix/`、`nul`、历史 PM 产物或他人改动，除非 PM 明确要求清理。
9. **所有数据质量必须可解释。** 新增字段优先使用 `source`、`as_of`、`coverage`、`confidence`、`data_status`、`missing_reason`，不要引入只在后端日志里可见的隐性降级。
10. **验收报告要能被下一个 agent 复用。** 每份报告必须包含 PM Digest、改动文件、验证命令和结果、风险、是否需要 HF、下一步。

## 15. 当前可验收口径

当且仅当以下条件全部满足，才能宣布本轮 integrated plan 收口完成:

- `P0-RETRO-ACCEPTANCE-001` 通过，且 P0-1 到 P0-5 没有 blocking 缺口。
- P1-1、P1-2、P1-3、P1-4、P1-5、P1-6 全部有 report 和 acceptance artifact。
- P1 最终验收报告明确说明静态 fallback 只作为 `assumption/fallback`，不会标记为 `real`。
- P2/P3 回归确认通过。
- 本地验证命令全部通过，或失败项被明确归类为既有非阻塞问题并获得 PM 接受。
- 若进行了部署，生产 `/fund/api/health`、`/fund/api/allocation/market-data/status`、前端 `/fund/` 和 allocation smoke 均通过；未部署时不得声称生产已更新。
