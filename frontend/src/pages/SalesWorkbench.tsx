import { useState } from 'react'
import { ClipboardCheck, RefreshCw } from 'lucide-react'
import { checkSalesCompliance, generateSalesNarrative } from '@/lib/sales-api'
import type { ComplianceResultModel, SalesFact, SalesNarrativeResponse, SalesScene } from '@/types/sales'
import ComplianceCheckPanel from '@/components/sales/ComplianceCheckPanel'
import SuitabilityGateBanner from '@/components/sales/SuitabilityGateBanner'

const RISK_LEVELS = ['conservative', 'moderate', 'balanced', 'aggressive', 'radical'] as const

export default function SalesWorkbench() {
  const [clientRisk, setClientRisk] = useState<typeof RISK_LEVELS[number]>('balanced')
  const [productRisk, setProductRisk] = useState<typeof RISK_LEVELS[number]>('balanced')
  const [fundName, setFundName] = useState('测试基金')
  const [fundCode, setFundCode] = useState('000001')
  const [asOf, setAsOf] = useState('2026-06-22')
  const [result, setResult] = useState<SalesNarrativeResponse | null>(null)
  const [compliance, setCompliance] = useState<ComplianceResultModel | null>(null)
  const [customText, setCustomText] = useState('这只基金保本，而且一定能涨。')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const facts = (): SalesFact[] => [
    { key: 'fund_name', value: fundName, source: 'manual_input', as_of: asOf, status: fundName ? 'real' : 'missing' },
    { key: 'fund_code', value: fundCode, source: 'manual_input', as_of: asOf, status: fundCode ? 'real' : 'missing' },
    { key: 'risk_level', value: productRisk, source: 'manual_input', as_of: asOf, status: 'real' },
    { key: 'as_of', value: asOf, source: 'manual_input', as_of: asOf, status: asOf ? 'real' : 'missing' },
  ]

  const generate = async () => {
    setLoading(true)
    setError(null)
    try {
      const payload = await generateSalesNarrative({
        scene: 'product_recommendation' as SalesScene,
        client_profile: { client_risk_level: clientRisk },
        fund_code: fundCode,
        facts: facts(),
        tone: 'professional',
        length_type: 'standard',
      })
      setResult(payload)
      setCompliance(payload.compliance)
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败')
    } finally {
      setLoading(false)
    }
  }

  const checkText = async () => {
    setLoading(true)
    setError(null)
    try {
      const payload = await checkSalesCompliance(customText)
      setCompliance(payload.compliance)
    } catch (err) {
      setError(err instanceof Error ? err.message : '检查失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-8 md:px-6">
      <header>
        <div className="flex items-center gap-2 text-primary">
          <ClipboardCheck className="h-4 w-4" />
          <span className="text-xs font-semibold uppercase tracking-[0.18em]">Sales Guardrails</span>
        </div>
        <h1 className="mt-2 text-2xl font-semibold text-white">券商营销话术工作台</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-white/55">话术生成前会校验必要事实、适当性和合规禁用语；缺少事实或风险不匹配时不会输出推荐内容。</p>
      </header>

      <section className="workspace-panel p-5">
        <div className="grid gap-4 md:grid-cols-3">
          <TextField label="基金名称" value={fundName} onChange={setFundName} />
          <TextField label="基金代码" value={fundCode} onChange={setFundCode} />
          <TextField label="事实日期" value={asOf} onChange={setAsOf} />
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <RiskPicker label="客户风险" value={clientRisk} onChange={setClientRisk} />
          <RiskPicker label="产品风险" value={productRisk} onChange={setProductRisk} />
        </div>
        <button type="button" onClick={generate} disabled={loading} className="workspace-action-active mt-5 inline-flex h-10 items-center gap-2 px-4 text-sm font-medium disabled:opacity-60">
          <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          生成并审计
        </button>
      </section>

      {error ? <div className="rounded-lg border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-100">{error}</div> : null}
      <SuitabilityGateBanner suitability={result?.suitability ?? null} />
      <ComplianceCheckPanel compliance={compliance} />

      {result ? (
        <section className="workspace-panel p-5">
          <div className="text-sm text-white/45">生成编号：{result.generation_id || '-'}</div>
          <div className="mt-3 whitespace-pre-wrap rounded-lg border border-white/[0.07] bg-white/[0.025] p-4 text-sm leading-7 text-white/78">
            {result.content || result.missing_reason || '未生成推荐话术。'}
          </div>
        </section>
      ) : null}

      <section className="workspace-panel p-5">
        <h2 className="text-base font-semibold text-white">禁用语快速检查</h2>
        <textarea
          value={customText}
          onChange={(event) => setCustomText(event.target.value)}
          className="mt-3 min-h-24 w-full resize-y rounded-md border border-white/[0.08] bg-popover p-3 text-sm text-popover-foreground outline-none focus:border-primary/60"
        />
        <button type="button" onClick={checkText} disabled={loading} className="workspace-action mt-3 inline-flex h-9 items-center px-4 text-sm disabled:opacity-60">检查文本</button>
      </section>
    </div>
  )
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-white/40">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-white/[0.08] bg-popover px-3 text-sm text-popover-foreground outline-none focus:border-primary/60" />
    </label>
  )
}

function RiskPicker({ label, value, onChange }: { label: string; value: typeof RISK_LEVELS[number]; onChange: (value: typeof RISK_LEVELS[number]) => void }) {
  return (
    <div>
      <div className="text-xs text-white/40">{label}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {RISK_LEVELS.map((level) => (
          <button key={level} type="button" onClick={() => onChange(level)} className={value === level ? 'workspace-action-active h-9 px-3 text-xs' : 'workspace-action h-9 px-3 text-xs'}>
            {level}
          </button>
        ))}
      </div>
    </div>
  )
}
