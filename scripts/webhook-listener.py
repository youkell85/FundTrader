#!/usr/bin/env python3
"""
FundTrader Gitee Webhook Listener
监听 Gitee Push 事件，自动拉取代码并重启服务

部署: 放在 /opt/fundtrader/scripts/webhook-listener.py
启动: systemctl start fundtrader-webhook
端口: 9100
"""
import hmac
import hashlib
import json
import logging
import os
import subprocess
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("webhook")

# ── 配置 ──
WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "fundtrader_webhook_2024")
LISTEN_PORT = int(os.environ.get("WEBHOOK_PORT", "9100"))
PROJECT_DIR = "/opt/fundtrader"
BACKEND_DIR = f"{PROJECT_DIR}/backend"
FRONTEND_DIR = f"{PROJECT_DIR}/frontend"
GIT_REMOTE = os.environ.get("GIT_REMOTE", "gitee")
BRANCH = os.environ.get("BRANCH", "master")


def run_cmd(cmd: str, cwd: str = None) -> tuple[int, str]:
    """执行命令并返回 (exit_code, output)"""
    try:
        result = subprocess.run(
            cmd, shell=True, cwd=cwd, capture_output=True, text=True, timeout=300
        )
        return result.returncode, (result.stdout + result.stderr).strip()
    except subprocess.TimeoutExpired:
        return -1, "TIMEOUT"
    except Exception as e:
        return -1, str(e)


def do_deploy(changed_files: list[str] = None) -> dict:
    """执行部署流程"""
    results = {}

    # 1. 拉取代码
    log.info("拉取最新代码...")
    rc, out = run_cmd(f"git pull {GIT_REMOTE} {BRANCH}", cwd=PROJECT_DIR)
    results["git_pull"] = {"ok": rc == 0, "output": out}
    if rc != 0:
        log.error(f"git pull 失败: {out}")
        return results
    log.info(f"git pull: {out}")

    # 判断是否需要部署后端/前端
    deploy_backend = True
    deploy_frontend = True
    if changed_files:
        backend_files = [f for f in changed_files if f.startswith("backend/")]
        frontend_files = [f for f in changed_files if f.startswith("frontend/")]
        deploy_files = [f for f in changed_files if f.startswith("deploy/")]
        if not backend_files and not deploy_files:
            deploy_backend = False
            log.info("无后端变更，跳过后端部署")
        if not frontend_files and not deploy_files:
            deploy_frontend = False
            log.info("无前端变更，跳过前端部署")

    # 2. 部署后端
    if deploy_backend:
        log.info("部署后端...")
        rc, out = run_cmd(
            f"cd {BACKEND_DIR} && "
            "python3 -m venv .venv && "
            ".venv/bin/pip install -U pip -q && "
            ".venv/bin/pip install -r requirements.txt -q && "
            "systemctl restart fundtrader",
        )
        results["backend"] = {"ok": rc == 0, "output": out[-200:] if out else ""}
        log.info(f"后端部署: {'OK' if rc == 0 else 'FAIL'}")

    # 3. 部署前端
    if deploy_frontend:
        log.info("部署前端...")
        rc, out = run_cmd(
            f"cd {FRONTEND_DIR} && npm ci && npm run build && systemctl restart fundtrader-frontend",
        )
        results["frontend"] = {"ok": rc == 0, "output": out[-200:] if out else ""}
        log.info(f"前端部署: {'OK' if rc == 0 else 'FAIL'}")

    # 4. 验证
    import time
    time.sleep(3)
    rc_b, _ = run_cmd("curl -s -o /dev/null -w '%{http_code}' http://localhost:8766/health")
    rc_f, _ = run_cmd("curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/fund/")
    rc_n, _ = run_cmd("curl -s -o /dev/null -w '%{http_code}' http://localhost/fund/")
    results["verify"] = {
        "backend": rc_b == 0,
        "frontend": rc_f == 0,
        "nginx": rc_n == 0,
    }
    log.info(f"验证: backend={rc_b==0}, frontend={rc_f==0}, nginx={rc_n==0}")

    return results


class WebhookHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        log.debug(format % args)

    def _verify_signature(self, body: bytes) -> bool:
        """验证 Gitee Webhook 签名"""
        signature = self.headers.get("X-Gitee-Token", "")
        if not signature:
            # 也支持 X-Gitee-Signature (HMAC)
            sig_header = self.headers.get("X-Gitee-Signature", "")
            if sig_header:
                expected = hmac.new(
                    WEBHOOK_SECRET.encode(), body, hashlib.sha256
                ).hexdigest()
                return hmac.compare_digest(sig_header, expected)
            # 无签名时用 token 验证
            return False
        return signature == WEBHOOK_SECRET

    def do_POST(self):
        if self.path != "/webhook/deploy":
            self.send_response(404)
            self.end_headers()
            return

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)

        # 验证签名
        if not self._verify_signature(body):
            log.warning("Webhook 签名验证失败")
            self.send_response(403)
            self.end_headers()
            self.wfile.write(b"Forbidden")
            return

        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            self.send_response(400)
            self.end_headers()
            return

        # 检查事件类型
        event = self.headers.get("X-Gitee-Event", "")
        if event != "Push Hook":
            log.info(f"忽略非 Push 事件: {event}")
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"Ignored")
            return

        # 提取变更文件
        ref = payload.get("ref", "")
        if not ref.endswith(f"/{BRANCH}"):
            log.info(f"忽略非 {BRANCH} 分支推送: {ref}")
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"Ignored branch")
            return

        commits = payload.get("commits", [])
        changed_files = []
        for commit in commits:
            changed_files.extend(commit.get("added", []))
            changed_files.extend(commit.get("modified", []))
            changed_files.extend(commit.get("removed", []))

        pusher = payload.get("pusher", {}).get("name", "unknown")
        log.info(f"收到 Push: {pusher} 推送了 {len(commits)} 个提交, {len(changed_files)} 个文件变更")

        # 执行部署
        results = do_deploy(changed_files)

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"status": "ok", "results": results}).encode())

    def do_GET(self):
        """健康检查"""
        if self.path == "/webhook/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok", "service": "fundtrader-webhook"}).encode())
        else:
            self.send_response(404)
            self.end_headers()


def main():
    server = HTTPServer(("0.0.0.0", LISTEN_PORT), WebhookHandler)
    log.info(f"Webhook 监听器启动，端口: {LISTEN_PORT}")
    log.info(f"Webhook URL: http://0.0.0.0:{LISTEN_PORT}/webhook/deploy")
    log.info(f"项目目录: {PROJECT_DIR}")
    log.info(f"Git Remote: {GIT_REMOTE}/{BRANCH}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("收到中断信号，正在关闭...")
        server.server_close()


if __name__ == "__main__":
    main()
