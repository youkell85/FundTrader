import { type ReactNode, useMemo, useState } from 'react'
import {
  Activity,
  Bell,
  BriefcaseBusiness,
  CandlestickChart,
  ChevronRight,
  Gauge,
  Layers3,
  LineChart,
  PieChart,
  Radar,
  Search,
  ShieldCheck,
  Target,
  TrendingUp,
  UserCircle,
} from 'lucide-react'

type PreviewMode = 'terminal' | 'cockpit'

const fundRows = [
  { code: '161725', name: '招商中证白酒指数A', manager: '侯昊', asset: '股票', weight: '9.32%', nav: '1.0345', day: '-0.82%', year: '-5.12%', drawdown: '-18.45%' },
  { code: '110011', name: '易方达中小盘混合', manager: '张坤', asset: '股票', weight: '8.74%', nav: '6.7210', day: '-1.35%', year: '+12.35%', drawdown: '-12.32%' },
  { code: '007119', name: '睿远成长价值混合A', manager: '傅鹏博', asset: '股票', weight: '8.21%', nav: '2.3410', day: '-0.65%', year: '+15.37%', drawdown: '-10.18%' },
  { code: '001102', name: '前海开源国家比较优势', manager: '曲扬', asset: '股票', weight: '7.85%', nav: '2.8920', day: '-0.58%', year: '+8.21%', drawdown: '-13.24%' },
  { code: '005827', name: '易方达蓝筹精选混合', manager: '张坤', asset: '股票', weight: '7.12%', nav: '2.3580', day: '-1.10%', year: '+9.87%', drawdown: '-11.45%' },
  { code: '003095', name: '中欧医疗健康混合A', manager: '葛兰', asset: '股票', weight: '6.78%', nav: '2.3406', day: '-1.22%', year: '-2.31%', drawdown: '-14.12%' },
]

const assetMix = [
  { label: '股票', value: 68.2, color: '#59c993' },
  { label: '债券', value: 18.5, color: '#d4a15e' },
  { label: '现金', value: 8.6, color: '#7ca4d8' },
  { label: '商品', value: 2.1, color: '#a28b68' },
  { label: '其他', value: 2.6, color: '#7a746b' },
]

const styleBars: Array<[string, number]> = [
  ['大盘成长', 28.4],
  ['大盘价值', 22.1],
  ['中盘成长', 17.6],
  ['中盘价值', 13.2],
  ['小盘成长', 9.3],
  ['小盘价值', 9.4],
]

const fundCards = [
  { name: '易方达蓝筹精选混合', manager: '张坤', returnRate: '+9.87%', nav: '2.3580', badge: '混合型', tag: '大盘成长', warm: false },
  { name: '睿远成长价值混合A', manager: '傅鹏博', returnRate: '+15.37%', nav: '2.3410', badge: '均衡成长', tag: '长期持有', warm: true },
  { name: '中欧医疗健康混合A', manager: '葛兰', returnRate: '-2.31%', nav: '2.3406', badge: '医药赛道', tag: '精选个股', warm: false },
  { name: '华夏中证新能源ETF', manager: '指数型', returnRate: '+5.42%', nav: '1.2340', badge: '新能源', tag: '景气修复', warm: true },
]

