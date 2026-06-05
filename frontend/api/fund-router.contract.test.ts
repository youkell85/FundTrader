import { describe, expect, test, vi } from 'vitest';

vi.mock('./lib/fundtrader-client', () => ({
  getFundList: vi.fn(async () => ({ total: 0, funds: [] })),
  getFundSnapshotList: vi.fn(async () => ({ total: 0, funds: [] })),
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
  ftFetch: vi.fn(async () => {
    throw new Error('simulated BFF failure');
  }),
}));

vi.mock('./lib/fund-quote', () => ({
  fetchFundQuote: vi.fn(async () => ({})),
  isExchangeFundCode: vi.fn(() => false),
}));

const { fundRouter } = await import('./fund-router');

describe('fund detail contract fallbacks', () => {
  const caller = fundRouter.createCaller({ user: null } as any);

  test('rating fallback returns dataStatus missing', async () => {
    const result = await caller.rating({ code: '000001' });
    expect(result.dataStatus).toBe('missing');
    expect(result.missingReason).toBeTruthy();
    expect(result.code).toBe('000001');
  });

  test('purchaseInfo fallback returns dataStatus missing', async () => {
    const result = await caller.purchaseInfo({ code: '000001' });
    expect(result.dataStatus).toBe('missing');
    expect(result.missingReason).toBeTruthy();
    expect(result.code).toBe('000001');
  });

  test('peerPerformance fallback returns dataStatus missing', async () => {
    const result = await caller.peerPerformance({ code: '000001' });
    expect(result.dataStatus).toBe('missing');
    expect(result.missingReason).toBeTruthy();
    expect(result.code).toBe('000001');
  });

  test('riskSummary fallback returns dataStatus missing', async () => {
    const result = await caller.riskSummary({ code: '000001' });
    expect(result.dataStatus).toBe('missing');
    expect(result.missingReason).toBeTruthy();
    expect(result.code).toBe('000001');
  });

  test('detailCompleteness fallback returns dataStatus missing', async () => {
    const result = await caller.detailCompleteness({ code: '000001' });
    expect(result.dataStatus).toBe('missing');
    expect(result.missingReason).toBeTruthy();
    expect(result.code).toBe('000001');
  });

  test('yearReturns fallback returns dataStatus missing', async () => {
    const result = await caller.yearReturns({ code: '000001' });
    expect(result.dataStatus).toBe('missing');
    expect(result.missingReason).toBeTruthy();
    expect(result.code).toBe('000001');
  });

  test('holderStructure fallback returns dataStatus missing', async () => {
    const result = await caller.holderStructure({ code: '000001' });
    expect(result.dataStatus).toBe('missing');
    expect(result.missingReason).toBeTruthy();
    expect(result.code).toBe('000001');
  });

  test('scaleHistory fallback returns dataStatus missing', async () => {
    const result = await caller.scaleHistory({ code: '000001' });
    expect(result.dataStatus).toBe('missing');
    expect(result.missingReason).toBeTruthy();
    expect(result.code).toBe('000001');
  });

  test('managerHistory fallback returns dataStatus missing', async () => {
    const result = await caller.managerHistory({ code: '000001' });
    expect(result.dataStatus).toBe('missing');
    expect(result.missingReason).toBeTruthy();
    expect(result.code).toBe('000001');
  });

  test('managerReport fallback returns dataStatus missing', async () => {
    const result = await caller.managerReport({ code: '000001' });
    expect(result.dataStatus).toBe('missing');
    expect(result.missingReason).toBeTruthy();
    expect(result.code).toBe('000001');
  });
});
