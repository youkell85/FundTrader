import type { summarizeDetailCoverage } from "@/lib/detail-status";

/** Return type of summarizeDetailCoverage — shared between DetailStatusPanels and FundDetail. */
export type CoverageSummary = ReturnType<typeof summarizeDetailCoverage>;
