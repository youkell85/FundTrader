import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ChevronRight, Search, UserCircle } from 'lucide-react'
import type { MarketDataStatus } from '@/types/allocation'
import { getFundAnalysis } from '@/lib/api'

type FundLike = {
  fundCode?: string
  fundName?: string
  fundAbbr?: string
  fundType?: string
  category?: string
  company?: string
  weight?: string | number | null
  targetWeight?: string | number | null
  currentWeight?: string | number | null
  holdingWeight?: string | number | null
  source?: string
  isXinjihui?: boolean
  nav?: string | number | null
  navDate?: string | null
  navTrend?: number[] | null
  dailyChange?: string | number | null
  dataQuality?: string | null
  staleLevel?: string | null
  manager?: { name?: string } | string | null
  performance?: {
    return1y?: string | number | null
    annualizedReturn?: string | number | null
    maxDrawdown?: string | number | null
    sharpeRatio?: string | number | null
  } | null
}

type DashboardMode = 'savedRecommendation' | 'userWatchlist' | 'candidatePool' | 'userEmptyFallback'

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

function Sparkline({
  points,
  warm = false,
  className = 'h-12 w-full',
}: {
  points: number[]
  warm?: boolean
  className?: string
}) {
  if (points.length < 2) {
    return (
      <div className={classNames(className, 'grid place-items-center rounded border border-white/[0.055] bg-white/[0.025] text-[10px] text-white/32')}>
        走势缺失
      </div>
    )
  }

  const width = 120
  const height = 42
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const d = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * width
      const y = height - ((point - min) / span) * (height - 6) - 3
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
  const stroke = warm ? '#d69d63' : '#59c993'

  return (
    <svg viewBox="0 0 120 42" className={classNames(className, 'overflow-visible')}>
      <path d={d} fill="none" stroke={stroke} strokeWidth="2" />
      <path d={d} fill="none" stroke={stroke} strokeOpacity=".2" strokeWidth="5" />
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

function normalizeNavTrend(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((point) => {
      const record = point as Record<string, unknown>
      return parseMetric(record.nav ?? record.unit_nav ?? record.navValue ?? record.value)
    })
    .filter((point): point is number => point !== null && point > 0)
    .slice(-42)
}

function Panel({ title, children, action, className }: { title: string; children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <section className={classNames('workspace-panel p-4', className)}>
      <div className="workspace-panel-header mb-3 flex items-center justify-between pb-2">
        <h3 className="text-sm font-semibold text-[#fff8ea]">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function fundWeight(fund: FundLike) {
  return parseMetric(fund.weight ?? fund.targetWeight ?? fund.currentWeight ?? fund.holdingWeight)
}

function buildWeightedFunds(funds: FundLike[]) {
  if (funds.length === 0) return []
  const explicitWeights = funds.map(fundWeight)
  const hasExplicitWeights = explicitWeights.some((weight) => weight !== null && weight > 0)

  if (hasExplicitWeights) {
    const rawTotal = explicitWeights.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    const scale = rawTotal > 0 && rawTotal <= 1.5 ? 100 : 1
    return funds.map((fund, index) => ({
      fund,
      weight: Number(((explicitWeights[index] || 0) * scale).toFixed(2)),
      weightSource: 'real' as const,
    }))
  }

  return funds.map((fund) => ({
    fund,
    weight: 0,
    weightSource: 'missing' as const,
  }))
}

function distributionByType(weighted: Array<{ fund: FundLike; weight: number; weightSource: 'real' | 'missing' }>) {
  const rows = new Map<string, number>()
  for (const item of weighted) {
    if (item.weightSource !== 'real' || item.weight <= 0) continue
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
  portfolioName,
  portfolioCreatedAt,
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
  portfolioName?: string | null
  portfolioCreatedAt?: string | null
  loading?: boolean
  error?: string | null
  marketOverview?: MarketOverviewPayload | null
  marketStatus?: MarketDataStatus | null
  marketLoading?: boolean
  marketError?: string | null
}) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [fundFilter, setFundFilter] = useState('all')
  const [trendByCode, setTrendByCode] = useState<Record<string, number[] | null>>({})
  const pendingTrendCodes = useRef(new Set<string>())
  const weighted = buildWeightedFunds(funds)
  const hasRealWeights = weighted.some((item) => item.weightSource === 'real')
  const assetMix = distributionByType(weighted)
  const avgDay = average(funds.map((fund) => parseMetric(fund.dailyChange)))
  const avgYear = average(funds.map((fund) => parseMetric(fund.performance?.return1y ?? fund.performance?.annualizedReturn)))
  const avgAnnual = average(funds.map((fund) => parseMetric(fund.performance?.annualizedReturn ?? fund.performance?.return1y)))
  const avgSharpe = average(funds.map((fund) => parseMetric(fund.performance?.sharpeRatio)))
  const avgDrawdown = average(funds.map((fund) => parseMetric(fund.performance?.maxDrawdown)))
  const hasRiskInputs = avgSharpe !== null && avgDrawdown !== null
  const riskScore = hasRiskInputs ? clamp(Math.round(62 + avgSharpe * 8 - Math.abs(avgDrawdown) * 0.45), 15, 92) : null
  const latestDate = funds.map((fund) => fund.navDate).filter(Boolean).sort().at(-1) || null
  const marketIndices = useMemo(() => normalizeMarketIndices(marketOverview), [marketOverview])
  const marketIndustries = useMemo(() => normalizeIndustries(marketOverview), [marketOverview])
  const risingCount = marketIndices.filter((item) => (item.change || 0) > 0).length
  const fallingCount = marketIndices.filter((item) => (item.change || 0) < 0).length
  const marketAsOf = marketStatus?.last_refresh ? formatDateTime(marketStatus.last_refresh) : (marketIndices.find((item) => item.date)?.date || latestDate || 'missing')
  const macroIndicators = marketStatus?.macro_indicators || {}
  const macroRows = [
    { label: 'PMI', key: 'PMI制造业' },
    { label: 'CPI', key: 'CPI同比' },
    { label: 'M2', key: 'M2增速' },
  ].map((item) => ({ ...item, data: macroIndicators[item.key] }))
  const strongestIndustry = marketIndustries[0]
  const sourceLabel = mode === 'savedRecommendation'
    ? `最近生成方案${portfolioName ? `：${portfolioName}` : ''}`
    : mode === 'userWatchlist'
      ? '自选基金池：未设置组合权重'
      : mode === 'userEmptyFallback'
        ? '用户暂无自选，展示真实候选池'
        : '未登录：真实候选池'
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
  const visibleCodes = useMemo(
    () => visibleCards.map(({ fund }) => String(fund.fundCode || '')).filter((code) => /^\d{6}$/.test(code)),
    [visibleCards],
  )

  useEffect(() => {
    const missingCodes = visibleCodes.filter((code) => !(code in trendByCode) && !pendingTrendCodes.current.has(code))
    if (missingCodes.length === 0) return

    let active = true
    missingCodes.forEach((code) => {
      pendingTrendCodes.current.add(code)
      getFundAnalysis(code)
        .then((analysis) => normalizeNavTrend(analysis?.nav_data || analysis?.navHistory || analysis?.navHistoryFull))
        .catch(() => null)
        .then((trend) => {
          pendingTrendCodes.current.delete(code)
          if (!active) return
          setTrendByCode((current) => ({ ...current, [code]: trend }))
        })
    })

    return () => {
      active = false
    }
  }, [trendByCode, visibleCodes])

  const trimmedQuery = query.trim()
  const queryLooksLikeFundCode = /^\d{6}$/.test(trimmedQuery)
  const showNoMatches = trimmedQuery.length > 0 && filteredWeighted.length === 0
  const openQueryFund = () => {
    if (queryLooksLikeFundCode) navigate(`/${trimmedQuery}`)
  }
  const dashboardMetrics = [
    [hasRealWeights ? '持仓数量' : '候选数量', `${funds.length}只`],
    ['日涨跌均值', signedPct(avgDay)],
    ['近一年均值', signedPct(avgYear)],
    ['最大回撤均值', plainPct(avgDrawdown)],
    ['年化收益均值', plainPct(avgAnnual)],
    ['夏普均值', avgSharpe === null ? 'missing' : avgSharpe.toFixed(2)],
  ]

  return (
    <section className="workspace-shell space-y-4">
      {/* Top bar: identity, source, freshness, user */}
      <header className="workspace-panel-strong flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-xl font-bold tracking-tight text-[#fff8ea]">决策桌面</h2>
          <span className="workspace-pill px-3 py-0.5 text-xs">{sourceLabel}</span>
          <span className="text-xs text-white/42">
            {portfolioCreatedAt
              ? `方案生成于 ${formatDateTime(portfolioCreatedAt)}`
              : marketLoading ? '行情加载中…' : `数据截至 ${marketAsOf}`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-white/52">
          <label className="workspace-input flex h-8 min-w-[240px] items-center gap-2 px-3">
            <Search size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && queryLooksLikeFundCode) {
                  event.preventDefault()
                  openQueryFund()
                }
              }}
              placeholder="搜索基金 / 代码 / 经理 / 公司"
              className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-white/30"
            />
          </label>
          <UserCircle size={18} />
          <span>{userName || '访客'}</span>
        </div>
      </header>

      {showNoMatches && (
        <div className="workspace-warning flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
          <span>没有匹配“{trimmedQuery}”的桌面候选基金。</span>
          <div className="flex items-center gap-2">
            {queryLooksLikeFundCode && (
              <button
                type="button"
                onClick={openQueryFund}
                className="workspace-action px-3 py-1.5 text-xs font-medium"
              >
                打开 {trimmedQuery}
              </button>
            )}
            <button
              type="button"
              onClick={() => setQuery('')}
              className="workspace-action px-3 py-1.5 text-xs font-medium"
            >
              清除搜索
            </button>
          </div>
        </div>
      )}

      {/* Loading / error banner */}
      {(loading || error) && (
        <div className="workspace-warning px-4 py-3 text-sm">
          {loading ? '正在加载基金数据…' : `数据加载异常：${error}`}
        </div>
      )}

      {/* Main decision row: market state, portfolio health, next actions */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Market state panel */}
        <Panel
          title="市场状态"
          action={marketLoading ? <span className="text-xs text-white/36">加载中…</span> : <span className="text-xs text-white/36">截至 {marketAsOf}</span>}
        >
          {(marketLoading || marketError || marketIndices.length === 0) && (
            <div className="workspace-warning mb-3 px-3 py-2 text-xs">
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
                <div key={item.code || item.name} className="grid grid-cols-[minmax(0,1fr)_96px_auto] items-center gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-white/82">{item.name}</div>
                    <div className="text-xs text-white/34">{item.code}</div>
                  </div>
                  <Sparkline
                    points={item.series.map((point) => point.close)}
                    warm={(item.change || 0) >= 0}
                    className="h-8 w-24"
                  />
                  <div className="text-right">
                    <div className="data-number text-sm font-semibold text-[#fff8ea]">{formatIndexValue(item.close)}</div>
                    <span className={classNames('data-number text-xs font-medium', (item.change || 0) >= 0 ? 'text-danger' : 'text-success')}>
                      {signedPct(item.change)}
                    </span>
                  </div>
                </div>
              ))}
              <div className="border-t border-white/[0.07] pt-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-white/45">上涨 {risingCount} / 下跌 {fallingCount}</span>
                  <span className="text-white/45">数据健康：{healthLabel(marketStatus?.health)}</span>
                </div>
                <div className="mt-2 rounded border border-white/[0.065] bg-white/[0.025] px-2 py-2">
                  <div className="mb-1 flex items-center justify-between text-[11px] text-white/42">
                    <span>Macro data</span>
                    <span>{marketStatus?.macro_available ? `confidence ${(marketStatus.macro_confidence * 100).toFixed(0)}%` : 'missing'}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {macroRows.map((item) => (
                      <div key={item.key} className="rounded border border-white/[0.045] bg-white/[0.035] px-2 py-1 text-xs">
                        <div className="font-medium text-white/70">{item.label}</div>
                        <div className={classNames('data-number text-sm font-semibold', item.data?.value != null ? 'text-[#fff8ea]' : 'text-white/35')}>
                          {formatMacroValue(item.data?.value)}
                        </div>
                        <div className="truncate text-[10px] text-white/32" title={item.data?.source || 'missing'}>
                          {formatConfidence(item.data?.confidence)} · {item.data?.source || 'missing'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {strongestIndustry && (
                  <div className="mt-1 flex items-center justify-between text-xs">
                    <span className="text-white/45">强势行业</span>
                    <span className="font-medium text-white/72">{strongestIndustry.name} {signedPct(strongestIndustry.change)}</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="py-4 text-sm text-white/38">市场全景等待指数数据返回。</div>
          )}
        </Panel>

        {/* Portfolio health / candidate quality panel */}
        <Panel
          title={hasRealWeights ? '组合健康' : '候选池质量'}
          action={<Link to="/analysis" className="text-xs text-[#8FD9BA] hover:text-white">诊断 →</Link>}
        >
          {funds.length === 0 ? (
            <div className="py-4 text-sm text-white/38">暂无基金数据。</div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {dashboardMetrics.map(([label, value]) => (
                  <div key={label}>
                    <div className="text-xs text-white/36">{label}</div>
                    <div className="data-number text-lg font-semibold text-[#fff8ea]">{value}</div>
                  </div>
                ))}
              </div>
              <div className="border-t border-white/[0.07] pt-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-white/45">{hasRealWeights ? '风险评级' : '组合权重'}</span>
                  <span className="font-medium text-white/72">
                    {!hasRealWeights
                      ? 'missing（尚未生成或导入真实权重）'
                      : riskScore === null ? 'missing（缺少夏普/回撤）' : `${riskScore >= 70 ? '偏低' : riskScore >= 50 ? '中等' : '偏高'} (${riskScore})`}
                  </span>
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
            <Link to="/analysis" className="workspace-action flex items-center justify-between px-3 py-2 text-sm">
              <span>组合诊断</span>
              <ChevronRight size={14} className="text-white/36" />
            </Link>
            <Link to="/recommend" className="workspace-action flex items-center justify-between px-3 py-2 text-sm">
              <span>推荐与对比</span>
              <ChevronRight size={14} className="text-white/36" />
            </Link>
            {funds.length > 0 && funds[0]?.fundCode && (
              <Link to={`/${funds[0].fundCode}`} className="workspace-action flex items-center justify-between px-3 py-2 text-sm">
                <span>查看 {fundName(funds[0])}</span>
                <ChevronRight size={14} className="text-white/36" />
              </Link>
            )}
            <div className="rounded border border-white/[0.055] bg-white/[0.025] px-3 py-2 text-xs text-white/42">
              {mode === 'savedRecommendation'
                ? '使用最近一次生成的配置方案权重，展示真实方案层面的配置和诊断入口。'
                : mode === 'userWatchlist'
                  ? '当前自选池没有真实组合权重。生成配置方案后，这里会切换为组合视图。'
                  : mode === 'userEmptyFallback'
                    ? '您暂无自选基金，当前只展示真实候选池，不生成组合权重。'
                    : '未登录，展示基金池中夏普靠前的真实候选，不生成组合权重。'}
            </div>
          </div>
        </Panel>
      </div>

      {/* Fund list section */}
      <Panel
        title={hasRealWeights ? '方案基金' : mode === 'userWatchlist' ? '自选基金' : '优选基金'}
        action={<Link to="/analysis" className="flex items-center gap-1 text-xs text-[#8FD9BA] hover:text-white">研究 <ChevronRight size={14} /></Link>}
      >
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          {fundTypeTabs.map((tabItem) => (
            <button
              key={tabItem.key}
              type="button"
              onClick={() => setFundFilter(tabItem.key)}
              className={classNames(
                'rounded-full px-3 py-1 transition',
                fundFilter === tabItem.key ? 'workspace-pill' : 'workspace-pill-muted hover:text-white',
              )}
            >
              {tabItem.label}
            </button>
          ))}
          <span className="ml-auto text-white/36">
            {hasRealWeights ? '按方案权重 · 真实指标' : '按夏普排序 · 无组合权重'}
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {visibleCards.map(({ fund, weight, weightSource }) => {
            const returnRate = parseMetric(fund.performance?.return1y ?? fund.performance?.annualizedReturn)
            const detailPath = fund.fundCode ? `/${fund.fundCode}` : '/analysis'
            const code = String(fund.fundCode || '')
            const trend = Array.isArray(fund.navTrend) && fund.navTrend.length > 1
              ? fund.navTrend
              : trendByCode[code] || []
            return (
              <Link key={fund.fundCode || fundName(fund)} to={detailPath} className="block rounded-lg border border-white/[0.075] bg-white/[0.03] p-3 transition hover:border-primary/40 hover:bg-white/[0.05]">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[#fff8ea]">{fundName(fund)}</div>
                    <div className="mt-0.5 text-xs text-white/36">{managerName(fund)}</div>
                  </div>
                  <span className="workspace-pill-muted shrink-0 px-2 py-0.5 text-[10px]">{typeLabel(fund)}</span>
                </div>
                <div className="mt-2 flex items-end justify-between">
                  <div>
                    <div className={classNames('data-number text-lg font-bold', (returnRate || 0) >= 0 ? 'text-danger' : 'text-success')}>{signedPct(returnRate)}</div>
                    <div className="text-xs text-white/36">近一年/年化</div>
                  </div>
                  <Sparkline points={trend} warm={(returnRate || 0) >= 0} className="h-8 w-20" />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs">
                  {weightSource === 'real' ? (
                    <span className="rounded bg-white/[0.055] px-2 py-0.5 text-white/45">权重 {weight.toFixed(2)}%</span>
                  ) : (
                    <span className="rounded bg-white/[0.055] px-2 py-0.5 text-white/45">权重 missing</span>
                  )}
                  <span className="data-number text-white/70">{metricText(fund.nav, 4)}<span className="ml-1 text-white/35">净值</span></span>
                </div>
              </Link>
            )
          })}
          {visibleCards.length === 0 && (
            <div className="rounded-lg border border-white/[0.075] bg-white/[0.025] p-4 text-sm text-white/38 sm:col-span-2 lg:col-span-4">
              {showNoMatches ? '没有匹配的基金，请清除搜索或直接打开代码详情。' : '没有匹配的基金，请调整搜索条件。'}
            </div>
          )}
        </div>
      </Panel>

      {/* Asset mix summary row */}
      {assetMix.length > 0 && (
        <Panel title="资产配置概览">
          <div className="mb-3 text-xs text-white/40">
            基于接口或最近生成方案返回的权重字段汇总；没有权重时不展示配置图。
          </div>
          <div className="flex flex-wrap gap-4">
            {assetMix.slice(0, 6).map((item) => (
              <div key={item.key} className="flex items-center gap-2 text-xs">
                <i className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: item.color }} />
                <span className="text-white/55">{item.label}</span>
                <span className="data-number font-medium text-[#fff8ea]">{item.value.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </section>
  )
}

export type { FundLike, DashboardMode, MarketOverviewPayload }
