# FundTrader 资产配置功能 — 深度调研报告

> 调研员产出 | 2026-06-03 | 基于源码逐文件审读

---

## 1. 架构总览

### 1.1 系统分层

```
┌─────────────────────────────────────────────────────────────────┐
│  前端 (React 19 + TypeScript)                                    │
│  AllocationWizard → allocationStore → api.ts (SSE/REST)          │
│  ↓ 结果页: OverviewPage / StrategyPage / RiskPage / ...         │
├─────────────────────────────────────────────────────────────────┤
│  BFF 层 (Hono + tRPC, 端口 3000)                                │
│  fund-router.ts → allocate mutation (5min 缓存)                  │
│  SSE 流式代理 → /allocation/generate/stream                      │
├─────────────────────────────────────────────────────────────────┤
│  后端 (FastAPI, 端口 8766)                                       │
│  allocation.py → 14 步编排管线 (orchestrator.py)                  │
│  ├─ risk_profiler.py    → 风险画像                                │
│  ├─ cma_manager.py      → CMA 三层架构 (Anchor/Signal/Blend)     │
│  ├─ saa_engine.py       → SAA 6级优化器                           │
│  ├─ regime_detector.py  → 市场状态检测 (2D象限+持续性)            │
│  ├─ taa_engine.py       → TAA 7因子信号+Fed模型                   │
│  ├─ circuit_breaker.py  → 4级梯度熔断器                           │
│  ├─ constraint_checker.py → 约束检查                              │
│  ├─ fund_mapper.py      → 基金映射 (5维评分选基)                  │
│  ├─ monte_carlo.py      → 蒙特卡洛 (Cholesky+跳跃扩散)           │
│  ├─ stress_test.py      → 应力测试 (6场景+可转债3D)               │
│  ├─ factor_exposure.py  → 因子暴露                               │
│  ├─ scenario_analysis.py → 情景分析 (3情景加权)                   │
│  └─ orchestrator.py     → 输出组装                               │
│  数据层: macro_fetcher → market_data_service → Tushare/akshare   │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 14步管线数据流

```
用户输入 (AllocationRequest)
  │
  ├─ Step 1: risk_profiler → RiskProfile (equity_center, effective_risk, horizon_months)
  │     └─ 行为校准 + 滑道路径(年龄) + 最大回撤覆盖
  │
  ├─ Step 2: detect_regime → RegimeState (regime, confidence, score)
  │     └─ 2D象限分类(growth×inflation) + 2次持续性确认
  │
  ├─ Step 2b: estimate_cma → CMAResult (returns, vols, cov_matrix)
  │     └─ Anchor(静态均衡) / Signal(滚动252日) / Blend(状态依赖λ) 三层混合
  │     └─ 降级: 失败时回退到纯 Anchor 层
  │
  ├─ Step 3: optimize_saa → {allocations, optimizer_level, risk_contributions, ...}
  │     └─ 6级优化器: L1风险预算 → L2最小波动 → L3 ERC → L4逆波动 → L5模板
  │     └─ 降级: L4+标记为 degraded
  │
  ├─ Step 5: adjust_taa → TAASummary (taa_adjusted, adjustments, composite_score, ...)
  │     └─ 7因子宏观信号 + IC自适应权重 + Fed连续化模型(15%权重)
  │     └─ 权益调整 = composite_score × 0.10 × regime.confidence
  │
  ├─ Step 6: evaluate_breaker → (post_breaker_alloc, triggered)
  │     └─ 4级梯度: Normal/Caution/Warning/Emergency
  │     └─ 非对称恢复: 升级即时, 降级需2次确认
  │
  ├─ Step 7: check_constraints → (final_alloc, constraint_checks)
  │
  ├─ Step 8: map_funds → fund_list (5维评分选基)
  │     └─ 降级: 基金池未覆盖时标记 degraded
  │
  ├─ Step 9: simulate (Monte Carlo) → MonteCarloResult
  │     └─ 1000路径 × horizon_months, Cholesky相关 + 状态跳跃扩散
  │     └─ 降级: 失败时 mc_result=None
  │
  ├─ Step 10: run_stress_tests → List[StressScenarioItem]
  │     └─ 6历史场景 + 可转债3D压力 + 专属可转债崩溃场景
  │     └─ 降级: 失败时 stress_results=[]
  │
  ├─ Step 11: calculate_exposures → factor_exposures
  │
  ├─ Step 12: analyze_scenarios → ScenarioAnalysis (3情景加权)
  │
  ├─ Step 13: _compute_portfolio_metrics → {expected_return, volatility, sharpe, calmar, ...}
  │
  └─ Step 14: _output_assembly → AllocationResponse
        └─ 分数→百分比转换, 组别汇总, 元数据, 风险免责
