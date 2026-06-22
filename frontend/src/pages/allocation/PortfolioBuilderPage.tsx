import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Boxes, CheckCircle2, Loader2, PackageSearch, PieChart, RefreshCw, ShieldAlert } from 'lucide-react'
import { buildPortfolio, getModelPortfolios, getPortfolioCandidates } from '@/lib/api'
import type { RiskTolerance } from '@/types/allocation'
import type {
  ModelPortfolioItem,
  PortfolioBuildResponse,
  PortfolioCandidate,
  PortfolioConstraint,
  PortfolioRole,
} from '@/types/portfolio'

const RISK_OPTIONS: { key: RiskTolerance; label: string }[] = [
  { key: 'conservative', label: '保守' },
  { key: 'moderate', label: '稳健' },
  { key: 'balanced', label: '均衡' },
  { key: 'aggressive', label: '进取' },
  { key: 'radical', label: '激进' },
]

const TARGETS: Record<RiskTolerance, Record<string, number>> = {
  conservative: { bond: 0.55, cash: 0.15, mixed: 0.2, equity: 0.1 },
  moderate: { bond: 0.4, mixed: 0.3, equity: 0.25, cash: 0.05 },
  balanced: { mixed: 0.35, equity: 0.35, bond: 0.2, index: 0.1 },
  aggressive: { equity: 0.45, index: 0.25, mixed: 0.2, qdii: 0.1 },
  radical: { equity: 0.5, index: 0.25, qdii: 0.15, mixed: 0.1 },
}

const ASSET_LABEL: Record<string, string> = {
  bond: '债券',
  cash: '现金',
  mixed: '混合',
  equity: '权益',
  index: '指数',
  qdii: 'QDII',
  alternative: '另类',
}

const ROLE_BY_ASSET: Record<string, PortfolioRole> = {
  bond: 'defensive',
  cash: 'liquidity',
  mixed: 'core',
  equity: 'satellite',
  index: 'core',
  qdii: 'alternative',
  alternative: 'alternative',
}

function pct(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return '缺失'
  return `${(value * 100).toFixed(1)}%`
}

function metric(value?: number | null, suffix = '%') {
  if (value === null || value === undefined || Number.isNaN(value)) return '缺失'
  return `${value.toFixed(2)}${suffix}`
}

function statusTone(status?: string) {
  if (status === 'real' || status === 'approved') return 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200'
  if (status === 'missing' || status === 'rejected') return 'border-red-400/25 bg-red-400/10 text-red-200'
  return 'border-amber-400/25 bg-amber-400/10 text-amber-200'
}

function mapCandidate(candidate: PortfolioCandidate): PortfolioCandidate {
  return {
    ...candidate,
    role: candidate.role || ROLE_BY_ASSET[candidate.asset_class] || 'core',
    min_weight: candidate.min_weight ?? 0,
    max_weight: candidate.max_weight || 0.3,
  }
}

