import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { BarChart3, ChevronRight, Search, ShieldCheck, SlidersHorizontal, TrendingUp, UserCircle } from 'lucide-react'
import type { MarketDataStatus } from '@/types/allocation'

type FundLike = {
  fundCode?: string
  code?: string | null
  fund_code?: string | null
  tsCode?: string | null
  fundName?: string
  fundAbbr?: string
  nameAvailable?: boolean
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
  fee?: string | number | null
  managementFee?: string | number | null
  custodyFee?: string | number | null
  feeManage?: string | number | null
  feeCustody?: string | number | null
  manageFee?: string | number | null
  trusteeFee?: string | number | null
  expenseRatio?: string | number | null
  totalScale?: string | number | null
  scale?: string | number | null
  aum?: string | number | null
  stars?: string | number | null
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
  net_flow?: number | string | null
  netFlow?: number | string | null
  amount?: number | string | null
  date?: string | null
  source?: string | null
  [key: string]: unknown
}

type MarketOverviewPayload = {
  market?: MarketIndexItem[]
  industries?: MarketIndustryItem[]
  industry?: MarketIndustryItem[]
}

type SortMode = 'return' | 'sharpe' | 'drawdown' | 'fee'

type TypeWinner = {
  key: string
  label: string
  primary: FundLike
  topSharpe: FundLike | null
  topReturn: FundLike | null
  count: number
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
  other: '其他',
}

const TYPE_ORDER = ['equity', 'hybrid', 'bond', 'index', 'etf', 'qdii', 'fof', 'money', 'reits']

function classNames(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(' ')
}

function parseMetric(value: unknown): number | null {
  if (value === undefined || value === null || value === '' || value === '—' || value === '-') return null
  const num = parseFloat(String(value).replace(/[%％,，]/g, ''))
  return Number.isFinite(num) ? num : null
}

function average(values: Array<number | null>) {
  const valid = values.filter((value): value is number => value !== null && Number.isFinite(value))
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null
}

