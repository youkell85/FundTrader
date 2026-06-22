import { FileText, ShieldCheck } from 'lucide-react'
import type { IpsSummary, LifecycleGoalSummary, PolicyBand } from '@/types/lifecycle'

function money(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '-'
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}

function pct(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '-'
  return `${(value * 100).toFixed(1)}%`
}

export default function IpsSummaryPanel({
  ips,
  goalSummary,
  policyBands,
}: {
  ips: IpsSummary
  goalSummary: LifecycleGoalSummary
  policyBands: PolicyBand[]
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
      <section className="workspace-panel p-5">
        <div className="flex items-center gap-2 text-white">
          <FileText className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">IPS 摘要</h2>
        </div>
        <p className="mt-3 text-sm leading-6 text-white/62">{ips.investor_profile}</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-white/35">Objectives</div>
            <ul className="mt-2 space-y-2 text-sm text-white/65">
              {ips.objectives.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-white/35">Constraints</div>
            <ul className="mt-2 space-y-2 text-sm text-white/65">
              {ips.constraints.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </div>
      </section>

      <section className="workspace-panel p-5">
        <div className="flex items-center gap-2 text-white">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">目标与纪律</h2>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Metric label="目标数" value={String(goalSummary.total_goals)} />
          <Metric label="资金缺口" value={`¥${money(goalSummary.funding_gap)}`} />
          <Metric label="建议月供" value={goalSummary.required_monthly_contribution == null ? '-' : `¥${money(goalSummary.required_monthly_contribution)}`} />
          <Metric label="目标胜率" value={pct(goalSummary.target_success_rate)} />
        </div>
        <div className="mt-4 overflow-hidden rounded-lg border border-white/[0.07]">
          {policyBands.map((band) => (
            <div key={band.asset_class} className="grid grid-cols-4 border-b border-white/[0.06] px-3 py-2 text-xs text-white/58 last:border-b-0">
              <span className="font-medium text-white/75">{band.asset_class}</span>
              <span>{pct(band.min_weight)}</span>
              <span>{pct(band.target_weight)}</span>
              <span>{pct(band.max_weight)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] p-3">
      <div className="text-[11px] text-white/38">{label}</div>
      <div className="mt-1 text-sm font-semibold text-white">{value}</div>
    </div>
  )
}
