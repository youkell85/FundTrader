#!/bin/bash
# FundTrader 一键部署脚本 - 新加坡服务器
# 用法: bash deploy/deploy.sh [--backend-only|--frontend-only|--full]
set -e

SG_HOST="43.160.226.62"
SSH_PORT="${SSH_PORT:-22222}"
GIT_REMOTE="${GIT_REMOTE:-gitee}"
PROJECT_DIR="/opt/fundtrader"
BACKEND_DIR="${PROJECT_DIR}/backend"
FRONTEND_DIR="${PROJECT_DIR}/frontend"

DEPLOY_BACKEND=true
DEPLOY_FRONTEND=true
DEPLOY_NGINX=false
DEPLOY_ENV=false

# 参数解析
while [[ $# -gt 0 ]]; do
  case $1 in
    --backend-only)  DEPLOY_FRONTEND=false; DEPLOY_NGINX=false; shift ;;
    --frontend-only) DEPLOY_BACKEND=false; DEPLOY_NGINX=false; shift ;;
    --nginx-only)    DEPLOY_BACKEND=false; DEPLOY_FRONTEND=false; DEPLOY_NGINX=true; shift ;;
    --full)          DEPLOY_NGINX=true; DEPLOY_ENV=true; shift ;;
    --env)           DEPLOY_ENV=true; shift ;;
    *)               echo "未知参数: $1"; shift ;;
  esac
done

echo "=== FundTrader 部署到新加坡服务器 ==="

# ── 1. 本地 git commit & push ──
echo "[1/6] 提交代码到 Git..."
cd "$(git rev-parse --show-toplevel)"
git add -A
if git diff --cached --quiet; then
  echo "  没有新的变更需要提交"
else
  git commit -m "deploy: $(date '+%Y-%m-%d %H:%M')"
fi

# ── 2. 服务器拉取最新代码 ──
echo "[2/6] 服务器拉取最新代码..."
git push ${GIT_REMOTE} master
echo "  代码已推送"
ssh -p ${SSH_PORT} root@${SG_HOST} "cd ${PROJECT_DIR} && git pull ${GIT_REMOTE} master"

# ── 3. 同步 .env 文件（仅 --env 或 --full） ──
if [ "$DEPLOY_ENV" = true ]; then
  echo "[3/6] 同步环境配置..."
  scp -P ${SSH_PORT} backend/.env root@${SG_HOST}:${BACKEND_DIR}/.env
  echo "  .env 已同步"
else
  echo "[3/6] 跳过环境配置同步"
fi

# ── 4. 部署后端 ──
if [ "$DEPLOY_BACKEND" = true ]; then
  echo "[4/6] 部署后端 (FastAPI)..."
  ssh -p ${SSH_PORT} root@${SG_HOST} "cd ${BACKEND_DIR} && pip3 install -r requirements.txt -q && systemctl restart fundtrader"
  echo "  后端已重启"
else
  echo "[4/6] 跳过后端部署"
fi

# ── 5. 部署前端 ──
if [ "$DEPLOY_FRONTEND" = true ]; then
  echo "[5/6] 部署前端 (Hono BFF)..."
  ssh -p ${SSH_PORT} root@${SG_HOST} "cd ${FRONTEND_DIR} && npm ci && npm run build && systemctl restart fundtrader-frontend"
  echo "  前端已重启"
else
  echo "[5/6] 跳过前端部署"
fi

# ── 6. 更新 Nginx（仅 --full 或 --nginx-only） ──
if [ "$DEPLOY_NGINX" = true ]; then
  echo "[6/6] 更新 Nginx 配置..."
  scp -P ${SSH_PORT} deploy/nginx_fund.conf root@${SG_HOST}:/etc/nginx/conf.d/fundtrader.conf
  scp -P ${SSH_PORT} deploy/fundtrader.service root@${SG_HOST}:/etc/systemd/system/fundtrader.service
  scp -P ${SSH_PORT} deploy/fundtrader-frontend.service root@${SG_HOST}:/etc/systemd/system/fundtrader-frontend.service
  ssh -p ${SSH_PORT} root@${SG_HOST} "systemctl daemon-reload && nginx -t && systemctl reload nginx"
  echo "  Nginx & Systemd 配置已更新"
else
  echo "[6/6] 跳过 Nginx 配置更新"
fi

# ── 验证 ──
echo ""
echo "=== 验证服务 ==="
sleep 3

BACKEND_OK=$(ssh -p ${SSH_PORT} root@${SG_HOST} "curl -s -o /dev/null -w '%{http_code}' http://localhost:8766/health" || echo "ERR")
FRONTEND_OK=$(ssh -p ${SSH_PORT} root@${SG_HOST} "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/fund/" || echo "ERR")
NGINX_OK=$(ssh -p ${SSH_PORT} root@${SG_HOST} "curl -s -o /dev/null -w '%{http_code}' http://localhost/fund/" || echo "ERR")
ASSET_OK=$(ssh -p ${SSH_PORT} root@${SG_HOST} "asset=\$(curl -fsS http://localhost/fund/ | grep -o '/fund/assets/[^\"'\"' ]*' | head -n 1); if [ -n \"\$asset\" ]; then curl -s -o /dev/null -w '%{http_code}' \"http://localhost\$asset\"; else echo MISSING; fi" || echo "ERR")
if [ "${NGINX_OK}" != "200" ] || [ "${ASSET_OK}" != "200" ]; then
  echo "  Static asset:       ${ASSET_OK}"
  echo "  Frontend verification failed: page or entry asset is not reachable"
  exit 1
fi

echo "  后端 (8766):     ${BACKEND_OK}"
echo "  前端 (3000):     ${FRONTEND_OK}"
echo "  Nginx 代理 (80): ${NGINX_OK}"
echo ""
echo "=== 部署完成 ==="
echo "  访问地址: http://${SG_HOST}/fund/"
echo "  API文档:  http://${SG_HOST}/fund/api/docs"
