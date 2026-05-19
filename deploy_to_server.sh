#!/bin/bash
# FundTrader 上海服务器部署脚本
# 用法: ssh root@150.158.127.92 'bash -s' < deploy_to_server.sh
# 功能: 从 Gitee 拉取最新代码并部署到上海服务器

set -e

PROJECT_DIR="/opt/FundTrader"
GITEE_REPO="https://gitee.com/youkell/FundTrader.git"
GITEE_TOKEN="${GITEE_TOKEN:-879e762cd526859f24c7b3a915eb2cae}"
GITEE_USER="youkell"

echo "========================================"
echo "  FundTrader 上海服务器部署"
echo "========================================"
echo ""

# 检查依赖
command -v git >/dev/null 2>&1 || { echo "[ERR] 未安装 git"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "[ERR] 未安装 python3"; exit 1; }

# 创建项目目录
mkdir -p $PROJECT_DIR
cd $PROJECT_DIR

# 克隆或更新仓库
if [ -d ".git" ]; then
    echo "[INFO] 更新现有仓库..."
    git remote set-url origin "https://${GITEE_USER}:${GITEE_TOKEN}@gitee.com/${GITEE_USER}/FundTrader.git"
    git pull origin master
else
    echo "[INFO] 克隆仓库..."
    git clone "https://${GITEE_USER}:${GITEE_TOKEN}@gitee.com/${GITEE_USER}/FundTrader.git" .
fi

# 安装后端依赖
echo "[INFO] 安装 Python 依赖..."
pip3 install -r backend/requirements.txt -q

# 检查 .env 是否存在（密钥文件）
if [ ! -f "backend/.env" ]; then
    echo "[WARN] backend/.env 不存在！需要手动创建"
    echo "       TUSHARE_TOKEN、IFIND_TOKEN、TICKFLOW_API_KEY"
fi

# 启动后端服务（使用 systemd）
echo "[INFO] 配置后端 systemd 服务..."
cat > /etc/systemd/system/fundtrader.service << EOF
[Unit]
Description=FundTrader API Backend
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$PROJECT_DIR/backend
ExecStart=/usr/bin/python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8766
Restart=always
RestartSec=10
Environment=PYTHONUTF8=1

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable fundtrader
systemctl restart fundtrader

# 检查 Docker 是否可用，部署前端
if command -v docker >/dev/null 2>&1; then
    echo "[INFO] 部署前端 Docker 容器..."
    docker stop fundtrader-frontend 2>/dev/null || true
    docker rm fundtrader-frontend 2>/dev/null || true
    docker build -t fundtrader-frontend -f Dockerfile .
    docker run -d --name fundtrader-frontend --restart always \
      -p 3000:3000 \
      -e FUNDTRADER_API_BASE=http://localhost:8766 \
      fundtrader-frontend
    echo "[OK] 前端 Docker 容器已启动"
else
    echo "[WARN] Docker 未安装，跳过前端部署"
fi

echo ""
echo "========================================"
echo "  部署完成"
echo "========================================"
echo "  后端 API: http://150.158.127.92:8766"
echo "  前端地址: http://150.158.127.92:3000"
echo "  后端日志: journalctl -u fundtrader -f"
echo "========================================"
