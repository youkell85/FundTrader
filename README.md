# 鑫基荟基金智选 (FundTrader)

公募基金智能分析 H5 平台，基于“鑫基荟”优选池产品名单，提供排名筛选、深度分析、智能推荐、定投回测、专业分析五大核心功能。

## 功能模块

1. **基金排名筛选** — 按行业/概念分类，业绩排序筛选
2. **深度产品分析** — 业绩曲线、经理信息、LLM 风格分析、配置价值评估
3. **智能定制推荐** — 风险偏好问卷 + 市场行情 → 配置方案
4. **智能定投回测** — 固定金额/均线偏离/策略对比回测
5. **专业分析维度** — 夏普比率、最大回撤、波动率、Calmar/Sortino 比率、风格九宫格

## 技术栈

- **前端**: React 19 + TypeScript + Vite + TailwindCSS + Recharts + Radix UI + Hono (BFF) + tRPC
- **后端**: FastAPI + 多源数据融合（Tushare / TickFlow / iFind / Tencent）
- **部署**: Nginx + Systemd

## 项目结构

```
/opt/fundtrader/
├── backend/          # FastAPI 后端（port 8766）
│   ├── app/
│   │   ├── api/          # 路由层
│   │   ├── services/     # 业务逻辑
│   │   ├── data/         # 数据层（含多源 Provider）
│   │   ├── models/       # 数据模型
│   │   └── constants/    # 常量配置
│   ├── requirements.txt
│   └── .env
├── frontend/         # React + Hono BFF（port 3000）
│   ├── src/            # React 源码
│   ├── api/            # Hono BFF + tRPC
│   ├── dist/           # 构建产物
│   └── package.json
├── deploy/           # 部署配置
│   ├── nginx_fund.conf
│   ├── fundtrader.service
│   ├── fundtrader-frontend.service
│   └── deploy.sh
├── docs/             # 文档
└── scripts/          # 工具脚本
```

## 本地开发

```bash
# 后端
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8766 --reload

# 前端
cd frontend
npm install
npm run dev
```

## 部署

```bash
bash deploy/deploy.sh
```

访问地址: `http://<SERVER_IP>/fund/`

## 数据来源

- **Tushare**: 基金排名、财务指标、历史数据
- **TickFlow**: 实时行情
- **iFind**: 备选数据源
- **腾讯**: 实时估值
- **LLM API**: 基金经理风格分析、配置建议

## 免责声明

本平台仅供数据分析参考，不构成任何投资建议。投资有风险，入市需谨慎。
