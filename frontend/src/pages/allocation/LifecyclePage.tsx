import { useMemo, useState } from 'react'
import { AlertTriangle, RefreshCw, Route, Target } from 'lucide-react'
import { buildLifecyclePlan } from '@/lib/lifecycle-api'
import { useAllocationStore } from '@/store/allocationStore'
import type { LifecycleGoalItem, LifecyclePolicyResponse } from '@/types/lifecycle'
import GlidePathChart from '@/components/allocation/GlidePathChart'
import IpsSummaryPanel from '@/components/allocation/IpsSummaryPanel'

function money(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '-'
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}

export default function LifecyclePage() {
  const { state } = useAllocationStore()
  const [targetAmount, setTargetAmount] = useState(() => Math.max(state.config.amount * 2, 1000000))
  const [horizonYears, setHorizonYears] = useState(() => {
    if (state.config.investment_horizon === 'very_long') return 20
    if (state.config.investment_horizon === 'long') return 10
    if (state.config.investment_horizon === 'short') return 3
    return 5
  })
  const [currentBalance, setCurrentBalance] = useState(state.config.amount)
  const [result, setResult] = useState<LifecyclePolicyResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const goal: LifecycleGoalItem = useMemo(() => ({
    id: 'primary-goal',
    name: state.config.goal_type === 'retirement' ? '退休目标' : state.config.goal_type === 'education' ? '教育目标' : state.config.goal_type === 'housing' ? '购房目标' : '财富目标',
    goal_type: state.config.goal_type || 'wealth',
    target_amount: targetAmount,
    horizon_years: horizonYears,
    priority: 1,
    current_balance: currentBalance,
    monthly_contribution: 0,
    metadata: {},
  }), [currentBalance, horizonYears, state.config.goal_type, targetAmount])

  const generate = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await buildLifecyclePlan({
        base_request: state.config,
        goals: [goal],
        current_age: state.config.age,
        retirement_age: state.config.goal_type === 'retirement' ? Math.max(state.config.age + horizonYears, 60) : null,
        review_frequency: 'annual',
        target_success_rate: 0.8,
      })
      setResult(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : '生命周期计划生成失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 md:px-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <Route className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-[0.18em]">Lifecycle IPS</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-white">生命周期资产配置</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/55">
            围绕客户目标生成滑行路径、策略带和建议月供；结果用于内部适当性校验，不构成收益承诺。
          </p>
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="workspace-action-active inline-flex h-10 items-center gap-2 px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          {loading ? '生成中' : '生成生命周期计划'}
        </button>
      </header>

      <section className="workspace-panel p-5">
        <div className="grid gap-4 md:grid-cols-4">
          <NumberField label="目标金额" value={targetAmount} min={10000} step={50000} onChange={setTargetAmount} />
          <NumberField label="当前资金" value={currentBalance} min={0} step={50000} onChange={setCurrentBalance} />
          <NumberField label="目标年限" value={horizonYears} min={1} step={1} onChange={setHorizonYears} />
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] p-4">
            <div className="text-xs text-white/40">当前风险</div>
            <div className="mt-2 text-lg font-semibold text-white">{state.config.risk_tolerance}</div>
            <div className="mt-1 text-xs text-white/38">来自配置问卷</div>
          </div>
        </div>
      </section>

      {error ? (
        <div className="flex items-start gap-3 rounded-lg border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {result ? (
        <>
          <section className="grid gap-4 md:grid-cols-4">
            <Kpi label="建议月供" value={result.required_monthly_contribution == null ? '-' : `¥${money(result.required_monthly_contribution)}`} />
            <Kpi label="资金缺口" value={`¥${money(result.goal_summary.funding_gap)}`} />
            <Kpi label="数据状态" value={result.data_quality.status} />
            <Kpi label="适当性" value={result.suitability_status} />
          </section>

          <IpsSummaryPanel ips={result.ips_summary} goalSummary={result.goal_summary} policyBands={result.policy_bands} />

          <section className="workspace-panel p-5">
            <div className="flex items-center gap-2 text-white">
              <Target className="h-4 w-4 text-primary" />
              <h2 className="text-base font-semibold">Glide Path</h2>
            </div>
            <GlidePathChart points={result.glide_path} />
          </section>

          {result.warnings.length ? (
            <section className="workspace-panel p-5">
              <h2 className="text-base font-semibold text-white">风险提示</h2>
              <ul className="mt-3 space-y-2 text-sm text-white/60">
                {result.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            </section>
          ) : null}
        </>
      ) : (
        <section className="workspace-panel p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.035]">
            <Target className="h-5 w-5 text-primary" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-white">等待生命周期计划</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-white/52">
            调整目标金额、当前资金和年限后生成计划；数据不足时页面会明确显示降级状态。
          </p>
        </section>
      )}
    </div>
  )
}

function NumberField({ label, value, min, step, onChange }: { label: string; value: number; min: number; step: number; onChange: (value: number) => void }) {
  return (
    <label className="block rounded-lg border border-white/[0.06] bg-white/[0.025] p-4">
      <span className="text-xs text-white/40">{label}</span>
      <input
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={(event) => onChange(Math.max(min, Number(event.target.value) || min))}
        className="mt-2 h-10 w-full rounded-md border border-white/[0.08] bg-popover px-3 text-sm text-popover-foreground outline-none focus:border-primary/60"
      />
    </label>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="workspace-panel p-4">
      <div className="text-xs text-white/40">{label}</div>
      <div className="mt-2 text-lg font-semibold text-white">{value}</div>
    </div>
  )
}