```

---

## 2. 关键代码定位

| 模块 | 文件路径 | 核心函数 | 行号 | 说明 |
|------|----------|----------|------|------|
| 编排器 | `backend/app/allocation/orchestrator.py` | `run()` | L95-433 | 14步管线主入口 |
| 编排器 | 同上 | `generate_variants()` | L519-571 | 三方案(防御/均衡/进取) |
| SAA引擎 | `backend/app/allocation/saa_engine.py` | `optimize_saa()` | L30-92 | 6级优化器入口 |
| SAA-L1 | 同上 | `_l1_risk_budget()` | L97-150 | SLSQP风险预算优化 |
| SAA-L2 | 同上 | `_l2_min_vol()` | L155-178 | 最小波动优化 |
| SAA-L3 | 同上 | `_l3_erc()` → `_erc_slsqp()` / `_erc_ccd()` | L183-262 | ERC (SLSQP+CCD双路径) |
| SAA-L4 | 同上 | `_l4_inverse_vol()` | L337-343 | 逆波动加权 |
| SAA-L5 | 同上 | `_l5_template()` | L348-351 | 硬编码模板 |
| TAA引擎 | `backend/app/allocation/taa_engine.py` | `adjust_taa()` | L152-221 | TAA主入口 |
| TAA信号 | 同上 | `_generate_live_signals()` | L224-276 | 13项宏观信号生成 |
| TAA-Fed | 同上 | `_compute_fed_model()` | L39-105 | Fed连续化模型 |
| TAA-IC | 同上 | `_get_adaptive_weights()` | L108-149 | IC自适应权重 |
| 市场状态 | `backend/app/allocation/regime_detector.py` | `detect_regime()` | L31-106 | 2D象限+持续性 |
| 宏观数据 | `backend/app/allocation/data/macro_fetcher.py` | `fetch_all()` | L34-77 | 13项指标获取 |
| 风险画像 | `backend/app/allocation/risk_profiler.py` | `profile_user()` | L24-87 | 行为校准+滑道路径 |
| CMA | `backend/app/allocation/cma_manager.py` | `estimate_cma()` | L33-81 | 三层CMA |
| 蒙特卡洛 | `backend/app/allocation/monte_carlo.py` | `simulate()` | L29-126 | Cholesky+跳跃扩散 |
| 应力测试 | `backend/app/allocation/stress_test.py` | `run_stress_tests()` | L32-74 | 6场景+可转债3D |
| 基金评分 | `backend/app/allocation/fund_scorer.py` | `score_fund()` | L77-129 | 5维评分 |
| 基金映射 | `backend/app/allocation/fund_mapper.py` | `map_funds()` | L187-235 | 评分选基 |
| 熔断器 | `backend/app/allocation/circuit_breaker.py` | `evaluate_breaker()` | L38-71 | 4级梯度保护 |
| 情景分析 | `backend/app/allocation/scenario_analysis.py` | `analyze_scenarios()` | L8-67 | 3情景加权 |
| API路由 | `backend/app/api/allocation.py` | `generate_allocation()` | L44-62 | REST入口 |
| API-SSE | 同上 | `generate_allocation_stream()` | L89-138 | SSE流式入口 |
| 前端向导 | `frontend/src/pages/AllocationWizard.tsx` | `AllocationWizard()` | L56-246 | 5步向导 |
| 前端状态 | `frontend/src/store/allocationStore.tsx` | `reducer()` | L1 | useReducer状态 |
| BFF路由 | `frontend/api/fund-router.ts` | `allocate` mutation | L1718-1743 | tRPC缓存5min |

---

## 3. 数据流分析

### 3.1 从用户输入到最终方案

```
1. 用户在 AllocationWizard 5步向导中填写:
   - Step 1: 年龄、金额、投资目标、投资期限
   - Step 2: 行为问卷 (3题: 回撤反应/追涨行为/波动容忍)
   - Step 3: 风险偏好 (5级) + 最大回撤滑块
   - Step 4: 资产偏好标签 (黄金/QDII/港股通/REITs/商品/可转债)
   - Step 5: 确认 → 触发 SSE 流式生成

