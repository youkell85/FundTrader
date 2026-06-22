# PR-01 阶段审核记录

生成时间：2026-06-22

## 阶段目标

- 建立生命周期资产配置、基金池组合配置、定投策略实验室、专业基金评价、卖方话术生成所需的后端与前端基础契约。
- 将新增 SQLite 迁移写入 `Database.init_tables()`，禁止直接执行 `merged/sql/*.sql`。
- 不注册新页面、不接新路由、不复制 `merged/fundtrader_bridge`，只做后续 PR 的代码级地基。

## 已完成改动

- `backend/app/storage/database.py`
  - 新增 `_quote_identifier()` 与 `_ensure_columns()`，用于旧库幂等补列。
  - 在 `Database.init_tables()` 中新增以下表：
    - `suitability_audit_log`
    - `sales_talk_templates`
    - `sales_talk_generations`
    - `model_portfolios`
    - `model_portfolio_holdings`
    - `dca_strategy_runs`
    - `professional_score_snapshots`
  - 为 `allocation_plans` 幂等补充 `plan_type`、`client_profile_json`、`policy_bands_json`、`glide_path_json`、`suitability_status`、`data_status`、`evidence_refs_json`。
  - 补充 owner、场景、组合、基金代码相关索引。
- `backend/app/allocation/models.py`
  - 新增 `EvidenceRef`、`FusionDataQuality`。
  - 新增生命周期策略契约：`LifecyclePolicyRequest`、`LifecyclePolicyResponse`、`LifecycleGoalItem`、`GlidePathPoint`、`PolicyBand`、`IpsSummary`。
  - 新增组合构建契约：`PortfolioCandidate`、`PortfolioConstraint`、`PortfolioBuildRequest`、`PortfolioBuildResponse`。
  - 新增定投策略实验室契约：`DcaStrategyLabRequest`、`DcaStrategyLabResponse`、`DcaStrategyScore`。
  - 新增专业评价与卖方话术契约：`ProfessionalScoreResponse`、`SalesNarrativeRequest`、`SalesNarrativeResponse`、`PitchBookResponse`。
- `frontend/src/types/*`
  - 新增 `lifecycle.ts`、`portfolio.ts`、`dca-lab.ts`、`sales.ts`，复用现有 `allocation.ts` 基础类型。
- `backend/tests/test_pr01_contract_migrations.py`
  - 覆盖新库初始化、重复初始化、旧 `allocation_plans` 表补列迁移。

## GitNexus 与影响面

- 修改前对 `Database.init_tables` 执行 impact analysis：
  - 风险等级：HIGH。
  - 直接调用方：`init_db`。
  - 受影响流程：`backend/app/main.py:lifespan`。
  - 关联测试：`test_fund_job_status.py`、`test_progress_stream_contract.py`、`test_risk_behavior_observations.py`、`test_storage_isolation.py`。
- 已按要求暂停并向用户说明；用户继续目标后，本阶段收窄为幂等迁移与新增契约，不改现有保存、读取、路由和页面行为。
- 提交前 `gitnexus detect_changes(scope=all)`：
  - 风险等级：low。
  - 受影响流程：无。
  - 注意：GitNexus 同时检测到既有未提交 `AGENTS.md`、`CLAUDE.md`，本阶段提交将不暂存这些文件。

## 数据真实性与合规边界

- 所有新增契约显式保留 `data_status`、`missing_reason`、`evidence_refs` 或 `FusionDataQuality`。
- 不生成占位话术，不添加模拟数据兜底。
- `sales_talk_generations` 保留 `compliance_level`、`compliance_issues_json`、`suitability_decision`、`audit_id`，后续 PR 必须先走适当性与合规检查再输出话术。
- 未引入 `orgs/clients/org_id` 表，避免超出当前 V2 方案阶段边界。

## 验证结果

- 后端迁移测试：`$env:PYTHONPATH='backend'; python -m unittest backend.tests.test_pr01_contract_migrations`，通过，2 tests OK。
- Python 编译：`$env:PYTHONPATH='backend'; python -m py_compile backend/app/allocation/models.py backend/app/storage/database.py`，通过。
- Pydantic 契约导入：`$env:PYTHONPATH='backend'; python -c "from app.allocation.models import LifecyclePolicyRequest, PortfolioBuildResponse, DcaStrategyLabRequest, SalesNarrativeResponse; print('MODEL_IMPORT_OK')"`，通过。
- 前端类型检查：`npm run check`，通过。

## 自审结论

- PR-01 目标达成。
- 当前阶段未接入 API 路由和页面，因此线上用户功能行为不应变化。
- 主要残余风险是 `Database.init_tables()` 属于启动链路高影响符号；已通过旧库迁移幂等测试和重复初始化测试覆盖，部署后仍需验证 `/fund/api/health` 与 `/fund/`。

## 下一阶段入口

- PR-02 可在此契约基础上实现生命周期资产配置服务与 API。
- 进入 PR-02 前仍需重新读取目标代码并对将修改的服务/路由符号执行 GitNexus impact analysis。
