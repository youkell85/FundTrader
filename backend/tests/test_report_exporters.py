import zipfile
import asyncio
from io import BytesIO
from unittest.mock import patch

from app.reports.exporters import export_markdown_docx, export_markdown_pdf
from app.api.fund import fund_research_report


MARKDOWN = """# Fund Report

## Evidence

- source: fund_quote_snapshot
- data_quality: partial
"""


def test_docx_export_is_deterministic_and_contains_metadata():
    first = export_markdown_docx(MARKDOWN, title="Fund Report", metadata={"code": "000001"})
    second = export_markdown_docx(MARKDOWN, title="Fund Report", metadata={"code": "000001"})

    assert first.data == second.data
    assert first.filename == "fund-report.docx"
    assert first.content_type.endswith("wordprocessingml.document")
    with zipfile.ZipFile(BytesIO(first.data)) as zf:
        names = set(zf.namelist())
        document = zf.read("word/document.xml").decode("utf-8")
    assert "[Content_Types].xml" in names
    assert "Fund Report" in document
    assert "fund_quote_snapshot" in document
    assert '"code": "000001"' in document


def test_pdf_export_is_deterministic_and_contains_report_text():
    first = export_markdown_pdf(MARKDOWN, title="Fund Report", metadata={"code": "000001"})
    second = export_markdown_pdf(MARKDOWN, title="Fund Report", metadata={"code": "000001"})

    assert first.data == second.data
    assert first.filename == "fund-report.pdf"
    assert first.content_type == "application/pdf"
    assert first.data.startswith(b"%PDF-1.4")
    assert b"Fund Report" in first.data
    assert b"fund_quote_snapshot" in first.data


def test_research_report_endpoint_keeps_markdown_json_contract():
    payload = {"markdown": MARKDOWN, "dataStatus": "available", "asOf": "2026-06-18", "source": "unit"}
    with patch("app.reports.fund_research_report.render_fund_research_report", return_value=payload):
        result = asyncio.run(fund_research_report("000001"))

    assert result == payload


def test_research_report_endpoint_exports_markdown_docx_and_pdf():
    payload = {"markdown": MARKDOWN, "dataStatus": "available", "asOf": "2026-06-18", "source": "unit"}
    with patch("app.reports.fund_research_report.render_fund_research_report", return_value=payload):
        markdown = asyncio.run(fund_research_report("000001", format="md"))
        docx = asyncio.run(fund_research_report("000001", format="docx"))
        pdf = asyncio.run(fund_research_report("000001", format="pdf"))

    assert markdown.media_type.startswith("text/markdown")
    assert markdown.headers["content-disposition"] == 'attachment; filename="fund-000001-research-report.md"'
    assert markdown.body == MARKDOWN.encode("utf-8")
    assert docx.media_type.endswith("wordprocessingml.document")
    assert docx.headers["content-disposition"] == 'attachment; filename="fund-000001-research-report.docx"'
    assert docx.body.startswith(b"PK")
    assert pdf.media_type == "application/pdf"
    assert pdf.headers["content-disposition"] == 'attachment; filename="fund-000001-research-report.pdf"'
    assert pdf.body.startswith(b"%PDF-1.4")
