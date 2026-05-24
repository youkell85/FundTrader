# FundTrader 自动同步部署指南

## 架构概览

```
本地开发 (Windows)                Gitee 仓库              新加坡服务器 (43.160.226.62)
┌──────────────┐              ┌──────────────┐         ┌──────────────────────┐
│ git push     │─────────────▶│  Gitee Repo  │────────▶│ Webhook Listener     │
│ gitee master │              │  youkell/    │  Push   │ :9100/webhook/deploy │
└──────────────┘              │  FundTrader  │  Hook   │         │             │
       │                      └──────────────┘         │    git pull          │
       │ deploy-local.bat                              │    + 重启服务         │
       └──────────── SSH 直连部署 ─────────────────────▶│                      │
                                                              └──────────────┘
```

## 两种部署方式

### 方式一：本地一键部署（推荐日常使用）

```bash
# Windows CMD
scripts\deploy-local.bat

# Git Bash / WSL
bash scripts/deploy-auto.sh
```

**参数说明：**

| 参数 | 说明 |
|------|------|
| (无参数) | 默认：提交代码 + 推送 + 部署后端和前端 |
| `--backend-only` | 仅部署后端 |
| `--frontend-only` | 仅部署前端 |
| `--full` | 完整部署（含 Nginx 配置 + .env 同步） |
| `--quick` | 快速部署（不同步 .env 和 Nginx） |
| `--skip-commit` | 跳过本地 commit/push，仅触发服务器部署 |
| `--env` | 同步 .env 文件 |

**示例：**

```bash
# 日常开发：提交并部署前后端
scripts\deploy-local.bat

# 仅修改了后端代码
scripts\deploy-local.bat --backend-only

# 服务器已有最新代码，只需重启
scripts\deploy-local.bat --skip-commit

# 首次部署或大改配置
scripts\deploy-local.bat --full
```

### 方式二：Gitee Webhook 自动部署（推送后自动触发）

当本地 `git push gitee master` 后，Gitee 会自动通知服务器拉取代码并重启。

**配置步骤（一次性）：**

1. 登录 Gitee → 进入 [FundTrader 仓库](https://gitee.com/youkell/FundTrader)
2. 管理 → WebHooks → 添加 WebHook
3. 填写：
   - **URL**: `http://43.160.226.62:9100/webhook/deploy`
   - **密码/Secret**: `fundtrader_webhook_2024`
   - **勾选**: Push Hook
   - **勾选**: Active
4. 保存

**验证 Webhook：**

```bash
# 在服务器上测试
curl http://localhost:9100/webhook/health
# 应返回: {"status": "ok", "service": "fundtrader-webhook"}

# 模拟 Gitee Push 事件
curl -X POST http://43.160.226.62:9100/webhook/deploy \
  -H "Content-Type: application/json" \
  -H "X-Gitee-Token: fundtrader_webhook_2024" \
  -H "X-Gitee-Event: Push Hook" \
  -d '{"ref":"refs/heads/master","commits":[{"added":[],"modified":["backend/app/main.py"],"removed":[]}],"pusher":{"name":"test"}}'
```

## 服务器服务管理

```bash
# SSH 连接
ssh -p 22222 root@43.160.226.62

# 查看服务状态
systemctl status fundtrader              # 后端 FastAPI
systemctl status fundtrader-frontend     # 前端 Hono BFF
systemctl status fundtrader-webhook      # Webhook 监听器

# 重启服务
systemctl restart fundtrader
systemctl restart fundtrader-frontend
systemctl restart fundtrader-webhook

# 查看日志
journalctl -u fundtrader -f              # 后端日志
journalctl -u fundtrader-frontend -f     # 前端日志
journalctl -u fundtrader-webhook -f      # Webhook 日志
```

## 端口分配

| 端口 | 服务 | 说明 |
|------|------|------|
| 80 | Nginx | 反向代理入口 |
| 3000 | Hono BFF | 前端 Node.js 服务 |
| 8766 | FastAPI | 后端 API 服务 |
| 9100 | Webhook | Gitee Push 监听 |

## 安全说明

- Webhook Secret 存储在 systemd 环境变量中，修改后需 `systemctl restart fundtrader-webhook`
- 建议定期更换 Webhook Secret
- 如需限制 Webhook 访问来源，可在 Nginx 中添加 IP 白名单（Gitee Webhook IP 段）
- 生产环境建议将 Webhook 放在 Nginx 后面，使用 HTTPS

## 修改 Webhook Secret

1. 编辑 `/etc/systemd/system/fundtrader-webhook.service`
2. 修改 `Environment=WEBHOOK_SECRET=新的密码`
3. 执行：
   ```bash
   systemctl daemon-reload
   systemctl restart fundtrader-webhook
   ```
4. 同步更新 Gitee WebHook 配置中的密码
