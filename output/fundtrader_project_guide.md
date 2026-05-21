# FundTrader 项目规范梳理

## 一、项目定位

**国元基金智选 (FundTrader)** — 公募基金智能分析H5平台，服务国元证券深圳益田路营业部客户。

---

## 二、目录结构（已规范化）

```
/opt/fundtrader/                    # Git仓库根目录
│
├── README.md                        # 项目说明（React+FastAPI技术栈）
├── .gitignore                       # Git忽略规则
├── Dockerfile                       # 前端容器构建（备用）
│
├── backend/                         # FastAPI后端（port 8766）
│   ├── app/
│   │   ├── main.py                  # FastAPI入口
│   │   ├── config.py                # 配置中心（Tushare/TickFlow/iFind/LLM）
│   │   ├── utils.py                 # 工具函数
│   │   ├── api/                     # 路由层（6个模块）
│   │   │   ├── fund.py              # 基金列表/分类/详情
│   │   │   ├── analysis.py          # 深度分析
│   │   │   ├── recommend.py         # 智能推荐
│   │   │   ├── dca.py               # 定投回测
│   │   │   ├── professional.py      # 专业指标
│   │   │   └── settings.py          # 自选/配置
│   │   ├── services/                # 业务逻辑层（7个服务）
│   │   │   ├── fund_service.py
│   │   │   ├── analysis_service.py
│   │   │   ├── dca_service.py
│   │   │   ├── recommend_service.py
│   │   │   ├── professional_service.py
│   │   │   ├── llm_service.py       # DeepSeek LLM分析
│   │   │   └── watchlist_service.py
│   │   ├── data/                    # 数据层
│   │   │   ├── providers/           # 多源Provider（三层架构核心）
│   │   │   │   ├── base.py          # 抽象基类
│   │   │   │   ├── fusion.py        # Fusion融合层（P1→P2→P3）
│   │   │   │   ├── tushare_provider.py   # P1: Tushare
│   │   │   │   ├── tickflow_provider.py  # P1: TickFlow实时
│   │   │   │   ├── tencent_provider.py   # P2: 腾讯备选
│   │   │   │   └── ifind_provider.py     # P2: iFind备选
│   │   │   ├── cache_manager.py
│   │   │   ├── akshare_fetcher.py
│   │   │   ├── eastmoney_fetcher.py
│   │   │   └── efinance_fetcher.py
│   │   ├── models/                  # Pydantic模型
│   │   └── constants/               # 常量（国元基金名单等）
│   ├── requirements.txt             # Python依赖
│   ├── .env                         # 环境变量（含密钥，不提交Git）
│   ├── .env.example                 # 环境变量模板
│   └── start.sh                     # 本地启动脚本
│
├── frontend/                        # React+Hono前端（port 3000）
│   ├── api/                         # Hono BFF后端
│   │   ├── boot.ts                  # Hono入口
│   │   ├── router.ts                # tRPC路由总线
│   │   ├── auth-router.ts           # 认证路由
│   │   ├── fund-router.ts           # 基金数据路由
│   │   ├── context.ts               # 上下文
│   │   ├── middleware.ts            # 中间件
│   │   ├── queries/                 # DB查询
│   │   ├── kimi/                    # Kimi集成
│   │   └── lib/                     # 工具库
│   ├── src/                         # React前端源码
│   │   ├── App.tsx                  # 根组件
│   │   ├── main.tsx                 # 入口
│   │   ├── pages/                   # 页面（7个）
│   │   │   ├── Home.tsx             # 首页/基金列表
│   │   │   ├── FundDetail.tsx       # 基金详情
│   │   │   ├── Analysis.tsx         # 深度分析
│   │   │   ├── Recommend.tsx        # 智能推荐
│   │   │   ├── Backtest.tsx         # 定投回测
│   │   │   ├── Login.tsx            # 登录
│   │   │   └── NotFound.tsx         # 404
│   │   ├── components/              # 业务组件
│   │   ├── components/ui/           # Radix UI组件（50+）
│   │   ├── hooks/                   # 自定义Hooks
│   │   ├── providers/               # Context Providers
│   │   ├── lib/                     # 工具库
│   │   └── utils/                   # 工具函数
│   ├── db/                          # Drizzle ORM
│   ├── contracts/                   # 类型契约
│   ├── public/                      # 静态资源
│   ├── dist/                        # 构建产物（线上运行）
│   │   └── public/assets/           # Nginx直接服务的静态资源
│   ├── package.json                 # Node依赖
│   ├── vite.config.ts               # Vite配置
│   ├── tsconfig*.json               # TypeScript配置（4个）
│   ├── tailwind.config.js           # Tailwind配置
│   └── fundtrader-v2.service        # 备用Systemd文件
│
├── deploy/                          # 部署配置
│   ├── nginx_fund.conf              # Nginx配置
│   ├── fundtrader.service           # FastAPI Systemd
│   ├── fundtrader-v2.service        # Hono Systemd
│   └── deploy.sh                    # 一键部署脚本
│
├── docs/                            # 文档
│   ├── CODEBUDDY.md                 # Kimi项目分析
│   ├── GITEE_SYNC_GUIDE.md          # Gitee同步指南
│   ├── kimiwork2_project_analysis.md
│   └── research_report_*.md         # 4份Tushare研究报告
│
└── scripts/                         # 工具脚本
    ├── deploy-sg.sh                 # 新加坡部署
    └── init-server.sh               # 服务器初始化
```

