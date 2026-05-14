#!/bin/bash
# FundTrader 一键部署脚本
set -e

echo "=== FundTrader 部署脚本 ==="

PROJECT_DIR="/opt/fundtrader"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"

# 1. 创建目录
mkdir -p $PROJECT_DIR

# 2. 克隆代码（如果不存在）
if [ ! -d "$PROJECT_DIR/.git" ]; then
    echo "克隆代码..."
    git clone <GITEE_REPO_URL> $PROJECT_DIR
fi

# 3. 安装后端依赖
echo "安装后端依赖..."
cd $BACKEND_DIR
pip3 install -r requirements.txt

# 4. 构建前端
echo "构建前端..."
cd $FRONTEND_DIR
npm install
npm run build

# 5. 配置Nginx
echo "配置Nginx..."
cp $PROJECT_DIR/deploy/nginx_fund.conf /etc/nginx/conf.d/fundtrader.conf
nginx -t && systemctl reload nginx

# 6. 配置Systemd
echo "配置Systemd服务..."
cp $PROJECT_DIR/deploy/fundtrader.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable fundtrader
systemctl restart fundtrader

# 7. 验证
echo "验证服务..."
sleep 3
curl -s http://localhost:8766/fund/api/health | python3 -m json.tool
curl -s -o /dev/null -w "%{http_code}" http://localhost/fund/

echo "=== 部署完成 ==="
echo "前端访问: http://<SERVER_IP>/fund/"
echo "API文档: http://<SERVER_IP>/fund/api/docs"