2. 前端调用 generateAllocationStream() → api.ts → BFF SSE 代理
   → FastAPI /allocation/generate/stream
   → 后台线程执行 run_allocation(request, progress_callback, cancel_event)

3. 后端14步管线执行 (详见1.2节)

4. 每步完成后通过 progress_callback → queue.Queue → SSE event → 前端 AllocationProgress 组件

5. 完成后 dispatch({type:"SET_OUTPUT", output:result}) → navigate("/allocation/result")

6. 结果页读取 allocationStore.output 渲染各子页面
```

### 3.2 关键数据转换点

| 位置 | 转换 | 说明 |
|------|------|------|
| orchestrator L42 | `cma.expected_returns[a] / 100.0` | % → 小数 (SAA优化器内部) |
| orchestrator L365 | `{a: round(v * 100, 2)}` | 小数 → % (输出给前端) |
| orchestrator L311-312 | `item.impact * 100`, `abs(impact) * amount` | 应力测试: 分数→%+金额 |
| orchestrator L335-337 | `scenario_result.weighted_return * 100` | 情景分析: 分数→% |
| orchestrator L354 | `f.weight * 100` | 基金权重: 分数→% |
| saa_engine L90-91 | `port_ret * 100`, `port_vol * 100` | 优化器输出: 小数→% |
| monte_carlo L117-125 | `* 100` | 模拟结果: 小数→% |
| risk_profiler L64 | `(age - 40) * 0.5` | 滑道路径: 每年超40减0.5%权益 |

---

## 4. 宏观经济指标清单

| # | 指标名称 | 类别 | 数据源 | 更新频率 | TTL | 置信度 | 评分函数 | 阈值 |
|---|---------|------|--------|---------|-----|--------|---------|------|
| 1 | PMI制造业 | growth | Tushare `cn_pmi` → akshare | 月度 | 24h | 0.95/0.9 | `_linear_score(v, 49.5, 50.5)` | <49.5偏空, >50.5偏多 |
| 2 | GDP同比 | growth | Tushare `cn_gdp` → akshare | 季度 | 24h | 0.95/0.9 | `_linear_score(v, 3.0, 6.0)` | <3%偏空, >6%偏多 |
| 3 | CPI同比 | inflation | Tushare `cn_cpi` → akshare | 月度 | 24h | 0.95/0.9 | `_linear_score_inverted(v, 1.0, 3.0)` | >3%偏空, <1%偏多 |
| 4 | PPI同比 | inflation | Tushare `cn_ppi` → akshare | 月度 | 24h | 0.95/0.9 | `_linear_score_inverted(v, -2.0, 3.0)` | >3%偏空, <-2%偏多 |
| 5 | 10Y国债收益率 | interest | Tushare `yc_cb` → akshare | 日度 | 4h | 0.95/0.9 | `_linear_score_inverted(v, 2.5, 3.5)` | >3.5%偏空, <2.5%偏多 |
| 6 | DR007 | interest | Tushare `shibor(1W)` → akshare `FR007`/`LPR1Y` | 日度 | 4h | 0.95/0.9 | `_linear_score_inverted(v, 2.0, 3.0)` | >3%偏空, <2%偏多 |
| 7 | 社融增速 | credit_money | Tushare `sf_month` → akshare | 月度 | 24h | 0.95/0.9 | `_linear_score(v, 7.0, 10.0)` | <7%偏空, >10%偏多 |
| 8 | M2增速 | credit_money | Tushare `cn_m`(自算YoY) → akshare | 月度 | 24h | 0.95/0.9 | `_linear_score(v, 7.0, 10.0)` | <7%偏空, >10%偏多 |
| 9 | 融资余额变化 | liquidity | Tushare `margin` → akshare | 日度 | 4h | 0.95/0.9 | `_linear_score(v, -200, 200)` | <-200亿偏空, >200亿偏多 |
| 10 | 北向资金净流入 | liquidity | akshare `stock_hsgt_hist_em` | 日度 | 4h | 0.9 | `_linear_score(v, -50, 100)` | <-50亿偏空, >100亿偏多 |
| 11 | 财政赤字率 | policy | **硬编码 3.0** | 静态 | - | 0.3 | `_linear_score(v, 2.5, 3.5)` | TODO: 待iFinD接入 |
| 12 | 美联储利率 | overseas | akshare `macro_bank_usa_interest_rate` | 月度 | 24h | 0.9 | `_linear_score_inverted(v, 3.0, 5.5)` | >5.5%偏空, <3%偏多 |
| 13 | 美元指数 | overseas | free forex API (DXY公式计算) | 日度 | 4h | 0.9 | `_linear_score_inverted(v, 95, 105)` | >105偏空, <95偏多 |

### 7因子类别权重 (TAA)

| 类别 | 权重 | 包含指标 |
|------|------|---------|
| 经济增长 | 0.20 | PMI制造业, GDP同比 |
| 通胀水平 | 0.15 | CPI同比, PPI同比 |
| 利率环境 | 0.15 | 10Y国债收益率, DR007 |
| 信用/货币 | 0.15 | 社融增速, M2增速 |
| 市场流动性 | 0.15 | 融资余额变化, 北向资金净流入 |
| 政策导向 | 0.10 | 财政赤字率 |
| 海外环境 | 0.10 | 美联储利率, 美元指数 |

> IC自适应权重: 当 IC decay 数据可用时, 以 50/50 比例混合 IC权重和静态权重

---

## 5. 金融计算逻辑

### 5.1 SAA优化器 (6级)

| 级别 | 算法 | 核心公式 | 实现位置 |
|------|------|---------|---------|
| L1 | SLSQP风险预算 | min Σ(RC_pct - target_rc)², s.t. Σw=1, equity±10% | saa_engine L97-150 |
| L2 | SLSQP最小波动 | min σ_p = √(w'Σw), s.t. Σw=1, equity±15% | saa_engine L155-178 |
| L3 | ERC (SLSQP+CCD) | min Σ(RC_i - 1/n)², 或 CCD: w_i = (σ²_p/n) / (Σ_j Σ_ij·w_j) | saa_engine L183-262 |
| L4 | 逆波动加权 | w_i = (1/σ_i) / Σ(1/σ_j) | saa_engine L337-343 |
| L5 | 硬编码模板 | 按 risk_level 查表 | saa_engine L348-351 |
| L6 | 最大分散化 | max DR = Σ(w_i·σ_i)/σ_p (仅 optimizer_mode 调用) | saa_engine L307-332 |

**风险贡献计算** (matrix_utils.py):
```
RC_i = w_i · (Σw)_i / σ_p
RC_pct_i = RC_i / Σ(RC_j)
```

### 5.2 TAA调整

```
composite_score = 0.85 × Σ(cat.avg_score × adaptive_weight) + 0.15 × fed_value
equity_adjustment = composite_score × 0.10 × regime.confidence
单资产调整上限: ±15% (MAX_SINGLE_ADJUSTMENT)
调整分配: 权益组按SAA比例分配, 固收组按比例吸收偏移
```

**Fed模型**:
```
rate_gap_score = clamp(-rate_gap / 2.5, -1, +1)   # Fed利率-中性利率
curve_score = clamp(curve_slope / 2.0, -1, +1)     # 10Y-Fed利率
fed_score = 0.6 × rate_gap_score + 0.4 × curve_score
```

### 5.3 CMA三层架构

```
Anchor层: 静态均衡值 (EQUILIBRIUM_RETURNS, EQUILIBRIUM_VOLS, DEFAULT_CORR)
Signal层: 滚动252日统计 (来自 market_data_service)
Blend层: result = (1-λ)×Anchor + λ×Signal
  λ = 0.40 (数据良好, coverage≥70%, confidence≥0.5)
  λ = 0.20 (数据不确定)
  λ = 0.00 (无信号数据)