function classNames(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(' ')
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

function Panel({ title, children, action, className }: { title: string; children: ReactNode; action?: ReactNode; className?: string }) {
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

function TerminalPreview() {
  return (
    <section className="relative overflow-hidden rounded-md border border-[#2b312f] bg-[#080a09] text-[#f4f1e8] shadow-2xl shadow-black/40">
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
              <button key={String(label)} className={classNames('flex h-10 w-full items-center gap-2 rounded px-3 text-left transition', index === 1 ? 'bg-[#d7a84f]/14 text-[#f1d28b]' : 'text-[#98a29b] hover:bg-white/5 hover:text-white')}>
                <Icon size={15} />
                <span>{String(label)}</span>
              </button>
            ))}
          </div>
        </aside>

        <main className="space-y-3 p-4">
          <Panel title="市场总览" action={<span className="text-xs text-[#9ca49a]">2025-05-23 15:00</span>}>
            <div className="grid gap-3 md:grid-cols-3">
              {['上证指数', '深证成指', '创业板指'].map((name, index) => (
                <div key={name} className="border-r border-white/[0.07] pr-3 last:border-r-0">
                  <div className="text-xs text-[#9ca49a]">{name}</div>
                  <div className="mt-2 flex items-end gap-2">
                    <span className="text-lg font-semibold text-[#59c993]">{index === 0 ? '3,348.37' : index === 1 ? '10,134.46' : '2,027.45'}</span>
                    <span className="text-xs text-[#59c993]">-0.{index + 2}8%</span>
                  </div>
                  <Sparkline />
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="持仓明细（前10）">
            <div className="overflow-hidden text-xs">
              <div className="grid grid-cols-[42px_82px_1.8fr_80px_70px_70px_70px_70px] border-b border-white/[0.07] pb-2 text-[#9aa49a]">
                <span>#</span><span>代码</span><span>基金名称</span><span>经理</span><span>持仓占比</span><span>净值</span><span>日涨跌</span><span>最大回撤</span>
              </div>
              {fundRows.map((row, index) => (
                <div key={row.code} className="grid grid-cols-[42px_82px_1.8fr_80px_70px_70px_70px_70px] border-b border-white/[0.045] py-2 text-[#d7d2c6]">
                  <span>{index + 1}</span>
                  <span>{row.code}</span>
                  <span>{row.name}</span>
                  <span>{row.manager}</span>
                  <span>{row.weight}</span>
                  <span>{row.nav}</span>
                  <span className="text-[#59c993]">{row.day}</span>
                  <span className="text-[#59c993]">{row.drawdown}</span>
                </div>
              ))}
            </div>
          </Panel>
        </main>

        <aside className="space-y-3 border-t border-[#2b312f] p-4 lg:border-l lg:border-t-0">
          <Panel title="资金流向（亿元）">
            <div className="space-y-4 text-sm">
              {['沪深两市', '主力净流入', '北向净流入', '融资净买入'].map((label, index) => (
                <div key={label} className="grid grid-cols-[88px_1fr_70px] items-center gap-3">
                  <span className="text-[#b9b1a4]">{label}</span>
                  <div className="h-2 overflow-hidden rounded-full bg-white/10"><div className={classNames('h-full', index === 1 ? 'bg-[#ef7567]' : 'bg-[#59c993]')} style={{ width: `${index === 1 ? 36 : 66}%` }} /></div>
                  <span className={index === 1 ? 'text-[#ef7567]' : 'text-[#59c993]'}>{index === 0 ? '-124.32' : index === 1 ? '-82.45' : index === 2 ? '+32.17' : '-74.03'}</span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="组合风险评级">
            <div className="mx-auto grid h-32 w-32 place-items-center rounded-full bg-[conic-gradient(from_215deg,#d7a84f_0_62%,rgba(255,255,255,.08)_62%_100%)] p-3">
              <div className="grid h-full w-full place-items-center rounded-full bg-[#0c0f0d] text-center">
                <div>
                  <div className="text-xl font-bold text-[#f0c46f]">中等</div>
                  <div className="text-xs text-[#b9b1a4]">风险得分 58</div>
                </div>
              </div>
            </div>
          </Panel>
        </aside>
      </div>
    </section>
  )
}

export function CockpitPreview() {
  return (
    <section className="relative overflow-hidden rounded-md border border-[#2a2f2b] bg-[#050706] p-3 text-[#f4efe3] shadow-2xl shadow-black/50">
      <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,.16)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.16)_1px,transparent_1px)] [background-size:32px_32px]" />
      <div className="relative min-h-[820px]">
        <header className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] pb-3">
          <div className="flex items-baseline gap-3">
            <h2 className="text-2xl font-bold tracking-tight text-[#58c792]">方案B</h2>
            <div className="text-2xl font-semibold text-white">资产驾驶舱</div>
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
            <span>张经理</span>
          </div>
        </header>

        <Panel title="市场全景" action={<span className="text-xs text-[#c8bba9]">2025-05-23 15:00</span>}>
          <div className="grid gap-4 xl:grid-cols-[1fr_1fr_1fr_170px_150px]">
            {[
              ['上证指数', '3,348.37', '-0.28%'],
              ['深证成指', '10,134.46', '-0.44%'],
              ['创业板指', '2,027.45', '-0.76%'],
            ].map(([name, value, change], index) => (
              <div key={name} className="min-h-[120px] border-r border-white/[0.08] pr-4">
                <div className="flex items-baseline gap-3">
                  <span className="font-semibold text-[#f2eadc]">{name}</span>
                  <span className="text-sm font-semibold text-[#58c792]">{value}</span>
                  <span className="text-xs text-[#58c792]">{change}</span>
                </div>
                <Sparkline warm={index === 2} />
                <div className="flex justify-between text-[10px] text-[#9f988f]"><span>09:30</span><span>11:30/13:00</span><span>15:00</span></div>
              </div>
            ))}
            <div className="space-y-3 border-r border-white/[0.08] pr-4 text-xs">
              <div className="font-semibold text-[#f2eadc]">市场状态</div>
              {[
                ['上涨家数', '1,152', '#58c792'],
                ['下跌家数', '3,254', '#d9815d'],
                ['成交额', '9,247 亿元', '#81b1d9'],
                ['北向净买', '+32.17 亿元', '#d7d2c6'],
              ].map(([label, value, color]) => (
                <div key={label} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-[#bbb4a9]"><i className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />{label}</span>
                  <span className="text-[#f4efe3]">{value}</span>
                </div>
              ))}
            </div>
            <div>
              <div className="mb-3 text-xs font-semibold text-[#f2eadc]">市场情绪</div>
              <div className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-[conic-gradient(from_210deg,#58c792_0_42%,#b68a5f_42%_68%,rgba(255,255,255,.08)_68%_100%)] p-2">
                <div className="grid h-full w-full place-items-center rounded-full bg-[#0c0f0d] text-center">
                  <div>
                    <div className="text-2xl font-bold text-[#e8c184]">42</div>
                    <div className="text-[10px] text-[#d6c9b7]">中性偏谨慎</div>
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
              ['组合净值', '1.2567', 'text-white'],
              ['日涨跌', '-0.35%', 'text-[#58c792]'],
              ['今年以来', '+8.72%', 'text-[#e37757]'],
              ['最大回撤', '-6.32%', 'text-[#58c792]'],
              ['年化收益', '12.45%', 'text-[#e8c184]'],
              ['夏普比率', '0.96', 'text-white'],
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
                <div className="grid h-28 w-28 place-items-center rounded-full bg-[conic-gradient(#59c993_0_68%,#d4a15e_68%_86%,#7ca4d8_86%_94%,#a28b68_94%_97%,#7a746b_97%_100%)] p-5">
                  <div className="h-full w-full rounded-full bg-[#0c0f0d]" />
                </div>
                <div className="space-y-2 text-xs">
                  {assetMix.map((item) => (
                    <div key={item.label} className="grid grid-cols-[52px_1fr_48px] items-center gap-2">
                      <span className="flex items-center gap-2"><i className="h-2 w-2 rounded-sm" style={{ backgroundColor: item.color }} />{item.label}</span>
                      <div className="h-1.5 rounded-full bg-white/10"><div className="h-full rounded-full" style={{ width: `${item.value}%`, backgroundColor: item.color }} /></div>
                      <span>{item.value.toFixed(2)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <div className="mb-3 text-sm font-semibold">风格分布（股票部分）</div>
              <div className="space-y-2 text-xs">
                {styleBars.map(([label, value], index) => (
                  <div key={label} className="grid grid-cols-[70px_1fr_44px] items-center gap-2">
                    <span className="text-[#cfc7bb]">{label}</span>
                    <div className="h-2 rounded-full bg-white/10">
                      <div className={classNames('h-full rounded-full', index < 2 ? 'bg-[#58c792]' : index < 4 ? 'bg-[#d8b36e]' : 'bg-[#9d8062]')} style={{ width: `${value * 3}%` }} />
                    </div>
                    <span>{value.toFixed(2)}%</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-3 text-sm font-semibold">行业分布（股票部分）</div>
              <div className="grid h-[150px] grid-cols-5 grid-rows-2 overflow-hidden rounded-sm border border-white/[0.06] text-xs">
                {[
                  ['电子', '15.23%', 'bg-[#5ba47b]'],
                  ['医药生物', '12.42%', 'bg-[#7d4e31]'],
                  ['食品饮料', '10.18%', 'bg-[#6c421f]'],
                  ['电力设备', '9.15%', 'bg-[#70451d]'],
                  ['银行', '7.82%', 'bg-[#5b3b22]'],
                  ['计算机', '6.75%', 'bg-[#345e50]'],
                  ['有色金属', '5.23%', 'bg-[#4f715f]'],
                  ['非银金融', '4.92%', 'bg-[#3c5148]'],
                  ['化工', '4.35%', 'bg-[#4f6452]'],
                  ['其他', '4.95%', 'bg-[#67604d]'],
                ].map(([name, value, color]) => (
                  <div key={name} className={classNames('flex flex-col justify-center border border-black/20 p-2', color)}>
                    <span>{name}</span>
                    <span className="mt-1 text-[#fff4df]">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="优选基金" action={<div className="flex flex-wrap gap-4 text-xs text-white/62"><span className="rounded bg-white/10 px-2 py-1 text-white">全部</span><span>股票型</span><span>混合型</span><span>债券型</span><span>指数型</span><span>QDII</span><span>FOF</span><span>更多</span></div>} className="mt-3">
          <div className="grid gap-3 lg:grid-cols-4">
            {fundCards.map((fund) => (
              <div key={fund.name} className="rounded-sm border border-white/[0.08] bg-white/[0.035] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-[#f7f1e7]">{fund.name}</div>
                    <div className="mt-1 text-xs text-[#a9a197]">{fund.manager}</div>
                  </div>
                  <span className="rounded border border-[#d1a66c]/45 px-2 py-0.5 text-[10px] text-[#e1b879]">{fund.badge}</span>
                </div>
                <div className="mt-3 grid grid-cols-[1fr_90px] items-end gap-3">
                  <div>
                    <div className={classNames('text-2xl font-bold', fund.returnRate.startsWith('-') ? 'text-[#58c792]' : 'text-[#e37757]')}>{fund.returnRate}</div>
                    <div className="text-xs text-[#aaa198]">今年以来</div>
                  </div>
                  <Sparkline warm={fund.warm} />
                </div>
                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className="rounded bg-[#d2a66a]/12 px-2 py-1 text-[#ddb878]">{fund.tag}</span>
                  <span className="text-[#f1eadf]">{fund.nav}<span className="ml-1 text-[#9f988f]">最新净值</span></span>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <div className="mt-3 grid gap-3 xl:grid-cols-[1.2fr_.8fr_1fr]">
          <Panel title="市场热点">
            <div className="grid grid-cols-[70px_1fr_70px_80px] gap-2 text-xs text-[#d8cec0]">
              <span className="text-[#58c792]">行业热点</span><span>主题热点</span><span>资金流向</span><span>涨幅榜</span>
              {['创新药', '固态电池', '半导体'].map((name, index) => (
                <div key={name} className="contents">
                  <span className="rounded bg-[#b38950]/28 px-2 py-1 text-center">{index + 1}</span>
                  <span className="py-1">{name}</span>
                  <span className="py-1 text-[#e37757]">+{(2.31 - index * 0.38).toFixed(2)}%</span>
                  <span className="py-1">{(25.41 - index * 6.9).toFixed(2)}亿</span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="组合风险" action={<Gauge size={15} className="text-[#d5a765]" />}>
            <div className="grid grid-cols-[1fr_110px] items-center gap-3 text-xs">
              <div className="space-y-3">
                <div className="flex justify-between"><span>风险评级</span><span>中等</span></div>
                <div className="flex justify-between"><span>风险得分</span><span>58</span></div>
                <div className="flex justify-between"><span>VaR(95%)</span><span>2.31%</span></div>
                <div className="flex justify-between"><span>最大回撤</span><span className="text-[#58c792]">-6.32%</span></div>
              </div>
              <div className="grid h-24 w-24 place-items-center rounded-full bg-[conic-gradient(from_210deg,#d4a15e_0_58%,#58c792_58%_78%,rgba(255,255,255,.08)_78%_100%)] p-3">
                <div className="h-full w-full rounded-full bg-[#0c0f0d]" />
              </div>
            </div>
          </Panel>
          <Panel title="近期调仓建议">
            <div className="space-y-3 text-sm text-[#d8cec0]">
              {[
                '增加科技成长类资产配置，关注AI算力产业链机会',
                '适度降低高波动板块仓位，控制组合回撤风险',
                '关注利率债配置价值，优化组合久期结构',
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

export default function DesignPreview() {
  const [mode, setMode] = useState<PreviewMode>('cockpit')

  const current = useMemo(() => {
    return mode === 'terminal'
      ? {
        label: '方案A',
        title: '方案A：投研终端',
        desc: '偏专业投研工作台，强调持仓明细、资金流、风险因子和执行监控。',
      }
      : {
        label: '方案B',
        title: '方案B：资产驾驶舱',
        desc: '按照你选中的驾驶舱概念：市场全景、组合诊断、资产分布、基金卡片、风险与调仓建议同屏呈现。',
      }
  }, [mode])

  return (
    <div className="min-h-screen bg-[#030504] px-4 py-6 text-[#f4efe3] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1540px]">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-[#58c792]">FundTrader UI Preview</div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">{current.title}</h1>
            <p className="mt-2 max-w-3xl text-sm text-[#aaa39a]">{current.desc}</p>
          </div>
          <div className="flex rounded-full border border-white/10 bg-white/[0.04] p-1">
            {(['terminal', 'cockpit'] as PreviewMode[]).map((item) => (
              <button
                key={item}
                onClick={() => setMode(item)}
                className={classNames(
                  'flex h-9 items-center gap-2 rounded-full px-4 text-sm transition',
                  mode === item ? 'bg-[#58c792] text-[#04120b] shadow-lg shadow-[#58c792]/20' : 'text-[#b9b1a7] hover:bg-white/[0.06] hover:text-white',
                )}
              >
                {item === 'terminal' ? <LineChart size={15} /> : <Layers3 size={15} />}
                {item === 'terminal' ? '方案A' : '方案B'}
              </button>
            ))}
          </div>
        </div>

        {mode === 'terminal' ? <TerminalPreview /> : <CockpitPreview />}

        <div className="mt-4 grid gap-3 text-xs text-[#9d958a] md:grid-cols-3">
          <div className="rounded-sm border border-white/[0.08] bg-white/[0.035] p-3"><TrendingUp className="mb-2 text-[#58c792]" size={16} />真实业务入口保留，预览页只用于比较信息架构与视觉方向。</div>
          <div className="rounded-sm border border-white/[0.08] bg-white/[0.035] p-3"><Radar className="mb-2 text-[#d4a15e]" size={16} />方案B以组合持有人和客户沟通为核心，首屏展示可解释的资产状态。</div>
          <div className="rounded-sm border border-white/[0.08] bg-white/[0.035] p-3"><Gauge className="mb-2 text-[#7ca4d8]" size={16} />风险、收益、调仓建议放在同一决策链路，减少跨页面跳转。</div>
        </div>
      </div>
    </div>
  )
}
