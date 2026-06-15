import { useMemo, useState } from 'react'
import {
  Activity,
  BarChart3,
  Bell,
  BriefcaseBusiness,
  CandlestickChart,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Gauge,
  Layers3,
  LineChart,
  PieChart,
  Radar,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  TrendingUp,
} from 'lucide-react'

type PreviewMode = 'terminal' | 'cockpit'

type FundRow = {
  code: string
  name: string
  tag: string
  score: number
  drawdown: string
  returnRate: string
}

const funds: FundRow[] = [
  { code: '161129', name: '原油主题精选', tag: 'QDII海外', score: 91, drawdown: '18.4%', returnRate: '+12.8%' },
  { code: '513180', name: '恒生科技ETF', tag: '港股通', score: 88, drawdown: '22.1%', returnRate: '+9.6%' },
  { code: '518880', name: '黄金ETF', tag: '黄金ETF', score: 86, drawdown: '10.7%', returnRate: '+7.2%' },
  { code: '110011', name: '稳健均衡混合', tag: '平衡型', score: 82, drawdown: '13.5%', returnRate: '+6.1%' },
]

const allocation = [
  { label: 'QDII海外', value: 32, color: '#58d68d' },
  { label: '港股通', value: 26, color: '#d7a84f' },
  { label: '黄金ETF', value: 18, color: '#f2d06b' },
  { label: '固收增强', value: 24, color: '#73a7ff' },
]

const signals = [
  ['风险预算', '24%', '已锁定最大回撤'],
  ['投资期限', '1-5年', '中期配置节奏'],
  ['目标画像', '35岁', '财富增值优先'],
]

function classNames(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(' ')
}

function MiniTrend({ warm = false }: { warm?: boolean }) {
  const bars = warm ? [42, 50, 44, 63, 58, 76, 71, 86] : [64, 54, 68, 72, 61, 78, 84, 91]
  return (
    <div className="flex h-20 items-end gap-2">
      {bars.map((height, index) => (
        <div
          key={`${height}-${index}`}
          className={classNames(
            'w-full rounded-t-[3px] transition-all duration-300',
            warm ? 'bg-[#d9a44f]/80' : 'bg-[#58d68d]/75'
          )}
          style={{ height: `${height}%` }}
        />
      ))}
    </div>
  )
}

function AllocationStrip() {
  return (
    <div className="space-y-3">
      {allocation.map((item) => (
        <div key={item.label} className="grid grid-cols-[74px_1fr_44px] items-center gap-3 text-xs">
          <span className="text-white/64">{item.label}</span>
          <div className="h-2 overflow-hidden rounded-full bg-white/8">
            <div className="h-full rounded-full" style={{ width: `${item.value}%`, background: item.color }} />
          </div>
          <span className="data-number text-right text-white/82">{item.value}%</span>
        </div>
      ))}
    </div>
  )
}

