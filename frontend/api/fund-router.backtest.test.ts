import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runDcaBacktest: vi.fn(),
  getFundSnapshotList: vi.fn(),
}));

vi.mock('./lib/fundtrader-client', () => ({
  getFundList: vi.fn(async () => ({ total: 0, funds: [] })),
  getFundSnapshotList: mocks.getFundSnapshotList,
  getFundSnapshot: vi.fn(async () => ({})),
  requestFundBackfill: vi.fn(async () => ({})),
  getCategories: vi.fn(async () => ({ categories: [] })),
  getFundAnalysis: vi.fn(async () => ({})),
  getFundAnalysisBatch: vi.fn(async () => ({ results: {} })),
  runDcaBacktest: mocks.runDcaBacktest,
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
const { mapFundItem } = await import('./lib/mapper');

const backendResult = {
  portfolio: {
    total_invested: 12000,
    total_value: 15000,
    total_profit_rate: 25,
    annual_return: 12,
    max_drawdown: -8,
    sharpe_ratio: 1.5,
    feeCost: 30,
  },
};

beforeEach(() => {
  mocks.runDcaBacktest.mockReset();
  mocks.getFundSnapshotList.mockReset();
  mocks.getFundSnapshotList.mockResolvedValue({ total: 0, funds: [] });
});

describe('fund runBacktest', () => {
  test('fundCodes path calls runDcaBacktest with codes directly', async () => {
    mocks.runDcaBacktest.mockResolvedValueOnce(backendResult);

    const caller = fundRouter.createCaller({ user: null } as any);
    const result = await caller.runBacktest({
      fundCodes: ['000001', '000002'],
      weights: [60, 40],
      strategy: 'fixed_amount',
      startDate: '2023-01-01',
      endDate: '2024-01-01',
      investAmount: 1000,
      investFrequency: 'monthly',
    });

    expect(mocks.runDcaBacktest).toHaveBeenCalledWith({
      codes: ['000001', '000002'],
      amount: 1000,
      frequency: 'monthly',
      strategy: 'fixed',
      start_date: '2023-01-01',
      end_date: '2024-01-01',
    });
    expect(result).toBeDefined();
  });

  test('fundIds path resolves ids to codes via fund list', async () => {
    const funds = [
      { code: '000001', name: '华夏成长混合', type: '混合型' },
      { code: '000002', name: '中银证券现金管家货币', type: '货币型' },
    ];
    const fundIds = funds.map((f) => mapFundItem(f).id);

    mocks.getFundSnapshotList.mockResolvedValue({ total: funds.length, funds });
    mocks.runDcaBacktest.mockResolvedValueOnce(backendResult);

    const caller = fundRouter.createCaller({ user: null } as any);
    const result = await caller.runBacktest({
      fundIds,
      weights: [50, 50],
      strategy: 'fixed_amount',
      startDate: '2023-01-01',
      endDate: '2024-01-01',
      investAmount: 1000,
      investFrequency: 'monthly',
    });

    expect(mocks.runDcaBacktest).toHaveBeenCalledWith({
      codes: ['000001', '000002'],
      amount: 1000,
      frequency: 'monthly',
      strategy: 'fixed',
      start_date: '2023-01-01',
      end_date: '2024-01-01',
    });
    expect(result).toBeDefined();
  });

  test('neither fundIds nor fundCodes throws error', async () => {
    const caller = fundRouter.createCaller({ user: null } as any);
    await expect(
      caller.runBacktest({
        fundIds: [],
        fundCodes: [],
        weights: [],
        strategy: 'fixed_amount',
        startDate: '2023-01-01',
        endDate: '2024-01-01',
        investAmount: 1000,
        investFrequency: 'monthly',
      })
    ).rejects.toThrow(/必须提供 fundIds 或 fundCodes/);
  });

  test('invalid strategy is rejected by schema before handler', async () => {
    const caller = fundRouter.createCaller({ user: null } as any);
    await expect(
      caller.runBacktest({
        fundCodes: ['000001'],
        strategy: 'unknown_strategy' as any,
        startDate: '2023-01-01',
        endDate: '2024-01-01',
        investAmount: 1000,
        investFrequency: 'monthly',
      })
    ).rejects.toThrow(/Invalid/);
  });
});
