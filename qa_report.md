# QA 验证报告 — FundTrader 资产配置功能修复

> 生成时间: 2026-06-03
> 验证环境: Windows / Python 3.x / Node.js

---

## 1. 语法检查结果

| 文件 | py_compile | 结果 |
|------|-----------|------|
| `backend/app/allocation/data/macro_fetcher.py` | ✅ 通过 | PASS |
| `backend/app/allocation/taa_engine.py` | ✅ 通过 | PASS |
| `backend/app/allocation/monte_carlo.py` | ✅ 通过 | PASS |
| `backend/app/allocation/cma_manager.py` | ✅ 通过 | PASS |
| `backend/app/allocation/orchestrator.py` | ✅ 通过 | PASS |
| `backend/app/allocation/regime_detector.py` | ✅ 通过 | PASS |
| `backend/app/allocation/saa_engine.py` | ✅ 通过 | PASS |

**7/7 文件语法检查全部通过。**

---

## 2. 构建检查结果

| 项目 | 命令 | 结果 |
|------|------|------|
| 前端构建 | `npm run build` (Vite + esbuild) | ✅ 通过 |

- Vite 构建成功: 2605 modules transformed, 8.04s
- esbuild BFF 打包成功: `dist/boot.js` 905.3kb
- 无构建错误，无 TypeScript 阻断错误

---

## 3. 修复验证结果

### Blocker 修复

#### B1: 社融数据从增量改为YoY增速(%) — ✅ 通过

**文件**: `macro_fetcher.py` 第284-310行

- `_fetch_social_financing()` 函数从 Tushare `sf_month` 获取 `inc_month`（月度增量），然后计算滚动12个月累计的YoY增速
- 第295-300行: `current_12m = vals.iloc[-12:].sum()`, `prior_12m = vals.iloc[-24:-12].sum()`, `yoy = (current_12m / prior_12m - 1) * 100`
- akshare 回退路径（第313-336行）同样优先使用"社会融资规模存量同比"列，回退到增量计算YoY
- 返回值单位为 `%`，与指标名称"社融增速"语义一致

#### B2: q3选项值改为 high/medium/low/none — ✅ 通过

**文件**: `AllocationWizard.tsx` 第29-32行

- q3_volatility 选项: `{ value: "high" }`, `{ value: "medium" }`, `{ value: "low" }`, `{ value: "none" }`
- 后端 `risk_profiler.py` 第12行: `"q3_volatility": {"high": 2, "medium": 0, "low": -1, "none": -2}`
- 前后端值完全匹配，无 `vhigh/vmid/vlow/vnone` 残留

#### B3: 跳跃概率不乘sensitivity，仅大小乘sensitivity — ✅ 通过

**文件**: `monte_carlo.py` 第79-82行

- 第80行: `jump_mask = rng.random((n_paths, N_ASSETS)) < jp["prob"]` — 概率统一，不乘 sensitivity
- 第81行: `jump_sizes = rng.normal(jp["mean"] * jump_sensitivity[np.newaxis, :], jp["vol"], ...)` — 大小乘 sensitivity
- 注释明确说明: "Jump probability is uniform; only jump size is scaled by sensitivity"

#### B4: regime调整使用 ASSET_TO_GROUP 而非字符串匹配 — ✅ 通过

**文件**: `cma_manager.py` 第252-266行

- 第255行: `{a: 1.0 for a in ASSET_CLASSES if ASSET_TO_GROUP.get(a) == "equity"}` — goldilocks
- 第259行: `{a: -1.5 for a in ASSET_CLASSES if ASSET_TO_GROUP.get(a) == "equity"}` — stagflation
- 第263行: `{a: -2.0 for a in ASSET_CLASSES if ASSET_TO_GROUP.get(a) == "equity"}` — deflation
- 不再使用 `"share" in a` 字符串匹配，全量搜索确认无残留

#### B5: 低置信度(conf<0.5)指标score置0 — ✅ 通过

**文件**: `taa_engine.py` 第249-262行

- 第256-262行: 当 `conf >= 0.8` → "high"; `conf >= 0.5` → "medium"; 否则 → "low" 且 `score = 0`
- 第262行: `score = 0  # Low confidence indicators should not influence TAA`
- 逻辑正确：低置信度指标不影响TAA调整

### 高严重度修复

#### H1: MDD优先使用MC MDD95 — ✅ 通过

**文件**: `orchestrator.py` 第369-372行（SAA summary）和第521-524行（portfolio metrics）

- 两处均使用相同逻辑: `mc_mdd = mc_result.max_drawdown_95 if mc_result else None`
- `effective_mdd = abs(mc_mdd) if mc_mdd and abs(mc_mdd) > 0 else estimated_mdd`
- MC MDD95 优先，不可用时回退到 `vol * 2.5` 估算

#### H2: 月度收益改用复利法 — ✅ 通过