状态调整: goldilocks→权益+1%, overheat→黄金+1.5%/商品+2%, etc.
```

### 5.4 蒙特卡洛模拟

```
月度参数: μ_monthly = μ_annual / 12, Σ_monthly = Σ_annual / 12
路径生成: R_t = μ_monthly + Z·L' + J·S
  Z ~ N(0,1), L = cholesky(Σ_monthly)
  J = Poisson跳跃 (概率/均值/波动率随状态变化)
  S = 资产跳跃敏感度 (权益1.1-1.4, 债券0.3-0.5, 现金0.05)
路径数: 1000, 种子: 42
输出: 中位数收益, P10/P25/P75/P90, VaR95, CVaR95, MDD95, 正收益概率
```

### 5.5 应力测试

**6个历史场景** (config.py STRESS_SCENARIOS):
- 2008全球金融危机, 2015A股股灾, 2018中美贸易战
- 2020新冠疫情, 2022股债双杀, QDII通道冻结

**可转债3D压力模型**:
```
impact_cb = delta × equity_shock + (-credit_dur × credit_widen) + (-rate_dur × rate_shift)
  delta = 0.50, credit_dur = 3.5年, rate_dur = 4.0年
专属崩溃场景: 股-30% + 利差+200bp + 利率+100bp → 约-26%
```

### 5.6 Sharpe比率

```
Sharpe = (expected_return - 2.0) / volatility   # 无风险利率硬编码2%
Calmar = expected_return / max_drawdown
MaxDrawdown估算 = volatility × 2.5              # 简化估算, 非实际计算
```

### 5.7 风险画像

```
行为校准: 3题平均调整值 avg_adj
  avg_adj < -0.5 → effective_risk 下调1级
  avg_adj > 1.5  → effective_risk 上调1级
