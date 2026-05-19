# FundTrader Gitee 同步与部署指南

## 一、Gitee 仓库信息

| 项目 | 值 |
|------|-----|
| 仓库地址 | https://gitee.com/youkell/FundTrader |
| 用户名 | youkell |
| 远程名称 | `gitee`（与 `origin`/GitHub 共存） |
| 认证方式 | HTTPS + Personal Access Token |

### 远程仓库布局

FundTrader 维护两个远程仓库：

- **origin** (GitHub): `https://github.com/youkell85/FundTrader.git` — 公开代码库
- **gitee** (Gitee): `https://gitee.com/youkell/FundTrader.git` — 国内代码库、自动同步

## 二、本地同步操作

### 首次设置

```powershell
# 1. 添加 Gitee 远程（如果尚未添加）
git remote add gitee https://gitee.com/youkell/FundTrader.git
```

### 手动同步

```powershell
# 方式 1: 使用同步脚本
.\sync_to_gitee.ps1

# 方式 2: 手动执行
git add -A
git commit -m "feat: 更新说明"
git push gitee master   # 推送到 Gitee
git push origin master  # 推送到 GitHub
```

### 自动同步（每 30 分钟）

```powershell
# 以管理员身份运行
.\setup_auto_sync.ps1
```

这会在 Windows 计划任务中创建 `FundTrader-SyncToGitee` 任务，每 30 分钟自动提交并推送代码到 Gitee。

**管理命令：**
```powershell
# 查看任务状态
Get-ScheduledTask -TaskName 'FundTrader-SyncToGitee'

# 手动触发同步
Start-ScheduledTask -TaskName 'FundTrader-SyncToGitee'

# 暂停自动同步
Disable-ScheduledTask -TaskName 'FundTrader-SyncToGitee'

# 删除自动同步任务
Unregister-ScheduledTask -TaskName 'FundTrader-SyncToGitee' -Confirm:$false
```

## 三、服务器部署

FundTrader 后端可部署到上海服务器，前端使用 Docker 部署。

### 后端部署

```bash
# SSH 登录上海服务器
ssh root@150.158.127.92

# 克隆 / 更新代码
git clone https://gitee.com/youkell/FundTrader.git /opt/FundTrader
cd /opt/FundTrader

# 安装后端依赖
pip3 install -r backend/requirements.txt

# 创建 .env 文件（密钥需手动配置）
cd backend
nano .env
# 填入: TUSHARE_TOKEN, IFIND_TOKEN, TICKFLOW_API_KEY

# 创建 systemd 服务
cat > /etc/systemd/system/fundtrader.service << 'EOF'
[Unit]
Description=FundTrader API Backend
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/FundTrader/backend
ExecStart=/usr/bin/python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8766
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable fundtrader
systemctl start fundtrader
systemctl status fundtrader
```

### 前端 Docker 部署

```bash
cd /opt/FundTrader
docker build -t fundtrader-frontend -f Dockerfile .
docker run -d --name fundtrader-frontend --restart always \
  -p 3000:3000 \
  -e FUNDTRADER_API_BASE=http://localhost:8766 \
  fundtrader-frontend
```

### 服务器端代码更新

```bash
cd /opt/FundTrader
git pull origin master
systemctl restart fundtrader    # 重启后端
docker restart fundtrader-frontend  # 重启前端
```

## 四、安全建议

### 1. Token 安全管理

`.env` 文件已加入 `.gitignore`，**不会**被推送到 Gitee/GitHub。每台机器需要手动创建：

```bash
# 服务器上
cd /opt/FundTrader/backend
cat > .env << 'EOF'
TUSHARE_TOKEN=your_tushare_token_here
IFIND_TOKEN=your_ifind_jwe_token_here
TICKFLOW_API_KEY=your_tickflow_key_here
EOF
chmod 600 .env
```

### 2. XPS 等其它开发机

克隆项目后也需要单独配置 `.env` 文件。参照 `DATASOURCE_GUIDE.md` 中的密钥说明。

### 3. 已忽略的敏感文件（不推送到 Git）

- `backend/.env` — 所有 API 密钥
- `*.pyc` / `__pycache__/` — Python 缓存
- `node_modules/` — 前端依赖
- `.codebuddy/` — IDE 本地设置

## 五、多设备协同工作流

```
Desktop -> git push gitee master  # 改代码后推送
                          |
                    Gitee 仓库
                          |
XPS -> git pull gitee master      # 拉到 XPS，继续开发
                          |
                    上海服务器
                  git pull && restart  # 部署
```

## 六、故障排查

### 推送失败

```powershell
# 检查远程连接
git remote -v

# 重新设置 Gitee 远程地址（替换 TOKEN）
git remote set-url gitee https://youkell:YOUR_TOKEN@gitee.com/youkell/FundTrader.git

# 强制推送（谨慎使用）
git push -f gitee master
```

### 服务器拉取失败

```bash
# 检查网络
curl -I https://gitee.com

# 手动拉取
cd /opt/FundTrader
git pull origin master
```

### 后端启动失败

```bash
# 查看日志
journalctl -u fundtrader -n 50 --no-pager

# 检查端口
ss -tlnp | grep 8766

# 手动启动测试
cd /opt/FundTrader/backend
python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8766

# 检查 .env 是否存在
cat backend/.env
```
