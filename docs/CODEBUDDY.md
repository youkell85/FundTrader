# FundTrader 项目上下文

## 项目概述

公募基金智能分析 H5 平台，基于国元证券公募基金持续营销名单，提供排名筛选、深度分析、智能推荐、定投回测、专业分析五大核心功能。

## 开发环境

| 项目 | 值 |
|------|-----|
| 开发机器 | Desktop (`C:\Users\youke\CodeBuddy\FundTrader`) |
| 协同机器 | XPS (`D:\CodeBuddy\FundTrader`) |
| Gitee 仓库 | `https://gitee.com/youkell/FundTrader` |
| GitHub 仓库 | `https://github.com/youkell85/FundTrader.git` |

## 端口分配

| 服务 | 端口 | 说明 |
|------|------|------|
| FastAPI 后端 | **8766** | 生产/开发均使用此端口 |
| Vite 前端开发 | 5173 (默认) | `npm run dev` |
| Docker 前端 | 3000 | `Dockerfile` 暴露端口 |

## 技术栈

- **前端**: Vue 3 + TypeScript + Vite + TailwindCSS + ECharts（在 v2/ 目录）
- **后端**: Python FastAPI + Uvicorn
- **数据源**: iFinD MCP + Tushare Pro + TickFlow + 腾讯财经 + AkShare + 东方财富 + efinance + NeoData + westock-data（9个数据源）

## 项目结构

```
FundTrader/
├── backend/
│   ├── app/
│   │   ├── api/       # FastAPI 路由
│   │   ├── data/      # 数据层（providers + fetchers）
│   │   ├── services/  # 业务逻辑
│   │   ├── models/    # Pydantic 模型
│   │   ├── utils/     # 工具函数
│   │   ├── config.py  # 配置（加载 .env）
│   │   └── main.py    # 入口
│   ├── .env           # 密钥（不提交 Git）
│   ├── requirements.txt
│   └── start.sh       # 启动脚本
├── v2/
│   └── frontend/      # Vue 3 前端
├── Dockerfile         # 前端 Docker 构建
├── CODEBUDDY.md       # ← 当前文件
├── DATASOURCE_GUIDE.md # 数据源参考手册（详细）
├── GITEE_SYNC_GUIDE.md # 同步与部署指南
├── sync_to_gitee.ps1  # 手动同步脚本
└── setup_auto_sync.ps1 # 自动同步计划任务
```

## 架构说明

三层数据架构：
- **融合层** (`backend/app/data/fusion.py`): 统一入口，按优先级合并多源数据
- **Provider层**: 实现 `DataProvider` 基类，参与融合调度（iFinD > Tushare > TickFlow > 腾讯财经）
- **Fetcher层**: 独立函数，不参与融合（AkShare、东方财富、efinance）

详细数据源选型参见 `DATASOURCE_GUIDE.md`。

## 启动命令

### 后端

```powershell
cd C:\Users\youke\CodeBuddy\FundTrader\backend
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8766 --reload
```

### 前端（v2）

```powershell
cd v2\frontend
npm install
npm run dev
```

## 密钥管理

所有密钥存储在 `backend/.env`，**不提交 Git**。已忽略在 `.gitignore` 中。每台机器需单独配置：

```env
TUSHARE_TOKEN=...     # Tushare Pro (6000积分)
IFIND_TOKEN=...       # iFinD MCP JWE Token
TICKFLOW_API_KEY=...  # TickFlow API Key
```

## 数据源核心要点

- iFinD MCP: 4个独立服务器（stock/fund/edb/news），HTTP POST JSON-RPC 2.0
- Tushare: `ts.pro_api(token)` 初始化，代码格式 `600519.SH`/`000001.SZ`
- TickFlow: 免费版仅支持日K线
- 融合层优先级: iFinD(P=5) > Tushare(P=4) > TickFlow(P=3) > 腾讯财经(P=2)

## 常见问题

1. **dotenv 加载顺序**: `config.py` 中先加载 `.env`，再导入 fusion.py。修改时注意保持此顺序
2. **Python 编码**: Windows 下可能出现 UTF-8 编码问题，启动时加 `PYTHONUTF8=1`
3. **端口冲突**: 启动前检查 8766 是否已被占用
4. **iFinD Token**: JWE 格式，通过 HTTP Bearer Token 传递，约 849 字符

## Gitee 自动同步

代码每 30 分钟自动推送到 Gitee（通过 Windows 计划任务）。XPS 上 `git pull gitee master` 获取最新代码后，CodeBuddy 自动加载本文件获取项目上下文。
