import { ShieldAlert, ShieldCheck } from 'lucide-react'
import type { ComplianceResultModel } from '@/types/sales'

export default function ComplianceCheckPanel({ compliance }: { compliance: ComplianceResultModel | null }) {
  if (!compliance) return null
  const blocked = compliance.level === 'block'
  return (
    <section className="workspace-panel p-5">
      <div className="flex items-center gap-2 text-white">
        {blocked ? <ShieldAlert className="h-4 w-4 text-red-300" /> : <ShieldCheck className="h-4 w-4 text-primary" />}
        <h2 className="text-base font-semibold">合规检查</h2>
      </div>
      <div className="mt-3 text-sm text-white/62">状态：{compliance.level}</div>
      {compliance.issues.length ? (
        <ul className="mt-3 space-y-2 text-sm text-red-100/85">
          {compliance.issues.map((issue) => <li key={issue}>{issue}</li>)}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-white/55">未发现禁止性表述。</p>
      )}
    </section>
  )
}
