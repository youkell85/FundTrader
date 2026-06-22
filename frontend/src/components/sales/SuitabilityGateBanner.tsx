import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import type { SuitabilityResultModel } from '@/types/sales'

export default function SuitabilityGateBanner({ suitability }: { suitability: SuitabilityResultModel | null }) {
  if (!suitability) return null
  const rejected = suitability.decision === 'rejected'
  return (
    <div className={rejected ? 'rounded-lg border border-red-400/20 bg-red-500/10 p-4' : 'rounded-lg border border-white/[0.07] bg-white/[0.035] p-4'}>
      <div className="flex items-center gap-2 text-sm font-medium text-white">
        {rejected ? <AlertTriangle className="h-4 w-4 text-red-300" /> : <CheckCircle2 className="h-4 w-4 text-primary" />}
        适当性：{suitability.decision}
      </div>
      <ul className="mt-2 space-y-1 text-sm text-white/60">
        {suitability.reasons.map((reason) => <li key={reason}>{reason}</li>)}
      </ul>
    </div>
  )
}
