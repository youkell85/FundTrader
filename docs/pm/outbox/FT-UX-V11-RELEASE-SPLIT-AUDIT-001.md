# FT-UX-V11-RELEASE-SPLIT-AUDIT-001 - FundTrader release split audit

Created: 2026-06-17T11:55:00+08:00
PM: Codex
Status: planned

## Goal

Prepare FundTrader UX V11 local changes for an intentional commit/release
decision without changing business behavior.

## Required checks

- `git status --short --untracked-files=all`
- Exclude `backend/.env`.
- Classify source changes, tests, PM docs, and runtime/env files.
- Run frontend check/build.
- Run relevant backend tests if touched backend files require it.
- Run a longer allocation stream smoke if local backend/data service is
  available.

## Acceptance

- Exact commit groups are listed.
- `backend/.env` is excluded.
- Validation evidence is current.
- No commit/push/deploy happens in this audit task.