---

## 三、技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | React 19 + TypeScript |
| 构建工具 | Vite 7 |
| UI组件 | Radix UI + TailwindCSS |
| 图表 | Recharts |
| BFF/SSR | Hono + tRPC |
| ORM | Drizzle ORM |
| 后端框架 | FastAPI |
| 数据源 | Tushare(P1) / TickFlow(P1) / Tencent(P2) / iFind(P2) / AkShare(P3) |
| LLM | DeepSeek V4 Flash |
| 部署 | Nginx + Systemd |

---

## 四、双服务架构

```
用户请求 → Nginx (80端口)
    ├── /fund/assets/* → frontend/dist/public/assets/ (静态文件)
    ├── /fund/api/trpc/* → Hono BFF (localhost:3000)
    ├── /fund/api/* → FastAPI (localhost:8766)
    └── /fund/* → Hono SSR (localhost:3000)

Systemd服务：
- fundtrader.service      → /opt/fundtrader/backend (Python)
- fundtrader-v2.service   → /opt/fundtrader/frontend (Node.js)
```

---

## 五、数据源优先级（三层架构）

| 优先级 | 数据源 | 用途 |
|--------|--------|------|
| P1 | Tushare + TickFlow | 主力：财务指标、实时行情 |
| P2 | 腾讯 + iFind | 备选：实时估值、特色数据 |
| P3 | AkShare + efinance | 兜底：PE历史、LPR、净值 |

---

## 六、Git工作流

```bash
# 修改代码后必须提交
 cd /opt/fundtrader
 git add -A
 git commit -m "type: description"
 git push gitee master
 git push origin master
```

**禁止**：修改 `/root/.openclaw/workspace/` 下的 FundTrader 静态拷贝（已删除）。

---

## 七、关键文件清单

| 文件 | 作用 | 修改频率 |
|------|------|---------|
| `backend/app/config.py` | 数据源配置 | 低 |
| `backend/.env` | 密钥环境变量 | 极低 |
| `deploy/nginx_fund.conf` | Nginx路由 | 低 |
| `deploy/deploy.sh` | 部署脚本 | 中 |
| `frontend/src/pages/*.tsx` | 页面逻辑 | 高 |
| `frontend/api/*.ts` | BFF接口 | 中 |
| `backend/app/services/*.py` | 业务逻辑 | 高 |
| `backend/app/data/providers/*.py` | 数据源 | 中 |

---

## 八、部署验证命令

```bash
# 检查服务状态
systemctl status fundtrader fundtrader-v2

# 验证API
curl http://localhost:8766/health

# 验证前端
curl -I http://localhost/fund/

# 查看日志
journalctl -u fundtrader -f
journalctl -u fundtrader-v2 -f
```

---

## 九、缓存目录

```
/tmp/fundtrader_cache/
├── fund_nav_full_*.json      # 基金净值历史
├── analysis_full_*.json      # 分析结果
├── fund_perf_*.json          # 性能指标
└── *.json                    # 其他缓存
```

---

## 十、项目演进记录

| 时间 | 里程碑 |
|------|--------|
| 2026-05-19 | 启动FundTrader，9数据源三层架构 |
| 2026-05-20 | 三基金技能融合层接入，Git工作流确立 |
| 2026-05-21 | 清理旧版代码，v2目录规范化整合 |

---

*梳理完成，项目结构已清晰规范。*
