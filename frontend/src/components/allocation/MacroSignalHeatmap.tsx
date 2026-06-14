import type { MacroSignalItem, CategorySignal } from '@/types/allocation';
import { SIGNAL_CATEGORY_ORDER, SIGNAL_CATEGORY_LABELS, SIGNAL_COLORS } from '@/types/allocation';

interface Props {
  signals: MacroSignalItem[];
  categorySummary: Record<string, CategorySignal>;
}

function scoreToColor(score: number): string {
  if (score === 0) return 'rgba(255,255,255,0.05)';
  const hue = score > 0 ? 145 : 0;
  const lightness = 35 + Math.abs(score) * 20;
  const saturation = 50 + Math.abs(score) * 20;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

function confidenceOpacity(confidence: string): number {
  if (confidence === 'high') return 1.0;
  if (confidence === 'medium') return 0.7;
  return 0.4;
}

function InterpBadge({ text }: { text: string }) {
  const color = text === '偏多' ? '#16C784' : text === '偏空' ? '#EE6666' : '#FAC858';
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color, backgroundColor: `${color}15` }}>
      {text}
    </span>
  );
}

export default function MacroSignalHeatmap({ signals, categorySummary }: Props) {
  if (!signals || signals.length === 0) {
    return (
      <div className="liquid-glass p-4 md:p-5">
        <h3 className="text-sm font-medium text-white/70 mb-3">宏观信号矩阵</h3>
        <div className="text-center py-8 text-white/50 text-sm">宏观数据未就绪</div>
      </div>
    );
  }

  // Group signals by category
  const grouped: Record<string, MacroSignalItem[]> = {};
  for (const sig of signals) {
    if (!grouped[sig.category]) grouped[sig.category] = [];
    grouped[sig.category].push(sig);
  }

  return (
    <div className="liquid-glass p-4 md:p-5">
      <h3 className="text-sm font-medium text-white/70 mb-4">宏观信号矩阵</h3>
      <div className="space-y-3">
        {SIGNAL_CATEGORY_ORDER.map((cat) => {
          const catSignals = grouped[cat];
          if (!catSignals || catSignals.length === 0) return null;
          const summary = categorySummary[cat];
          const catColor = SIGNAL_COLORS[cat] || '#fff';

          return (
            <div key={cat}>
              {/* Category header */}
              <div className="flex items-center gap-2 mb-1.5">
                <div className="w-1 h-3 rounded-sm" style={{ backgroundColor: catColor }} />
                <span className="text-xs text-white/50">{SIGNAL_CATEGORY_LABELS[cat] || cat}</span>
                {summary && (
                  <>
                    <div className="flex-1 h-1 rounded-full bg-white/[0.06] max-w-[60px] overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.abs(summary.avg_score) * 100}%`,
                          backgroundColor: summary.avg_score > 0 ? '#16C784' : summary.avg_score < 0 ? '#EE6666' : '#666',
                          marginLeft: summary.avg_score < 0 ? 'auto' : undefined,
                        }}
                      />
                    </div>
                    <InterpBadge text={summary.interpretation} />
                  </>
                )}
              </div>

              {/* Signal cells */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5 ml-3">
                {catSignals.map((sig) => (
                  <div
                    key={sig.factor_name}
                    className="rounded px-2.5 py-2 transition-all duration-200 cursor-default group relative"
                    style={{
                      backgroundColor: scoreToColor(sig.score),
                      opacity: confidenceOpacity(sig.confidence),
                      border: `1px solid rgba(255,255,255,${sig.confidence === 'high' ? 0.08 : 0.04})`,
                    }}
                    title={`${sig.factor_name}: 值=${sig.value ?? '暂无'}, 评分=${sig.score > 0 ? '+' : ''}${sig.score.toFixed(2)}, 置信度=${sig.confidence}`}
                  >
                    <div className="text-[11px] text-white/60 truncate">{sig.factor_name}</div>
                    <div className="data-number text-xs font-medium mt-0.5" style={{ color: sig.score > 0.3 ? '#16C784' : sig.score < -0.3 ? '#EE6666' : 'rgba(255,255,255,0.6)' }}>
                      {sig.score > 0 ? '+' : ''}{sig.score.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
