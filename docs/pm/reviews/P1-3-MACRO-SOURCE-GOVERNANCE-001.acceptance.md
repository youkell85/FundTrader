# P1-3-MACRO-SOURCE-GOVERNANCE-001 Acceptance

**Task:** Macro Data Source Governance
**Verdict:** accepted
**Date:** 2026-06-11

DXY source label fixed to `derived_fx_formula`. All 13 macro indicators have explicit `source/confidence/fetch_time`. Static fallbacks use low confidence (0.3-0.5).

6 tests passed in test_macro_fetcher.py. 13 tests passed in allocation/contract/data-quality/ic-decay tests.
