import { Link, useParams } from 'react-router'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import ProfessionalScorePanel from '@/components/fund/ProfessionalScorePanel'

export default function ProfessionalEvaluation() {
  const { code = '' } = useParams<{ code: string }>()
  const valid = /^\d{6}$/.test(code)

  return (
    <div className="min-h-screen pb-12 pt-16">
      <main className="mx-auto max-w-6xl px-4 md:px-6">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <Link to={valid ? `/${code}` : '/'} className="inline-flex items-center gap-1 text-sm text-white/50 hover:text-white">
            <ArrowLeft className="h-4 w-4" />
            返回基金详情
          </Link>
        </div>
        <div className="mb-5">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary/80">
            <ShieldCheck className="h-4 w-4" />
            Professional Evaluation
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-white md:text-3xl">基金专业评价</h1>
          <p className="mt-2 text-sm text-white/45">
            {valid ? `${code} 的证据化评分、Brinson readiness 与风格诊断。` : '基金代码格式无效。'}
          </p>
        </div>
        {valid ? (
          <ProfessionalScorePanel code={code} />
        ) : (
          <div className="rounded-md border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-100">
            请输入 6 位基金代码。
          </div>
        )}
      </main>
    </div>
  )
}