滑道路径: age > 40 时, equity_center -= (age-40) × 0.5% (最低10%)
```

---

## 6. 风险点识别

### 6.1 逻辑错误 / 设计缺陷

| # | 严重度 | 位置 | 描述 |
|---|--------|------|------|
| R1 | **高** | `orchestrator.py` L376 | `expected_max_drawdown = volatility × 2.5` 是粗略估算, 非实际计算。蒙特卡洛已产出 `max_drawdown_95`, 但 SAA 摘要用的是简化值, 两者可能矛盾 |
| R2 | **高** | `orchestrator.py` L485-489 | Sharpe 无风险利率硬编码 2.0%, 与 CMA 中 money_fund 2.0% 恰好相同, 但未与前端/配置统一管理 |
| R3 | **高** | `macro_fetcher.py` L383-386 | 财政赤字率硬编码 3.0, confidence=0.3, 但 TAA 仍用该值参与评分。低置信度数据不应影响决策 |
| R4 | **中** | `taa_engine.py` L232-246 | 13项信号中 "社融增量" 获取的是12个月累计值(亿元), 但评分函数 `_linear_score(v, 7.0, 10.0)` 的阈值是增速%单位, **量纲不匹配** |
| R5 | **中** | `regime_detector.py` L199 | 象限分类阈值 0.1 极低, 几乎任何非零增长/通胀都会触发非 baseline 状态, 可能导致频繁切换 |
| R6 | **中** | `taa_engine.py` L195 | `equity_adjustment = composite_score × 0.10 × regime.confidence`, 当 confidence=0.3 (无数据时) 仍会产生非零调整, 虽然幅度小但逻辑上不应调整 |
| R7 | **中** | `monte_carlo.py` L80-82 | 跳跃扩散中 `jump_sizes` 使用正态分布, 但 `jump_mask` 和 `jump_sizes` 独立采样, 跳跃大小未与跳跃概率关联, 可能导致不合理的跳跃幅度 |
| R8 | **中** | `fund_mapper.py` L14-176 | 基金池数据全部硬编码, `aum`/`daily_turnover`/`tracking_error` 等为静态值, `fund_data_refresher.py` 尝试动态刷新但失败时静默回退, 实际运行可能长期使用过时数据 |
| R9 | **低** | `cma_manager.py` L254 | `_get_regime_adjustments` 中 `"share" in a` 匹配了所有 A 股资产 (a_share_*), 但也匹配了其他含 "share" 的键; 当前 ASSET_CLASSES 无此问题但设计脆弱 |
| R10 | **低** | `saa_engine.py` L148 | L1 优化器成功条件 `result.fun < 0.1` 过于宽松, 可能接受质量较差的解 |

### 6.2 数据质量问题

| # | 问题 | 影响 |
|---|------|------|
| D1 | 财政赤字率硬编码 3.0, 永不更新 | 政策信号永远中性, 失去政策维度判断力 |
| D2 | 美元指数通过免费 forex API 计算 DXY, 公式正确性存疑 (权重指数计算需要倒数) | 海外环境信号可能失真 |
| D3 | DR007 使用 Shibor 1W 作为代理, 两者并非同一指标 | 利率环境信号可能偏差 |
| D4 | 社融获取的是月度增量累计(亿元), 但 TAA 评分函数按增速(%)阈值打分 | 量纲错误导致信号失真 |
| D5 | 北向资金列名不稳定 ("当日成交净买额"/"净流入"), 使用 fallback 逻辑取第一个数值列 | 数据可靠性低 |
| D6 | Tushare 6000积分权限有限, 部分接口 (us_trl, DXY) 不可用 | 海外数据依赖 akshare 免费源 |

### 6.3 交互设计缺陷

| # | 问题 | 影响 |
|---|------|------|
| U1 | 前端行为问卷的 `q3_volatility` 选项值 (vhigh/vmid/vlow/vnone) 与后端 `_BEHAVIOR_ADJUSTMENTS` 的 key (high/medium/low/none) **不匹配** | 行为校准第3题可能永远不生效 |
| U2 | 向导 Step 3 中 `calibratedRisk` 的计算逻辑在前端重复实现, 与后端 `risk_profiler.py` 的逻辑不完全一致 (前端用简单的阈值映射, 后端用 avg_adj) | 前端显示的"行为校准建议"可能与实际校准结果不同 |
| U3 | 前端 `max_drawdown` 默认值 24, 但选择 conservative 时 RISK_OPTIONS 中 dd=12, 两者不一致 | 用户选择保守型后回撤约束可能仍为24% |
| U4 | SSE 流式生成无超时保护, 若后端管线卡住, 前端会无限等待 | 用户体验差, 需手动取消 |

### 6.4 线程安全 / 并发问题

| # | 问题 | 影响 |
|---|------|------|
| C1 | `regime_detector.py` 的 `_previous_regime` 等全局变量在 `detect_regime()` L74-83 的 v3 模式分支中, 在 `_regime_lock` 外部读取后又在内部写入 | 潜在竞态条件 |
| C2 | `orchestrator.py` 的 `_DIAG_HISTORY` 列表无锁保护, 多线程并发调用 `run()` 时可能数据竞争 | 诊断历史可能损坏 |
| C3 | `fund_mapper.py` 的 `_FUND_POOL` 字典在 `refresh_fund_profile` 中可能被修改, 无锁保护 | 基金数据可能不一致 |

---

## 7. 给审查员的可执行建议

### 7.1 必须审查的代码段 (高优先级)

1. **`taa_engine.py` L232-246 + `macro_fetcher.py` L266-277**
   - 社融指标量纲问题: `fetch_all` 获取的是"社融增量"(亿元累计), 但 TAA 评分函数 `_linear_score(v, 7.0, 10.0)` 的阈值 7.0-10.0 明显是增速%单位
   - **建议**: 确认 `macro_fetcher` 应返回社融增速(%)还是增量(亿元), 统一量纲

2. **`AllocationWizard.tsx` L29-33 + `risk_profiler.py` L9-13**
   - 前端行为问卷 q3 的选项值 (vhigh/vmid/vlow/vnone) 与后端 `_BEHAVIOR_ADJUSTMENTS` 的 key (high/medium/low/none) 不匹配
   - **建议**: 统一前后端的选项 key 命名

3. **`orchestrator.py` L376 + L497**
   - `expected_max_drawdown = volatility × 2.5` 简化估算, 而蒙特卡洛已产出更准确的 `max_drawdown_95`
   - **建议**: 当蒙特卡洛结果可用时, 使用其 MDD95 替代简化估算

4. **`macro_fetcher.py` L383-386**
   - 财政赤字率硬编码 3.0, 置信度 0.3 但仍参与 TAA 评分
   - **建议**: 当 confidence < 0.5 时, 该信号应输出 score=0 而非参与评分

### 7.2 建议审查的代码段 (中优先级)

5. **`regime_detector.py` L199**
   - 象限阈值 0.1 过低, 检查历史 regime 切换频率是否合理
   - **建议**: 回测验证阈值敏感性, 考虑提高到 0.2

6. **`monte_carlo.py` L80-82**
   - 跳跃扩散模型中跳跃大小与跳跃概率独立, 检查是否符合 Merton 跳跃扩散模型
   - **建议**: 确认跳跃大小应使用 `jp["mean"]` 而非 `rng.normal(jp["mean"], jp["vol"])` (当前实现)

7. **`fund_mapper.py` 全文**
   - 基金池数据静态硬编码, 检查 `fund_data_refresher.py` 的实际刷新成功率
   - **建议**: 添加刷新失败的监控告警

8. **`cma_manager.py` L254**
   - `_get_regime_adjustments` 中 `"share" in a` 的字符串匹配方式脆弱
   - **建议**: 改用 `ASSET_TO_GROUP[a] == "equity"` 判断

### 7.3 可选优化 (低优先级)

9. **`saa_engine.py` L148** — L1 成功条件 `result.fun < 0.1` 可收紧
10. **`orchestrator.py` L485** — Sharpe 无风险利率应从 config 读取
11. **`monte_carlo.py` L35** — 默认 1000 路径偏少, 可考虑 5000+
12. **前端 SSE** — 添加客户端超时保护 (如 120s)

---

## 附录: 资产类别与组别映射

| 组别 | 包含资产类别 |
|------|-------------|
| equity (权益) | a_share_large, a_share_small, a_share_value, a_share_growth, hk_equity, us_equity |
| fixed_income (固收) | rate_bond, credit_bond, convertible |
| alternative (另类) | gold, commodity, reits |
| cash_equiv (现金等价) | money_fund, cash |

## 附录: 风险等级模板

| 等级 | equity_center | max_drawdown | volatility_target |
|------|--------------|-------------|------------------|
| conservative | 15% | 8% | 5% |
| moderate | 30% | 15% | 8% |
| balanced | 45% | 22% | 12% |
| aggressive | 65% | 30% | 16% |
| radical | 80% | 40% | 20% |
