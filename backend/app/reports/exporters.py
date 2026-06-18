"""Deterministic Word/PDF export helpers for research report Markdown."""
from __future__ import annotations

import html
import io
import json
import zipfile
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ReportExport:
    filename: str
    content_type: str
    data: bytes
    metadata: dict[str, Any]


def _plain_lines(markdown: str) -> list[str]:
    lines: list[str] = []
    for raw in markdown.splitlines():
        text = raw.strip()
        if not text:
            continue
        if text.startswith("#"):
            text = text.lstrip("#").strip()
        lines.append(text)
    return lines or ["Empty report"]


def _docx_xml(markdown: str, metadata: dict[str, Any]) -> str:
    paragraphs = []
    meta = json.dumps(metadata, ensure_ascii=False, sort_keys=True)
    for line in [f"metadata: {meta}", *_plain_lines(markdown)]:
        paragraphs.append(
            "<w:p><w:r><w:t>"
            + html.escape(line, quote=False)
            + "</w:t></w:r></w:p>"
        )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        "<w:body>"
        + "".join(paragraphs)
        + "</w:body></w:document>"
    )


def export_markdown_docx(markdown: str, *, title: str, metadata: dict[str, Any] | None = None) -> ReportExport:
    meta = {"title": title, **(metadata or {})}
    buffer = io.BytesIO()
    fixed_time = (2026, 1, 1, 0, 0, 0)
    files = {
        "[Content_Types].xml": (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/word/document.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            "</Types>"
        ),
        "_rels/.rels": (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
            'Target="word/document.xml"/>'
            "</Relationships>"
        ),
        "word/document.xml": _docx_xml(markdown, meta),
    }
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for name in sorted(files):
            info = zipfile.ZipInfo(name, fixed_time)
            info.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(info, files[name].encode("utf-8"))
    return ReportExport(
        filename=_safe_filename(title, "docx"),
        content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        data=buffer.getvalue(),
        metadata=meta,
    )


def _pdf_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def export_markdown_pdf(markdown: str, *, title: str, metadata: dict[str, Any] | None = None) -> ReportExport:
    meta = {"title": title, **(metadata or {})}
    lines = [f"{title}", f"metadata: {json.dumps(meta, ensure_ascii=False, sort_keys=True)}", *_plain_lines(markdown)]
    text_ops = ["BT", "/F1 10 Tf", "50 780 Td"]
    for idx, line in enumerate(lines[:45]):
        if idx:
            text_ops.append("0 -14 Td")
        text_ops.append(f"({_pdf_escape(line[:110])}) Tj")
    text_ops.append("ET")
    stream = "\n".join(text_ops).encode("utf-8")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode("ascii") + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    payload = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(payload))
        payload.extend(f"{index} 0 obj\n".encode("ascii"))
        payload.extend(obj)
        payload.extend(b"\nendobj\n")
    xref_at = len(payload)
    payload.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    payload.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        payload.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    payload.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n".encode("ascii")
    )
    return ReportExport(
        filename=_safe_filename(title, "pdf"),
        content_type="application/pdf",
        data=bytes(payload),
        metadata=meta,
    )


def _safe_filename(title: str, suffix: str) -> str:
    safe = "".join(ch.lower() if ch.isalnum() else "-" for ch in title.strip()) if title else "report"
    safe = "-".join(part for part in safe.split("-") if part) or "report"
    return f"{safe}.{suffix}"
