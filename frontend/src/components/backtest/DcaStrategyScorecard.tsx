import type { DcaStrategyLabResponse } from '@/types/dca-lab'

function fmt(value: number | null | undefined, suffix = '') {
  if (value == null || Number.isNaN(value)) return '-'
  return `${value.toFixed(2)}${suffix}`
}

export default function DcaStrategyScorecard({ result }: { result: DcaStrategyLabResponse | null }) {
  if (!result) return null
  return (
    <section className="workspace-panel p-5">
      <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-base font-semibold text-white">定投策略评分</h2>
          <p className="mt-1 text-xs text-white/45">历史区间适配度分析，不构成收益承诺。</p>
        </div>
        <span className="text-xs text-white/40">数据状态：{result.data_quality.status}</span>
      </div>
      {result.scores.length ? (
        <div className="mt-4 overflow-hidden rounded-lg border border-white/[0.07]">
          {result.scores.map((item) => (
            <div key={item.strategy_id} className="grid grid-cols-5 gap-2 border-b border-white/[0.06] px-3 py-3 text-xs text-white/58 last:border-b-0">
              <span className="font-medium text-white/78">#{item.rank} {item.strategy_type}</span>
              <span>评分 {fmt(item.score)}</span>
              <span>年化 {fmt(item.annualized_return, '%')}</span>
              <span>回撤 {fmt(item.max_drawdown, '%')}</span>
              <span>Sharpe {fmt(item.sharpe_ratio)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-[#FAC858]/20 bg-[#FAC858]/[0.04] p-4 text-sm text-[#FAC858]/85">
          {result.data_quality.missing_reason || '缺少真实净值，未生成策略评分。'}
        </div>
      )}
      {result.warnings.length ? <p className="mt-3 text-xs text-white/42">{result.warnings.join(' ')}</p> : null}
    </section>
  )
}