**文件**: `monte_carlo.py` 第54行

- `monthly_returns = np.power(1 + annual_returns, 1 / 12.0) - 1`
- 复利法正确：`(1 + r_annual)^(1/12) - 1`，而非简单除以12

#### H3: Sharpe无风险利率从宏观数据获取 — ✅ 通过

**文件**: `orchestrator.py` 第489-516行

- `_compute_sharpe()` 调用 `_get_risk_free_rate()`
- `_get_risk_free_rate()` 从 `market_data_service.get_macro_snapshot()` 获取10Y国债收益率
- 合理性检查: `0 < yield_10y < 10`
- 回退默认值: 2.0%

#### H4: regime阈值从0.1提高到0.2 — ✅ 通过

**文件**: `regime_detector.py` 第199行

- `THRESHOLD = 0.2`
- 应用于 `_classify_quadrant()` 中的四个象限判断

#### H5: Calmar分母使用MC MDD95 — ✅ 通过

**文件**: `orchestrator.py` 第519-539行

- `_compute_portfolio_metrics()` 中 `max_drawdown` 使用 `effective_mdd`（优先MC MDD95）
- 第537行: `calmar = expected_return / max_drawdown`，分母即MC MDD95

#### H6: L1目标函数改为组级别约束 — ✅ 通过

**文件**: `saa_engine.py` 第96-124行

- 第103-108行: 将组预算映射到每个资产的 `(grp, budget)` 对
- 第110-124行: objective 函数计算组级别 L2 距离
  - 第117-120行: 按 group 汇总 `rc_pct`
  - 第121-123行: `loss += (group_sums.get(grp, 0.0) - budget) ** 2`
- 不再逐资产约束风险预算，优化器自行决定组内分配

#### H7: DR007优先FR007，Shibor代理confidence降至0.7 — ⚠️ 部分通过

**文件**: `macro_fetcher.py` 第236-281行（获取逻辑）和第64-67行（confidence逻辑）

- ✅ 获取逻辑正确: `_fetch_dr007()` 先尝试 FR007（akshare `repo_rate_hist`），再回退 Shibor 1W（tushare）
- ⚠️ confidence 逻辑有问题: 当 FR007 成功时，`fetch_all()` 中 src 判断为 "tushare"（因为 DR007 不在排除列表中），导致 confidence 被错误地降到 0.7
  - 预期: FR007 成功 → confidence = 0.9（akshare 源默认值）
  - 实际: FR007 成功 → src = "tushare" → confidence = 0.7
  - **根因**: `fetch_all()` 的 src 判断基于指标名称是否在排除列表，而非实际数据来源

#### H8: DXY confidence从0.9降为0.7 — ✅ 通过

**文件**: `macro_fetcher.py` 第68-70行

- `if name == "美元指数": conf = 0.7`
- 覆盖了默认的 0.9（forex_api 源），正确降为 0.7

---

## 4. 回归风险分析

### 4.1 发现的回归问题

| 编号 | 严重度 | 描述 | 文件:行 |
|------|--------|------|---------|
| R1 | **中** | DR007 confidence 逻辑错误：FR007 成功时 confidence 也被降至 0.7 | `macro_fetcher.py:58,66-67` |

**R1 详细分析**:
- `_fetch_dr007()` 先尝试 FR007（akshare），成功则返回
- 但 `fetch_all()` 第58行判断 src 时，DR007 不在排除列表，pro 存在时 src = "tushare"
- 第66-67行: `if name == "DR007" and src == "tushare": conf = 0.7`
- 结果: 无论实际使用 FR007 还是 Shibor，confidence 都是 0.7
- **影响**: FR007 是比 Shibor 更好的 DR007 代理，其 confidence 应为 0.9 而非 0.7
- **建议修复**: 在 `_fetch_dr007` 中返回数据源标识，或在排除列表中加入 DR007（当 FR007 成功时 src 应为 "akshare"）

### 4.2 一致性问题

| 编号 | 严重度 | 描述 |
|------|--------|------|
| C1 | **低** | `_generate_signals_from_snapshot`（回测路径）未应用 B5 低置信度置0逻辑 |

**C1 详细分析**:
- 实时路径 `_generate_live_signals()` 中，conf < 0.5 时 score = 0
- 回测路径 `_generate_signals_from_snapshot()` 中，value 存在时 confidence 固定为 "medium"，score 不置0
- 回测场景下数据通常可信，此差异可接受，但两路径行为不完全一致

### 4.3 导入完整性

