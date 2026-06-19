# AGENTS.md — FundTrader 项目上下文（多 IDE 共享）

> 任何 AI 编码助手（Claude Code、CodeBuddy、Cursor、Kimi、Qwen Code 等）在编辑本项目文件后，
> 请参考本文档提交和部署。**修改代码后务必推送 + 部署，不要只停在本地。**

---

## 项目概况

公募基金智能分析与资产配置 H5 平台。前后端分离，部署在新加坡 43.160.226.62。

| 项目 | 值 |
|------|-----|
| 本地路径（Desktop） | `C:\Users\youke\CodeBuddy\FundTrader` |
| 本地路径（XPS） | `D:\Workspace\Fundtrader` |
| 生产服务器 | `root@43.160.226.62:22222` |
| 线上地址 | http://43.160.226.62/fund/ |
| Gitee | https://gitee.com/youkell/FundTrader |
| GitHub | https://github.com/youkell85/FundTrader |

## 技术栈

- **前端**: React 19 + TypeScript + Vite + TailwindCSS + shadcn/ui (Radix) + Recharts + tRPC
- **BFF 层**: Hono (Node.js，端口 3000)，提供 tRPC 路由 + REST 代理
- **后端**: Python FastAPI + Uvicorn（端口 8766）
- **数据库**: SQLite (`backend/data/fundtrader.db`)
- **数据源**: iFinD MCP / Tushare / AkShare / 东方财富 / efinance
- **部署**: Nginx 反向代理，Systemd 管理服务

## 端口与架构

```
浏览器 → :80 Nginx
  ├── /fund/       → localhost:3000  (Hono BFF → 前端静态文件)
  └── /fund/api/*  → localhost:3000  (Hono BFF)
                       ├── /fund/api/trpc/*    → tRPC handler
                       └── /fund/api/* (其他)   → REST proxy → localhost:8766 (FastAPI)
```

## 目录结构

```
Fundtrader/
├── backend/
│   ├── app/
│   │   ├── api/          # FastAPI 路由 (allocation.py, dca.py, fund.py, ...)
│   │   ├── allocation/   # 资产配置引擎 (orchestrator, saa, taa, backtest, ...)
│   │   ├── data/         # 数据层 (akshare, eastmoney, efinance, cache)
│   │   ├── services/     # 业务服务 (llm, analysis, recommend, watchlist, ...)
│   │   ├── models/       # Pydantic 模型
│   │   ├── storage/      # SQLite 数据库层
│   │   └── main.py       # FastAPI 入口
│   ├── requirements.txt
│   └── start.sh
├── frontend/
│   ├── api/              # Hono BFF (boot.ts, fund-router.ts, tRPC routes)
│   ├── src/
│   │   ├── components/ui/       # shadcn/ui 组件 (select, dropdown-menu, ...)
│   │   ├── components/allocation/ # 资产配置组件
│   │   ├── components/backtest/   # 回测组件
│   │   ├── pages/           # 页面 (Home, Backtest, AllocationWizard, ...)
│   │   ├── lib/api.ts       # 前端 REST API 客户端 (fetchJson)
│   │   └── index.css        # Tailwind + CSS 变量 (深色主题)
│   ├── package.json
│   └── vite.config.ts
├── deploy/               # Nginx 配置 + Systemd 服务文件
├── scripts/              # 部署脚本 (deploy-auto.sh, webhook-listener.py)
└── docs/                 # 文档和诊断报告
```

---

## ⚠️ 提交与部署（必读）

### 提交并推送

```bash
git -C Fundtrader add <修改的文件>
git -C Fundtrader commit -m "<描述>"
git -C Fundtrader push origin master   # GitHub
git -C Fundtrader push gitee master    # Gitee（服务器从此拉取）
```

### 部署到生产服务器

SSH 密钥：`C:\Users\youke\.ssh\id_ed25519_nopass`（已授权，无密码）

**一步部署（推荐）：**
```bash
ssh -o StrictHostKeyChecking=no -i C:\Users\youke\.ssh\id_ed25519_nopass -p 22222 root@43.160.226.62 "cd /opt/fundtrader && git pull gitee master && systemctl restart fundtrader && cd /opt/fundtrader/frontend && npm ci && npm run build && systemctl restart fundtrader-frontend && echo DEPLOY_OK"
```