export default function PortfolioBuilderPage() {
  const [candidates, setCandidates] = useState<PortfolioCandidate[]>([])
  const [models, setModels] = useState<ModelPortfolioItem[]>([])
  const [selectedCodes, setSelectedCodes] = useState<string[]>([])
  const [risk, setRisk] = useState<RiskTolerance>('balanced')
  const [amount, setAmount] = useState(100000)
  const [maxSingle, setMaxSingle] = useState(30)
  const [result, setResult] = useState<PortfolioBuildResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [building, setBuilding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedCandidates = useMemo(
    () => candidates.filter((candidate) => selectedCodes.includes(candidate.fund_code)).map(mapCandidate),
    [candidates, selectedCodes],
  )

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const [candidateRes, modelRes] = await Promise.all([
        getPortfolioCandidates(80),
        getModelPortfolios(6),
      ])
      setCandidates(candidateRes.candidates || [])
      setModels(modelRes.items || [])
      const defaults = (candidateRes.candidates || []).slice(0, 6).map((item) => item.fund_code)
      setSelectedCodes((prev) => (prev.length ? prev : defaults))
    } catch (e: any) {
      setError(e?.message || '组合候选池加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  async function runBuild(seed?: ModelPortfolioItem) {
    setBuilding(true)
    setError(null)
    try {
      const seedCandidates = seed
        ? seed.holdings
            .filter((holding) => holding.metadata_status !== 'missing')
            .map((holding) => ({
              fund_code: holding.fund_code,
              fund_name: holding.fund_name,
              asset_class: '',
              role: holding.role,
              min_weight: 0,
              max_weight: Math.max(holding.weight, 0.05),
              metadata_status: holding.metadata_status,
              missing_reason: holding.missing_reason,
            }))
        : selectedCandidates

      const constraints: PortfolioConstraint = {
        max_single_fund_weight: Math.max(5, Math.min(maxSingle, 80)) / 100,
        max_same_company_weight: 0.5,
        min_fund_count: Math.min(3, seedCandidates.length || 3),
        max_fund_count: 8,
        target_asset_weights: TARGETS[risk],
      }

      const response = await buildPortfolio({
        candidates: seedCandidates,
        constraints,
        risk_tolerance: risk,
        amount,
      })
      setResult(response)
    } catch (e: any) {
      setError(e?.message || '组合构建失败')
    } finally {
      setBuilding(false)
    }
  }

  function toggleCandidate(code: string) {
    setSelectedCodes((prev) => (
      prev.includes(code)
        ? prev.filter((item) => item !== code)
        : [...prev, code].slice(-12)
    ))
  }

  return (
    <div className="space-y-5 px-4 py-5 md:px-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary/80">
            <Boxes className="h-4 w-4" />
            Portfolio Builder
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-white md:text-3xl">组合构建与模型组合超市</h1>
        </div>
        <button
          type="button"
          onClick={loadData}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-4 text-sm text-white/75 hover:bg-white/[0.07]"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          刷新
        </button>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-md border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-100">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(380px,0.9fr)]">
        <section className="workspace-panel-strong p-4">
          <div className="flex flex-col gap-3 border-b border-white/[0.06] pb-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">基金池候选</h2>
              <p className="mt-1 text-sm text-white/45">当前选中 {selectedCodes.length} 只，候选来自后端真实快照。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {RISK_OPTIONS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setRisk(item.key)}
                  className={[
                    'h-9 rounded-md border px-3 text-sm transition',
                    risk === item.key
                      ? 'border-primary/60 bg-primary/15 text-primary'
                      : 'border-white/10 bg-white/[0.03] text-white/55 hover:bg-white/[0.06]',
                  ].join(' ')}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-xs text-white/45">投资金额</span>
              <input
                type="number"
                min={1000}
                value={amount}
                onChange={(event) => setAmount(Number(event.target.value) || 0)}
                className="h-10 w-full rounded-md border border-white/10 bg-background px-3 text-sm text-white outline-none focus:border-primary/50"
              />
            </label>
            <label className="space-y-2">
              <span className="text-xs text-white/45">单基金上限 (%)</span>
              <input
                type="number"
                min={5}
                max={80}
                value={maxSingle}
                onChange={(event) => setMaxSingle(Number(event.target.value) || 30)}
                className="h-10 w-full rounded-md border border-white/10 bg-background px-3 text-sm text-white outline-none focus:border-primary/50"
              />
            </label>
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {loading ? (
              <div className="col-span-full flex min-h-48 items-center justify-center text-white/45">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                加载候选池
              </div>
            ) : candidates.map((candidate) => {
              const checked = selectedCodes.includes(candidate.fund_code)
              return (
                <button
                  key={candidate.fund_code}
                  type="button"
                  onClick={() => toggleCandidate(candidate.fund_code)}
                  className={[
                    'rounded-md border p-3 text-left transition',
                    checked
                      ? 'border-primary/45 bg-primary/10'
                      : 'border-white/[0.07] bg-white/[0.025] hover:bg-white/[0.045]',
                  ].join(' ')}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-white">{candidate.fund_name || candidate.fund_code}</div>
                      <div className="mt-1 text-xs text-white/40">{candidate.fund_code} · {ASSET_LABEL[candidate.asset_class] || candidate.asset_class}</div>
                    </div>
                    {checked ? <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" /> : null}
                  </div>
                  <div className={`mt-3 inline-flex rounded border px-2 py-0.5 text-[11px] ${statusTone(candidate.metadata_status)}`}>
                    {candidate.metadata_status}
                  </div>
                </button>
              )
            })}
          </div>

          <button
            type="button"
            disabled={building || selectedCandidates.length === 0}
            onClick={() => runBuild()}
            className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-45"
          >
            {building ? <Loader2 className="h-4 w-4 animate-spin" /> : <PieChart className="h-4 w-4" />}
            生成组合
          </button>
        </section>

        <section className="space-y-5">
          <div className="workspace-panel-strong p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-white">构建结果</h2>
              {result ? <span className={`rounded border px-2 py-1 text-xs ${statusTone(result.data_quality.status)}`}>{result.data_quality.status}</span> : null}
            </div>
            {!result ? (
              <div className="mt-5 flex min-h-40 items-center justify-center rounded-md border border-dashed border-white/10 text-sm text-white/35">
                选择基金后生成组合
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  <Metric label="基金数" value={String(result.xray.fund_count)} />
                  <Metric label="前三集中度" value={pct(result.xray.concentration_top3)} />
                  <Metric label="估算费率" value={result.xray.estimated_fee === null || result.xray.estimated_fee === undefined ? '缺失' : metric(result.xray.estimated_fee * 100)} />
                </div>
                <div className="space-y-2">
                  {result.holdings.map((holding) => (
                    <div key={holding.fund_code} className="rounded-md border border-white/[0.07] bg-white/[0.025] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-white">{holding.fund_name}</div>
                          <div className="mt-1 text-xs text-white/40">{holding.fund_code} · {holding.role}</div>
                        </div>
                        <div className="data-number text-sm text-primary">{pct(holding.weight)}</div>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-white/45">{holding.rationale}</p>
                    </div>
                  ))}
                </div>
                {result.warnings.length ? (
                  <div className="rounded-md border border-amber-400/20 bg-amber-400/10 p-3 text-xs leading-relaxed text-amber-100">
                    <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
                    {result.warnings.join('；')}
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="workspace-panel-strong p-4">
            <div className="flex items-center gap-2">
              <PackageSearch className="h-4 w-4 text-primary" />
              <h2 className="text-lg font-semibold text-white">模型组合</h2>
            </div>
            <div className="mt-4 space-y-3">
              {models.map((model) => (
                <div key={model.id} className="rounded-md border border-white/[0.07] bg-white/[0.025] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-white">{model.name}</div>
                      <p className="mt-1 text-xs leading-relaxed text-white/45">{model.description}</p>
                    </div>
                    <span className={`rounded border px-2 py-1 text-xs ${statusTone(model.data_quality.status)}`}>{model.data_quality.status}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <Metric label="风险等级" value={`R${model.risk_level}`} compact />
                    <Metric label="历史测算目标" value={metric(model.target_return)} compact />
                    <Metric label="风险阈值" value={metric(model.max_drawdown)} compact />
                  </div>
                  <p className="mt-3 text-[11px] leading-relaxed text-white/35">{model.risk_disclaimer}</p>
                  <button
                    type="button"
                    onClick={() => runBuild(model)}
                    className="mt-3 inline-flex h-9 w-full items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-sm text-white/70 hover:bg-white/[0.07]"
                  >
                    载入构建
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function Metric({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className="rounded-md border border-white/[0.06] bg-white/[0.025] p-3">
      <div className="text-[11px] text-white/35">{label}</div>
      <div className={`${compact ? 'text-sm' : 'text-lg'} data-number mt-1 font-semibold text-white`}>{value}</div>
    </div>
  )
}
