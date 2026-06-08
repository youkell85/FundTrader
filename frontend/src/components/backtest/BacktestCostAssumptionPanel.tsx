import type { CostAssumptionSummary } from '@/types/backtest';

interface Props {
  costAssumption: CostAssumptionSummary | null | undefined;
}

function fmt(v: number | null | undefined, suffix?: string, digits = 2): string {
  if (v == null || Number.isNaN(v)) return '—';
  return `${v.toFixed(digits)}${suffix || ''}`;
}

export default function BacktestCostAssumptionPanel({ costAssumption }: Props) {
  if (!costAssumption || !costAssumption.enabled) {
    const reason = costAssumption?.missing_reason || '暂无成本扣减数据';
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
        <h3 className="text-sm font-medium text-white/70 mb-3">成本假设与换手影响</h3>
        <p className="text-xs text-white/30 italic">{reason}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
      <h3 className="text-sm font-medium text-white/70 mb-4">成本假设与换手影响</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        <div className="rounded-md border border-white/[0.05] bg-white/[0.02] px-2.5 py-2">
          <div className="text-[10px] text-white/35">成本假设</div>
          <div className="mt-0.5 text-sm font-medium text-white/70 data-number">{fmt(costAssumption.cost_bps, ' bps', 0)}</div>
        </div>
        <div className="rounded-md border border-white/[0.05] bg-white/[0.02] px-2.5 py-2">
          <div className="text-[10px] text-white/35">平均换手</div>
          <div className="mt-0.5 text-sm font-medium text-white/70 data-number">{fmt(costAssumption.avg_turnover_pct, '%', 1)}</div>
        </div>
        <div className="rounded-md border border-white/[0.05] bg-white/[0.02] px-2.5 py-2">
          <div className="text-[10px] text-white/35">累计成本扣减</div>
          <div className="mt-0.5 text-sm font-medium text-white/70 data-number">{fmt(costAssumption.total_cost_pct, '%', 2)}</div>
        </div>
        <div className="rounded-md border border-white/[0.05] bg-white/[0.02] px-2.5 py-2">
          <div className="text-[10px] text-white/35">年化成本扣减</div>
          <div className="mt-0.5 text-sm font-medium text-white/70 data-number">{fmt(costAssumption.annualized_cost_pct, '%', 2)}</div>
        </div>
        <div className="rounded-md border border-white/[0.05] bg-white/[0.02] px-2.5 py-2">
          <div className="text-[10px] text-white/35">调整次数</div>
          <div className="mt-0.5 text-sm font-medium text-white/70 data-number">{fmt(costAssumption.rebalance_count, '', 0)}</div>
        </div>
        <div className="rounded-md border border-white/[0.05] bg-white/[0.02] px-2.5 py-2">
          <div className="text-[10px] text-white/35">数据来源</div>
          <div className="mt-0.5 text-sm font-medium text-white/70">{costAssumption.source || '—'}</div>
        </div>
      </div>
    </div>
  );
}
