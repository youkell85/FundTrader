# CLAUDE.md

> 本项目完整上下文和部署指南请参见 [AGENTS.md](./AGENTS.md)。

## 快速部署

修改代码后必须推送并部署。详见 AGENTS.md 的"提交与部署"章节。

```bash
# 一步部署
ssh -o StrictHostKeyChecking=no -i C:\Users\youke\.ssh\id_ed25519_nopass -p 22222 root@43.160.226.62 "cd /opt/fundtrader && git pull gitee master && systemctl restart fundtrader && cd /opt/fundtrader/frontend && npm ci && npm run build && systemctl restart fundtrader-frontend && echo DEPLOY_OK"
```
