import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ChevronRight, Search, UserCircle } from 'lucide-react'
import type { MarketDataStatus } from '@/types/allocation'

type FundLike = {
  fundCode?: string
  fundName?: string
  fundAbbr?: string
  fundType?: string
  category?: string
  company?: string
  source?: string
  isXinjihui?: boolean
  nav?: string | number | null
  navDate?: string | null
  dailyChange?: string | number | null
  manager?: { name?: string } | string | null
  performance?: {
    return1y?: string | number | null
    annualizedReturn?: string | number | null
    maxDrawdown?: string | number | null
    sharpeRatio?: string | number | null
  } | null
}

type DashboardMode = 'user' | 'bestSharpe' | 'userEmptyFallback'

type MarketIndexItem = {
  code?: string | null
  name?: string | null
  close?: number | string | null
  value?: number | string | null
  price?: number | string | null
  latest?: number | string | null
  change?: number | string | null
  pct_change?: number | string | null
  change_pct?: number | string | null
  date?: string | null
  source?: string | null
  series?: MarketKlinePoint[] | null
  [key: string]: unknown
}

type MarketKlinePoint = {
  date?: string | null
  open?: number | string | null
  high?: number | string | null
  low?: number | string | null
  close?: number | string | null
  volume?: number | string | null
}

type MarketIndustryItem = {
  name?: string | null
  industry?: string | null
  board?: string | null
  change?: number | string | null
  pct_change?: number | string | null
  change_pct?: number | string | null
  [key: string]: unknown
}

type MarketOverviewPayload = {
  market?: MarketIndexItem[]
  industries?: MarketIndustryItem[]
  industry?: MarketIndustryItem[]
}

const TYPE_LABELS: Record<string, string> = {
  equity: '股票型',
  hybrid: '混合型',
  bond: '债券型',
  index: '指数型',
  etf: 'ETF',
  qdii: 'QDII',
  money: '货币型',
  fof: 'FOF',
  reits: 'REITs',
}

const TYPE_COLORS: Record<string, string> = {
  equity: '#59c993',
  hybrid: '#d4a15e',
  bond: '#7ca4d8',
  index: '#a28b68',
  etf: '#8d7a64',
  qdii: '#b8894a',
  money: '#74706a',
  fof: '#716c65',
  reits: '#67604d',
  other: '#716c65',
}

function classNames(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(' ')
}

function parseMetric(value: unknown): number | null {
  if (value === undefined || value === null || value === '' || value === '—' || value === '-') return null
  const num = parseFloat(String(value).replace('%', ''))
  return Number.isFinite(num) ? num : null
}

