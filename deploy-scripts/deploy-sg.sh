#!/bin/bash
# FundTrader 一键部署脚本 - 新加坡服务器
# 用法: bash deploy-scripts/deploy-sg.sh [--backend-only|--frontend-only]
set -e

SG_HOST="43.160.226.62"
BACKEND_DIR="/opt/fundtrader/backend"
V2_DIR="/opt/fundtrader-v2/v2/frontend"

DEPLOY_BACKEND=true
DEPLOY_FRONTEND=true

if [ "$1" = "--backend-only" ]; then
  DEPLOY_FRONTEND=false
elif [ "$1" = "--frontend-only" ]; then
  DEPLOY_BACKEND=false
fi

echo "=== FundTrader 部署到新加坡服务器 ==="

# 1. 本地 git commit & push
echo "[1/5] 提交代码到 Git..."
cd "$(git rev-parse --show-toplevel)"
git add -A
if git diff --cached --quiet; then
  echo "  没有新的变更需要提交"
else
  git commit -m "deploy: $(date '+%Y-%m-%d %H:%M')"
  git push origin master
  echo "  代码已推送"
fi

# 2. 服务器拉取最新代码
echo "[2/5] 服务器拉取最新代码..."
ssh root@${SG_HOST} "cd /opt/fundtrader && git pull origin master && cd /opt/fundtrader-v2 && git pull origin master"

# 3. 部署后端
if [ "$DEPLOY_BACKEND" = true ]; then
  echo "[3/5] 部署后端 (FastAPI)..."
  ssh root@${SG_HOST} "cd ${BACKEND_DIR} && pip3 install -r requirements.txt -q && systemctl restart fundtrader"
  echo "  后端已重启"
else
  echo "[3/5] 跳过后端部署"
fi

# 4. 部署前端
if [ "$DEPLOY_FRONTEND" = true ]; then
  echo "[4/5] 部署前端 (Hono BFF)..."
  ssh root@${SG_HOST} "cd ${V2_DIR} && npm install --production=false && npm run build && systemctl restart fundtrader-v2"
  echo "  前端已重启"
else
  echo "[4/5] 跳过前端部署"
fi

# 5. 验证
echo "[5/5] 验证服务..."
sleep 3
BACKEND_OK=$(ssh root@${SG_HOST} "curl -s -o /dev/null -w '%{http_code}' http://localhost:8766/health")
FRONTEND_OK=$(ssh root@${SG_HOST} "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/fund/")

echo ""
echo "=== 部署结果 ==="
echo "  后端 (8766): ${BACKEND_OK}"
echo "  前端 (3000): ${FRONTEND_OK}"
echo "  访问地址: http://${SG_HOST}/fund/"
