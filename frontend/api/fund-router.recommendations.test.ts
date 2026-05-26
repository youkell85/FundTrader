import { describe, expect, test, vi } from "vitest";

vi.mock("./lib/fundtrader-client", () => ({
  getFundList: vi.fn(async () => ({
    total: 1,
    funds: [{
      code: "000001",
      name: "测试股票基金",
      type: "股票型",
      is_xinjihui: true,
      performance: {
        near_3y: 100,
        annualizedVolatility: 10,
        maxDrawdown: -20,
        sharpeRatio: "—",
      },
    }],
  })),
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

describe("fund recommendations metrics", () => {
  test("annualizes multi-year returns geometrically and computes excess-return Sharpe", async () => {
    const caller = fundRouter.createCaller({ user: null } as any);

    const result = await caller.recommendations({
      sourceMode: "custom",
      includeXinjihui: false,
      includeWatchlist: false,
      selectedFundCodes: ["000001"],
      preferredTypes: ["equity"],
      riskProfile: "balanced",
      horizon: "3年",
      maxDrawdown: 30,
    });

    expect(result.length).toBeGreaterThan(0);
    const first = result[0];
    expect(Number(first.expectedReturn)).toBeCloseTo(25.99, 1);
    expect(Number(first.volatility)).toBeCloseTo(10, 1);
    expect(Number(first.expectedRisk)).toBeCloseTo(25.2, 1);
    expect(Number(first.sharpe)).toBeCloseTo(2.4, 1);
  });
});
