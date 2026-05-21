"""通用工具函数"""
import sys


def console_error(msg: str) -> None:
    """在控制台输出错误信息"""
    print(f"[ERROR] {msg}", file=sys.stderr)
