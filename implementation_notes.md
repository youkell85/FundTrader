# Implementation Notes — 资产配置 Bug 修复

## 改动清单

### Blocker 修复

| ID | 文件 | 行号 | 改动描述 |
|----|------|------|----------|
| B1 | `backend/app/allocation/data/macro_fetcher.py` | L46 | 指标名从"社融增量"改为"社融增速" |
| B1 | `backend/app/allocation/data/macro_fetcher.py` | L266-289 | `_fetch_social_financing()` 重写：获取25个月数据，计算滚动12月累计的YoY增速(%)，而非返回增量绝对值 |
| B1 | `backend/app/allocation/data/macro_fetcher.py` | L280-289 | `_ak_sf()` 重写：优先查找"社会融资规模存量同比"列，否则从增量数据计算YoY |
| B2 | `frontend/src/pages/AllocationWizard.tsx` | L29-32 | q3选项值从 `vhigh/vmid/vlow/vnone` 改为 `high/medium/low/none`，匹配后端 `_BEHAVIOR_ADJUSTMENTS` 的 key |
| B3 | `backend/app/allocation/monte_carlo.py` | L80-82 | 跳跃概率统一使用 `jp["prob"]`（不乘sensitivity），仅跳跃大小乘sensitivity：`rng.normal(jp["mean"] * sensitivity, ...)` |
| B4 | `backend/app/allocation/cma_manager.py` | L17 | 新增导入 `ASSET_TO_GROUP` |
| B4 | `backend/app/allocation/cma_manager.py` | L253-264 | `_get_regime_adjustments()` 中 `"equity" in a or "share" in a` / `"share" in a` 全部改为 `ASSET_TO_GROUP.get(a) == "equity"`，修复 hk_equity/us_equity 匹配遗漏 |
| B5 | `backend/app/allocation/taa_engine.py` | L261 | `_generate_live_signals()` 中，当 `conf < 0.5` 时增加 `score = 0`，低置信度指标不再影响TAA评分 |

### 高严重度修复

| ID | 文件 | 行号 | 改动描述 |
|----|------|------|----------|
| H1 | `backend/app/allocation/orchestrator.py` | L369-377 | SAA summary 的 `expected_max_drawdown` 优先使用 MC MDD95（取绝对值），MC不可用时才用 `vol × 2.5` 估算 |
| H2 | `backend/app/allocation/monte_carlo.py` | L54 | 月度收益从 `annual_returns / 12.0` 改为 `np.power(1 + annual_returns, 1/12) - 1`（复利法） |
| H3 | `backend/app/allocation/orchestrator.py` | L485-516 | `_compute_sharpe()` 的 `rf` 参数默认值改为 None，新增 `_get_risk_free_rate()` 函数从宏观数据获取10Y国债收益率，不可用时回退 2.0% |
| H4 | `backend/app/allocation/regime_detector.py` | L199 | Regime 分类阈值从 0.1 提高到 0.2 |
| H5 | `backend/app/allocation/orchestrator.py` | L496-507 | `_compute_portfolio_metrics()` 的 MDD 和 Calmar 均使用 MC MDD95，MC不可用时才用 vol×2.5 |
| H6 | `backend/app/allocation/saa_engine.py` | L101-124 | L1目标函数从"组内等分target_rc"改为"组级别约束"：按组汇总风险贡献后与组目标比较，优化器自行决定组内分配 |
| H7 | `backend/app/allocation/data/macro_fetcher.py` | L229-268 | DR007获取顺序改为：优先FR007(akshare) → Shibor 1W(Tushare, confidence降至0.7) → LPR 1Y(最终回退) |
| H8 | `backend/app/allocation/data/macro_fetcher.py` | L69-70 | 美元指数(DXY)的confidence从0.9降为0.7 |

## 设计取舍说明

1. **B1 社融增速计算**：由于 Tushare 6000pts 无法获取社融存量数据（`sf_year` 需要更高权限），采用从增量数据推算YoY的方式：当年12月累计增量 / 去年同期12月累计增量 - 1。这是增量数据能给出的最接近存量增速的近似。

2. **B3 跳跃扩散**：修复方案保留了sensitivity对跳跃大小的影响（高波动资产跳跃更大），但移除了概率上的双重放大。这符合金融直觉：跳跃事件的发生概率对所有资产相同，但影响幅度因资产特性而异。

3. **B5 低置信度阈值**：选择0.5作为cutoff，低于此值的指标score直接置0。这比加权衰减更简单且更安全，避免了低质量数据对TAA的任何影响。

4. **H3 无风险利率**：每次计算Sharpe时都调用 `_get_risk_free_rate()`，该函数会读取缓存的宏观数据（非实时请求），性能影响可忽略。2.0%的默认值对应中国10Y国债的历史中位水平。

5. **H6 SAA L1目标函数**：改为组级别约束后，优化器在满足组风险预算的前提下，可以根据各资产的风险特征自由分配组内权重。这比强制等分更合理——高波动资产自然获得较少权重。

6. **H7 DR007代理**：FR007是银行间回购定盘利率，与DR007高度相关（均反映银行间短期流动性），比Shibor更准确。当使用Shibor代理时confidence降至0.7，反映其作为代理的不精确性。

## 未修复项及原因

无。所有指定的 Blocker 和高严重度问题均已修复。

## 自测结果

- Python 语法检查：7个修改文件全部通过 `py_compile`
- 前端构建：`vite build` 成功（9.12s）
- 前端 TS 错误均为项目已有问题（路径别名、JSX flag配置），与本次修改无关
