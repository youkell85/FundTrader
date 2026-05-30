import React from 'react';
import type { RegimeHistoryEntry } from '@/types/backtest';
import { REGIME_LABELS, REGIME_COLORS } from '@/types/allocation';

interface Props {
  regimeHistory: RegimeHistoryEntry[];
  attribution: Record<string, { total_return: number; period_count: number; total_days: number }>;
}

export default function RegimeTimeline({ regimeHistory, attribution }: Props) {
  if (!regimeHistory || regimeHistory.length === 0) return null;

  const totalDays = regimeHistory.reduce((sum, r) => {
    const d = (new Date(r.end_date).getTime() - new Date(r.start_date).getTime()) / 86400000;
    return sum + Math.max(d, 1);
  }, 0);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
      <h3 className="text-sm font-medium text-white/70 mb-4">市场政权时间轴</h3>

      {/* Timeline bar */}
      <div className="flex rounded-md overflow-hidden h-6 mb-4">
        {regimeHistory.map((r, i) => {
          const days = (new Date(r.end_date).getTime() - new Date(r.start_date).getTime()) / 86400000;
          const pct = Math.max((days / totalDays) * 100, 0.5);
          return (
            <div key={i} style={{ width: `${pct}%`, backgroundColor: REGIME_COLORS[r.regime] || '#666' }}
              className="relative group cursor-default" title={`${REGIME_LABELS[r.regime]} (${r.start_date} ~ ${r.end_date})`}>
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block whitespace-nowrap rounded bg-black/90 px-2 py-1 text-xs text-white z-10">
                {REGIME_LABELS[r.regime]}: {r.start_date.slice(0, 7)} ~ {r.end_date.slice(0, 7)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend + attribution */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
        {Object.entries(REGIME_LABELS).map(([k, label]) => {
          const attr = attribution[k];
          return (
            <div key={k} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: REGIME_COLORS[k] || '#666' }} />
              <span className="text-xs text-white/50">{label}</span>
              {attr !== undefined && (
                <span className={`text-xs font-medium ${attr.total_return >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {attr.total_return >= 0 ? '+' : ''}{(attr.total_return * 100).toFixed(1)}%
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
