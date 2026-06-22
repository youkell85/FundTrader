# PR-03 阶段审核记录

生成时间：2026-06-22

## 阶段目标

- 新增卖方话术生成、适当性检查、合规审计能力。
- 删除占位符兜底：缺少必要事实时返回 `missing`，不生成内容。
- 保守客户推荐 balanced/radical 产品时必须被适当性阻断。
- “保本 / 稳赚 / 一定能涨”等禁止性表述必须被 block。
- 每次生成、缺事实、阻断或合规检查都写审计。

## 已完成改动

- `backend/app/services/suitability_guard.py`
  - 新增 5 档风险等级匹配。
  - 客户风险低于产品风险 2 级及以上返回 `rejected`。
- `backend/app/services/compliance_check.py`
  - 新增禁用语检查，覆盖 `保本`、`稳赚`、`一定能涨`、`保证收益`、`无风险` 等。
  - 出现禁止性表述返回 `block`。
- `backend/app/services/audit_service.py`
  - 写入 `suitability_audit_log`。
  - 写入 `sales_talk_generations`。
  - 不依赖不存在的模板外键。
- `backend/app/services/talk_generator.py`
  - 新增 `REQUIRED_FACTS_BY_SCENE` 事实门禁。
  - 缺少必要事实返回 `content=""`、`data_quality.status=missing`。
  - 适当性拒绝返回 `content=""`、`data_quality.status=rejected`。
  - 通过事实与适当性后，使用已验证 facts 生成确定性话术并再做合规检查。
- `backend/app/api/sales.py`
  - 新增 `POST /sales/narrative`。
  - 新增 `POST /sales/compliance-check`。
- `backend/app/main.py`
  - 注册 sales router。
- `frontend/src/pages/SalesWorkbench.tsx`
  - 新增券商营销话术工作台。
- `frontend/src/components/sales/ComplianceCheckPanel.tsx`
  - 展示合规检查结果。
- `frontend/src/components/sales/SuitabilityGateBanner.tsx`
  - 展示适当性门禁状态。
- `frontend/src/lib/sales-api.ts`
  - 新增 sales API client。
- `frontend/src/App.tsx`
  - 新增 `/sales` 路由。
- `backend/tests/test_sales_guardrails.py`
  - 覆盖禁用词 block、适当性 rejected、缺 facts missing 且审计落库。

## GitNexus 与影响面

- 修改前 impact analysis：
  - `backend/app/main.py:app`：LOW。
  - `frontend/src/App.tsx:App`：LOW。
- 提交前 `gitnexus detect_changes(scope=all)`：
  - 风险等级：MEDIUM。
  - 受影响流程：`App -> PageLoader`、`App -> AccessDenied`。
  - 原因：新增 `/sales` 前端路由，属于 PR-03 必要变更。
  - 未出现 HIGH/CRITICAL。

## 数据真实性与合规边界

- 话术只使用请求内 `facts`，不补造基金名、代码、日期、风险等级。
- 缺 facts 时不生成占位话术。
- 被适当性拒绝时不生成推荐内容。
- 合规 block 时不输出违规话术。
- 本阶段不接 LLM，不自动发送客户触达消息。
- 审计写入包含请求摘要、合规/适当性结果、证据引用和生成记录。

## 验证结果

- 后端测试：`$env:PYTHONPATH='backend'; python -m unittest backend.tests.test_sales_guardrails backend.tests.test_lifecycle_policy backend.tests.test_pr01_contract_migrations`，通过，7 tests OK。
- Python 编译：`$env:PYTHONPATH='backend'; python -m py_compile backend/app/services/suitability_guard.py backend/app/services/compliance_check.py backend/app/services/audit_service.py backend/app/services/talk_generator.py backend/app/api/sales.py backend/app/main.py`，通过。
- 前端类型检查：`npm run check`，通过。

## 自审结论

- PR-03 目标达成。
- 当前实现优先保证事实门禁、适当性、合规和审计闭环。
- 残余风险：前端工作台为最小可用页面，后续可在 PR-07 机构工作台中统一纳入客户 360 / NBA 场景。

## 下一阶段入口

- PR-04 进入定投策略实验室。
- 进入 PR-04 前需重新读取现有 `/dca/backtest` 和 allocation backtest 相关代码，确保新实验室不替换旧接口。
