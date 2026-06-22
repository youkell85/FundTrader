import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2, ShieldCheck } from 'lucide-react'
import { getProfessionalAnalysis } from '@/lib/api'

type ProfessionalPillar = {
  pillar: string
  score: number
  status: string
  missing_reason?: string | null
  evidence_refs: Array<{ source: string; as_of?: string | null; description?: string; confidence?: number }>
}

type ProfessionalAnalysis = {
  professional_score?: {
    total_score?: number | null
    evidence_completeness: number
    data_quality: { status: string; missing_reason?: string | null; warnings?: string[] }
    pillars: ProfessionalPillar[]
    warnings: string[]
  }
  brinson_attribution?: {
    status: string
    warnings?: string[]
    data_quality?: { missing_reason?: string | null }
  }
  style_profile?: {
    status: string
    warnings?: string[]
  }
  error?: string
}

const PILLAR_LABEL: Record<string, string> = {
  performance: '业绩',
  risk: '风险',
  cost: '费用',
  style: '风格',
  holdings: '持仓',
}

function tone(status?: string) {
  if (status === 'real' || status === 'available') return 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100'
  if (status === 'missing' || status === 'rejected') return 'border-red-400/25 bg-red-400/10 text-red-100'
  return 'border-amber-400/25 bg-amber-400/10 text-amber-100'
}

function fmt(value?: number | null, suffix = '') {
  if (value === null || value === undefined || Number.isNaN(value)) return '缺失'
  return `${value.toFixed(1)}${suffix}`
}

export default function ProfessionalScorePanel({ code }: { code: string }) {
  const [data, setData] = useState<ProfessionalAnalysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!/^\d{6}$/.test(code)) return
    let alive = true
    setLoading(true)
    setError(null)
    getProfessionalAnalysis(code)
      .then((response) => {
        if (alive) setData(response)
      })
      .catch((e: any) => {
        if (alive) setError(e?.message || '专业评价加载失败')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [code])

  if (loading) {
    return (
      <div className="flex min-h-32 items-center justify-center rounded-md border border-white/10 bg-white/[0.02] text-sm text-white/45">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        加载专业评价
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-100">
        {error}
      </div>
    )
  }

  const score = data?.professional_score
  if (!score) {
    return (
      <div className="rounded-md border border-white/10 bg-white/[0.02] p-3 text-sm text-white/45">
        当前基金暂无专业评价数据。
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-md border border-white/[0.08] bg-white/[0.025] p-3">
          <div className="text-[11px] text-white/40">总分</div>
          <div className="data-number mt-1 text-2xl font-semibold text-white">{fmt(score.total_score)}</div>
        </div>
        <div className="rounded-md border border-white/[0.08] bg-white/[0.025] p-3">
          <div className="text-[11px] text-white/40">证据完整度</div>
          <div className="data-number mt-1 text-2xl font-semibold text-white">{fmt(score.evidence_completeness * 100, '%')}</div>
        </div>
        <div className={`rounded-md border p-3 ${tone(score.data_quality.status)}`}>
          <div className="text-[11px] opacity-70">评价状态</div>
          <div className="mt-1 text-lg font-semibold">{score.data_quality.status}</div>
        </div>
        <div className={`rounded-md border p-3 ${tone(data?.brinson_attribution?.status)}`}>
          <div className="text-[11px] opacity-70">Brinson</div>
          <div className="mt-1 text-lg font-semibold">{data?.brinson_attribution?.status || 'missing'}</div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {score.pillars.map((pillar) => (
          <div key={pillar.pillar} className="rounded-md border border-white/[0.08] bg-white/[0.025] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-white">{PILLAR_LABEL[pillar.pillar] || pillar.pillar}</span>
              <span className={`rounded border px-1.5 py-0.5 text-[10px] ${tone(pillar.status)}`}>{pillar.status}</span>
            </div>
            <div className="data-number mt-2 text-xl font-semibold text-white">{fmt(pillar.score)}</div>
            <div className="mt-2 flex items-center gap-1 text-[11px] text-white/40">
              <ShieldCheck className="h-3.5 w-3.5" />
              {pillar.evidence_refs.length} 条证据
            </div>
            {pillar.missing_reason ? <p className="mt-2 text-xs leading-relaxed text-white/40">{pillar.missing_reason}</p> : null}
          </div>
        ))}
      </div>

      {(score.warnings?.length || data?.brinson_attribution?.warnings?.length || data?.error) ? (
        <div className="rounded-md border border-amber-400/20 bg-amber-400/10 p-3 text-xs leading-relaxed text-amber-100">
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
          {[data?.error, ...(score.warnings || []), ...(data?.brinson_attribution?.warnings || [])].filter(Boolean).join('；')}
        </div>
      ) : null}
    </div>
  )
}
