# 国元基金智选 (FundTrader)

公募基金智能分析H5平台，基于国元证券公募基金持续营销名单，提供排名筛选、深度分析、智能推荐、定投回测、专业分析五大核心功能。

## 功能模块

1. **基金排名筛选** — 按行业/概念分类，业绩排序筛选
2. **深度产品分析** — 业绩曲线、经理信息、LLM风格分析、配置价值评估
3. **智能定制推荐** — 风险偏好问卷 + 市场行情 → 配置方案
4. **智能定投回测** — 固定金额/均线偏离/策略对比回测
5. **专业分析维度** — 夏普比率、最大回撤、波动率、Calmar/Sortino比率、风格九宫格

## 技术栈

- **前端**: Vue 3 + TypeScript + Vite + TailwindCSS + ECharts
- **后端**: FastAPI + AkShare + efinance + LLM API
- **部署**: Nginx + Systemd

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

- AkShare: 基金排名、基本信息、持仓、行业板块
- efinance: 基金历史净值、定投回测
- 东方财富API: 实时估值、排名数据
- LLM API: 基金经理风格分析、配置建议

## 免责声明

本平台仅供数据分析参考，不构成任何投资建议。投资有风险，入市需谨慎。