**分步部署（调试用）：**
```bash
# 1. 服务器拉取代码
ssh -i C:\Users\youke\.ssh\id_ed25519_nopass -p 22222 root@43.160.226.62 "cd /opt/fundtrader && git pull gitee master"

# 2. 重启后端
ssh -i C:\Users\youke\.ssh\id_ed25519_nopass -p 22222 root@43.160.226.62 "systemctl restart fundtrader"

# 3. 构建前端 + 重启
ssh -i C:\Users\youke\.ssh\id_ed25519_nopass -p 22222 root@43.160.226.62 "cd /opt/fundtrader/frontend && npm ci && npm run build && systemctl restart fundtrader-frontend"
```

### 验证部署

```bash
curl http://43.160.226.62/fund/api/health                    # 后端 (期望 {"status":"ok"})
curl -o /dev/null -w "%{http_code}" http://43.160.226.62/fund/  # 前端 (期望 200)
```

### 只改前端时（跳过 Python 依赖安装）
```bash
ssh -i C:\Users\youke\.ssh\id_ed25519_nopass -p 22222 root@43.160.226.62 "cd /opt/fundtrader && git pull gitee master && cd /opt/fundtrader/frontend && npm ci && npm run build && systemctl restart fundtrader-frontend && echo DEPLOY_OK"
```

### 只改后端时（跳过前端构建）
```bash
ssh -i C:\Users\youke\.ssh\id_ed25519_nopass -p 22222 root@43.160.226.62 "cd /opt/fundtrader && git pull gitee master && systemctl restart fundtrader && echo DEPLOY_OK"
```

---

## 关键约定

1. **CSS 变量是深色主题**：`index.css` 的 `:root` 已设为深色值（`--popover: 228 50% 8%` 等），body 背景 `#000110`。新增 UI 组件必须使用 `bg-popover text-popover-foreground` 等语义变量，不要硬编码颜色。

2. **下拉选择框用 Radix Select**：项目已有 `@/components/ui/select`，不要用原生 `<select>`。Radix Select 通过 Portal 渲染，自动继承 `:root` CSS 变量。

3. **超时策略**：`api.ts` 的 `fetchJson` 对 `/allocation/*` 和 `/dca/backtest` 路径自动使用 120s 超时，其余 30s。`boot.ts` 的 BFF 代理同理。不要再随意加新的 AbortController。

4. **编排器降级优先**：`orchestrator.py` 的 14 步管线中，CMA 和应力测试已支持降级（失败不崩溃）。新增步骤应遵循相同模式：`except → 记录 warning → 降级继续`。

5. **线程安全**：`circuit_breaker.py`、`regime_detector.py`、`alert_engine.py` 已有 `threading.Lock`。修改这些模块时不要删除锁或引入新的模块级可变状态。

6. **tRPC 缓存键**：`fund-router.ts` 的 `allocate` mutation 缓存键已包含所有关键字段（risk_tolerance, age, amount, horizon, goal_type, max_drawdown, preferred_tags, behavior_answers）。新增字段时记得同步更新缓存键。

---

## 当前阶段状态

1. **TypeScript 严格模式**：`npm run check` 当前已通过；后续提交前继续保持类型检查为绿。
2. **下拉选择框**：`frontend/src` 当前已无原生 `<select>` / `<option>`；新增或修改下拉控件继续使用 `@/components/ui/select`。
3. **BFF 请求取消兼容性**：`api.ts` 和 BFF `fundtrader-client.ts` 已使用兼容方案合并外部取消信号与内部超时；新增请求客户端时继续避免直接依赖 `AbortSignal.any()`。

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **FundTrader** (14180 symbols, 23631 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/FundTrader/context` | Codebase overview, check index freshness |
| `gitnexus://repo/FundTrader/clusters` | All functional areas |
| `gitnexus://repo/FundTrader/processes` | All execution flows |
| `gitnexus://repo/FundTrader/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
