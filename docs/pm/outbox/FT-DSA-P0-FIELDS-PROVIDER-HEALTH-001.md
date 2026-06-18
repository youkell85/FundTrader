# FT-DSA-P0-FIELDS-PROVIDER-HEALTH-001

## PM Digest

- Project: `FundTrader`
- Source plan:
  - `D:\Workspace\docs\0615\gpt\FundTrader_2026-06-15.md`
  - `D:\Workspace\docs\0615\gpt\DSA融合整改落地方案_2026-06-16.md`
- Task batch: **DSA-P0**（第一批，承接 `FT-P0` 内容但不再使用 UX V11 阶段名）
- Goal: 建立基金字段级来源/完整度合同与 provider 健康端点，先把“可不可信”说清楚。
- Scope type: coding implementation task for coding agent
- Commit / push / deploy: not allowed

## Allowed Files

- `backend/app/data/data_gateway.py`
- `backend/app/main.py`
- `backend/app/models/fund.py`
- `backend/app/services`（如有既有 provider/字段聚合服务）
- `backend/app/tests/test_dsa_p0_fields_provider_health.py`
- `backend/app/api/health.py`
- `frontend/api/fund-router.ts`
- `frontend/api/lib/mapper.ts`
- `frontend/src/pages/FundDetail`
- `frontend/src/components`
- `docs/pm/reports/FT-DSA-P0-FIELDS-PROVIDER-HEALTH-001.md`
- `docs/pm/reviews/FT-DSA-P0-FIELDS-PROVIDER-HEALTH-001.review.md`
- `docs/pm/reviews/FT-DSA-P0-FIELDS-PROVIDER-HEALTH-001.review.json`

## Context

第一批任务围绕“真实字段可信度”而非页面重构。目标是：

- detail 链路支持字段级来源/时间/状态；
- 数据源健康可见；
- 不改动公开接口形态，维持 `/fund/` 与 `/fund/api/*`。

- **FT-DSA-P0-1**：字段来源与完整度合同（`field` + `source` + `status`）
- **FT-DSA-P0-2**：Provider 健康状态端点
- **FT-DSA-P0-3**：前端缺失字段与来源可读显示

## Task

1. **定义字段来源类型与映射**

- 明确一套字段级结构（或复用现有类型）：

```json
{
  "field": "fund_scale",
  "value": 123.45,
  "source": "tushare.fund_share",
  "asOf": "2026-03-31",
  "status": "available|partial|stale|missing",
  "coverage": 1.0,
  "missingReason": null
}
```

- 在后端模型/映射路径落点：
  - `backend/app/data/data_gateway.py`
  - `backend/app/models/fund.py`
  - `backend/app/main.py`
- 保证旧 `FundDetail` 已有字段仍可读取，新增字段需可选，不允许“补假值”。

2. **覆盖关键字段矩阵（P0 子集）**

优先保证以下字段组返回来源信息，不完整时标记 `missingReason`：

- 基础信息：`name / type / company / manager / establish_date / benchmark`
- 净值相关：`nav / adjusted_nav / daily_return / nav_date`
- 规模份额：`fund_scale / fund_share / share_date`
- 持仓与暴露：`top_holdings / bond_holdings / industry_exposure`
- 风险指标：`volatility / max_drawdown / sharpe / tracking_error`

原则：单源失败不阻断主详情，字段缺失只降级展示。

3. **provider 健康端点**

- 实现或补齐 `/fund/api/data-sources/status`，返回每个 provider：
  - `name`
  - `capabilities`
  - `status`
  - `lastSuccess`
  - `lastError`
  - `cooldownUntil`
- 先覆盖已出现/已知 provider：iFinD、Tushare、TickFlow、AkShare、Eastmoney、efinance
- 若实时状态不可持久化，输出 `unknown / missing` 并说明来源。

4. **前端展示改造（只加状态，不改框架）**

- 在 `fund-router` 与 `mapper` 保持接口兼容；
- `FundDetail` 页面展示字段缺失与来源提示（如 `missingReason`）；
- 与 `DataGapsPanel` 联动，避免大段空白；
- 不新增新页面，不重构 tab 结构。

5. **测试与回归**

- 增加/补齐 backend 单测：
  - 字段来源结构
  - `/fund/api/data-sources/status` 稳定返回
- Frontend:
  - 若存在可运行测试链，补充 DataGaps/state 面板最小用例；
  - 若当前测试过重，至少补齐受影响构建路径。

## Constraints

- 不提交、推送、部署；
- 不修改生产 secrets / `.env`；
- 不动 `backend\data\fundtrader.db`；
- 不改路由前缀，不新增生产入口；
- 不做 Word/PDF 报告导出和完整 Fund Agent。

## Validation

```powershell
cd D:\Workspace\Fundtrader\backend
python -m pytest -q
```

```powershell
cd D:\Workspace\Fundtrader\frontend
npm.cmd run check
npm.cmd run build
```

本地 smoke：

```powershell
cd D:\Workspace\Fundtrader
curl.exe -s http://127.0.0.1:8766/fund/api/health
curl.exe -s http://127.0.0.1:8766/fund/api/data-sources/status
```

## Acceptance Criteria

- 详情链路返回的字段级 provenance 可追溯（source/asOf/status/missingReason）；
- 原有 `fund/api` 路由行为未破坏；
- provider 健康端点返回结构化状态；
- 缺失字段在 UI 清晰显示，而非空白或假值；
- 未发现与路由兼容性相关的回归。

## Final Report Requirements

输出到 `D:\Workspace\Fundtrader\docs\pm\reports\FT-DSA-P0-FIELDS-PROVIDER-HEALTH-001.md`，文件必须以 `## PM Digest` 开头，至少包含：

- status：`done` / `blocked` / `needs_pm_decision`
- files changed
- coverage 字段清单与缺失字段清单
- provider 状态接口输出样例
- validation 命令和结果
- compatibility notes（`/fund/`、`/fund/api/*`）
- git diff stat
- 下一步建议（对接 `FT-P0-3` / 报告链）
