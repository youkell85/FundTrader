#!/bin/bash
# FundTrader 一键部署脚本
set -e

echo "=== FundTrader 部署脚本 ==="

PROJECT_DIR="/opt/fundtrader"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"
DEPLOY_DIR="$PROJECT_DIR/deploy"

echo "1. 更新代码..."
cd $PROJECT_DIR
git pull origin master || git pull gitee master

echo "2. 安装后端依赖..."
cd $BACKEND_DIR
python3 -m venv .venv
.venv/bin/pip install -U pip -q
.venv/bin/pip install -r requirements.txt

echo "3. 构建前端..."
cd $FRONTEND_DIR
npm ci
npm run build

echo "4. 配置 Nginx..."
cp $DEPLOY_DIR/nginx_fund.conf /etc/nginx/conf.d/fundtrader.conf
nginx -t && systemctl reload nginx

echo "5. 配置 Systemd 服务..."
cp $DEPLOY_DIR/fundtrader.service /etc/systemd/system/
cp $DEPLOY_DIR/fundtrader-frontend.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable fundtrader
systemctl enable fundtrader-frontend

echo "6. 重启服务..."
systemctl restart fundtrader

echo "   等待后端健康检查 (超时 120s)..."
for i in $(seq 1 60); do
  if curl -sf http://127.0.0.1:8766/health > /dev/null 2>&1; then
    echo "   后端已就绪"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "   警告: 后端启动超时，继续部署前端"
  fi
  sleep 2
done

systemctl restart fundtrader-frontend

echo "7. 验证..."
sleep 3
curl -s http://localhost:8766/health | python3 -m json.tool || true
curl -s -o /dev/null -w "HTTP状态码: %{http_code}\n" http://localhost/fund/ || true

echo "=== 部署完成 ==="
echo "前端访问: http://<SERVER_IP>/fund/"
echo "API文档: http://<SERVER_IP>/fund/api/docs"