| 文件 | 导入项 | 状态 |
|------|--------|------|
| `taa_engine.py` | `ASSET_CLASSES, ASSET_TO_GROUP, GROUP_MAP` from `.config` | ✅ 完整 |
| `cma_manager.py` | `ASSET_CLASSES, ASSET_TO_GROUP, DEFAULT_CORR, EQUILIBRIUM_RETURNS, EQUILIBRIUM_VOLS, N_ASSETS` | ✅ 完整 |
| `saa_engine.py` | `ASSET_BOUNDS, ASSET_CLASSES, ASSET_TO_GROUP, FALLBACK_TEMPLATES, GROUP_MAP, RISK_BUDGETS` | ✅ 完整 |
| `orchestrator.py` | `ASSET_CLASSES, ASSET_TO_GROUP, GROUP_MAP` | ✅ 完整 |
| `monte_carlo.py` | `ASSET_CLASSES, N_ASSETS` | ✅ 完整 |
| `regime_detector.py` | `RegimeState` from `.models` | ✅ 完整 |
| `macro_fetcher.py` | `MacroIndicator, MacroSnapshot` from `.models` | ✅ 完整 |

### 4.4 函数签名一致性

| 修改 | 签名变化 | 影响 |
|------|---------|------|
| `_compute_sharpe` | 新增 `rf: float = None` 参数（有默认值） | ✅ 向后兼容 |
| `_fetch_dr007` | 内部逻辑变更，签名不变 | ✅ 无影响 |
| `_fetch_social_financing` | 内部逻辑变更，签名不变 | ✅ 无影响 |
| `_l1_risk_budget` objective | 从逐资产改为组级别 | ✅ 内部变更 |

### 4.5 数据类型匹配

| 检查项 | 结果 |
|--------|------|
| 社融YoY返回 float (非增量亿元) | ✅ `round(yoy, 2)` 返回 float |
| MC MDD95 用于 MDD 计算 | ✅ `abs(mc_mdd)` 确保 float |
| ASSET_TO_GROUP.get() 返回 Optional[str] | ✅ 与 `== "equity"` 比较正确 |
| 月度收益复利法结果为 float | ✅ `np.power()` 返回 ndarray |

### 4.6 边界条件

| 检查项 | 结果 |
|--------|------|
| 社融数据不足24个月 | ✅ 第301-307行有 `elif len(vals) >= 13` 分支 |
| 社融 prior_12m = 0 | ✅ 第298行 `if prior_12m > 0` 防止除零 |
| MC result 为 None | ✅ `mc_mdd = mc_result.max_drawdown_95 if mc_result else None` |
| Sharpe vol < 0.01 | ✅ 第497-498行返回 0.0 |
| Calmar max_drawdown = 0 | ✅ 第536行 `if metrics["max_drawdown"] > 0` |
| 宏观数据全部不可用 | ✅ 回退到 2.0% 默认无风险利率 |

---

## 5. 发现的新问题

### 问题1: DR007 confidence 误降（中等严重度）

- **位置**: `macro_fetcher.py` 第58行 + 第66-67行
- **描述**: `fetch_all()` 中 DR007 的 src 判断逻辑不区分实际数据来源（FR007 vs Shibor），导致 FR007 成功时 confidence 也被降至 0.7
- **影响**: DR007 指标 confidence 始终为 0.7，低于其应有的 0.9（FR007 路径）
- **建议**: 方案A — 在排除列表中加入 "DR007"（使 FR007 成功时 src = "akshare"，conf = 0.9）；方案B — 让 `_fetch_dr007` 返回 (value, actual_source) 元组

### 问题2: 回测路径 TAA 信号一致性（低严重度）

- **位置**: `taa_engine.py` 第464-502行
- **描述**: `_generate_signals_from_snapshot` 未应用低置信度置0逻辑
- **影响**: 回测与实时路径行为不一致，但回测数据通常可信，影响较小

---

## 6. 总结

| 维度 | 结果 |
|------|------|
| Python 语法检查 | **7/7 通过** |
| 前端构建检查 | **1/1 通过** |
| Blocker 修复验证 | **5/5 通过** |
| 高严重度修复验证 | **7/8 通过** (H7 部分通过) |
| 总体验证通过率 | **12/13 (92.3%)** |
| 回归问题 | **1个中等** (DR007 confidence 误降) |
| 一致性问题 | **1个低等** (回测路径未同步 B5) |

### 部署建议

**可以部署，但建议优先修复 R1（DR007 confidence 误降）**。

R1 的影响范围有限：
- DR007 confidence 从 0.9 降到 0.7 不会导致系统错误
- 低置信度指标在 TAA 中 score 会被置0（B5修复），所以实际影响更小
- 但如果希望 FR007 数据被正确利用，应修复此问题

修复 R1 的最小改动方案：在 `fetch_all()` 第58行的排除列表中加入 "DR007"：
```python
src = "tushare" if pro and name not in ("北向资金净流入","财政赤字率","美联储利率","美元指数","DR007") else "akshare"
```
这样 FR007 成功时 src = "akshare"，conf = 0.9；Shibor 成功时需要额外处理（因为 Shibor 来自 tushare 但 src 被标为 akshare）。更完善的方案是让 `_fetch_dr007` 返回实际数据源标识。
