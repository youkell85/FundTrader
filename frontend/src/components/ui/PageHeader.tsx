import { REGIME_LABELS } from '@/types/allocation';

interface PageHeaderProps {
  title: string;
  engineVersion?: string;
  regime?: string;
  regimeLabel?: string;
  generatedAt?: string;
  circuitBreakerTriggered?: boolean;
}

export default function PageHeader({
  title,
  engineVersion,
  regime,
  regimeLabel,
  generatedAt,
  circuitBreakerTriggered,
}: PageHeaderProps) {
  return (
    <div className="pt-7 pb-2">
      <h1 className="text-2xl md:text-3xl font-semibold text-white tracking-tight">{title}</h1>
      <div className="flex flex-wrap items-center gap-2 mt-2 text-sm text-white/45">
        {engineVersion && (
          <>
            <span>引擎 {engineVersion}</span>
            <span>·</span>
          </>
        )}
        {regime && (
          <>
            <span>
              市场:{' '}
              <span className="text-[#16C784]">{(REGIME_LABELS as any)[regime] || regimeLabel || regime}</span>
            </span>
            <span>·</span>
          </>
        )}
        {generatedAt && <span>{generatedAt.slice(0, 16)}</span>}
        {circuitBreakerTriggered && (
          <span className="text-[#EE6666] font-medium">⚡熔断</span>
        )}
      </div>
    </div>
  );
}
