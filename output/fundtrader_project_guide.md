# FundTrader 项目规范指南

## 项目定位

FundTrader 是鑫基荟基金智能分析 H5 平台，面向基金筛选、深度分析、配置推荐和定投回测场景。
首页默认展示“鑫基荟”优选池产品；点灭“鑫基荟”标签后展示用户自选基金。自选基金可通过 6 位基金代码或唯一匹配的产品名称添加，并可在首页列表中删除。

当前仓库已经完成目录提级，根目录下只有一套正式代码：

- `backend/`：FastAPI 后端，监听 `8766`
- `frontend/`：React + Hono/tRPC BFF，监听 `3000`
- `deploy/`：Nginx 与 systemd 配置
- `scripts/`：服务器初始化和新加坡服务器部署脚本

旧的 `v2/` 目录已经清理，不再使用。

## 目录结构

```text
/opt/fundtrader/
├── README.md
├── Dockerfile
├── .gitignore
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── api/
│   │   │   ├── fund.py
│   │   │   ├── analysis.py
│   │   │   ├── recommend.py
│   │   │   ├── dca.py
│   │   │   ├── professional.py
│   │   │   └── settings.py
│   │   ├── services/
│   │   ├── data/
│   │   │   └── providers/
│   │   ├── models/
│   │   └── constants/
│   ├── requirements.txt
│   ├── start.sh
│   └── .env
├── frontend/
│   ├── api/
│   │   ├── boot.ts
│   │   ├── router.ts
│   │   ├── fund-router.ts
│   │   ├── auth-router.ts
│   │   ├── context.ts
│   │   └── lib/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── pages/
│   │   ├── components/
│   │   ├── hooks/
│   │   └── providers/
│   ├── public/
│   ├── dist/
│   ├── package.json
│   ├── vite.config.ts
│   └── fundtrader-frontend.service
├── deploy/
│   ├── nginx_fund.conf
│   ├── fundtrader.service
│   ├── fundtrader-frontend.service
│   └── deploy.sh
├── scripts/
│   ├── deploy-sg.sh
│   └── init-server.sh
├── docs/
└── output/
```

## 运行架构

```text
用户请求
  ↓
Nginx :80
  ├── /fund/assets/*    -> /opt/fundtrader/frontend/dist/public/assets/
  ├── /fund/api/trpc/*  -> Hono/tRPC BFF :3000
  ├── /fund/api/*       -> FastAPI :8766
  └── /fund/*           -> Hono 前端入口 :3000
```

systemd 服务：

| 服务名 | 目录 | 端口 | 作用 |
| --- | --- | --- | --- |
| `fundtrader.service` | `/opt/fundtrader/backend` | `8766` | FastAPI 后端 |
| `fundtrader-frontend.service` | `/opt/fundtrader/frontend` | `3000` | React 静态入口 + Hono/tRPC BFF |

`fundtrader-v2.service` 是旧名称，已废弃。不要再新增或重启该服务。

## 关键配置

### Nginx

配置文件：

```text
deploy/nginx_fund.conf
/etc/nginx/conf.d/fundtrader.conf
```

静态资源必须指向提级后的目录：

```nginx
location /fund/assets/ {
    alias /opt/fundtrader/frontend/dist/public/assets/;
}
```

如果这里误指向 `/opt/fundtrader/v2/...`，页面会出现 HTML 200 但 JS/CSS 404 的白屏。

### 前端 BFF

入口：

```text
frontend/api/boot.ts
frontend/dist/boot.js
```

生产启动：

```bash
cd /opt/fundtrader/frontend
npm ci
npm run build
systemctl restart fundtrader-frontend
```

### 后端 API

入口：

```text
backend/app/main.py
```

生产启动由 `fundtrader.service` 接管。

## 部署流程

推荐使用：

```bash
bash scripts/deploy-sg.sh --full
```

常用选项：

```bash
bash scripts/deploy-sg.sh --frontend-only
bash scripts/deploy-sg.sh --backend-only
bash scripts/deploy-sg.sh --nginx-only
```

部署脚本会检查：

- FastAPI `/health`
- Hono/BFF `/fund/`
- Nginx `/fund/`
- 页面 HTML 引用的入口静态资源是否为 `200`

最后一项用于避免“页面 200 但入口 JS/CSS 404”的白屏问题。

## 运维命令

```bash
systemctl status fundtrader fundtrader-frontend
systemctl restart fundtrader
systemctl restart fundtrader-frontend

journalctl -u fundtrader -f
journalctl -u fundtrader-frontend -f

curl http://127.0.0.1:8766/health
curl -I http://127.0.0.1:3000/fund/
curl -I http://127.0.0.1/fund/
```

线上基金列表接口验证：

```bash
curl 'http://127.0.0.1:3000/fund/api/trpc/fund.list?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%22pageSize%22%3A5%7D%7D%7D'
```

## Git 同步规则

目标状态：

- 本机 `HEAD` = Gitee `master`
- 服务器 `HEAD` = Gitee `master`
- 本机和服务器 `git status --short` 都为空
- 本机和服务器都不存在 `v2/`

检查命令：

```bash
git fetch gitee master --prune
git rev-parse HEAD
git rev-parse gitee/master
git status --short
```

服务器：

```bash
cd /opt/fundtrader
git fetch gitee master --prune
git rev-parse HEAD
git rev-parse gitee/master
git status --short
```

## 忽略文件

以下内容属于运行时数据、工具缓存或本机环境，不提交：

```text
.qoder/
backend/data/
frontend/dist/
frontend/node_modules/
*.log
.env
```

## 最近结构变更

| 日期 | 变更 |
| --- | --- |
| 2026-05-21 | 清理旧 `v2/` 目录，仓库提级为根目录 `backend/` + `frontend/` |
| 2026-05-21 | 将前端 systemd 服务从 `fundtrader-v2.service` 改名为 `fundtrader-frontend.service` |
| 2026-05-21 | 部署脚本增加入口静态资源验收，防止白屏回归 |
| 2026-05-21 | 首页基金列表改为自选接口失败时降级，不影响鑫基荟产品列表 |
| 2026-05-21 | 从 2026-04-10 “鑫基荟”优选池 PDF 导入 207 只产品，替代“持续营销”标签 |
| 2026-05-22 | 首页列表改为更紧凑的指标型 UI，移除“在售基金”统计，增加基金大类平均年化、最大回撤、夏普概览 |
| 2026-05-22 | 智能定投改为搜索式基金选择，修复列表颜色可读性，补充现金流年化、回撤、夏普和买入持有对比口径 |
| 2026-05-22 | 配置推荐页改为参数驱动交互，支持风险、周期、基金大类、最大回撤和金额调整 |
| 2026-05-22 | 深度分析页增加行业/类型分布兜底图、经理在管基金指标和更完整的市场风险洞察 |
