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
const fundClient = await import('./lib/fundtrader-client');
const fundQuote = await import('./lib/fund-quote');

describe('fund detail contract fallbacks', () => {
  const caller = fundRouter.createCaller({ user: null } as any);

  function expectMissingFallback(result: { code: string; dataStatus?: string; missingReason?: string | null }) {
    expect(result.dataStatus).toBe('missing');
    expect(result.missingReason).toBeTruthy();
    expect(result.code).toBe('000001');
  }

  test('rating fallback returns dataStatus missing', async () => {
    const result = await caller.rating({ code: '000001' });
    expectMissingFallback(result);
  });

  test('purchaseInfo fallback returns dataStatus missing', async () => {
    const result = await caller.purchaseInfo({ code: '000001' });
    expectMissingFallback(result);
  });

  test('peerPerformance fallback returns dataStatus missing', async () => {
    const result = await caller.peerPerformance({ code: '000001' });
    expectMissingFallback(result);
  });

  test('peerPerformance requests bounded backend series', async () => {
    const ftFetchMock = vi.mocked(fundClient.ftFetch);
    ftFetchMock.mockResolvedValueOnce({ code: '000002', series: { fund: [], peer: [], index: [], benchmark: [] } });

    const result = await caller.peerPerformance({ code: '000002' });

    expect(result.code).toBe('000002');
    expect(ftFetchMock).toHaveBeenLastCalledWith(
      '/fund/peer-performance?code=000002&window_days=1827&max_points=420',
    );
  });

  test('riskSummary fallback returns dataStatus missing', async () => {
    const result = await caller.riskSummary({ code: '000001' });
    expectMissingFallback(result);
  });

  test('detailCompleteness fallback returns dataStatus missing', async () => {
    const result = await caller.detailCompleteness({ code: '000001' });
    expectMissingFallback(result);
  });

  test('marketContext requests backend fund route and falls back structurally', async () => {
    const ftFetchMock = vi.mocked(fundClient.ftFetch);
    ftFetchMock.mockResolvedValueOnce({
      fundCode: '512880',
      status: 'partial',
      sections: { etfKline: { status: 'partial', source: 'TickFlow' } },
      warnings: [],
    });

    const result = await caller.marketContext({ code: '512880' }) as any;

    expect(result.fundCode).toBe('512880');
    expect(ftFetchMock).toHaveBeenLastCalledWith('/fund/512880/market-context');
  });

  test('fundResearchReport returns missing fallback when backend fails', async () => {
    const result = await caller.fundResearchReport({ code: '000001' }) as any;

    expect(result.code).toBe('000001');
    expect(result.dataStatus).toBe('missing');
    expect(result.missingReason).toBeTruthy();
  });

  test('fundResearchReport preserves evidence pack v2 fields', async () => {
    const ftFetchMock = vi.mocked(fundClient.ftFetch);
    ftFetchMock.mockResolvedValueOnce({
      code: '000001',
      markdown: '# report',
      dataStatus: 'partial',
      evidencePack: {
        schemaVersion: 'fund-evidence-pack.v2',
        coverageSummary: { status: 'partial', coverage: 0.75 },
        criticalMissingEvidence: [{ category: 'risk_metrics', status: 'missing', blocking: true }],
        conclusionReadiness: { status: 'insufficient_data', conclusionStrength: 'none' },
      },
    });

    const result = await caller.fundResearchReport({ code: '000001' }) as any;

    expect(result.evidencePack.schemaVersion).toBe('fund-evidence-pack.v2');
    expect(result.evidencePack.conclusionReadiness.status).toBe('insufficient_data');
    expect(result.evidencePack.criticalMissingEvidence[0].blocking).toBe(true);
    expect(ftFetchMock).toHaveBeenLastCalledWith('/fund/000001/research-report');
  });

  test('dataSourcesStatus requests unified provider health route', async () => {
    const ftFetchMock = vi.mocked(fundClient.ftFetch);
    ftFetchMock.mockResolvedValueOnce({ status: 'available', providers: [], availableCount: 0, totalCount: 0 });

    const result = await caller.dataSourcesStatus() as any;

    expect(result.status).toBe('available');
    expect(ftFetchMock).toHaveBeenLastCalledWith('/data-sources/status');
  });

  test('fundDataStatus requests existing job/data status route', async () => {
    const ftFetchMock = vi.mocked(fundClient.ftFetch);
    ftFetchMock.mockResolvedValueOnce({ jobs: { pending: 1 }, activeJobs: [{ jobId: 'job-1', status: 'running' }] });

    const result = await caller.fundDataStatus() as any;

    expect(result.jobs.pending).toBe(1);
    expect(result.activeJobs[0].jobId).toBe('job-1');
    expect(ftFetchMock).toHaveBeenLastCalledWith('/fund/data-status');
  });

  test('fundJobs requests pollable backend job list route', async () => {
    const ftFetchMock = vi.mocked(fundClient.ftFetch);
    ftFetchMock.mockResolvedValueOnce({ jobs: [{ jobId: 'job-1', status: 'running' }] });

    const result = await caller.fundJobs({ limit: 5, status: 'running' }) as any;

    expect(result.jobs[0].status).toBe('running');
    expect(ftFetchMock).toHaveBeenLastCalledWith('/fund/jobs?limit=5&status=running');
  });

  test('fundJobStatus requests single backend job route', async () => {
    const ftFetchMock = vi.mocked(fundClient.ftFetch);
    ftFetchMock.mockResolvedValueOnce({ jobId: 'job-1', status: 'succeeded', progress: 1 });

    const result = await caller.fundJobStatus({ jobId: 'job-1' }) as any;

    expect(result.progress).toBe(1);
    expect(ftFetchMock).toHaveBeenLastCalledWith('/fund/jobs/job-1');
  });

  test('industryStats does not create a fake 100 percent no-data bucket', async () => {
    vi.mocked(fundClient.getFundSnapshotList).mockResolvedValueOnce({ total: 0, funds: [] });

    const result = await caller.industryStats();

    expect(result).toEqual([]);
  });

  test('industryStats computes ratios only from returned fund snapshots', async () => {
    vi.mocked(fundClient.getFundSnapshotList).mockResolvedValueOnce({
      total: 3,
      funds: [
        { code: '000001', type: '股票型' },
        { code: '000002', type: '股票型' },
        { code: '000003', type: '债券型' },
      ],
    });

    const result = await caller.industryStats();

    expect(result).toEqual([
      { industry: '股票型', totalRatio: '66.67' },
      { industry: '债券型', totalRatio: '33.33' },
    ]);
  });

  test('detailByCode preserves snapshot holdings in fast fallback', async () => {
    vi.mocked(fundClient.getFundSnapshot).mockResolvedValueOnce({
      code: '000003',
      name: '持仓基金',
      type: '混合型',
      nav: 1.23,
      holdings: [
        {
          stockCode: '600000.SH',
          stockName: '浦发银行',
          ratio: 8.5,
          industry: '银行',
          quarter: '20260331',
        },
      ],
      asset_allocation: [{ name: '股票', ratio: 75.94, report_date: '20260331' }],
    });
    vi.mocked(fundClient.getFundAnalysis).mockResolvedValueOnce({});
    vi.mocked(fundQuote.fetchFundQuote).mockResolvedValueOnce({
      code: '000003',
      name: '持仓基金',
      nav: 1.23,
    } as any);

    const result = await caller.detailByCode({ code: '000003' }) as any;

    expect(result.holdings).toHaveLength(1);
    expect(result.holdings[0].stockName).toBe('浦发银行');
    expect(result.assetAllocation).toHaveLength(1);
    expect(result.assetAllocation[0].name).toBe('股票');
  });

  test('detailByCode uses analysis holdings when snapshot is light', async () => {
    vi.mocked(fundClient.getFundSnapshot).mockResolvedValueOnce({
      code: '000004',
      name: '分析持仓基金',
      type: '混合型',
      nav: 1.56,
    });
    vi.mocked(fundClient.getFundAnalysis).mockResolvedValueOnce({
      code: '000004',
      name: '分析持仓基金',
      holdings: [
        {
          code: '600519.SH',
          name: '贵州茅台',
          ratio: 10.83,
          industry: '白酒',
          quarter: '20260331',
        },
      ],
      asset_allocation: [{ name: '股票', ratio: 75.94, report_date: '20260331' }],
    });
    vi.mocked(fundQuote.fetchFundQuote).mockResolvedValueOnce({
      code: '000004',
      name: '分析持仓基金',
      nav: 1.56,
    } as any);

    const result = await caller.detailByCode({ code: '000004' }) as any;

    expect(result.holdings).toHaveLength(1);
    expect(result.holdings[0].stockName).toBe('贵州茅台');
    expect(result.assetAllocation).toHaveLength(1);
  });

  test('detailByCode prefers exchange quote scalars over stale analysis in fast fallback', async () => {
    vi.mocked(fundQuote.isExchangeFundCode).mockImplementation((code: string) => code === '512100');
    try {
      vi.mocked(fundClient.getFundSnapshot).mockResolvedValueOnce({
        code: '512100',
        name: 'CSI 1000 ETF',
        type: 'ETF',
        nav: 3.3712,
        accum_nav: 3.3712,
        nav_date: '2026-06-02',
        day_growth: 0.12,
        holdings: [
          { stockCode: '601869.SH', stockName: 'Yangtze Optical Fibre', ratio: 0.11, quarter: '20260331' },
        ],
        asset_allocation: [{ name: 'stock', ratio: 3.2, report_date: '20260331' }],
      });
      vi.mocked(fundClient.getFundAnalysis).mockResolvedValueOnce({
        code: '512100',
        name: 'CSI 1000 ETF',
        nav: 3.2524,
        accum_nav: 3.2524,
        nav_date: '2026-05-30',
        day_growth: -0.35,
        nav_data: [{ date: '2026-06-02', nav: 3.3712, day_growth: 0.12 }],
      });
      vi.mocked(fundQuote.fetchFundQuote).mockResolvedValueOnce({
        code: '512100',
        name: 'CSI 1000 ETF',
        type: 'ETF',
        nav: 3.348,
        accumNav: 3.348,
        navDate: '2026-06-09',
        dayGrowth: -0.69,
      } as any);

      const result = await caller.detailByCode({ code: '512100' }) as any;

      expect(result.nav).toBe('3.348');
      expect(result.navDate).toBe('2026-06-09');
      expect(String(result.accumNav)).toBe('3.348');
      expect(String(result.dailyChange)).toBe('-0.69');
      expect(result.navHistory).toHaveLength(1);
      expect(result.holdings).toHaveLength(1);
    } finally {
      vi.mocked(fundQuote.isExchangeFundCode).mockReturnValue(false);
    }
  });

  test('yearReturns fallback returns dataStatus missing', async () => {
    const result = await caller.yearReturns({ code: '000001' });
    expectMissingFallback(result);
  });

  test('holderStructure fallback returns dataStatus missing', async () => {
    const result = await caller.holderStructure({ code: '000001' });
    expectMissingFallback(result);
  });

  test('scaleHistory fallback returns dataStatus missing', async () => {
    const result = await caller.scaleHistory({ code: '000001' });
    expectMissingFallback(result);
  });

  test('managerHistory fallback returns dataStatus missing', async () => {
    const result = await caller.managerHistory({ code: '000001' });
    expectMissingFallback(result);
  });

  test('managerReport fallback returns dataStatus missing', async () => {
    const result = await caller.managerReport({ code: '000001' });
    expectMissingFallback(result);
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
