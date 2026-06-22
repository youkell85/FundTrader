# PR-05 组合构建与模型组合超市阶段审核

## 范围
- 后端新增 `portfolio_builder`、`model_portfolio`、`marketplace` API。
- 前端新增组合构建页面、模型组合超市入口、REST 客户端和资产配置中心子路由。
- 本阶段未执行 `docs/0622/Final/merged/sql`，未整包复制 `fundtrader_bridge`。

## GitNexus 影响分析
- `backend/app/main.py:app` upstream impact: LOW，direct=0，processes=0。
- `frontend/src/App.tsx:App` upstream impact: LOW，direct=0，processes=0。
- `frontend/src/components/layout/SidebarNav.tsx:SidebarNav` upstream impact: LOW，direct=0，processes=0。
- `detect_changes(scope=all)` 当前为 MEDIUM，主要命中 React App 路由与侧边导航；同时包含既有未纳入本阶段的 `AGENTS.md` / `CLAUDE.md` touched 状态，提交时将只 stage PR-05 文件。

## 接口与数据合同
- `GET /marketplace/candidates` 只从 `FundDataStore.list_snapshots()` 读取真实基金快照。
- `POST /marketplace/portfolio-build` 对请求中的缺失基金代码返回 warning，不做静默替换。
- `GET /marketplace/model-portfolios` 优先读取已发布模型组合；为空时基于真实快照生成内存模型组合。
- `target_return` / `max_drawdown` 已标记为 `historical_measurement_target` 与 historical risk threshold，并展示非收益承诺声明。

## 自测
- `cd backend && python -m pytest tests/test_portfolio_builder.py tests/test_pr01_contract_migrations.py`
  - 6 passed。
- `cd frontend && npm run check`
  - passed。

## 风险与纠偏
- 模型组合在数据库无发布数据时使用当前快照动态生成，不写回数据库，避免引入不可审计种子。
- 组合构建当前为确定性规则引擎，未把 Black-Litterman / HRP 写回主 SAA；后续可作为影子评分模块加入。
- 若生产基金快照为空，接口返回 `missing`，前端展示错误/空状态，不使用模拟数据兜底。
