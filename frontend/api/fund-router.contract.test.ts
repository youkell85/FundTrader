import { describe, expect, test, vi } from 'vitest';
import { feePct } from '../src/lib/fund-data';

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

describe('research candidate pool', () => {
  // Use unique user IDs per test to avoid filesystem state pollution
  test('listResearchCandidates returns empty when no candidates', async () => {
    const caller = fundRouter.createCaller({ user: { id: 'rc_empty', name: 'A', username: 'a', role: 'user', avatar: null } } as any);
    const result = await caller.listResearchCandidates();
    expect(result.funds.filter((f: any) => f.fundCode)).toEqual([]);
    expect(result.total).toBe(0);
  });

  test('addResearchCandidate then list returns candidate', async () => {
    const caller = fundRouter.createCaller({ user: { id: 'rc_add', name: 'A', username: 'a', role: 'user', avatar: null } } as any);
    await caller.addResearchCandidate({ code: '000001' });
    const result = await caller.listResearchCandidates();
    expect(result.total).toBe(1);
    expect(result.funds.length).toBeGreaterThan(0);
  });

  test('removeResearchCandidate removes from list', async () => {
    const caller = fundRouter.createCaller({ user: { id: 'rc_remove', name: 'A', username: 'a', role: 'user', avatar: null } } as any);
    await caller.addResearchCandidate({ code: '000001' });
    await caller.removeResearchCandidate({ code: '000001' });
    const result = await caller.listResearchCandidates();
    expect(result.total).toBe(0);
  });

  test('user A candidates are invisible to user B', async () => {
    const callerA = fundRouter.createCaller({ user: { id: 'rc_a', name: 'A', username: 'a', role: 'user', avatar: null } } as any);
    const callerB = fundRouter.createCaller({ user: { id: 'rc_b', name: 'B', username: 'b', role: 'user', avatar: null } } as any);
    await callerA.addResearchCandidate({ code: '000001' });
    const resultB = await callerB.listResearchCandidates();
    expect(resultB.total).toBe(0);
    const resultA = await callerA.listResearchCandidates();
    expect(resultA.total).toBe(1);
  });

  test('unauthenticated cannot write research candidates', async () => {
    const anon = fundRouter.createCaller({ user: null } as any);
    await expect(anon.addResearchCandidate({ code: '000001' })).rejects.toThrow();
    await expect(anon.removeResearchCandidate({ code: '000001' })).rejects.toThrow();
  });

  test('unauthenticated cannot list research candidates', async () => {
    const anon = fundRouter.createCaller({ user: null } as any);
    await expect(anon.listResearchCandidates()).rejects.toThrow();
  });
});

describe('feePct helper', () => {
  test('handles decimal fee (0.015 → 1.50%)', () => {
    expect(feePct(0.015)).toBe('1.50%');
  });
  test('handles percent fee (1.5 → 1.50%)', () => {
    expect(feePct(1.5)).toBe('1.50%');
  });
  test('handles null → —', () => {
    expect(feePct(null)).toBe('—');
  });
  test('handles string decimal "0.012" → 1.20%', () => {
    expect(feePct('0.012')).toBe('1.20%');
  });
  test('handles string percent "1.2" → 1.20%', () => {
    expect(feePct('1.2')).toBe('1.20%');
  });
});
