"""Small deterministic Markdown renderer used by backend report services."""
from __future__ import annotations

from typing import Iterable


def table(headers: list[str], rows: Iterable[Iterable[object]]) -> str:
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(_cell(value) for value in row) + " |")
    return "\n".join(lines)


def _cell(value: object) -> str:
    text = "" if value is None else str(value)
    return text.replace("\n", " ").replace("|", "\\|")


def section(title: str, body: str) -> str:
    return f"## {title}\n\n{body.strip()}\n"
