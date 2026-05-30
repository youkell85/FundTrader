import type { MarketRegime, CategorySignal } from '@/types/allocation';
import { REGIME_COLORS, REGIME_LABELS } from '@/types/allocation';

interface Props {
  regime: MarketRegime;
  regimeLabel: string;
  compositeScore: number;
  categorySummary: Record<string, CategorySignal>;
  circuitBreakerTriggered: boolean;
  compact?: boolean;
  regimePending?: string | null;
  regimePendingCount?: number;
  regimeConfirmed?: boolean;
}

const REGIME_DESC: Record<string, string> = {
  goldilocks: '经济增长强劲、通胀温和',
  overheat: '经济过热、通胀上行',
  stagflation: '增长放缓、通胀高企',
  deflation: '增长疲弱、通胀低迷',
  baseline: '信号不明、维持基准',
};

const PENDING_LABELS: Record<string, string> = {
  goldilocks: '金发女孩',
  overheat: '过热',
  stagflation: '滞胀',
  deflation: '通缩',
  baseline: '基准',
};

export default function MarketRegimeCard({ regime, regimeLabel, compositeScore, categorySummary, circuitBreakerTriggered, compact, regimePending, regimePendingCount, regimeConfirmed }: Props) {
  const color = REGIME_COLORS[regime] || REGIME_COLORS.baseline;
  const label = regimeLabel || REGIME_LABELS[regime] || '基准';
  const showPending = regimePending && !regimeConfirmed;
  const pendingColor = REGIME_COLORS[regimePending as MarketRegime] || '#FAC858';
  if (compact) {
    return (
      <div className="col-span-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-3 flex items-center gap-3">
        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
        <div>
          <div className="text-white/55 text-xs">市场政权</div>
          <div className="text-base font-medium mt-0.5" style={{ color }}>{label}</div>
          {showPending && (
            <div className="text-[10px] text-[#FAC858] mt-0.5 flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#FAC858] motion-safe:animate-pulse" />
              待确认→{PENDING_LABELS[regimePending] || regimePending}{regimePendingCount != null && ` (${regimePendingCount}/2)`}
            </div>
          )}
        </div>
        <div className="ml-auto text-right">
          <div className="text-white/55 text-xs">综合信号</div>
          <div className="data-number text-base font-medium mt-0.5" style={{ color: compositeScore > 0.2 ? '#F5384B' : compositeScore < -0.2 ? '#16C784' : '#FAC858' }}>
            {compositeScore > 0 ? '+' : ''}{compositeScore.toFixed(2)}
          </div>
        </div>
        {circuitBreakerTriggered && <span className="text-[#EE6666] text-xs font-medium motion-safe:animate-pulse">⚡熔断</span>}
      </div>
    );
  }

  const growthScore = categorySummary?.growth?.avg_score ?? 0;
  const inflationScore = categorySummary?.inflation?.avg_score ?? 0;
  const dotX = 100 + growthScore * 80;
  const dotY = 100 - inflationScore * 80;

  return (
    <div className="liquid-glass p-4 md:p-5" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-lg font-semibold" style={{ color }}>{label}</span>
            {circuitBreakerTriggered && <span className="text-[#EE6666] text-xs font-medium px-2 py-0.5 rounded bg-[#EE6666]/10 motion-safe:animate-pulse">熔断触发</span>}
            {regimeConfirmed && <span className="text-[#F5384B] text-[10px] px-1.5 py-0.5 rounded bg-[#F5384B]/10">✓ 已确认</span>}
          </div>
          <p className="text-white/45 text-sm">{REGIME_DESC[regime]}</p>
          {showPending && (
            <div className="mt-2 px-3 py-2 rounded-lg bg-[#FAC858]/[0.08] border border-[#FAC858]/20">
              <div className="flex items-center gap-2 text-xs">
                <span className="inline-block w-2 h-2 rounded-full motion-safe:animate-pulse" style={{ backgroundColor: pendingColor }} />
                <span className="text-[#FAC858] font-medium">待确认政权: {PENDING_LABELS[regimePending] || regimePending}</span>
                {regimePendingCount != null && <span className="text-white/40 ml-1">确认进度 {regimePendingCount}/2 期</span>}
              </div>
              <p className="text-white/55 text-[11px] mt-1">需连续2期信号一致方可切换，当前仍沿用已确认政权</p>
            </div>
          )}
          <div className="flex gap-4 mt-3 text-sm">
            <div><span className="text-white/55">综合信号: </span><span className="data-number font-medium" style={{ color: compositeScore > 0.2 ? '#F5384B' : compositeScore < -0.2 ? '#16C784' : '#FAC858' }}>{compositeScore > 0 ? '+' : ''}{compositeScore.toFixed(2)}</span></div>
          </div>
        </div>

        <div className="hidden md:block flex-shrink-0">
          <svg width="160" height="160" viewBox="0 0 200 200" className="opacity-80">
            <rect x="100" y="100" width="100" height="100" fill="#16C78418" />
            <rect x="0" y="0" width="100" height="100" fill="#FAC85818" />
            <rect x="100" y="0" width="100" height="100" fill="#EE666618" />
            <rect x="0" y="100" width="100" height="100" fill="#73C0DE18" />
            <line x1="0" y1="100" x2="200" y2="100" stroke="white" strokeOpacity="0.12" />
            <line x1="100" y1="0" x2="100" y2="200" stroke="white" strokeOpacity="0.12" />
            <text x="150" y="190" textAnchor="middle" fill="white" fillOpacity="0.3" fontSize="9">金发女孩</text>
            <text x="150" y="15" textAnchor="middle" fill="white" fillOpacity="0.3" fontSize="9">过热</text>
            <text x="50" y="15" textAnchor="middle" fill="white" fillOpacity="0.3" fontSize="9">滞胀</text>
            <text x="50" y="190" textAnchor="middle" fill="white" fillOpacity="0.3" fontSize="9">通缩</text>
            <text x="195" y="105" textAnchor="end" fill="white" fillOpacity="0.2" fontSize="8">增长+</text>
            <text x="100" y="10" textAnchor="middle" fill="white" fillOpacity="0.2" fontSize="8">通胀+</text>
            <circle cx={dotX} cy={dotY} r="5" fill={color} opacity="0.9" />
            <circle cx={dotX} cy={dotY} r="10" fill="none" stroke={color} strokeOpacity="0.25" strokeWidth="1" />
          </svg>
        </div>
      </div>
    </div>
  );
}
