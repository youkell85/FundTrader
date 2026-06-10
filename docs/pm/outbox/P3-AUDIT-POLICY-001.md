# P3-AUDIT-POLICY-001 - P3 calibration audit policy config

Created: 2026-06-10T21:49:26+08:00
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Make the P3 calibration audit policy explicit and configurable without changing
allocation behaviour. The pipeline health API should continue to return the
same audit health/section fields, and should additionally expose the policy
used to classify calibration coverage/drift.

This is a monitoring/observability task only. It must not change portfolio
generation, optimizer inputs, calibration writers, authentication, deployment,
or production smoke semantics.

## Context

- Current repo: FundTrader
- Current task owner: Codex PM
- Coding agent role: implementer only
- Important background:
  - Keep unrelated dirty worktree changes untouched.
  - If repo state has drifted from this handoff, stop and report before editing.
  - PM decision accepted on 2026-06-10: unauthenticated production
    `POST /fund/api/allocation/generate` returning HTTP 401 remains WARN, not
    FAIL, in the production smoke script. Do not alter that behaviour in this
    task.
  - Current P3 local work already introduced read-only
    `backend/app/allocation/calibration_audit.py` and tests. Build on it.
  - Keep all new source and test text ASCII-only.

## Approved Scope

Files or areas the coding agent may edit:

- `backend/app/allocation/calibration_audit.py`
- `backend/tests/test_calibration_audit.py`
- `docs/pm/reports/P3-AUDIT-POLICY-001.md`

Files or areas the coding agent must not edit:

- `AGENTS.md`
- `CLAUDE.md`
- `.codegraph/**`
- `.mavis/**`
- `.reasonix/**`
- `docs/0610/**`
- `scripts/check-production-allocation.ps1`
- Frontend files unless PM explicitly approves a follow-up
- Unrelated generated assets
- Deployment output unless explicitly requested
- Git history, branches, tags, or remotes
- Anything outside this handoff without PM approval

## Required Repo Check Before Editing

Run and summarize:

```powershell
git log --oneline -5
git rev-parse --short HEAD
git status --short --untracked-files=all
```

If the status contains unrelated changes, preserve them and continue only inside
the approved scope.

## Implementation Tasks

1. Before editing symbols, follow the project GitNexus rule:
   - Run impact analysis for the calibration audit functions you will modify
     or create.
   - If GitNexus is unavailable or stale, report that in the final PM report
     and proceed only if the affected scope remains limited to this helper and
     its tests.
2. Add a small explicit audit policy model/helper in
   `backend/app/allocation/calibration_audit.py`.
   - Preserve current default thresholds:
     - return drift threshold: `3.0`
     - vol drift threshold: `5.0`
     - jump probability min/max: `0.0` / `0.10`
     - coverage threshold: `0.7`
   - Include `policy_source` and `policy_version` fields.
   - Default policy should be stable, deterministic, and have source
     `static_defaults`.
3. Load an optional policy from
   `StatsSnapshotCache.get("historical_calibration")` without mutating cache
   data.
   - Accept either `calibration_audit_policy.params` or a flat
     `calibration_audit_policy` dict.
   - Supported override keys:
     - `return_drift_threshold`
     - `vol_drift_threshold`
     - `jump_probability_min`
     - `jump_probability_max`
     - `coverage_threshold`
     - `policy_version`
   - Ignore malformed, non-finite, or logically invalid values and fall back
     to the default for that field.
   - Do not raise if the policy is missing or malformed.
4. Use the resolved policy for:
   - section coverage partial/real classification
   - return drift warnings
   - vol drift warnings
   - jump probability range warnings
5. Add `policy` to the `audit_calibration()` return object. Keep existing
   top-level keys and existing section item shape intact.
6. Extend focused tests for:
   - default policy is exposed and preserves current thresholds
   - cache policy overrides thresholds
   - malformed policy values are ignored/fall back safely
   - custom coverage threshold changes section classification
   - custom jump probability range changes warning behaviour

## Contracts And Design Decisions

List stable interfaces, API contracts, UX rules, data-shape rules, or module
boundaries that the coding agent must preserve.

- `audit_calibration()` remains read-only and safe when cache/database access
  fails.
- Existing `audit_calibration()` keys remain present:
  `health`, `sections`, `warning_count`, `missing_count`.
- The new `policy` object must be additive and JSON-serializable.
- No allocation outputs, optimizer behaviour, calibration writers, auth, smoke
  script behaviour, commit, push, or deployment changes.
- Keep status strings unchanged: `real`, `partial`, `assumption`, `stale`,
  `missing`, `rejected`, `healthy`, `degraded`, `critical`, `unknown`.

## Validation

Commands or checks the coding agent must run:

```powershell
cd backend
python -m pytest tests/test_calibration_audit.py tests/test_allocation_api_contract.py -q
python -m pytest -q
```

Expected result:

- Both pytest commands pass.
- If GitNexus tooling is unavailable, mention that explicitly in the final
  report with the fallback scope rationale.

## Stop Conditions

Stop and write a report instead of guessing when:

- The implementation requires changing files outside the approved scope.
- A product, architecture, data-contract, or deployment decision is missing.
- Validation fails for reasons unrelated to this task.
- The repo state is too different from the assumptions in this handoff.

## Final Report Required

Write `docs/pm/reports/P3-AUDIT-POLICY-001.md` with:

1. Summary
2. Files changed
3. Validation commands and results
4. Open risks or PM decisions needed

Do not include hidden chain-of-thought or `<think>` blocks.
