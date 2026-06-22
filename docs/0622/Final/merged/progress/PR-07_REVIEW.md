# PR-07 Institution Workspace Review

## Scope

- Added an independent institution workspace capability for Client 360, manual NBA suggestions, and task drafts.
- Added backend modules:
  - `backend/app/services/client_360.py`
  - `backend/app/services/feature_flags.py`
  - `backend/app/services/nba_engine.py`
  - `backend/app/api/workspace.py`
- Added frontend modules:
  - `frontend/src/types/workspace.ts`
  - `frontend/src/pages/workspace/CMWorkbench.tsx`
- Mounted the backend router in `backend/app/main.py` and the frontend page at `/workspace`.

## Contract And Compliance Review

- Direct contact fields are recursively stripped from Client 360 payloads.
- No direct personal contact values are persisted.
- `direct_contact_storage`, `auto_outreach`, and `org_rbac_import` are explicitly disabled by feature flags.
- NBA output is suggestion-only:
  - `manual_only=true`
  - `auto_send=false`
  - `status=draft`
- Task output is draft-only and requires manual approval.
- Organization/RBAC/client import migrations remain out of scope for PR-07.

## Data Truthfulness Review

- The workspace uses only request-provided client and holding evidence.
- Missing or incomplete risk/holding evidence is surfaced through `data_quality.status=partial`.
- No simulated holdings, contacts, or recommendation evidence are generated.

## Impact Review

- Pre-edit GitNexus impact for `backend/app/main.py:app`: LOW.
- Pre-edit GitNexus impact for `frontend/src/App.tsx:App`: LOW.
- Existing sales talk generation and product explanation flows are not modified.

## Validation

- `cd backend && python -m pytest tests/test_workspace_services.py`
  - Result: 4 passed.
- `cd frontend && npm run check`
  - Result: passed.

## Residual Risks

- `/workspace` is an MVP workbench and does not yet include organization hierarchy, RBAC import, CRM import, or task persistence.
- NBA rules are deterministic guardrail rules; richer campaign prioritization should be added only after source evidence and approval workflow are formalized.