function TerminalPreview() {
  return (
    <section className="relative overflow-hidden rounded-md border border-[#2b312f] bg-[#080a09] text-[#f4f1e8] shadow-2xl shadow-black/40">
      <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,.18)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.18)_1px,transparent_1px)] [background-size:28px_28px]" />
      <div className="relative grid min-h-[660px] grid-cols-1 lg:grid-cols-[188px_1fr_320px]">
        <aside className="border-b border-[#2b312f] bg-[#0d100e]/92 p-4 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded bg-[#d7a84f] text-[#070806]">
              <CandlestickChart size={18} />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-[0.14em]">FUNDTRADER</div>
              <div className="text-[10px] text-[#9aa49a]">投研终端</div>
            </div>
          </div>
          <div className="mt-8 space-y-1 text-sm">
            {[
              ['市场扫描', Activity],
              ['资产配置', PieChart],
              ['基金池', BriefcaseBusiness],
              ['风险控制', ShieldCheck],
              ['执行计划', Target],
            ].map(([label, Icon], index) => (
              <button
                key={String(label)}
                className={classNames(
                  'flex h-10 w-full items-center gap-2 rounded px-3 text-left transition',
                  index === 1 ? 'bg-[#d7a84f]/14 text-[#f1d28b]' : 'text-[#98a29b] hover:bg-white/5 hover:text-white'
                )}
              >
                <Icon size={15} />
                <span>{String(label)}</span>
              </button>
            ))}
          </div>
          <div className="mt-8 border-t border-[#2b312f] pt-5">
            <div className="text-[11px] text-[#7d887f]">策略状态</div>
            <div className="mt-3 flex items-center gap-2 text-sm text-[#58d68d]">
              <span className="h-2 w-2 rounded-full bg-[#58d68d]" />
              模型已同步
            </div>
          </div>
        </aside>

        <main className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 border-b border-[#2b312f] pb-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-[#fffaf0]">平衡型组合工作台</h2>
              <p className="mt-1 text-sm text-[#9aa49a]">500,000元 / 中期 1-5年 / 最大回撤 24%</p>
            </div>
            <div className="flex items-center gap-2">
              <button className="grid h-9 w-9 place-items-center rounded border border-[#2b312f] text-[#9aa49a] hover:text-white" title="筛选">
                <SlidersHorizontal size={16} />
              </button>
              <button className="grid h-9 w-9 place-items-center rounded border border-[#2b312f] text-[#9aa49a] hover:text-white" title="提醒">
                <Bell size={16} />
              </button>
              <button className="h-9 rounded bg-[#d7a84f] px-4 text-sm font-semibold text-[#080a09]">生成配置</button>
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {signals.map(([label, value, desc]) => (
              <div key={label} className="rounded border border-[#2b312f] bg-[#101410]/82 p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-[#858f86]">{label}</div>
                <div className="mt-3 data-number text-2xl font-semibold text-[#f4f1e8]">{value}</div>
                <div className="mt-1 text-xs text-[#8e978e]">{desc}</div>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
            <div className="rounded border border-[#2b312f] bg-[#101410]/82 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-[#fffaf0]">市场热度矩阵</h3>
                  <p className="text-xs text-[#89938a]">按偏好资产做实时排序</p>
                </div>
                <LineChart size={17} className="text-[#58d68d]" />
              </div>
              <div className="mt-5">
                <MiniTrend />
              </div>
              <div className="mt-4 grid grid-cols-4 gap-2 text-center text-[11px] text-[#8d978f]">
                {['QDII', '港股', '黄金', '固收'].map((item) => (
                  <div key={item} className="border-t border-[#2b312f] pt-2">{item}</div>
                ))}
              </div>
            </div>

            <div className="rounded border border-[#2b312f] bg-[#101410]/82 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[#fffaf0]">资产权重</h3>
                <span className="text-xs text-[#f1d28b]">建议版</span>
              </div>
              <div className="mt-6">
                <AllocationStrip />
              </div>
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded border border-[#2b312f] bg-[#101410]/82">
            <div className="grid grid-cols-[72px_1fr_88px_64px_76px] gap-3 border-b border-[#2b312f] px-4 py-3 text-xs text-[#8b958c]">
              <span>代码</span>
              <span>基金名称</span>
              <span>资产标签</span>
              <span>评分</span>
              <span>年化</span>
            </div>
            {funds.map((fund) => (
              <div key={fund.code} className="grid grid-cols-[72px_1fr_88px_64px_76px] gap-3 border-b border-[#2b312f]/70 px-4 py-3 text-sm last:border-b-0">
                <span className="data-number text-[#d7a84f]">{fund.code}</span>
                <span className="min-w-0 truncate text-[#f5f1e8]">{fund.name}</span>
                <span className="text-[#9aa49a]">{fund.tag}</span>
                <span className="data-number text-[#58d68d]">{fund.score}</span>
                <span className="data-number text-[#58d68d]">{fund.returnRate}</span>
              </div>
            ))}
          </div>
        </main>

        <aside className="border-t border-[#2b312f] bg-[#0d100e]/92 p-4 lg:border-l lg:border-t-0">
          <div className="rounded border border-[#2b312f] bg-[#101410] p-4">
            <div className="flex items-center gap-2 text-[#f1d28b]">
              <Gauge size={17} />
              <h3 className="text-sm font-semibold">风险闸门</h3>
            </div>
            <div className="mt-5 grid place-items-center">
              <div className="relative grid h-36 w-36 place-items-center rounded-full border border-[#d7a84f]/30 bg-[#d7a84f]/8">
                <div className="absolute inset-3 rounded-full border border-[#58d68d]/30" />
                <div className="text-center">
                  <div className="data-number text-3xl font-semibold text-[#f4f1e8]">24%</div>
                  <div className="text-xs text-[#8d978f]">回撤上限</div>
                </div>
              </div>
            </div>
            <div className="mt-5 space-y-3 text-xs text-[#a6afa7]">
              <div className="flex justify-between"><span>压力测试</span><span className="text-[#58d68d]">通过</span></div>
              <div className="flex justify-between"><span>集中度</span><span className="text-[#f1d28b]">适中</span></div>
              <div className="flex justify-between"><span>再平衡</span><span>月度</span></div>
            </div>
          </div>

          <div className="mt-4 rounded border border-[#2b312f] bg-[#101410] p-4">
            <h3 className="text-sm font-semibold text-[#fffaf0]">执行提示</h3>
            <div className="mt-4 space-y-3 text-sm">
              {['黄金ETF作为波动缓冲', '港股通分批建仓', 'QDII仓位保留5%机动'].map((item) => (
                <div key={item} className="flex items-start gap-2 text-[#a6afa7]">
                  <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-[#58d68d]" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </section>
  )
}

function CockpitPreview() {
  return (
    <section className="relative overflow-hidden rounded-md border border-[#2b3834] bg-[#050706] text-[#fff7e9] shadow-2xl shadow-black/40">
      <div className="absolute inset-x-0 top-0 h-64 bg-[radial-gradient(circle_at_25%_0%,rgba(69,176,132,.28),transparent_42%),radial-gradient(circle_at_78%_10%,rgba(185,113,61,.22),transparent_36%)]" />
      <div className="relative min-h-[660px] p-4 sm:p-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-sm bg-[#45b084] text-[#03100b]">
              <Layers3 size={19} />
            </div>
            <div>
              <div className="text-lg font-semibold">FundTrader 资产驾驶舱</div>
              <div className="text-xs text-[#b9b0a3]">面向客户沟通与投顾决策</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex h-10 min-w-0 items-center gap-2 rounded-sm border border-white/10 bg-white/[0.04] px-3 text-sm text-[#cfc5b7]">
              <Search size={15} />
              <span className="hidden sm:inline">搜索基金 / 策略 / 标签</span>
            </div>
            <button className="h-10 rounded-sm bg-[#45b084] px-4 text-sm font-semibold text-[#03100b]">新建方案</button>
          </div>
        </header>

        <div className="mt-8 grid gap-5 xl:grid-cols-[1fr_360px]">
          <div>
            <div className="grid gap-5 md:grid-cols-[1.2fr_.8fr]">
              <div className="rounded-sm border border-white/10 bg-[#101411]/82 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-3xl font-semibold leading-tight text-[#fff7e9]">财富增值组合</h2>
                    <p className="mt-2 max-w-xl text-sm leading-6 text-[#b9b0a3]">
                      平衡型风险画像，优先覆盖 QDII海外、港股通、黄金ETF，并控制组合最大回撤。
                    </p>
                  </div>
                  <div className="rounded-sm border border-[#45b084]/30 bg-[#45b084]/10 px-3 py-2 text-right">
                    <div className="text-[11px] text-[#9ed7bd]">组合评分</div>
                    <div className="data-number text-2xl font-semibold text-[#45b084]">89</div>
                  </div>
                </div>
                <div className="mt-8 grid gap-3 sm:grid-cols-3">
                  {[
                    ['投资金额', '500,000元', CircleDollarSign],
                    ['期限', '中期', Target],
                    ['风险偏好', '平衡型', Radar],
                  ].map(([label, value, Icon]) => (
                    <div key={String(label)} className="border-l border-[#45b084]/40 pl-3">
                      <div className="flex items-center gap-2 text-xs text-[#a9b1aa]">
                        <Icon size={14} />
                        {String(label)}
                      </div>
                      <div className="mt-2 text-lg font-semibold text-[#fff7e9]">{String(value)}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-sm border border-white/10 bg-[#101411]/82 p-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">市场状态</h3>
                  <TrendingUp size={17} className="text-[#45b084]" />
                </div>
                <div className="mt-6">
                  <MiniTrend warm />
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-sm bg-white/[0.04] p-3">
                    <div className="text-xs text-[#b9b0a3]">海外资产</div>
                    <div className="data-number mt-1 text-[#45b084]">+1.42%</div>
                  </div>
                  <div className="rounded-sm bg-white/[0.04] p-3">
                    <div className="text-xs text-[#b9b0a3]">黄金避险</div>
                    <div className="data-number mt-1 text-[#d69d63]">+0.68%</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-[.9fr_1.1fr]">
              <div className="rounded-sm border border-white/10 bg-[#101411]/82 p-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">建议资产结构</h3>
                  <PieChart size={17} className="text-[#d69d63]" />
                </div>
                <div className="mt-6">
                  <AllocationStrip />
                </div>
                <button className="mt-6 flex h-10 w-full items-center justify-center gap-2 rounded-sm border border-[#45b084]/35 text-sm text-[#9ed7bd] hover:bg-[#45b084]/10">
                  查看调仓路径
                  <ChevronRight size={15} />
                </button>
              </div>

              <div className="rounded-sm border border-white/10 bg-[#101411]/82 p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">优选基金清单</h3>
                  <BarChart3 size={17} className="text-[#45b084]" />
                </div>
                <div className="space-y-3">
                  {funds.slice(0, 3).map((fund, index) => (
                    <div key={fund.code} className="grid grid-cols-[32px_1fr_70px] items-center gap-3 rounded-sm bg-white/[0.04] p-3">
                      <div className="grid h-8 w-8 place-items-center rounded-sm bg-[#45b084]/12 data-number text-sm text-[#9ed7bd]">{index + 1}</div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{fund.name}</div>
                        <div className="mt-1 text-xs text-[#aaa196]">{fund.code} / {fund.tag} / 回撤 {fund.drawdown}</div>
                      </div>
                      <div className="data-number text-right text-[#45b084]">{fund.returnRate}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <aside className="space-y-5">
            <div className="rounded-sm border border-[#d69d63]/25 bg-[#15110c]/88 p-5">
              <div className="flex items-center gap-2 text-[#d69d63]">
                <Sparkles size={17} />
                <h3 className="text-sm font-semibold">投顾叙事</h3>
              </div>
              <p className="mt-4 text-sm leading-7 text-[#d8cec0]">
                当前方案用黄金ETF降低尾部风险，用港股通提升中期弹性，用QDII海外分散单一市场波动。
              </p>
              <div className="mt-5 space-y-3 text-sm text-[#c9beb1]">
                {['先建核心仓位 70%', '第2个月完成弹性仓', '触及18%回撤开始降风险'].map((item) => (
                  <div key={item} className="flex items-center justify-between border-b border-white/8 pb-3 last:border-b-0 last:pb-0">
                    <span>{item}</span>
                    <CheckCircle2 size={15} className="text-[#45b084]" />
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-sm border border-white/10 bg-[#101411]/82 p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">风险可解释</h3>
                <ShieldCheck size={17} className="text-[#45b084]" />
              </div>
              <div className="mt-5 space-y-4">
                {[
                  ['预估波动', '12.6%'],
                  ['最大回撤', '24.0%'],
                  ['再平衡阈值', '5.0%'],
                ].map(([label, value]) => (
                  <div key={label}>
                    <div className="mb-2 flex justify-between text-xs text-[#b9b0a3]">
                      <span>{label}</span>
                      <span className="data-number text-[#fff7e9]">{value}</span>
                    </div>
                    <div className="h-2 rounded-full bg-white/8">
                      <div className="h-full rounded-full bg-[#45b084]" style={{ width: label === '最大回撤' ? '78%' : '56%' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </section>
  )
}

export default function DesignPreview() {
  const [mode, setMode] = useState<PreviewMode>('terminal')
  const meta = useMemo(
    () => ({
      terminal: {
        title: '方案A：投研终端',
        desc: '偏数据密度、稳定感和专业工作流，适合基金筛选、回测、配置结果等高频页面统一改造。',
      },
      cockpit: {
        title: '方案B：资产驾驶舱',
        desc: '偏客户沟通和决策展示，强调方案解释、风险叙事和组合状态，适合配置向导与结果页升级。',
      },
    }),
    []
  )

  return (
    <div className="min-h-screen px-3 pb-10 pt-20 sm:px-5 lg:px-8">
      <div className="mx-auto max-w-[1480px]">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white sm:text-3xl">FundTrader 整体UI预览</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-white/62">
              两个方向均按中文金融投顾场景设计，先用于视觉评审；确认后再拆到首页、配置、回测、推荐等业务页面。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 rounded-md border border-white/10 bg-white/[0.03] p-1">
            {(['terminal', 'cockpit'] as PreviewMode[]).map((item) => (
              <button
                key={item}
                onClick={() => setMode(item)}
                className={classNames(
                  'h-10 rounded px-4 text-sm transition',
                  mode === item ? 'bg-white text-[#070806]' : 'text-white/64 hover:bg-white/8 hover:text-white'
                )}
              >
                {item === 'terminal' ? '方案A' : '方案B'}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4 rounded-md border border-white/10 bg-white/[0.03] p-4">
          <div className="text-lg font-semibold text-white">{meta[mode].title}</div>
          <div className="mt-1 text-sm leading-6 text-white/62">{meta[mode].desc}</div>
        </div>

        {mode === 'terminal' ? <TerminalPreview /> : <CockpitPreview />}
      </div>
    </div>
  )
}
