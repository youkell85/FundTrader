#!/bin/bash
# FundTrader v2 服务器初始化脚本 - 首次部署时在服务器上执行
# 用法: ssh root@43.160.226.62 "bash -s" < deploy-scripts/init-server.sh
set -e

PROJECT_DIR="/opt/fundtrader"
BACKEND_DIR="${PROJECT_DIR}/v2/backend"
FRONTEND_DIR="${PROJECT_DIR}/v2/frontend"

echo "=== FundTrader v2 服务器初始化 ==="

# ── 1. 安装系统依赖 ──
echo "[1/7] 安装系统依赖..."
apt-get update -qq
apt-get install -y -qq python3 python3-pip nginx git curl

# ── 2. 安装 Node.js 22 ──
echo "[2/7] 安装 Node.js 22..."
if ! command -v node &>/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "  Node.js: $(node -v)"
echo "  npm:     $(npm -v)"

# ── 3. 克隆代码 ──
echo "[3/7] 克隆代码..."
if [ ! -d "${PROJECT_DIR}/.git" ]; then
  git clone https://gitee.com/<YOUR_GITEE_REPO> ${PROJECT_DIR}
else
  cd ${PROJECT_DIR} && git pull origin master
fi

# ── 4. 安装后端依赖 ──
echo "[4/7] 安装后端依赖..."
pip3 install -r ${BACKEND_DIR}/requirements.txt -q

# ── 5. 构建前端 ──
echo "[5/7] 构建前端..."
cd ${FRONTEND_DIR}
npm ci
npm run build

# ── 6. 配置 Systemd 服务 ──
echo "[6/7] 配置 Systemd 服务..."
cp ${PROJECT_DIR}/deploy/fundtrader.service /etc/systemd/system/
cp ${PROJECT_DIR}/v2/frontend/fundtrader-v2.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable fundtrader fundtrader-v2

# ── 7. 配置 Nginx ──
echo "[7/7] 配置 Nginx..."
cp ${PROJECT_DIR}/deploy/nginx_fund.conf /etc/nginx/conf.d/fundtrader.conf
# 移除默认 nginx 站点避免冲突
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl enable nginx && systemctl restart nginx

# ── 启动服务 ──
echo ""
echo "=== 启动服务 ==="
systemctl start fundtrader
systemctl start fundtrader-v2

sleep 3

# ── 验证 ──
BACKEND_OK=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8766/health || echo "ERR")
FRONTEND_OK=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/fund/ || echo "ERR")
NGINX_OK=$(curl -s -o /dev/null -w '%{http_code}' http://localhost/fund/ || echo "ERR")

echo ""
echo "=== 初始化完成 ==="
echo "  后端 (8766):     ${BACKEND_OK}"
echo "  前端 (3000):     ${FRONTEND_OK}"
echo "  Nginx 代理 (80): ${NGINX_OK}"
echo ""
echo "  访问地址: http://$(hostname -I | awk '{print $1}')/fund/"
echo "  API文档:  http://$(hostname -I | awk '{print $1}')/fund/api/docs"
echo ""
echo "⚠️  请手动完成以下步骤:"
echo "  1. 创建 ${BACKEND_DIR}/.env (参考 backend/.env)"
echo "  2. 更新 deploy-scripts/init-server.sh 中的 GITEE 仓库地址"
echo "  3. 如有 SSL 证书需求，配置 nginx HTTPS"