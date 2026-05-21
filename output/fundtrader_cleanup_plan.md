# FundTrader 项目规范梳理报告

## 一、当前状态总览

**Git版本**: `4fe6004` (已推送Gitee/GitHub)  
**服务状态**: 双服务正常运行  
**线上地址**: http://43.160.226.62/fund/ ✅

---

## 二、目录结构（已规范化）

```
/opt/fundtrader/                    # Git仓库根目录
│
├── README.md                        # 项目说明
├── .gitignore                       # Git忽略规则
├── Dockerfile                       # 前端容器构建（备用）
│
├── backend/                         # FastAPI后端（port 8766）
│   ├── app/
│   │   ├── main.py                  # FastAPI入口
│   │   ├── config.py                # 配置中心
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
│   ├── data/
│   │   └── watchlist.json           # 自选数据（运行时生成）
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
│   │   └── real-funds.json          # 真实基金数据
│   ├── dist/                        # 构建产物（线上运行）
│   │   └── public/assets/           # Nginx直接服务的静态资源
│   ├── package.json                 # Node依赖
│   ├── package-lock.json            # 锁定依赖版本
│   ├── vite.config.ts               # Vite配置
│   ├── tsconfig*.json               # TypeScript配置（4个）
│   ├── tailwind.config.js           # Tailwind配置
│   ├── postcss.config.js            # PostCSS配置
│   ├── eslint.config.js             # ESLint配置
│   ├── vitest.config.ts             # 测试配置
│   ├── components.json              # shadcn/ui配置
│   ├── index.html                   # HTML入口
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
├── scripts/                         # 工具脚本
│   ├── deploy-sg.sh                 # 新加坡部署脚本
│   └── init-server.sh               # 服务器初始化脚本
│
└── output/                          # 输出文档
    └── fundtrader_project_guide.md  # 本规范文档
```

---

## 三、文件用途与必要性审查

### 3.1 核心代码文件（必须保留）

| 路径 | 用途 | 必要性 |
|------|------|--------|
| `backend/app/main.py` | FastAPI入口 | ⭐⭐⭐ |
| `backend/app/config.py` | 配置中心 | ⭐⭐⭐ |
| `backend/app/api/*.py` | 6个路由模块 | ⭐⭐⭐ |
| `backend/app/services/*.py` | 7个业务服务 | ⭐⭐⭐ |
| `backend/app/data/providers/*.py` | 5个数据源Provider | ⭐⭐⭐ |
| `backend/app/models/*.py` | 数据模型 | ⭐⭐⭐ |
| `backend/app/constants/*.py` | 常量配置 | ⭐⭐⭐ |
| `frontend/src/pages/*.tsx` | 7个页面组件 | ⭐⭐⭐ |
| `frontend/src/components/*.tsx` | 业务组件 | ⭐⭐⭐ |
| `frontend/api/*.ts` | Hono BFF路由 | ⭐⭐⭐ |
| `frontend/db/*.ts` | Drizzle ORM | ⭐⭐⭐ |

### 3.2 配置文件（必须保留）

| 路径 | 用途 | 必要性 |
|------|------|--------|
| `backend/requirements.txt` | Python依赖清单 | ⭐⭐⭐ |
| `backend/.env` | 环境变量（密钥，Git忽略） | ⭐⭐⭐ |
| `backend/.env.example` | 环境变量模板 | ⭐⭐⭐ |
| `frontend/package.json` | Node依赖清单 | ⭐⭐⭐ |
| `frontend/package-lock.json` | 锁定依赖版本 | ⭐⭐⭐ |
| `frontend/vite.config.ts` | Vite构建配置 | ⭐⭐⭐ |
| `frontend/tsconfig*.json` | TypeScript配置（4个） | ⭐⭐⭐ |
| `frontend/tailwind.config.js` | TailwindCSS配置 | ⭐⭐⭐ |
| `frontend/postcss.config.js` | PostCSS配置 | ⭐⭐⭐ |
| `frontend/eslint.config.js` | ESLint配置 | ⭐⭐ |
| `frontend/vitest.config.ts` | 测试配置 | ⭐⭐ |
| `frontend/components.json` | shadcn/ui组件配置 | ⭐⭐ |

### 3.3 部署文件（必须保留）

| 路径 | 用途 | 必要性 |
|------|------|--------|
| `deploy/nginx_fund.conf` | Nginx反向代理配置 | ⭐⭐⭐ |
| `deploy/fundtrader.service` | FastAPI Systemd服务 | ⭐⭐⭐ |
| `deploy/fundtrader-v2.service` | Hono Systemd服务 | ⭐⭐⭐ |
| `deploy/deploy.sh` | 一键部署脚本 | ⭐⭐⭐ |
| `scripts/deploy-sg.sh` | 新加坡远程部署 | ⭐⭐ |
| `scripts/init-server.sh` | 服务器初始化 | ⭐⭐ |

### 3.4 可清理/合并的文件

