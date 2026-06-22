# PR-02 阶段审核记录

生成时间：2026-06-22

## 阶段目标

- 将 V2 方案中的生命周期资产配置能力实现为当前主配置结果的 wrapper。
- 保持 `/allocation/generate` 行为不变。
- 新增 `/allocation/lifecycle-plan`，返回 `allocation + ips + goal_summary + data_quality`。
- Monte Carlo 月供反推超时或边界不足时降级为 `partial`，不得返回 500。

## 已完成改动

- `backend/app/allocation/goal_manager.py`
  - 新增目标排序、目标汇总、线性月供反推。
- `backend/app/allocation/goal_monte_carlo.py`
  - 新增纯 Python Monte Carlo 成功率与二分月供反推。
  - 支持 `timeout_linear_approximation` 和 `upper_bound_insufficient` 降级。
- `backend/app/allocation/lifecycle_policy.py`
  - 新增 `build_lifecycle_policy()`，复用当前 `orchestrator.run()` 生成基础 allocation。
  - 新增 goal-aware equity center、glide path、policy bands、IPS summary 和证据引用。
  - 数据质量合并为 `FusionDataQuality`，月供反推降级时返回 `partial`。
- `backend/app/api/allocation.py`
  - 新增 `POST /allocation/lifecycle-plan`，不修改 `/allocation/generate`。
- `backend/app/allocation/models.py`
  - 补充 `LifecycleGoalSummary`。
  - `LifecyclePolicyRequest` 增加 `target_success_rate`。
  - `LifecyclePolicyResponse` 增加 `goal_summary`、`required_monthly_contribution`。
- `frontend/src/pages/allocation/LifecyclePage.tsx`
  - 新增生命周期结果页。
  - 支持目标金额、当前资金、目标年限输入并生成生命周期计划。
- `frontend/src/components/allocation/GlidePathChart.tsx`
  - 新增滑行路径图。
- `frontend/src/components/allocation/IpsSummaryPanel.tsx`
  - 新增 IPS 和策略带摘要。
- `frontend/src/lib/lifecycle-api.ts`
  - 新增生命周期接口请求，避免触碰现有 `generateAllocationStream` 流程。
- `frontend/src/App.tsx`、`frontend/src/components/layout/SidebarNav.tsx`
  - 新增 `/allocation/result/lifecycle` 页面和导航入口。
- `backend/tests/test_lifecycle_policy.py`
  - 覆盖正常 wrapper 输出和月供反推降级为 `partial`。

## GitNexus 与影响面

- PR-02 修改前 impact analysis：
  - `orchestrator.run`：MEDIUM，直接调用方 7 个，受影响模块 Allocation/API，未返回 HIGH/CRITICAL。
  - `generate_allocation`：LOW。
  - `App`：LOW。
  - `SidebarNav`：LOW。
- 首次 `gitnexus detect_changes(scope=all)`：
  - 风险等级：HIGH。
  - 主要原因：新增生命周期 API 曾短暂修改 `frontend/src/lib/api.ts`，触碰 `generateAllocationStream` 相关流程；后端 route 插入位置也让相邻旧函数被标记 touched。
- 纠偏动作：
  - 将生命周期前端请求拆到 `frontend/src/lib/lifecycle-api.ts`。
  - 恢复 `frontend/src/lib/api.ts`，避免触碰现有 allocation stream。
  - 将后端生命周期 route 移至 router 文件末尾，减少对相邻旧函数的误触碰。
- 纠偏后 `gitnexus detect_changes(scope=all)`：
  - 风险等级：MEDIUM。
  - 受影响流程：`App -> PageLoader`、`App -> AccessDenied`。
  - 原因：新增前端 result 子路由，这是 PR-02 必要范围。

## 数据真实性与合规边界

- 生命周期 wrapper 不替代主 allocation，不回写 SAA，不承诺收益。
- `required_monthly_contribution` 来自目标金额、当前资金、目标年限、当前 allocation 的预期收益/波动。
- Monte Carlo 超时或上界不足时明确标记 `data_quality.status = partial`，并写入 `fallback_reason`。
- 前端页面文案保留“不构成收益承诺”的业务提示。
- 未使用模拟基金或占位话术。

## 验证结果

- 后端测试：`$env:PYTHONPATH='backend'; python -m unittest backend.tests.test_lifecycle_policy backend.tests.test_pr01_contract_migrations`，通过，4 tests OK。
- Python 编译：`$env:PYTHONPATH='backend'; python -m py_compile backend/app/allocation/lifecycle_policy.py backend/app/allocation/goal_manager.py backend/app/allocation/goal_monte_carlo.py backend/app/api/allocation.py backend/app/allocation/models.py`，通过。
- API route 注册：`$env:PYTHONPATH='backend'; python -c "from app.api.allocation import router; print(any(getattr(r, 'path', '') == '/allocation/lifecycle-plan' for r in router.routes))"`，返回 `True`。
- 前端类型检查：`npm run check`，通过。

## 自审结论

- PR-02 目标达成。
- `/allocation/generate` 未修改，生命周期能力通过新增 endpoint 和新增页面承载。
- 当前残余风险为前端 `App` 路由层 MEDIUM 影响；属于新增页面必须触达的路由范围，已通过 TypeScript 检查覆盖。

## 下一阶段入口

- PR-03 进入卖方话术、适当性与合规审计。
- 进入 PR-03 前需重新读取相关服务/路由代码，对将修改的符号执行 GitNexus impact analysis。
