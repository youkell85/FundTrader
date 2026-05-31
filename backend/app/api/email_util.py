"""Email utility — send emails via SMTP."""
import logging
import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

logger = logging.getLogger(__name__)

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.qq.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
SMTP_FROM = os.getenv("SMTP_FROM", SMTP_USER)


def send_email(to: str, subject: str, body: str) -> bool:
    """Send an email. Returns True on success."""
    if not SMTP_USER or not SMTP_PASS:
        logger.warning("SMTP not configured — skipping email to %s", to)
        return False
    try:
        msg = MIMEMultipart()
        msg["From"] = SMTP_FROM
        msg["To"] = to
        msg["Subject"] = subject
        msg.attach(MIMEText(body, "html", "utf-8"))

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.send_message(msg)
        logger.info("Email sent to %s: %s", to, subject)
        return True
    except Exception as e:
        logger.error("Failed to send email to %s: %s", to, e)
        return False


def send_verification_email(to: str, username: str, token: str) -> bool:
    """Send email verification link."""
    base = os.getenv("SITE_URL", "http://43.160.226.62/fund")
    link = f"{base}/verify-email?token={token}"
    body = f"""<h2>FundTrader 邮箱验证</h2>
<p>用户 {username}，你好！</p>
<p>请点击以下链接验证你的邮箱：</p>
<p><a href="{link}">{link}</a></p>
<p>链接有效期 1 小时。</p>"""
    return send_email(to, "FundTrader 邮箱验证", body)


def send_password_reset_email(to: str, username: str, new_password: str) -> bool:
    """Send password reset email with new temporary password."""
    body = f"""<h2>FundTrader 密码重置</h2>
<p>用户 {username}，你好！</p>
<p>你的密码已重置，新密码为：<strong>{new_password}</strong></p>
<p>请登录后尽快修改密码。</p>"""
    return send_email(to, "FundTrader 密码重置", body)
