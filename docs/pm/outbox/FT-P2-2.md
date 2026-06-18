# FT-P2-2 - Research Report Word And PDF Export

## Goal

Add deterministic Word/PDF export helpers for FundTrader research report Markdown.

## Context

`docs\0615\gpt` places Word/PDF export after stable Markdown research reports. The implementation should be lightweight, deterministic, and safe in local tests.

Claude coding agent execution is currently unavailable in this environment because CC Switch returns `AppIdNoAuthError`; Codex PM fallback may execute the scoped implementation and must report that fallback explicitly.

## Approved Scope

- Add backend report export helpers that accept Markdown/title/metadata and produce `.docx` and `.pdf` bytes or files.
- Use stdlib-only deterministic output if third-party document libraries are unavailable.
- Preserve Markdown as source of truth.
- Include metadata/provenance in export outputs.
- Do not add external rendering services, browser automation, or production deployment changes.

## Allowed Files

- `backend\app\reports\exporters.py`
- `backend\tests\test_report_exporters.py`
- `docs\pm\reports\FT-P2-2.md`

## Implementation Tasks

1. Inspect existing report modules for export entry points.
2. Implement deterministic docx/pdf export helpers.
3. Add focused tests validating file signatures, metadata text, and deterministic bytes.
4. Write the final implementation report to `docs\pm\reports\FT-P2-2.md`.

## Validation

Run only this safe validation block:

```powershell
cd backend
$env:PYTHONPATH = (Get-Location).Path
pytest tests\test_report_exporters.py -q
```

## Acceptance Criteria

- `.docx` export returns a valid zipped DOCX-like payload.
- `.pdf` export returns a valid PDF payload.
- Exports are deterministic for identical inputs.
- Tests pass without network or browser dependencies.

## Final Report Required

Write `docs\pm\reports\FT-P2-2.md` with implementation summary, files changed, validation result, PM fallback note, and residual risks.
