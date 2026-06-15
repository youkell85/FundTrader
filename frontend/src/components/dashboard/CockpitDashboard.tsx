import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Bell, ChevronRight, Gauge, Search, UserCircle } from 'lucide-react'
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

function MiniIndexKline({ series, change }: { series: ReturnType<typeof normalizeKlineSeries>; change: number | null }) {
  if (series.length < 2) return <MarketMoveBar value={change} />

  const width = 142
  const height = 46
  const paddingX = 4
  const paddingY = 4
  const values = series.flatMap((point) => [point.open, point.high, point.low, point.close])
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const innerHeight = height - paddingY * 2
  const step = (width - paddingX * 2) / Math.max(series.length - 1, 1)
  const candleWidth = clamp(step * 0.52, 2.2, 4.8)
  const y = (value: number) => paddingY + ((max - value) / span) * innerHeight
  const closeLine = series
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${(paddingX + index * step).toFixed(2)},${y(point.close).toFixed(2)}`)
    .join(' ')

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mt-2 h-[46px] w-full overflow-visible" role="img" aria-label="指数30日K线">
      <path d={closeLine} fill="none" stroke="#74aef5" strokeOpacity="0.28" strokeWidth="1.6" />
      {series.map((point, index) => {
        const x = paddingX + index * step
        const isUp = point.close >= point.open
        const stroke = isUp ? '#e37757' : '#58c792'
        const bodyTop = Math.min(y(point.open), y(point.close))
        const bodyHeight = Math.max(Math.abs(y(point.open) - y(point.close)), 1.6)
        return (
          <g key={`${point.date}-${index}`}>
            <line x1={x} x2={x} y1={y(point.high)} y2={y(point.low)} stroke={stroke} strokeWidth="1" strokeOpacity="0.92" />
            <rect
              x={x - candleWidth / 2}
              y={bodyTop}
              width={candleWidth}
              height={bodyHeight}
              rx="0.8"
              fill={isUp ? 'rgba(227,119,87,0.22)' : 'rgba(88,199,146,0.22)'}
              stroke={stroke}
              strokeWidth="0.9"
            />
          </g>
        )
      })}
    </svg>
  )
}

function MarketMoveBar({ value }: { value: number | null }) {
  const magnitude = value === null ? 0 : clamp(Math.abs(value) * 24, 5, 100)
  const isUp = (value || 0) >= 0
  return (
    <div className="mt-4">
      <div className="h-1.5 rounded-full bg-white/10">
        <div
          className={classNames('h-full rounded-full', isUp ? 'bg-[#c86f44]' : 'bg-[#58c792]')}
          style={{ width: `${magnitude}%` }}
        />
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-[#9f988f]">
        <span>日涨跌幅</span>
        <span className={isUp ? 'text-[#e37757]' : 'text-[#58c792]'}>{signedPct(value)}</span>
      </div>
    </div>
  )
}

function Panel({ title, children, action, className }: { title: string; children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <section className={classNames('rounded-sm border border-[#2a2f2b] bg-[#0c0f0d]/90 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]', className)}>
      <div className="mb-2 flex items-center justify-between border-b border-white/[0.07] pb-2">
        <h3 className="text-sm font-semibold text-[#fff8ea]">{title}</h3>
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
  const avgMarketChange = average(marketIndices.map((item) => item.change))
  const marketScore = clamp(
    Math.round(50 + (avgMarketChange || 0) * 10 + ((marketStatus?.macro_confidence || 0) - 0.5) * 22 - Math.max((marketStatus?.vol_ratio || 1) - 1, 0) * 9),
    5,
    95,
  )
  const marketAsOf = marketStatus?.last_refresh ? formatDateTime(marketStatus.last_refresh) : (marketIndices.find((item) => item.date)?.date || latestDate)
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
  const marketHotspots = useMemo(() => {
    return [...marketIndices]
      .sort((a, b) => (b.change || 0) - (a.change || 0))
      .slice(0, 3)
  }, [marketIndices])
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
    <section className="relative overflow-hidden rounded-md border border-[#2a2f2b] bg-[#050706] p-2 text-[#f4efe3] shadow-2xl shadow-black/50">
      <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,.16)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.16)_1px,transparent_1px)] [background-size:32px_32px]" />
      <div className="relative">
        <header className="mb-2 flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] px-1 pb-2">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="text-2xl font-bold tracking-tight text-[#58c792]">资产驾驶舱</h2>
            <div className="rounded-full border border-[#58c792]/25 bg-[#58c792]/10 px-3 py-1 text-xs text-[#8de0b5]">{sourceLabel}</div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-[#bcb5aa]">
            <label className="flex h-8 min-w-[260px] items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-3">
              <Search size={14} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索基金 / 代码 / 经理 / 公司"
                className="min-w-0 flex-1 bg-transparent text-xs text-[#f4efe3] outline-none placeholder:text-[#bcb5aa]"
              />
            </label>
            <Bell size={16} />
            <span>消息</span>
            <span>预警</span>
            <UserCircle size={18} />
            <span>{userName || '访客'}</span>
          </div>
        </header>

        {(loading || error) && (
          <div className="mb-3 rounded-sm border border-white/[0.08] bg-white/[0.035] px-4 py-3 text-sm text-[#d8cec0]">
            {loading ? '正在加载真实基金数据...' : `数据加载异常：${error}`}
          </div>
        )}

        <Panel
          title="市场全景"
          action={<span className="text-xs text-[#c8bba9]">{marketLoading ? '真实行情加载中' : `真实行情截至 ${marketAsOf}`}</span>}
        >
          {(marketLoading || marketError || marketIndices.length === 0) && (
            <div className="mb-3 rounded-sm border border-white/[0.08] bg-white/[0.035] px-3 py-2 text-xs text-[#d8cec0]">
              {marketLoading
                ? '正在加载真实市场指数和市场状态...'
                : marketError
                  ? `市场全景加载异常：${marketError}`
                  : '真实行情暂不可用，未使用组合指标替代。'}
            </div>
          )}
          <div className="grid gap-3 xl:grid-cols-[1fr_1fr_1fr_160px_130px]">
            {marketIndices.length > 0 ? marketIndices.slice(0, 3).map((item) => (
              <div key={item.code || item.name} className="min-h-[118px] border-r border-white/[0.08] pr-3">
                <div className="flex items-baseline gap-3">
                  <span className="font-semibold text-[#f2eadc]">{item.name}</span>
                  <span className="text-sm font-semibold text-[#f4efe3]">{formatIndexValue(item.close)}</span>
                  <span className={classNames('text-xs font-semibold', (item.change || 0) >= 0 ? 'text-[#e37757]' : 'text-[#58c792]')}>
                    {signedPct(item.change)}
                  </span>
                </div>
                <MiniIndexKline series={item.series || []} change={item.change} />
                <div className="flex justify-between text-[10px] text-[#9f988f]"><span>{item.code}</span><span>30日K线</span><span>{item.source}</span></div>
              </div>
            )) : (
              <div className="min-h-[82px] border-r border-white/[0.08] pr-4 xl:col-span-3">
                <div className="font-semibold text-[#f2eadc]">真实行情暂不可用</div>
                <div className="mt-3 text-sm leading-6 text-[#b9b1a4]">市场全景等待 `/fund/api/recommend/market` 返回指数数据后展示，不用基金组合数据兜底。</div>
              </div>
            )}
            <div className="space-y-2 border-r border-white/[0.08] pr-3 text-xs">
              <div className="font-semibold text-[#f2eadc]">市场状态</div>
              {[
                ['上涨指数', `${risingCount}/${marketIndices.length}`, '#e37757'],
                ['下跌指数', `${fallingCount}/${marketIndices.length}`, '#58c792'],
                ['波动倍率', marketStatus?.vol_ratio ? `${marketStatus.vol_ratio.toFixed(2)}x` : '—', '#81b1d9'],
                ['数据健康', healthLabel(marketStatus?.health), marketStatus?.health === 'critical' ? '#e37757' : '#d7d2c6'],
              ].map(([label, value, color]) => (
                <div key={label} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-[#bbb4a9]"><i className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />{label}</span>
                  <span className="text-[#f4efe3]">{value}</span>
                </div>
              ))}
              <div className="flex items-center justify-between gap-3">
                <span className="text-[#bbb4a9]">强势行业</span>
                <span className="text-right text-[#f4efe3]">{strongestIndustry ? `${strongestIndustry.name} ${signedPct(strongestIndustry.change)}` : '暂无行业数据'}</span>
              </div>
            </div>
            <div>
              <div className="mb-2 text-xs font-semibold text-[#f2eadc]">市场情绪</div>
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[conic-gradient(from_210deg,#58c792_0_var(--score),#b68a5f_var(--score)_78%,rgba(255,255,255,.08)_78%_100%)] p-1.5" style={{ ['--score' as string]: `${marketScore}%` }}>
                <div className="grid h-full w-full place-items-center rounded-full bg-[#0c0f0d] text-center">
                  <div>
                    <div className="text-lg font-bold text-[#e8c184]">{marketScore}</div>
                    <div className="text-[10px] text-[#d6c9b7]">{marketScore >= 65 ? '偏强' : marketScore >= 40 ? '中性' : '偏弱'}</div>
                  </div>
                </div>
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-[#9f988f]"><span>0</span><span>100</span></div>
            </div>
          </div>
        </Panel>

        <Panel title="我的组合" action={<div className="flex gap-2"><Link to="/analysis" className="rounded-full border border-white/15 px-3 py-1 text-xs hover:bg-white/8">组合诊断</Link><Link to="/recommend" className="rounded-full border border-white/15 px-3 py-1 text-xs hover:bg-white/8">组合对比</Link></div>} className="mt-2">
          <div className="grid grid-cols-2 gap-2 border-b border-white/[0.08] pb-2 md:grid-cols-6">
            {[
              ['组合净值', netValue, 'text-white'],
              ['日涨跌', signedPct(avgDay), (avgDay || 0) >= 0 ? 'text-[#e37757]' : 'text-[#58c792]'],
              ['今年以来', signedPct(avgYear), (avgYear || 0) >= 0 ? 'text-[#e37757]' : 'text-[#58c792]'],
              ['最大回撤', plainPct(avgDrawdown), 'text-[#58c792]'],
              ['年化收益', plainPct(avgAnnual), 'text-[#e8c184]'],
              ['夏普比率', avgSharpe === null ? '—' : avgSharpe.toFixed(2), 'text-white'],
            ].map(([label, value, color]) => (
              <div key={label} className="border-r border-white/[0.08] last:border-r-0">
                <div className="text-xs text-[#a8a097]">{label}</div>
                <div className={classNames('mt-0.5 text-lg font-semibold', color)}>{value}</div>
              </div>
            ))}
          </div>

          <div className="mt-2 grid gap-3 lg:grid-cols-[1fr_1fr_1.45fr]">
            <div>
              <div className="mb-2 text-sm font-semibold">资产配置</div>
              <div className="grid grid-cols-[112px_1fr] items-center gap-3">
                <div className="grid h-20 w-20 place-items-center rounded-full p-4" style={{ background: `conic-gradient(${assetMix.map((item, index) => `${item.color} ${assetMix.slice(0, index).reduce((sum, x) => sum + x.value, 0)}% ${assetMix.slice(0, index + 1).reduce((sum, x) => sum + x.value, 0)}%`).join(',') || '#716c65 0 100%'})` }}>
                  <div className="h-full w-full rounded-full bg-[#0c0f0d]" />
                </div>
                <div className="space-y-2 text-xs">
                  {assetMix.slice(0, 6).map((item) => (
                    <div key={item.key} className="grid grid-cols-[62px_1fr_48px] items-center gap-2">
                      <span className="flex items-center gap-2"><i className="h-2 w-2 rounded-sm" style={{ backgroundColor: item.color }} />{item.label}</span>
                      <div className="h-1.5 rounded-full bg-white/10"><div className="h-full rounded-full" style={{ width: `${item.value}%`, backgroundColor: item.color }} /></div>
                      <span>{item.value.toFixed(2)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <div className="mb-2 text-sm font-semibold">风格分布（按基金类型）</div>
              <div className="space-y-2 text-xs">
                {assetMix.slice(0, 6).map((item, index) => (
                  <div key={item.key} className="grid grid-cols-[70px_1fr_44px] items-center gap-2">
                    <span className="text-[#cfc7bb]">{item.label}</span>
                    <div className="h-2 rounded-full bg-white/10">
                      <div className={classNames('h-full rounded-full', index < 2 ? 'bg-[#58c792]' : index < 4 ? 'bg-[#d8b36e]' : 'bg-[#9d8062]')} style={{ width: `${item.value}%` }} />
                    </div>
                    <span>{item.value.toFixed(2)}%</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 text-sm font-semibold">基金类型热力分布</div>
              <div className="grid h-[96px] grid-cols-4 grid-rows-2 overflow-hidden rounded-sm border border-white/[0.06] text-xs">
                {assetMix.slice(0, 8).map((item) => (
                  <div key={item.key} className="flex flex-col justify-center border border-black/20 p-2" style={{ backgroundColor: item.color }}>
                    <span>{item.label}</span>
                    <span className="mt-1 text-[#fff4df]">{item.value.toFixed(2)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Panel>

        <Panel
          title={mode === 'user' ? '用户组合持仓' : '优选基金'}
          action={<Link to="/funds" className="flex items-center gap-1 text-xs text-[#d8cec0] hover:text-white">更多 <ChevronRight size={14} /></Link>}
          className="mt-2"
        >
          <div className="-mt-1 mb-2 flex flex-wrap items-center gap-2 text-xs">
            {fundTypeTabs.map((tabItem) => (
              <button
                key={tabItem.key}
                type="button"
                onClick={() => setFundFilter(tabItem.key)}
                className={classNames(
                  'rounded-sm px-3 py-1 transition',
                  fundFilter === tabItem.key ? 'bg-white/12 text-white' : 'text-[#a9a197] hover:bg-white/[0.06] hover:text-white',
                )}
              >
                {tabItem.label}
              </button>
            ))}
            <span className="ml-auto rounded bg-white/[0.06] px-2 py-1 text-[#f4efe3]">按夏普</span>
            <span className="rounded px-2 py-1 text-[#d8cec0]">真实指标</span>
            <span className="rounded px-2 py-1 text-[#d8cec0]">最新净值</span>
          </div>
          <div className="grid gap-3 lg:grid-cols-4">
            {visibleCards.map(({ fund, weight }) => {
              const returnRate = parseMetric(fund.performance?.return1y ?? fund.performance?.annualizedReturn)
              const detailPath = fund.fundCode ? `/${fund.fundCode}` : '/analysis'
              return (
                <Link key={fund.fundCode || fundName(fund)} to={detailPath} className="block h-[122px] overflow-hidden rounded-sm border border-white/[0.08] bg-white/[0.035] p-2 transition hover:border-[#58c792]/55 hover:bg-white/[0.055]">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-semibold leading-5 text-[#f7f1e7]">{fundName(fund)}</div>
                      <div className="mt-1 text-xs text-[#a9a197]">{managerName(fund)}</div>
                    </div>
                    <span className="shrink-0 rounded border border-[#d1a66c]/45 px-2 py-0.5 text-[10px] text-[#e1b879]">{typeLabel(fund)}</span>
                  </div>
                  <div className="mt-1 grid grid-cols-[1fr_82px] items-end gap-3">
                    <div>
                      <div className={classNames('text-lg font-bold', (returnRate || 0) >= 0 ? 'text-[#e37757]' : 'text-[#58c792]')}>{signedPct(returnRate)}</div>
                      <div className="text-xs text-[#aaa198]">近一年/年化</div>
                    </div>
                    <Sparkline warm={(returnRate || 0) >= 0} className="h-8 w-full" />
                  </div>
                  <div className="mt-0.5 flex items-center justify-between text-xs">
                    <span className="rounded bg-[#d2a66a]/12 px-2 py-1 text-[#ddb878]">权重 {weight.toFixed(2)}%</span>
                    <span className="text-[#f1eadf]">{metricText(fund.nav, 4)}<span className="ml-1 text-[#9f988f]">最新净值</span></span>
                  </div>
                </Link>
              )
            })}
            {visibleCards.length === 0 && (
              <div className="rounded-sm border border-white/[0.08] bg-white/[0.035] p-4 text-sm text-[#bcb5aa] lg:col-span-4">
                没有匹配的基金，请调整搜索条件。
              </div>
            )}
          </div>
        </Panel>

        <div className="mt-2 grid gap-3 xl:grid-cols-[1.2fr_.8fr_1fr]">
          <Panel title="市场热点">
            <div className="mb-3 flex flex-wrap gap-4 text-xs">
              <span className="font-semibold text-[#58c792]">指数涨跌</span>
              <span className="text-[#a9a197]">市场状态</span>
              <span className="text-[#a9a197]">资金流向</span>
              <span className="text-[#a9a197]">波动监控</span>
            </div>
            <div className="space-y-2 text-xs">
              {marketHotspots.map((item, index) => (
                <div key={item.code || item.name} className="grid grid-cols-[28px_1fr_76px_96px] items-center gap-3">
                  <span className="grid h-5 w-5 place-items-center rounded-sm bg-[#d4a15e]/28 text-[#e8c184]">{index + 1}</span>
                  <span className="truncate text-[#f4efe3]">{item.name}</span>
                  <span className={classNames('text-right font-semibold', (item.change || 0) >= 0 ? 'text-[#e37757]' : 'text-[#58c792]')}>{signedPct(item.change)}</span>
                  <span className="text-right text-[#d8cec0]">{formatIndexValue(item.close)}</span>
                </div>
              ))}
              {marketHotspots.length === 0 && (
                <div className="py-4 text-sm text-[#bcb5aa]">市场热点等待真实指数数据返回。</div>
              )}
            </div>
          </Panel>
          <Panel title="组合风险" action={<Gauge size={15} className="text-[#d5a765]" />}>
            <div className="grid grid-cols-[1fr_110px] items-center gap-3 text-xs">
              <div className="space-y-3">
                <div className="flex justify-between"><span>风险评级</span><span>{riskScore >= 70 ? '偏低' : riskScore >= 50 ? '中等' : '偏高'}</span></div>
                <div className="flex justify-between"><span>风险得分</span><span>{riskScore}</span></div>
                <div className="flex justify-between"><span>VaR(估算)</span><span>{plainPct(avgDrawdown === null ? null : Math.abs(avgDrawdown) / 2)}</span></div>
                <div className="flex justify-between"><span>最大回撤</span><span className="text-[#58c792]">{plainPct(avgDrawdown)}</span></div>
              </div>
              <div className="grid h-20 w-20 place-items-center rounded-full bg-[conic-gradient(from_210deg,#d4a15e_0_58%,#58c792_58%_78%,rgba(255,255,255,.08)_78%_100%)] p-3">
                <div className="h-full w-full rounded-full bg-[#0c0f0d]" />
              </div>
            </div>
          </Panel>
          <Panel title="近期调仓建议">
            <div className="space-y-3 text-sm text-[#d8cec0]">
              {[
                mode === 'user' ? '基于用户自选组合计算，优先检查高回撤低夏普持仓。' : '未登录状态下展示基金池中夏普比率靠前的候选组合。',
                (avgDrawdown || 0) < -15 ? '组合回撤偏高，建议降低权益或高波动主题基金占比。' : '组合回撤处于可控区间，可继续观察收益稳定性。',
                (avgSharpe || 0) >= 1 ? '夏普比率较好，可把高质量基金设为核心仓位。' : '夏普比率仍有提升空间，建议替换低效率持仓。',
              ].map((text) => (
                <div key={text} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#d4a15e]" />
                  <span>{text}</span>
                </div>
              ))}
              <Link to="/recommend" className="mt-2 flex items-center gap-1 text-xs font-semibold text-[#58c792] hover:text-white">查看全部建议 <ChevronRight size={14} /></Link>
            </div>
          </Panel>
        </div>
      </div>
    </section>
  )
}

export type { FundLike, DashboardMode, MarketOverviewPayload }