function average(values: Array<number | null>) {
  const valid = values.filter((value): value is number => value !== null && Number.isFinite(value))
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function signedPct(value: number | null, digits = 2) {
  if (value === null) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`
}

function plainPct(value: number | null, digits = 2) {
  if (value === null) return '—'
  return `${value.toFixed(digits)}%`
}

function metricText(value: unknown, digits = 2) {
  const num = parseMetric(value)
  return num === null ? '—' : num.toFixed(digits)
}

function fundName(fund: FundLike) {
  return String(fund.fundName || fund.fundAbbr || fund.fundCode || '未命名基金')
}

function managerName(fund: FundLike) {
  return typeof fund.manager === 'string' ? fund.manager : fund.manager?.name || fund.company || '基金经理待补'
}

function typeKey(fund: FundLike) {
  return String(fund.fundType || fund.category || 'other').toLowerCase()
}

function typeLabel(fund: FundLike) {
  const key = typeKey(fund)
  return TYPE_LABELS[key] || String(fund.category || fund.fundType || '其他')
}

function Sparkline({ warm = false, className = 'h-12 w-full' }: { warm?: boolean; className?: string }) {
  const stroke = warm ? '#c86f44' : '#59c993'
  return (
    <svg viewBox="0 0 120 42" className={classNames(className, 'overflow-visible')}>
      <path d="M2 30 L12 23 L22 26 L32 16 L43 21 L54 12 L66 18 L78 9 L90 13 L102 7 L118 11" fill="none" stroke={stroke} strokeWidth="2" />
      <path d="M2 33 L12 26 L22 29 L32 19 L43 24 L54 15 L66 21 L78 12 L90 16 L102 10 L118 14" fill="none" stroke={stroke} strokeOpacity=".22" strokeWidth="5" />
    </svg>
  )
}

function normalizeKlineSeries(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((point) => {
      const record = point as Record<string, unknown>
      const open = parseMetric(record.open)
      const high = parseMetric(record.high)
      const low = parseMetric(record.low)
      const close = parseMetric(record.close)
      if (open === null || high === null || low === null || close === null) return null
      return {
        date: String(record.date || ''),
        open,
        high,
        low,
        close,
      }
    })
    .filter((point): point is { date: string; open: number; high: number; low: number; close: number } => point !== null)
}

function Panel({ title, children, action, className }: { title: string; children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <section className={classNames('rounded-lg border border-slate-200 bg-white p-4', className)}>
      <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function buildEqualWeights(funds: FundLike[]) {
  if (funds.length === 0) return []
  const base = Math.floor((100 / funds.length) * 100) / 100
  let used = 0
  return funds.map((fund, index) => {
    const weight = index === funds.length - 1 ? Number((100 - used).toFixed(2)) : base
    used += weight
    return { fund, weight }
  })
}

function distributionByType(weighted: Array<{ fund: FundLike; weight: number }>) {
  const rows = new Map<string, number>()
  for (const item of weighted) {
    const key = typeKey(item.fund)
    rows.set(key, (rows.get(key) || 0) + item.weight)
  }
  return Array.from(rows.entries())
    .map(([key, value]) => ({ key, label: TYPE_LABELS[key] || key, value, color: TYPE_COLORS[key] || TYPE_COLORS.other }))
    .sort((a, b) => b.value - a.value)
}

function pickNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    const num = parseMetric(value)
    if (num !== null) return num
  }
  return null
}

function normalizeMarketIndices(payload?: MarketOverviewPayload | null) {
  return (payload?.market || [])
    .map((item) => {
      const record = item as Record<string, unknown>
      return {
        code: String(item.code || record.symbol || record.ts_code || '—'),
        name: String(item.name || record.index_name || record.short_name || item.code || '市场指数'),
        close: pickNumber(record, ['close', 'value', 'price', 'latest', '最新价', '收盘']),
        change: pickNumber(record, ['change', 'pct_change', 'change_pct', '涨跌幅', 'pctChg']),
        date: String(item.date || record.trade_date || record.as_of || ''),
        source: String(item.source || record.source || '真实行情接口'),
        series: normalizeKlineSeries(record.series || record.kline || record.bars),
      }
    })
    .filter((item) => item.close !== null || item.change !== null)
}

function normalizeIndustries(payload?: MarketOverviewPayload | null) {
  return (payload?.industries || payload?.industry || [])
    .map((item) => {
      const record = item as Record<string, unknown>
      return {
        name: String(item.name || item.industry || item.board || record.label || '行业板块'),
        change: pickNumber(record, ['change', 'pct_change', 'change_pct', '涨跌幅', 'pctChg']),
      }
    })
    .filter((item) => item.change !== null)
    .sort((a, b) => (b.change || 0) - (a.change || 0))
}

function formatIndexValue(value: number | null) {
  if (value === null) return '—'
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatMacroValue(value: unknown) {
  const num = parseMetric(value)
  return num === null ? 'missing' : num.toFixed(2)
}

function formatConfidence(value: unknown) {
  const num = parseMetric(value)
  return num === null ? 'conf -' : `conf ${(num * 100).toFixed(0)}%`
}

function formatDateTime(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function healthLabel(status?: MarketDataStatus['health']) {
  switch (status) {
    case 'healthy':
      return '健康'
    case 'degraded':
      return '降级可用'
    case 'critical':
      return '异常'
    default:
      return '未知'
  }
}

export function CockpitDashboard({
  funds,
  mode,
  userName,
  loading,
  error,
  marketOverview,
  marketStatus,
  marketLoading,
  marketError,
}: {
  funds: FundLike[]
  mode: DashboardMode
  userName?: string | null
  loading?: boolean
  error?: string | null
  marketOverview?: MarketOverviewPayload | null
  marketStatus?: MarketDataStatus | null
  marketLoading?: boolean
  marketError?: string | null
}) {
  const [query, setQuery] = useState('')
  const [fundFilter, setFundFilter] = useState('all')
  const weighted = buildEqualWeights(funds)
  const assetMix = distributionByType(weighted)
  const avgDay = average(funds.map((fund) => parseMetric(fund.dailyChange)))
  const avgYear = average(funds.map((fund) => parseMetric(fund.performance?.return1y ?? fund.performance?.annualizedReturn)))
  const avgAnnual = average(funds.map((fund) => parseMetric(fund.performance?.annualizedReturn ?? fund.performance?.return1y)))
  const avgSharpe = average(funds.map((fund) => parseMetric(fund.performance?.sharpeRatio)))
  const avgDrawdown = average(funds.map((fund) => parseMetric(fund.performance?.maxDrawdown)))
  const netValue = avgYear === null ? '—' : (1 + avgYear / 100).toFixed(4)
  const riskScore = clamp(Math.round(58 + (avgSharpe || 0) * 8 - Math.abs(avgDrawdown || 0) * 0.45), 15, 92)
  const latestDate = funds.map((fund) => fund.navDate).filter(Boolean).sort().at(-1) || new Date().toISOString().slice(0, 10)
  const marketIndices = useMemo(() => normalizeMarketIndices(marketOverview), [marketOverview])
  const marketIndustries = useMemo(() => normalizeIndustries(marketOverview), [marketOverview])
  const risingCount = marketIndices.filter((item) => (item.change || 0) > 0).length
  const fallingCount = marketIndices.filter((item) => (item.change || 0) < 0).length
  const marketAsOf = marketStatus?.last_refresh ? formatDateTime(marketStatus.last_refresh) : (marketIndices.find((item) => item.date)?.date || latestDate)
  const macroIndicators = marketStatus?.macro_indicators || {}
  const macroRows = [
    { label: 'PMI', key: 'PMI制造业' },
    { label: 'CPI', key: 'CPI同比' },
    { label: 'M2', key: 'M2增速' },
  ].map((item) => ({ ...item, data: macroIndicators[item.key] }))
  const strongestIndustry = marketIndustries[0]
  const sourceLabel = mode === 'user'
    ? '登录用户组合'
    : mode === 'userEmptyFallback'
      ? '用户暂无自选，暂展示最优夏普组合'
      : '未登录：最优夏普组合'
  const fundTypeTabs = useMemo(() => {
    const typeOrder = ['all', 'equity', 'hybrid', 'bond', 'index', 'etf', 'qdii', 'fof']
    const available = new Set(weighted.map(({ fund }) => typeKey(fund)))
    return typeOrder
      .filter((key) => key === 'all' || available.has(key))
      .map((key) => ({ key, label: key === 'all' ? '全部' : TYPE_LABELS[key] || key.toUpperCase() }))
  }, [weighted])
  const filteredWeighted = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return weighted.filter(({ fund }) => {
      if (fundFilter !== 'all' && typeKey(fund) !== fundFilter) return false
      if (!keyword) return true
      const haystack = [
        fund.fundCode,
        fundName(fund),
        managerName(fund),
        typeLabel(fund),
        fund.company,
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(keyword)
    })
  }, [fundFilter, query, weighted])
  const visibleCards = filteredWeighted.slice(0, 4)

  return (
    <section className="space-y-4 text-slate-700">
      {/* Top bar: identity, source, freshness, user */}
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-xl font-bold tracking-tight text-slate-800">决策桌面</h2>
          <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-0.5 text-xs text-blue-600">{sourceLabel}</span>
          <span className="text-xs text-slate-400">
            {marketLoading ? '行情加载中…' : `数据截至 ${marketAsOf}`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
          <label className="flex h-8 min-w-[240px] items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3">
            <Search size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索基金 / 代码 / 经理 / 公司"
              className="min-w-0 flex-1 bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400"
            />
          </label>
          <UserCircle size={18} />
          <span>{userName || '访客'}</span>
        </div>
      </header>

      {/* Loading / error banner */}
      {(loading || error) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {loading ? '正在加载基金数据…' : `数据加载异常：${error}`}
        </div>
      )}

      {/* Main decision row: market state, portfolio health, next actions */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Market state panel */}
        <Panel
          title="市场状态"
          action={marketLoading ? <span className="text-xs text-slate-400">加载中…</span> : <span className="text-xs text-slate-400">截至 {marketAsOf}</span>}
        >
          {(marketLoading || marketError || marketIndices.length === 0) && (
            <div className="mb-3 rounded border border-amber-100 bg-amber-50/50 px-3 py-2 text-xs text-amber-700">
              {marketLoading
                ? '正在加载市场指数数据…'
                : marketError
                  ? `市场数据加载异常：${marketError}`
                  : '市场行情暂不可用'}
            </div>
          )}
          {marketIndices.length > 0 ? (
            <div className="space-y-3">
              {marketIndices.slice(0, 3).map((item) => (
                <div key={item.code || item.name} className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-700">{item.name}</div>
                    <div className="text-xs text-slate-400">{item.code}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-slate-800">{formatIndexValue(item.close)}</div>
                    <span className={classNames('text-xs font-medium', (item.change || 0) >= 0 ? 'text-red-500' : 'text-emerald-500')}>
                      {signedPct(item.change)}
                    </span>
                  </div>
                </div>
              ))}
              <div className="border-t border-slate-100 pt-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">上涨 {risingCount} / 下跌 {fallingCount}</span>
                  <span className="text-slate-500">数据健康：{healthLabel(marketStatus?.health)}</span>
                </div>
                <div className="mt-2 rounded border border-slate-100 bg-slate-50 px-2 py-2">
                  <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
                    <span>Macro data</span>
                    <span>{marketStatus?.macro_available ? `confidence ${(marketStatus.macro_confidence * 100).toFixed(0)}%` : 'missing'}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {macroRows.map((item) => (
                      <div key={item.key} className="rounded bg-white px-2 py-1 text-xs">
                        <div className="font-medium text-slate-700">{item.label}</div>
                        <div className={classNames('data-number text-sm font-semibold', item.data?.value != null ? 'text-slate-800' : 'text-slate-400')}>
                          {formatMacroValue(item.data?.value)}
                        </div>
                        <div className="truncate text-[10px] text-slate-400" title={item.data?.source || 'missing'}>
                          {formatConfidence(item.data?.confidence)} · {item.data?.source || 'missing'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {strongestIndustry && (
                  <div className="mt-1 flex items-center justify-between text-xs">
                    <span className="text-slate-500">强势行业</span>
                    <span className="font-medium text-slate-700">{strongestIndustry.name} {signedPct(strongestIndustry.change)}</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="py-4 text-sm text-slate-400">市场全景等待指数数据返回。</div>
          )}
        </Panel>

        {/* Portfolio health panel */}
        <Panel
          title="组合健康"
          action={<Link to="/analysis" className="text-xs text-blue-600 hover:text-blue-800">诊断 →</Link>}
        >
          {funds.length === 0 ? (
            <div className="py-4 text-sm text-slate-400">暂无基金数据。</div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {[
                  ['组合净值', netValue],
                  ['日涨跌', signedPct(avgDay)],
                  ['今年以来', signedPct(avgYear)],
                  ['最大回撤', plainPct(avgDrawdown)],
                  ['年化收益', plainPct(avgAnnual)],
                  ['夏普比率', avgSharpe === null ? '—' : avgSharpe.toFixed(2)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <div className="text-xs text-slate-400">{label}</div>
                    <div className="text-lg font-semibold text-slate-800">{value}</div>
                  </div>
                ))}
              </div>
              <div className="border-t border-slate-100 pt-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">风险评级</span>
                  <span className="font-medium text-slate-700">{riskScore >= 70 ? '偏低' : riskScore >= 50 ? '中等' : '偏高'} ({riskScore})</span>
                </div>
              </div>
            </div>
          )}
        </Panel>

        {/* Next actions panel */}
        <Panel
          title="下一步"
          action={null}
        >
          <div className="space-y-2">
            <Link to="/analysis" className="flex items-center justify-between rounded border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
              <span className="text-slate-700">组合诊断</span>
              <ChevronRight size={14} className="text-slate-400" />
            </Link>
            <Link to="/recommend" className="flex items-center justify-between rounded border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
              <span className="text-slate-700">推荐与对比</span>
              <ChevronRight size={14} className="text-slate-400" />
            </Link>
            {funds.length > 0 && funds[0]?.fundCode && (
              <Link to={`/${funds[0].fundCode}`} className="flex items-center justify-between rounded border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
                <span className="text-slate-700">查看 {fundName(funds[0])}</span>
                <ChevronRight size={14} className="text-slate-400" />
              </Link>
            )}
            <div className="rounded border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500">
              {mode === 'user'
                ? '基于您的自选组合，检查高回撤低夏普持仓。'
                : mode === 'userEmptyFallback'
                  ? '您暂无自选基金，当前展示最优夏普组合。'
                  : '未登录，展示基金池中夏普靠前的候选组合。'}
            </div>
          </div>
        </Panel>
      </div>

      {/* Fund list section */}
      <Panel
        title={mode === 'user' ? '持仓基金' : '优选基金'}
        action={<Link to="/funds" className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">全部 <ChevronRight size={14} /></Link>}
      >
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          {fundTypeTabs.map((tabItem) => (
            <button
              key={tabItem.key}
              type="button"
              onClick={() => setFundFilter(tabItem.key)}
              className={classNames(
                'rounded-full px-3 py-1 transition',
                fundFilter === tabItem.key ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
              )}
            >
              {tabItem.label}
            </button>
          ))}
          <span className="ml-auto text-slate-400">按夏普排序 · 真实指标</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {visibleCards.map(({ fund, weight }) => {
            const returnRate = parseMetric(fund.performance?.return1y ?? fund.performance?.annualizedReturn)
            const detailPath = fund.fundCode ? `/${fund.fundCode}` : '/analysis'
            return (
              <Link key={fund.fundCode || fundName(fund)} to={detailPath} className="block rounded-lg border border-slate-200 bg-white p-3 transition hover:border-blue-300 hover:shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-800">{fundName(fund)}</div>
                    <div className="mt-0.5 text-xs text-slate-400">{managerName(fund)}</div>
                  </div>
                  <span className="shrink-0 rounded-full border border-slate-200 px-2 py-0.5 text-[10px] text-slate-500">{typeLabel(fund)}</span>
                </div>
                <div className="mt-2 flex items-end justify-between">
                  <div>
                    <div className={classNames('text-lg font-bold', (returnRate || 0) >= 0 ? 'text-red-500' : 'text-emerald-500')}>{signedPct(returnRate)}</div>
                    <div className="text-xs text-slate-400">近一年/年化</div>
                  </div>
                  <Sparkline warm={(returnRate || 0) >= 0} className="h-8 w-20" />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-500">权重 {weight.toFixed(2)}%</span>
                  <span className="text-slate-600">{metricText(fund.nav, 4)}<span className="ml-1 text-slate-400">净值</span></span>
                </div>
              </Link>
            )
          })}
          {visibleCards.length === 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-400 sm:col-span-2 lg:col-span-4">
              没有匹配的基金，请调整搜索条件。
            </div>
          )}
        </div>
      </Panel>

      {/* Asset mix summary row */}
      {assetMix.length > 0 && (
        <Panel title="资产配置概览">
          <div className="flex flex-wrap gap-4">
            {assetMix.slice(0, 6).map((item) => (
              <div key={item.key} className="flex items-center gap-2 text-xs">
                <i className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: item.color }} />
                <span className="text-slate-600">{item.label}</span>
                <span className="font-medium text-slate-800">{item.value.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </section>
  )
}

export type { FundLike, DashboardMode, MarketOverviewPayload }