function signedPct(value: number | null, digits = 2) {
  if (value === null) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`
}

function plainPct(value: number | null, digits = 2) {
  if (value === null) return '—'
  return `${value.toFixed(digits)}%`
}

function decimalText(value: number | null, digits = 2) {
  return value === null ? '—' : value.toFixed(digits)
}

function signedToneClass(value: number | null) {
  if (value === null) return 'text-white/45'
  return value >= 0 ? 'text-danger' : 'text-success'
}

function fundName(fund: FundLike) {
  return String(fund.fundName || fund.fundAbbr || fund.fundCode || '未命名基金')
}

function fundCode(fund: FundLike) {
  const rawCode = fund.fundCode || fund.code || fund.fund_code || fund.tsCode || ''
  const match = String(rawCode).match(/\d{6}/)
  return match ? match[0] : ''
}

function managerName(fund: FundLike) {
  const value = typeof fund.manager === 'string' ? fund.manager : fund.manager?.name
  return value ? String(value) : null
}

function companyName(fund: FundLike) {
  const value = fund.company ? String(fund.company).trim() : ''
  return value && value !== '—' ? value : null
}

function fundSubline(fund: FundLike) {
  const code = fundCode(fund) || '代码缺失'
  const manager = managerName(fund)
  const company = companyName(fund)
  if (manager) return `${code} / 经理 ${manager}`
  if (company) return `${code} / 公司 ${company}`
  return `${code} / 经理缺失`
}

function typeKey(fund: FundLike) {
  const raw = String(fund.fundType || fund.category || 'other').toLowerCase()
  if (raw.includes('etf')) return 'etf'
  if (raw.includes('qdii')) return 'qdii'
  if (raw.includes('fof')) return 'fof'
  if (raw.includes('reits')) return 'reits'
  if (raw.includes('stock') || raw.includes('equity') || raw.includes('股票')) return 'equity'
  if (raw.includes('hybrid') || raw.includes('mixed') || raw.includes('混合')) return 'hybrid'
  if (raw.includes('bond') || raw.includes('债')) return 'bond'
  if (raw.includes('index') || raw.includes('指数')) return 'index'
  if (raw.includes('money') || raw.includes('货币')) return 'money'
  return raw || 'other'
}

function typeLabel(fund: FundLike) {
  const key = typeKey(fund)
  return TYPE_LABELS[key] || String(fund.category || fund.fundType || '其他')
}

function returnMetric(fund: FundLike) {
  return parseMetric(fund.performance?.return1y)
}

function sharpeMetric(fund: FundLike) {
  return parseMetric(fund.performance?.sharpeRatio)
}

function drawdownMetric(fund: FundLike) {
  return parseMetric(fund.performance?.maxDrawdown)
}

function normalizeFeeRate(value: number | null) {
  if (value === null) return null
  return Math.abs(value) <= 1.5 ? value * 100 : value
}

function feeSummary(fund: FundLike) {
  const explicitFee = parseMetric(fund.fee ?? fund.expenseRatio)
  if (explicitFee !== null) {
    const value = normalizeFeeRate(explicitFee)
    return value === null ? { value: null, text: '缺失' } : { value, text: `${value.toFixed(2)}%` }
  }

  const management = parseMetric(fund.managementFee ?? fund.feeManage ?? fund.manageFee)
  const custody = parseMetric(fund.custodyFee ?? fund.feeCustody ?? fund.trusteeFee)
  if (management !== null && custody !== null) {
    const value = normalizeFeeRate(management + custody)
    return value === null ? { value: null, text: '缺失' } : { value, text: `${value.toFixed(2)}%` }
  }
  if (management !== null) {
    const value = normalizeFeeRate(management)
    return value === null ? { value: null, text: '缺失' } : { value, text: `管 ${value.toFixed(2)}%` }
  }
  if (custody !== null) {
    const value = normalizeFeeRate(custody)
    return value === null ? { value: null, text: '缺失' } : { value, text: `托 ${value.toFixed(2)}%` }
  }
  return { value: null, text: '缺失' }
}

function feeMetric(fund: FundLike) {
  return feeSummary(fund).value
}

function scaleText(fund: FundLike) {
  const scale = parseMetric(fund.totalScale ?? fund.scale ?? fund.aum)
  if (scale === null) return '缺失'
  if (Math.abs(scale) >= 10_000) return `${(scale / 10_000).toFixed(1)}亿`
  return `${scale.toFixed(scale >= 100 ? 1 : 2)}亿`
}

function dataStatusText(fund: FundLike) {
  const quality = String(fund.dataQuality || '').toLowerCase()
  const stale = String(fund.staleLevel || '').toLowerCase()
  if (quality === 'seeded' || stale === 'missing') return { text: '不可用', tone: 'bad' as const }
  if (stale === 'stale') return { text: '待详情校验', tone: 'warn' as const }
  if (quality === 'partial') return { text: '部分真实', tone: 'warn' as const }
  return { text: '可用', tone: 'ok' as const }
}

function isDecisionFund(fund: FundLike) {
  const nav = parseMetric(fund.nav)
  const quality = String(fund.dataQuality || '').toLowerCase()
  const stale = String(fund.staleLevel || '').toLowerCase()
  const hasDecisionMetric = returnMetric(fund) !== null || sharpeMetric(fund) !== null || drawdownMetric(fund) !== null
  return Boolean(fund.navDate) && nav !== null && nav > 0 && hasDecisionMetric && quality !== 'seeded' && stale !== 'missing'
}

function sortFunds(funds: FundLike[], sortMode: SortMode) {
  return [...funds].sort((a, b) => {
    if (sortMode === 'drawdown') return (drawdownMetric(a) ?? 999) - (drawdownMetric(b) ?? 999)
    if (sortMode === 'fee') return (feeMetric(a) ?? 999) - (feeMetric(b) ?? 999)
    if (sortMode === 'sharpe') return (sharpeMetric(b) ?? -999) - (sharpeMetric(a) ?? -999)
    return (returnMetric(b) ?? -999) - (returnMetric(a) ?? -999)
  })
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
      }
    })
    .filter((item) => item.close !== null || item.change !== null)
}

function normalizeIndustries(payload?: MarketOverviewPayload | null) {
  return (payload?.industries || payload?.industry || [])
    .map((item) => {
      const record = item as Record<string, unknown>
      return {
        name: String(item.name || item.industry || item.board || record.label || record['板块名称'] || record['名称'] || '行业板块'),
        change: pickNumber(record, ['change', 'pct_change', 'change_pct', '涨跌幅', 'pctChg']),
        netFlow: pickNumber(record, ['net_flow', 'netFlow', 'amount', '主力净流入-净额', '今日主力净流入-净额', '净流入']),
        date: String(item.date || record.trade_date || record.as_of || ''),
        source: String(item.source || record.source || ''),
      }
    })
    .filter((item) => item.change !== null || item.netFlow !== null)
    .sort((a, b) => (b.change ?? b.netFlow ?? 0) - (a.change ?? a.netFlow ?? 0))
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

function amountYiText(value: number | null) {
  if (value === null) return '缺失'
  const yi = value / 100_000_000
  const digits = Math.abs(yi) >= 10 ? 1 : 2
  return `${yi >= 0 ? '+' : ''}${yi.toFixed(digits)}亿`
}

function industrySignalText(item: { change: number | null; netFlow?: number | null }) {
  if (item.change !== null) return signedPct(item.change)
  return amountYiText(item.netFlow ?? null)
}

function healthLabel(status?: MarketDataStatus['health']) {
  switch (status) {
    case 'healthy':
      return 'Healthy'
    case 'degraded':
      return '降级可用'
    case 'critical':
      return '异常'
    default:
      return '未知'
  }
}

function macroConfidenceText(status?: MarketDataStatus | null) {
  if (!status?.macro_available || status.macro_confidence === null || status.macro_confidence === undefined) return '缺失'
  return `${(status.macro_confidence * 100).toFixed(0)}%`
}

function buildTypeWinners(funds: FundLike[]) {
  const rows: TypeWinner[] = []
  for (const key of TYPE_ORDER) {
    const candidates = funds.filter((fund) => typeKey(fund) === key && isDecisionFund(fund))
    if (candidates.length === 0) continue
    const topSharpe = sortFunds(candidates.filter((fund) => sharpeMetric(fund) !== null), 'sharpe')[0] || null
    const topReturn = sortFunds(candidates.filter((fund) => returnMetric(fund) !== null), 'return')[0] || null
    const primary = topSharpe || topReturn
    if (!primary) continue
    rows.push({
      key,
      label: TYPE_LABELS[key] || key,
      primary,
      topSharpe,
      topReturn,
      count: candidates.length,
    })
  }
  return rows
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

function marketPressureConclusion({
  marketLoading,
  marketError,
  marketStatus,
  marketIndustries,
}: {
  marketLoading?: boolean
  marketError?: string | null
  marketStatus?: MarketDataStatus | null
  marketIndustries: Array<{ name: string; change: number | null; netFlow?: number | null }>
}) {
  const volRatio = marketStatus?.vol_ratio ?? null
  if (marketLoading) return '市场数据加载中：先不要根据压力指标做筛选结论。'
  if (marketError || marketStatus?.health === 'critical') return '市场数据异常：先用基金自身收益、回撤、夏普做保守筛选。'
  if (volRatio !== null && volRatio >= 1.2) return '波动偏高：筛选时先看回撤和夏普，再看近一年收益；暂不做行业强弱判断。'
  if (marketIndustries.length === 0) return '市场数据可用，但行业热度缺失：先按基金自身收益风险筛选。'
  if (marketIndustries[0]?.change !== null) return `行业信号可参考：${marketIndustries[0].name}相对靠前，但仍需进详情页复核基金指标。`
  if (marketIndustries[0]?.netFlow !== null && marketIndustries[0]?.netFlow !== undefined) return `行业资金流可参考：${marketIndustries[0].name}主力净流入${amountYiText(marketIndustries[0].netFlow)}，仍需进详情页复核基金指标。`
  return '市场压力正常：可从分类型优选横榜进入详情复核。'
}

function homeConclusion(decisionCount: number, marketStatus?: MarketDataStatus | null) {
  const volRatio = marketStatus?.vol_ratio ?? null
  if (decisionCount === 0) return '真实基金指标仍在加载或不足，先等待候选池返回可决策数据。'
  if (volRatio !== null && volRatio >= 1.2) return '当前波动偏高，优先挑选回撤和夏普稳定的分类型冠军。'
  return '先用分类型优选横榜缩小范围，再进详情页复核费率、回撤和同类表现。'
}

function Panel({ title, children, action, className }: { title: string; children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <section className={classNames('workspace-panel p-4', className)}>
      <div className="workspace-panel-header mb-3 flex items-center justify-between gap-3 pb-2">
        <h3 className="text-sm font-semibold text-[#fff8ea]">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

export function CockpitDashboard({
  funds,
  mode,
  portfolioFunds,
  fundUniverseTotal,
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
  portfolioFunds?: FundLike[]
  fundUniverseTotal?: number | null
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
  const [sortMode, setSortMode] = useState<SortMode>('return')

  const marketIndices = useMemo(() => normalizeMarketIndices(marketOverview), [marketOverview])
  const marketIndustries = useMemo(() => normalizeIndustries(marketOverview), [marketOverview])
  const decisionFunds = useMemo(() => funds.filter(isDecisionFund), [funds])
  const fundPool = decisionFunds.length > 0 ? decisionFunds : funds
  const typeWinners = useMemo(() => buildTypeWinners(funds), [funds])
  const latestDate = funds.map((fund) => fund.navDate).filter(Boolean).sort().at(-1) || null
  const marketAsOf = marketStatus?.last_refresh ? formatDateTime(marketStatus.last_refresh) : (marketIndices.find((item) => item.date)?.date || latestDate || '缺失')
  const trimmedQuery = query.trim()
  const queryLooksLikeFundCode = /^\d{6}$/.test(trimmedQuery)
  const showNoMatches = trimmedQuery.length > 0

  const availableTabs = useMemo(() => {
    const available = new Set(fundPool.map(typeKey))
    return [
      { key: 'all', label: '全部' },
      ...TYPE_ORDER.filter((key) => available.has(key)).map((key) => ({ key, label: TYPE_LABELS[key] || key })),
    ]
  }, [fundPool])

  const filteredFunds = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return sortFunds(
      fundPool.filter((fund) => {
        if (fundFilter !== 'all' && typeKey(fund) !== fundFilter) return false
        if (!keyword) return true
        const haystack = [
          fundCode(fund),
          fundName(fund),
          managerName(fund),
          companyName(fund),
          typeLabel(fund),
        ].filter(Boolean).join(' ').toLowerCase()
        return haystack.includes(keyword)
      }),
      sortMode,
    )
  }, [fundFilter, fundPool, query, sortMode])

  const portfolioWeighted = useMemo(() => buildWeightedFunds(portfolioFunds || []), [portfolioFunds])
  const hasPortfolioWeights = portfolioWeighted.some((item) => item.weightSource === 'real')
  const portfolioAvgReturn = average((portfolioFunds || []).map(returnMetric))
  const portfolioAvgSharpe = average((portfolioFunds || []).map(sharpeMetric))
  const avgReturn = average(decisionFunds.map(returnMetric))
  const avgSharpe = average(decisionFunds.map(sharpeMetric))
  const avgDrawdown = average(decisionFunds.map(drawdownMetric))
  const reliableRatio = funds.length > 0 ? decisionFunds.length / funds.length : 0
  const topFund = filteredFunds[0]
  const pressureText = marketPressureConclusion({ marketLoading, marketError, marketStatus, marketIndustries })
  const conclusion = homeConclusion(decisionFunds.length, marketStatus)
  const volRatio = marketStatus?.vol_ratio ?? null

  const openQueryFund = () => {
    if (queryLooksLikeFundCode) navigate(`/${trimmedQuery}`)
  }

  const sortOptions: Array<{ key: SortMode; label: string }> = [
    { key: 'return', label: '收益' },
    { key: 'sharpe', label: '夏普' },
    { key: 'drawdown', label: '回撤' },
    { key: 'fee', label: '费率' },
  ]

  return (
    <section className="workspace-shell space-y-4">
      <header className="workspace-panel-strong flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-3">
          <h2 className="text-xl font-bold tracking-tight text-[#fff8ea]">基金市场</h2>
          <span className="workspace-pill px-3 py-0.5 text-xs">市场首页 / 真实候选池</span>
          <span className="text-xs text-white/42">数据截至 {marketAsOf}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-white/52">
          <label className="workspace-input flex h-8 min-w-[260px] items-center gap-2 px-3">
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

      {(loading || error || (showNoMatches && filteredFunds.length === 0)) && (
        <div className="workspace-warning flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
          <span>
            {loading
              ? '正在加载基金数据...'
              : error
                ? `数据加载异常：${error}`
                : `没有匹配“${trimmedQuery}”的市场候选基金。`}
          </span>
          {!loading && !error && (
            <div className="flex items-center gap-2">
              {queryLooksLikeFundCode && (
                <button type="button" onClick={openQueryFund} className="workspace-action px-3 py-1.5 text-xs font-medium">
                  打开 {trimmedQuery}
                </button>
              )}
              <button type="button" onClick={() => setQuery('')} className="workspace-action px-3 py-1.5 text-xs font-medium">
                清除搜索
              </button>
            </div>
          )}
        </div>
      )}

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1.65fr)_repeat(4,minmax(120px,.55fr))]">
        <div className="workspace-panel-strong p-4 md:col-span-2 xl:col-span-1">
          <div className="mb-2 flex items-center gap-2 text-xs text-[#8FD9BA]">
            <TrendingUp size={14} />
            <span>今日筛选结论</span>
          </div>
          <p className="text-lg font-semibold leading-snug text-[#fff8ea]">{conclusion}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/42">
            <span>基金池 {fundUniverseTotal || funds.length} 只</span>
            <span>可决策 {decisionFunds.length} 只</span>
            <span>最新净值日 {latestDate || '缺失'}</span>
          </div>
        </div>
        {[
          ['真实覆盖', `${Math.round(reliableRatio * 100)}%`, `${decisionFunds.length}/${funds.length || 0} 可用`],
          ['近一年均值', signedPct(avgReturn), '按可决策基金'],
          ['夏普均值', decimalText(avgSharpe), '风险收益'],
          ['回撤均值', plainPct(avgDrawdown), '越低越稳'],
        ].map(([label, value, hint]) => (
          <div key={label} className="workspace-panel p-4">
            <div className="text-xs text-white/38">{label}</div>
            <div className="data-number mt-1 text-xl font-semibold text-[#fff8ea]">{value}</div>
            <div className="mt-2 text-xs text-white/34">{hint}</div>
          </div>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Panel
            title="基金市场"
            action={
              <div className="flex items-center gap-2 text-xs text-white/42">
                <SlidersHorizontal size={14} />
                <span>{sortOptions.find((item) => item.key === sortMode)?.label}优先</span>
              </div>
            }
          >
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
              {availableTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setFundFilter(tab.key)}
                  className={classNames(
                    'rounded-full px-3 py-1 transition',
                    fundFilter === tab.key ? 'workspace-pill' : 'workspace-pill-muted hover:text-white',
                  )}
                >
                  {tab.label}
                </button>
              ))}
              <div className="ml-auto flex flex-wrap items-center gap-1">
                {sortOptions.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setSortMode(option.key)}
                    className={classNames(
                      'rounded px-2.5 py-1 transition',
                      sortMode === option.key ? 'workspace-action-active' : 'workspace-action',
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="border-y border-white/[0.07] text-xs text-white/38">
                  <tr>
                    <th className="py-2 pr-3 font-medium">基金</th>
                    <th className="px-3 py-2 font-medium">类型</th>
                    <th className="px-3 py-2 text-right font-medium">近一年</th>
                    <th className="px-3 py-2 text-right font-medium">夏普</th>
                    <th className="px-3 py-2 text-right font-medium">最大回撤</th>
                    <th className="px-3 py-2 text-right font-medium">费率</th>
                    <th className="px-3 py-2 font-medium">净值日</th>
                    <th className="px-3 py-2 font-medium">状态</th>
                    <th className="py-2 pl-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.055]">
                  {filteredFunds.slice(0, 10).map((fund) => {
                    const code = fundCode(fund)
                    const status = dataStatusText(fund)
                    const fee = feeSummary(fund)
                    const yearlyReturn = returnMetric(fund)
                    return (
                      <tr key={code || fundName(fund)} className="transition hover:bg-white/[0.025]">
                        <td className="py-3 pr-3">
                          <Link to={code ? `/${code}` : '/analysis'} className="block min-w-0">
                            <div className="max-w-[260px] truncate font-semibold text-[#fff8ea]">{fundName(fund)}</div>
                            <div className="mt-0.5 flex items-center gap-2 text-xs text-white/36">
                              {!fund.nameAvailable && <span className="text-[#f0c58b]">名称缺失</span>}
                              <span className="truncate">{fundSubline(fund)}</span>
                            </div>
                          </Link>
                        </td>
                        <td className="px-3 py-3">
                          <span className="workspace-pill-muted rounded px-2 py-0.5 text-xs">{typeLabel(fund)}</span>
                        </td>
                        <td className={classNames('data-number px-3 py-3 text-right font-semibold', signedToneClass(yearlyReturn))}>
                          {signedPct(yearlyReturn)}
                        </td>
                        <td className="data-number px-3 py-3 text-right text-[#fff8ea]">{decimalText(sharpeMetric(fund))}</td>
                        <td className="data-number px-3 py-3 text-right text-white/72">{plainPct(drawdownMetric(fund))}</td>
                        <td className="data-number px-3 py-3 text-right text-white/72">{fee.text}</td>
                        <td className="px-3 py-3 text-xs text-white/50">{fund.navDate || '缺失'}</td>
                        <td className="px-3 py-3">
                          <span
                            className={classNames(
                              'rounded px-2 py-0.5 text-xs',
                              status.tone === 'ok' && 'border border-[#59c993]/25 bg-[#59c993]/10 text-[#8FD9BA]',
                              status.tone === 'warn' && 'border border-[#d4a15e]/25 bg-[#d4a15e]/10 text-[#f0c58b]',
                              status.tone === 'bad' && 'border border-red-400/25 bg-red-400/10 text-red-200',
                            )}
                          >
                            {status.text}
                          </span>
                        </td>
                        <td className="py-3 pl-3 text-right">
                          <Link to={code ? `/${code}` : '/analysis'} className="workspace-action inline-flex items-center gap-1 px-2.5 py-1 text-xs">
                            详情 <ChevronRight size={12} />
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {filteredFunds.length === 0 && (
              <div className="mt-3 rounded border border-white/[0.075] bg-white/[0.025] p-4 text-sm text-white/40">
                当前条件下没有可展示基金，清除搜索或切换类型后再试。
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.07] pt-3 text-xs text-white/42">
              <span>规则：仅把有净值日、净值、真实/非种子指标的基金纳入可决策样本。</span>
              <span>{filteredFunds.length > 10 ? `已显示前 10 / ${filteredFunds.length} 只` : `当前 ${filteredFunds.length} 只`}</span>
            </div>
          </Panel>

          <Panel
            title="分类型优选横榜"
            action={<span className="text-xs text-white/36">每类优先看夏普，收益冠军作复核</span>}
          >
            {typeWinners.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {typeWinners.map((item) => {
                  const primary = item.primary
                  const code = fundCode(primary)
                  const returnChampion = item.topReturn && fundCode(item.topReturn) !== code ? item.topReturn : null
                  return (
                    <Link
                      key={item.key}
                      to={code ? `/${code}` : '/analysis'}
                      className="block rounded-lg border border-white/[0.075] bg-white/[0.03] p-3 transition hover:border-primary/40 hover:bg-white/[0.05]"
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="workspace-pill px-2 py-0.5 text-xs">{item.label}</span>
                        <span className="text-xs text-white/34">{item.count} 只可比</span>
                      </div>
                      <div className="truncate text-sm font-semibold text-[#fff8ea]">{fundName(primary)}</div>
                      <div className="mt-0.5 text-xs text-white/36">{fundSubline(primary)}</div>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <div className="text-white/32">近一年</div>
                          <div className={classNames('data-number font-semibold', signedToneClass(returnMetric(primary)))}>{signedPct(returnMetric(primary))}</div>
                        </div>
                        <div>
                          <div className="text-white/32">夏普</div>
                          <div className="data-number font-semibold text-[#fff8ea]">{decimalText(sharpeMetric(primary))}</div>
                        </div>
                        <div>
                          <div className="text-white/32">费率</div>
                          <div className="data-number font-semibold text-white/72">{feeSummary(primary).text}</div>
                        </div>
                      </div>
                      {returnChampion && (
                        <div className="mt-2 rounded border border-white/[0.055] bg-white/[0.025] px-2 py-1 text-xs text-white/44">
                          收益冠军：{fundName(returnChampion)} {signedPct(returnMetric(returnChampion))}
                        </div>
                      )}
                    </Link>
                  )
                })}
              </div>
            ) : (
              <div className="rounded border border-white/[0.075] bg-white/[0.025] p-4 text-sm text-white/40">
                当前基金池缺少可决策指标，暂不能生成分类型横榜。
              </div>
            )}
          </Panel>
        </div>

        <aside className="space-y-4">
          <Panel
            title="组合 / 自选摘要"
            action={<Link to="/analysis" className="text-xs text-[#8FD9BA] hover:text-white">打开分析</Link>}
          >
            {portfolioFunds && portfolioFunds.length > 0 ? (
              <div className="space-y-3">
                <div className="rounded border border-white/[0.065] bg-white/[0.025] p-3">
                  <div className="text-xs text-white/38">
                    {mode === 'savedRecommendation' ? '最近生成方案' : '自选基金池'}
                  </div>
                  <div className="mt-1 font-semibold text-[#fff8ea]">{portfolioName || `${portfolioFunds.length} 只基金`}</div>
                  <div className="mt-1 text-xs text-white/36">
                    {portfolioCreatedAt ? `生成于 ${formatDateTime(portfolioCreatedAt)}` : hasPortfolioWeights ? '含真实权重' : '未设置真实权重'}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded border border-white/[0.055] bg-white/[0.025] p-2">
                    <div className="text-white/32">数量</div>
                    <div className="data-number text-base font-semibold text-[#fff8ea]">{portfolioFunds.length}</div>
                  </div>
                  <div className="rounded border border-white/[0.055] bg-white/[0.025] p-2">
                    <div className="text-white/32">收益均值</div>
                    <div className={classNames('data-number text-base font-semibold', signedToneClass(portfolioAvgReturn))}>{signedPct(portfolioAvgReturn)}</div>
                  </div>
                  <div className="rounded border border-white/[0.055] bg-white/[0.025] p-2">
                    <div className="text-white/32">夏普均值</div>
                    <div className="data-number text-base font-semibold text-[#fff8ea]">{decimalText(portfolioAvgSharpe)}</div>
                  </div>
                </div>
                <div className="space-y-2">
                  {portfolioWeighted.slice(0, 4).map(({ fund, weight, weightSource }) => (
                    <Link key={fundCode(fund) || fundName(fund)} to={fundCode(fund) ? `/${fundCode(fund)}` : '/analysis'} className="workspace-action flex items-center justify-between gap-3 px-3 py-2 text-xs">
                      <span className="min-w-0 truncate">{fundName(fund)}</span>
                      <span className="data-number shrink-0 text-white/50">{weightSource === 'real' ? `${weight.toFixed(1)}%` : scaleText(fund)}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-sm text-white/42">
                <div className="rounded border border-white/[0.065] bg-white/[0.025] p-3">
                  {mode === 'userEmptyFallback'
                    ? '当前账号暂无自选基金。首页先展示市场候选池，生成配置后这里会显示组合摘要。'
                    : mode === 'candidatePool'
                      ? '未登录状态下只展示市场候选池，不生成个人组合摘要。'
                      : '暂无组合或自选数据。'}
                </div>
                <Link to="/recommend" className="workspace-action flex items-center justify-between px-3 py-2 text-sm">
                  <span>生成推荐方案</span>
                  <ChevronRight size={14} />
                </Link>
              </div>
            )}
          </Panel>

          <Panel
            title="市场压力"
            action={<span className="text-xs text-white/36">{healthLabel(marketStatus?.health)}</span>}
          >
            <div className="workspace-warning mb-3 rounded px-3 py-3 text-sm leading-relaxed">
              {pressureText}
            </div>
            <div className="divide-y divide-white/[0.055] text-sm">
              <div className="flex items-center justify-between py-2">
                <span className="text-white/45">市场数据</span>
                <span className={classNames('font-medium', marketStatus?.health === 'healthy' ? 'text-[#8FD9BA]' : 'text-[#f0c58b]')}>
                  {healthLabel(marketStatus?.health)}
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-white/45">宏观置信度</span>
                <span className="data-number text-[#fff8ea]">{macroConfidenceText(marketStatus)}</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-white/45">波动率比值</span>
                <span className={classNames('data-number', volRatio !== null && volRatio >= 1.2 ? 'text-danger' : 'text-[#8FD9BA]')}>
                  {volRatio === null ? '缺失' : volRatio.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-white/45">行业热度</span>
                <span className="text-right text-[#fff8ea]">
                  {marketIndustries[0] ? `${marketIndustries[0].name} ${industrySignalText(marketIndustries[0])}` : '暂不可用'}
                </span>
              </div>
            </div>
          </Panel>

          <Panel title="市场指数">
            {marketIndices.length > 0 ? (
              <div className="space-y-2">
                {marketIndices.slice(0, 3).map((item) => (
                  <div key={item.code || item.name} className="flex items-center justify-between gap-3 rounded border border-white/[0.055] bg-white/[0.025] px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-[#fff8ea]">{item.name}</div>
                      <div className="text-xs text-white/34">{item.code}</div>
                    </div>
                    <div className="text-right">
                      <div className="data-number text-sm text-white/74">{formatIndexValue(item.close)}</div>
                      <div className={classNames('data-number text-xs font-semibold', signedToneClass(item.change))}>
                        {signedPct(item.change)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded border border-white/[0.075] bg-white/[0.025] p-3 text-sm text-white/40">
                {marketLoading ? '正在加载指数数据...' : marketError || '指数数据暂不可用'}
              </div>
            )}
          </Panel>

          <Panel title="下一步">
            <div className="space-y-2">
              <Link to="/analysis" className="workspace-action flex items-center justify-between px-3 py-2 text-sm">
                <span className="flex items-center gap-2"><BarChart3 size={14} /> 打开专业分析对比</span>
                <ChevronRight size={14} />
              </Link>
              <Link to="/recommend" className="workspace-action flex items-center justify-between px-3 py-2 text-sm">
                <span className="flex items-center gap-2"><ShieldCheck size={14} /> 生成配置方案</span>
                <ChevronRight size={14} />
              </Link>
              {topFund && fundCode(topFund) && (
                <Link to={`/${fundCode(topFund)}`} className="workspace-action flex items-center justify-between px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">复核 {fundName(topFund)}</span>
                  <ChevronRight size={14} />
                </Link>
              )}
            </div>
          </Panel>
        </aside>
      </section>
    </section>
  )
}

export type { FundLike, DashboardMode, MarketOverviewPayload }
