import { describe, expect, test, vi, beforeEach } from 'vitest';

// Suppress auto-prewarm timers during test — prevents setTimeout side-effects
// from refreshHomeCaches("startup") firing during test execution
process.env.FUNDTRADER_DISABLE_AUTO_PREWARM = "true";

const snapshotListMock = vi.fn();

vi.mock("./lib/fundtrader-client", () => ({
  getFundList: vi.fn(async () => ({ total: 0, funds: [] })),
  getFundSnapshotList: snapshotListMock,
  getFundSnapshot: vi.fn(async () => ({})),
  requestFundBackfill: vi.fn(async () => ({})),
  getCategories: vi.fn(async () => ({ categories: [] })),
  getFundAnalysis: vi.fn(async () => ({})),
  getFundAnalysisBatch: vi.fn(async () => ({ results: {} })),
  runDcaBacktest: vi.fn(async () => ({})),
  getWatchlist: vi.fn(async () => ({ funds: [] })),
  addToWatchlist: vi.fn(async () => ({})),
  removeFromWatchlist: vi.fn(async () => ({})),
  getFundLLMReview: vi.fn(async () => ({})),
  getDcaLLMReview: vi.fn(async () => ({})),
  ftFetch: vi.fn(async () => ({})),
}));

vi.mock("./lib/fund-quote", () => ({
  fetchFundQuote: vi.fn(async () => ({})),
  isExchangeFundCode: vi.fn(() => false),
}));

const { fundRouter } = await import("./fund-router");

describe("fund list startup resilience", () => {
  beforeEach(() => {
    snapshotListMock.mockReset();
  });

  test("degraded path returns explicit missingReason when backend is unavailable", async () => {
    // Simulate ECONNREFUSED / backend not listening — snapshot API returns degraded
    snapshotListMock.mockResolvedValue({
      funds: null,
      total: 0,
      degraded: true,
    });

    const caller = fundRouter.createCaller({ user: null } as any);
    const result = await caller.list({
      withMetrics: false,
      sortBy: "dailyChange",
      sortOrder: "desc",
    });

    expect(result).toMatchObject({
      degraded: true,
      missingReason: expect.any(String),
      funds: [],
      total: 0,
    });
  });

  test("returns empty funds (not throwing) when cache cold and backend unavailable", async () => {
    // WithMetrics=true on cold cache triggers fetchHomeFundSummaries which
    // ultimately calls getFundSnapshotList. When backend is down, results are empty
    // but the caller should NOT hang or throw — it degrades gracefully.
    snapshotListMock.mockResolvedValue({
      funds: null,
      total: 0,
      degraded: true,
    });

    const caller = fundRouter.createCaller({ user: null } as any);
    const result = await caller.list({
      withMetrics: true,
      sortBy: "dailyChange",
      sortOrder: "desc",
    });

    // Must not throw — even if every data source is unavailable
    expect(result.funds).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.page).toBeDefined();
    expect(result.pageSize).toBeDefined();
  });
});
