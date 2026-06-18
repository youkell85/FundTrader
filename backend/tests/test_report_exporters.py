import zipfile
from io import BytesIO

from app.reports.exporters import export_markdown_docx, export_markdown_pdf


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
