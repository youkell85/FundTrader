interface Props {
  triggered: boolean;
  volRatio: number | null;
}

const LEVELS = [
  { label: 'Normal', max: 1.2, color: '#16C784', width: '40%' },
  { label: 'Caution', max: 1.8, color: '#FAC858', width: '20%' },
  { label: 'Warning', max: 2.5, color: '#F97316', width: '23%' },
  { label: 'Emergency', max: Infinity, color: '#EE6666', width: '17%' },
];

const EQUITY_REDUCTION: Record<number, number> = { 1: 10, 2: 30, 3: 50 };

function getLevel(ratio: number): number {
  if (ratio >= 2.5) return 3;
  if (ratio >= 1.8) return 2;
  if (ratio >= 1.2) return 1;
  return 0;
}

function getIndicatorPosition(ratio: number): string {
  if (ratio <= 0) return '0%';
  // Map ratio to bar position (0 → 0%, 1.2 → 40%, 1.8 → 60%, 2.5 → 83%, 3.5 → 100%)
  if (ratio <= 1.2) return `${(ratio / 1.2) * 40}%`;
  if (ratio <= 1.8) return `${40 + ((ratio - 1.2) / 0.6) * 20}%`;
  if (ratio <= 2.5) return `${60 + ((ratio - 1.8) / 0.7) * 23}%`;
  return `${Math.min(100, 83 + ((ratio - 2.5) / 1.0) * 17)}%`;
}

export default function CircuitBreakerGauge({ triggered, volRatio }: Props) {
  const level = volRatio !== null ? getLevel(volRatio) : -1;
  const reduction = level > 0 ? EQUITY_REDUCTION[level] : 0;

  return (
    <div className="liquid-glass p-4 md:p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-white/70">熔断器状态</h3>
        {triggered && reduction > 0 && (
          <span className="text-xs font-medium px-2 py-0.5 rounded bg-[#EE6666]/10 text-[#EE6666] animate-pulse">
            权益减持 {reduction}%
          </span>
        )}
        {!triggered && volRatio !== null && (
          <span className="text-xs text-white/55">{LEVELS[level]?.label || 'Normal'}</span>
        )}
      </div>

      {/* Segmented bar */}
      <div className="relative h-5 flex rounded-md overflow-hidden border border-white/[0.06]">
        {volRatio === null ? (
          <div className="w-full bg-white/[0.04] flex items-center justify-center text-[10px] text-white/50">
            数据暂不可用
          </div>
        ) : (
          LEVELS.map((seg, i) => (
            <div
              key={seg.label}
              className="h-full relative transition-all duration-300"
              style={{
                width: seg.width,
                backgroundColor: i <= level ? `${seg.color}30` : 'rgba(255,255,255,0.03)',
                borderRight: i < 3 ? '1px solid rgba(255,255,255,0.08)' : 'none',
              }}
            >
              {i <= level && (
                <div
                  className="absolute inset-0 transition-opacity duration-300"
                  style={{
                    backgroundColor: `${seg.color}${i === level ? '40' : '20'}`,
                    animation: i === level && triggered ? 'pulse 2s infinite' : 'none',
                  }}
                />
              )}
            </div>
          ))
        )}

        {/* Indicator arrow */}
        {volRatio !== null && (
          <div
            className="absolute top-0 h-full w-0.5 bg-white/90 transition-all duration-500 ease-out"
            style={{ left: getIndicatorPosition(volRatio) }}
          >
            <div className="absolute -top-1 -left-1 w-2.5 h-2.5 rotate-45 bg-white/80" />
          </div>
        )}
      </div>

      {/* Threshold labels */}
      <div className="flex mt-1.5 text-[10px] text-white/50 relative">
        <span style={{ position: 'absolute', left: '0%' }}>0</span>
        <span style={{ position: 'absolute', left: '38%' }}>1.2</span>
        <span style={{ position: 'absolute', left: '58%' }}>1.8</span>
        <span style={{ position: 'absolute', left: '81%' }}>2.5</span>
        {volRatio !== null && (
          <span className="ml-auto text-white/45 data-number">vol_ratio = {volRatio.toFixed(2)}</span>
        )}
      </div>
    </div>
  );
}
