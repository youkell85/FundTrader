"""通用工具函数"""
import sys
import re
import os


def console_error(msg: str) -> None:
    """在控制台输出错误信息（自动脱敏敏感信息）"""
    sanitized = _sanitize_sensitive_info(msg)
    print(f"[ERROR] {sanitized}", file=sys.stderr)


def _sanitize_sensitive_info(msg: str) -> str:
    """脱敏日志中的敏感信息"""
    if not msg:
        return msg
    # 脱敏 API Keys
    msg = re.sub(r'(api[_-]?key[=:\s]+)[\w-]+', r'\1***REDACTED***', msg, flags=re.IGNORECASE)
    # 脱敏 Bearer tokens
    msg = re.sub(r'(Bearer\s+)\S+', r'\1***REDACTED***', msg)
    # 脱敏密码
    msg = re.sub(r'(password[=:\s]+)\S+', r'\1***REDACTED***', msg, flags=re.IGNORECASE)
    # 脱敏 token
    msg = re.sub(r'(token[=:\s]+)\S+', r'\1***REDACTED***', msg, flags=re.IGNORECASE)
    return msg


def console_info(msg: str) -> None:
    """在控制台输出信息"""
    print(f"[INFO] {msg}")


def console_warn(msg: str) -> None:
    """在控制台输出警告"""
    print(f"[WARN] {msg}", file=sys.stderr)
