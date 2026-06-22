# PR-04 阶段审核记录

生成时间：2026-06-22

## 阶段目标

- 不替换现有 `/dca/backtest`。
- 新增 `/allocation/dca-strategy-lab`。
- 提供定投策略评分、最多 36 个 rolling 起点约束和页面提示。
- 缺真实净值时返回 `missing`，不生成评分。
- 页面明确展示“历史区间适配度分析，不构成收益承诺”。

## 已完成改动

- `backend/app/services/dca_strategies.py`
  - 复用现有真实净值获取 `_get_nav_history()`。
  - 复用现有 DCA compare 计算 `_calculate_dca_backtest()`。
  - 新增 `bounded_rolling_start_dates()`，rolling 起点最多 36 个。
- `backend/app/allocation/dca_strategy_lab.py`
  - 新增 `run_dca_strategy_lab()`。
  - 缺净值返回 `DcaStrategyLabResponse(data_quality.status="missing")`。
  - 有真实净值时输出 fixed/ratio/ma/martingale 策略评分。
  - 写入 `dca_strategy_runs`。
- `backend/app/api/allocation.py`
  - 新增 `POST /allocation/dca-strategy-lab`。
  - 未修改 `/dca/backtest`。
- `frontend/src/lib/dca-lab-api.ts`
  - 新增前端 API client。
- `frontend/src/components/backtest/DcaStrategyScorecard.tsx`
  - 新增策略评分卡。
- `frontend/src/pages/allocation/BacktestPage.tsx`
  - 在现有回测页追加“定投策略实验室”卡片。
  - 保留原有回测面板与再平衡面板。
- `backend/tests/test_dca_strategy_lab.py`
  - 覆盖缺净值返回 missing。
  - 覆盖策略评分和 rolling 起点 <= 36。

## GitNexus 与影响面

- 修改前 impact analysis：
  - `backend/app/api/allocation.py:router`：LOW。
  - `frontend/src/pages/allocation/BacktestPage.tsx:BacktestPage`：LOW。
- 提交前 `gitnexus detect_changes(scope=all)`：
  - 风险等级：MEDIUM。
  - 受影响流程：BacktestPage 与现有 quick backtest 相关流程。
  - 原因：在既有 BacktestPage 内新增实验室卡片。
  - 未出现 HIGH/CRITICAL。

## 数据真实性与合规边界

- 数据来源为现有真实净值获取链路，缺净值不使用模拟数据兜底。
- 缺净值时 `scores=[]`，`data_quality.status="missing"`。
- 评分仅用于历史区间适配度比较，不展示为收益承诺。
- 不替换旧 `/dca/backtest`，不改变现有回测请求/响应。

## 验证结果

- 后端测试：`$env:PYTHONPATH='backend'; python -m unittest backend.tests.test_dca_strategy_lab backend.tests.test_sales_guardrails backend.tests.test_lifecycle_policy backend.tests.test_pr01_contract_migrations`，通过，9 tests OK。
- Python 编译：`$env:PYTHONPATH='backend'; python -m py_compile backend/app/services/dca_strategies.py backend/app/allocation/dca_strategy_lab.py backend/app/api/allocation.py`，通过。
- 前端类型检查：`npm run check`，通过。

## 自审结论

- PR-04 目标达成。
- 当前实现以真实净值数据可得性为硬门槛，符合“不模拟兜底”的要求。
- 残余风险：评分公式为轻量打分，后续可加入更多策略维度，但不得改变“不承诺收益”的展示边界。

## 下一阶段入口

- PR-05 进入组合构建与模型组合超市。
- 进入 PR-05 前需重新读取基金池、推荐和组合相关代码，确保候选基金来自真实基金池或当前配置结果。