| 路径 | 问题 | 建议 |
|------|------|------|
| `backend/start.sh` | 与`deploy/deploy.sh`功能重复，且路径写死 | **删除**，统一使用`deploy/deploy.sh` |
| `frontend/fundtrader-v2.service` | 与`deploy/fundtrader-v2.service`重复 | **删除**，统一使用`deploy/`下的版本 |
| `frontend/public/real-funds.json` | 测试数据，非生产数据 | **删除**或移至`docs/`作为示例 |
| `backend/data/watchlist.json` | 运行时生成的用户数据 | 加入`.gitignore`，从Git移除 |
| `output/fundtrader_project_guide.md` | 本规范文档 | 保留，但考虑移至`docs/` |
| `Dockerfile` | 未实际使用，且路径已过时 | **更新**或**删除** |

### 3.5 文档文件（保留）

| 路径 | 用途 | 必要性 |
|------|------|--------|
| `README.md` | 项目说明 | ⭐⭐⭐ |
| `docs/CODEBUDDY.md` | Kimi项目分析 | ⭐⭐ |
| `docs/GITEE_SYNC_GUIDE.md` | Gitee同步指南 | ⭐⭐ |
| `docs/kimiwork2_project_analysis.md` | 项目分析 | ⭐⭐ |
| `docs/research_report_*.md` | 4份Tushare研究报告 | ⭐⭐ |

---

## 四、清理建议清单

### 立即清理（无风险）

1. **删除 `backend/start.sh`**
   - 原因：与`deploy/deploy.sh`功能重复，且使用`nohup`而非Systemd管理
   - 替代：使用`deploy/deploy.sh`或`systemctl restart fundtrader`

2. **删除 `frontend/fundtrader-v2.service`**
   - 原因：与`deploy/fundtrader-v2.service`完全重复
   - 替代：统一使用`deploy/fundtrader-v2.service`

3. **删除 `frontend/public/real-funds.json`**
   - 原因：测试数据，生产环境从API获取实时数据
   - 替代：如需示例数据，移至`docs/examples/`

### 加入Git忽略（运行时生成文件）

4. **`backend/data/watchlist.json`**
   - 原因：用户自选数据，运行时生成，不应进入版本控制
   - 操作：加入`.gitignore`，`git rm --cached`

5. **`frontend/dist/`**（已在`.gitignore`中）
   - 确认：检查是否确实被忽略

### 待决策文件

6. **`Dockerfile`**
   - 选项A：更新路径后保留（作为容器化备选）
   - 选项B：直接删除（当前未使用Systemd更稳定）

7. **`output/fundtrader_project_guide.md`**
   - 选项A：保留在当前位置
   - 选项B：移至`docs/project_guide.md`

---

## 五、执行命令

```bash
cd /opt/fundtrader

# 1. 删除重复/无用文件
rm -f backend/start.sh
rm -f frontend/fundtrader-v2.service
rm -f frontend/public/real-funds.json

# 2. 将运行时数据加入Git忽略
echo "backend/data/*.json" >> .gitignore
git rm --cached backend/data/watchlist.json 2>/dev/null || true

# 3. 移动规范文档到docs（可选）
mv output/fundtrader_project_guide.md docs/
rmdir output 2>/dev/null || true

# 4. Git提交
git add -A
git commit -m "chore: 清理无用备份/测试脚本，规范项目结构

- 删除 backend/start.sh（与deploy/deploy.sh重复）
- 删除 frontend/fundtrader-v2.service（与deploy/重复）
- 删除 frontend/public/real-funds.json（测试数据）
- 将 backend/data/*.json 加入.gitignore（运行时生成）
- 移动 output/ 到 docs/"

git push gitee master
git push origin master
```

---

## 六、清理后目录结构

```
/opt/fundtrader/
├── README.md
├── .gitignore
├── Dockerfile（待决策）
│
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── utils.py
│   │   ├── api/
│   │   ├── services/
│   │   ├── data/
│   │   │   ├── providers/
│   │   │   ├── cache_manager.py
│   │   │   ├── akshare_fetcher.py
│   │   │   ├── eastmoney_fetcher.py
│   │   │   └── efinance_fetcher.py
│   │   ├── models/
│   │   └── constants/
│   ├── data/                    # 运行时生成，Git忽略
│   ├── requirements.txt
│   ├── .env
│   └── .env.example
│
├── frontend/
│   ├── api/
│   ├── src/
│   ├── db/
│   ├── contracts/
│   ├── public/                  # 清空测试数据
│   ├── dist/                    # 构建产物，Git忽略
│   ├── package.json
│   ├── package-lock.json
│   ├── vite.config.ts
│   ├── tsconfig*.json
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── eslint.config.js
│   ├── vitest.config.ts
│   ├── components.json
│   └── index.html
│
├── deploy/
│   ├── nginx_fund.conf
│   ├── fundtrader.service
│   ├── fundtrader-v2.service
│   └── deploy.sh
│
├── docs/
│   ├── CODEBUDDY.md
│   ├── GITEE_SYNC_GUIDE.md
│   ├── kimiwork2_project_analysis.md
│   ├── research_report_*.md
│   └── fundtrader_project_guide.md  # 从output/移入
│
└── scripts/
    ├── deploy-sg.sh
    └── init-server.sh
```

---

## 七、验证清单

- [ ] `backend/start.sh` 已删除
- [ ] `frontend/fundtrader-v2.service` 已删除
- [ ] `frontend/public/real-funds.json` 已删除
- [ ] `backend/data/*.json` 已加入`.gitignore`
- [ ] `output/` 已合并到`docs/`
- [ ] Git提交并推送
- [ ] 服务重启验证正常

---

*梳理完成，等待确认后执行清理。*
