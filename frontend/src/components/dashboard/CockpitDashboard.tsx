import { Bell, ChevronRight, Gauge, Search, UserCircle } from 'lucide-react'

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

function Sparkline({ warm = false }: { warm?: boolean }) {
  const stroke = warm ? '#c86f44' : '#59c993'
  return (
    <svg viewBox="0 0 120 42" className="h-12 w-full overflow-visible">
      <path d="M2 30 L12 23 L22 26 L32 16 L43 21 L54 12 L66 18 L78 9 L90 13 L102 7 L118 11" fill="none" stroke={stroke} strokeWidth="2" />
      <path d="M2 33 L12 26 L22 29 L32 19 L43 24 L54 15 L66 21 L78 12 L90 16 L102 10 L118 14" fill="none" stroke={stroke} strokeOpacity=".22" strokeWidth="5" />
    </svg>
  )
}

function Panel({ title, children, action, className }: { title: string; children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <section className={classNames('rounded-sm border border-[#2a2f2b] bg-[#0c0f0d]/90 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]', className)}>
      <div className="mb-4 flex items-center justify-between border-b border-white/[0.07] pb-3">
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

export function CockpitDashboard({
  funds,
  mode,
  userName,
  loading,
  error,
}: {
  funds: FundLike[]
  mode: DashboardMode
  userName?: string | null
  loading?: boolean
  error?: string | null
}) {
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
  const sourceLabel = mode === 'user'
    ? '登录用户组合'
    : mode === 'userEmptyFallback'
      ? '用户暂无自选，暂展示最优夏普组合'
      : '未登录：最优夏普组合'
  const topFunds = weighted.slice(0, 8)
  const cards = weighted.slice(0, 4)

  return (
    <section className="relative overflow-hidden rounded-md border border-[#2a2f2b] bg-[#050706] p-3 text-[#f4efe3] shadow-2xl shadow-black/50">
      <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,.16)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.16)_1px,transparent_1px)] [background-size:32px_32px]" />
      <div className="relative min-h-[780px]">
        <header className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] pb-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="text-2xl font-bold tracking-tight text-[#58c792]">资产驾驶舱</h2>
            <div className="rounded-full border border-[#58c792]/25 bg-[#58c792]/10 px-3 py-1 text-xs text-[#8de0b5]">{sourceLabel}</div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-[#bcb5aa]">
            <div className="flex h-8 min-w-[260px] items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-3">
              <Search size={14} />
              <span>搜索基金 / 代码 / 经理 / 公司</span>
            </div>
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

        <Panel title="市场全景" action={<span className="text-xs text-[#c8bba9]">组合数据截至 {latestDate}</span>}>
          <div className="grid gap-4 xl:grid-cols-[1fr_1fr_1fr_170px_150px]">
            {[
              ['组合平均日涨跌', signedPct(avgDay), '当前组合'],
              ['组合近一年收益', signedPct(avgYear), `${funds.length} 只基金`],
              ['组合平均夏普', avgSharpe === null ? '—' : avgSharpe.toFixed(2), '风险收益'],
            ].map(([name, value, change], index) => (
              <div key={name} className="min-h-[120px] border-r border-white/[0.08] pr-4">
                <div className="flex items-baseline gap-3">
                  <span className="font-semibold text-[#f2eadc]">{name}</span>
                  <span className="text-sm font-semibold text-[#58c792]">{value}</span>
                  <span className="text-xs text-[#b9b1a4]">{change}</span>
                </div>
                <Sparkline warm={index === 1 && (avgYear || 0) < 0} />
                <div className="flex justify-between text-[10px] text-[#9f988f]"><span>持仓</span><span>指标</span><span>更新</span></div>
              </div>
            ))}
            <div className="space-y-3 border-r border-white/[0.08] pr-4 text-xs">
              <div className="font-semibold text-[#f2eadc]">组合状态</div>
              {[
                ['基金数量', `${funds.length}`, '#58c792'],
                ['权益/指数占比', `${assetMix.filter((item) => ['equity', 'index', 'etf'].includes(item.key)).reduce((sum, item) => sum + item.value, 0).toFixed(2)}%`, '#d9815d'],
                ['平均回撤', plainPct(avgDrawdown), '#81b1d9'],
                ['数据来源', mode === 'user' ? '用户自选' : '基金池排序', '#d7d2c6'],
              ].map(([label, value, color]) => (
                <div key={label} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-[#bbb4a9]"><i className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />{label}</span>
                  <span className="text-[#f4efe3]">{value}</span>
                </div>
              ))}
            </div>
            <div>
              <div className="mb-3 text-xs font-semibold text-[#f2eadc]">组合评分</div>
              <div className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-[conic-gradient(from_210deg,#58c792_0_var(--score),#b68a5f_var(--score)_78%,rgba(255,255,255,.08)_78%_100%)] p-2" style={{ ['--score' as string]: `${riskScore}%` }}>
                <div className="grid h-full w-full place-items-center rounded-full bg-[#0c0f0d] text-center">
                  <div>
                    <div className="text-2xl font-bold text-[#e8c184]">{riskScore}</div>
                    <div className="text-[10px] text-[#d6c9b7]">{riskScore >= 70 ? '稳健优秀' : riskScore >= 50 ? '中性偏稳' : '需降波动'}</div>
                  </div>
                </div>
              </div>
              <div className="mt-2 flex justify-between text-[10px] text-[#9f988f]"><span>0</span><span>100</span></div>
            </div>
          </div>
        </Panel>

        <Panel title="我的组合" action={<div className="flex gap-2"><button className="rounded-full border border-white/15 px-3 py-1 text-xs">组合诊断</button><button className="rounded-full border border-white/15 px-3 py-1 text-xs">组合对比</button></div>} className="mt-3">
          <div className="grid grid-cols-2 gap-3 border-b border-white/[0.08] pb-4 md:grid-cols-6">
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
                <div className={classNames('mt-1 text-2xl font-semibold', color)}>{value}</div>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr_1.5fr]">
            <div>
              <div className="mb-3 text-sm font-semibold">资产配置</div>
              <div className="grid grid-cols-[132px_1fr] items-center gap-4">
                <div className="grid h-28 w-28 place-items-center rounded-full p-5" style={{ background: `conic-gradient(${assetMix.map((item, index) => `${item.color} ${assetMix.slice(0, index).reduce((sum, x) => sum + x.value, 0)}% ${assetMix.slice(0, index + 1).reduce((sum, x) => sum + x.value, 0)}%`).join(',') || '#716c65 0 100%'})` }}>
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
              <div className="mb-3 text-sm font-semibold">风格分布（按基金类型）</div>
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
              <div className="mb-3 text-sm font-semibold">基金类型热力分布</div>
              <div className="grid h-[150px] grid-cols-4 grid-rows-2 overflow-hidden rounded-sm border border-white/[0.06] text-xs">
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

        <Panel title={mode === 'user' ? '用户组合持仓' : '优选基金'} action={<div className="flex flex-wrap gap-4 text-xs text-white/62"><span className="rounded bg-white/10 px-2 py-1 text-white">按夏普</span><span>真实指标</span><span>最新净值</span><span>更多</span></div>} className="mt-3">
          <div className="grid gap-3 lg:grid-cols-4">
            {cards.map(({ fund, weight }) => {
              const returnRate = parseMetric(fund.performance?.return1y ?? fund.performance?.annualizedReturn)
              return (
                <div key={fund.fundCode || fundName(fund)} className="rounded-sm border border-white/[0.08] bg-white/[0.035] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold text-[#f7f1e7]">{fundName(fund)}</div>
                      <div className="mt-1 text-xs text-[#a9a197]">{managerName(fund)}</div>
                    </div>
                    <span className="rounded border border-[#d1a66c]/45 px-2 py-0.5 text-[10px] text-[#e1b879]">{typeLabel(fund)}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-[1fr_90px] items-end gap-3">
                    <div>
                      <div className={classNames('text-2xl font-bold', (returnRate || 0) >= 0 ? 'text-[#e37757]' : 'text-[#58c792]')}>{signedPct(returnRate)}</div>
                      <div className="text-xs text-[#aaa198]">近一年/年化</div>
                    </div>
                    <Sparkline warm={(returnRate || 0) >= 0} />
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className="rounded bg-[#d2a66a]/12 px-2 py-1 text-[#ddb878]">权重 {weight.toFixed(2)}%</span>
                    <span className="text-[#f1eadf]">{metricText(fund.nav, 4)}<span className="ml-1 text-[#9f988f]">最新净值</span></span>
                  </div>
                </div>
              )
            })}
          </div>
        </Panel>

        <div className="mt-3 grid gap-3 xl:grid-cols-[1.2fr_.8fr_1fr]">
          <Panel title="持仓明细">
            <div className="grid grid-cols-[58px_1fr_70px_72px_70px] gap-2 text-xs text-[#d8cec0]">
              <span className="text-[#58c792]">代码</span><span>基金名称</span><span>权重</span><span>夏普</span><span>回撤</span>
              {topFunds.map(({ fund, weight }) => (
                <div key={fund.fundCode || fundName(fund)} className="contents">
                  <span className="py-1">{fund.fundCode || '—'}</span>
                  <span className="truncate py-1">{fundName(fund)}</span>
                  <span className="py-1 text-[#e8c184]">{weight.toFixed(2)}%</span>
                  <span className="py-1">{metricText(fund.performance?.sharpeRatio)}</span>
                  <span className="py-1 text-[#58c792]">{plainPct(parseMetric(fund.performance?.maxDrawdown))}</span>
                </div>
              ))}
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
              <div className="grid h-24 w-24 place-items-center rounded-full bg-[conic-gradient(from_210deg,#d4a15e_0_58%,#58c792_58%_78%,rgba(255,255,255,.08)_78%_100%)] p-3">
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
              <button className="mt-2 flex items-center gap-1 text-xs font-semibold text-[#58c792]">查看全部建议 <ChevronRight size={14} /></button>
            </div>
          </Panel>
        </div>
      </div>
    </section>
  )
}

export type { FundLike, DashboardMode }
