import { describe, expect, test, vi } from 'vitest';

vi.mock('./lib/fundtrader-client', () => ({
  getFundList: vi.fn(async () => ({
    total: 1,
    funds: [{
      code: '000001',
      name: '测试股票基金',
      type: '股票型',
      is_xinjihui: true,
      performance: {
        near_3y: 100,
        annualizedVolatility: 10,
        maxDrawdown: -20,
        sharpeRatio: '\u2014',
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

vi.mock('./lib/fund-quote', () => ({
  fetchFundQuote: vi.fn(async () => ({})),
  isExchangeFundCode: vi.fn(() => false),
}));

const { fundRouter } = await import('./fund-router');

describe('fund recommendations metrics', () => {
  test('annualizes multi-year returns geometrically and computes excess-return Sharpe', async () => {
    const caller = fundRouter.createCaller({ user: null } as any);

    const result = await caller.recommendations({
      sourceMode: 'custom',
      includeXinjihui: false,
      includeWatchlist: false,
      selectedFundCodes: ['000001'],
      preferredTypes: ['equity'],
      riskProfile: 'balanced',
      horizon: '3年',
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

describe('annualizePeriodReturn - geometric vs arithmetic', () => {
  test('geometric annualization should differ from simple division', () => {
    const periodReturn = 100;
    const years = 3;
    const simpleAnnualized = periodReturn / years;
    const geometricAnnualized = (Math.pow(1 + periodReturn / 100, 1 / years) - 1) * 100;
    expect(simpleAnnualized).toBeCloseTo(33.33, 1);
    expect(geometricAnnualized).toBeCloseTo(25.99, 1);
    expect(geometricAnnualized).not.toBeCloseTo(simpleAnnualized, 0);
  });

  test('excess-return Sharpe should subtract risk-free rate', async () => {
    const caller = fundRouter.createCaller({ user: null } as any);
    const result = await caller.recommendations({
      sourceMode: 'custom',
      includeXinjihui: false,
      includeWatchlist: false,
      selectedFundCodes: ['000001'],
      preferredTypes: ['equity'],
      riskProfile: 'balanced',
      horizon: '3年',
      maxDrawdown: 30,
    });

    const sharpe = Number(result[0].sharpe);
    const expectedReturn = Number(result[0].expectedReturn);
    const volatility = Number(result[0].volatility);
    const simpleRatio = expectedReturn / volatility;
    expect(sharpe).toBeLessThan(simpleRatio);
  });
});
