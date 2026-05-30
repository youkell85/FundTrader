import { useState, useEffect } from 'react';
import { useAllocationData } from '@/hooks/useAllocationData';
import PageHeader from '@/components/ui/PageHeader';
import MarketRegimeCard from '@/components/allocation/MarketRegimeCard';
import CircuitBreakerGauge from '@/components/allocation/CircuitBreakerGauge';
import MacroSignalHeatmap from '@/components/allocation/MacroSignalHeatmap';
import DataFreshnessBar from '@/components/allocation/DataFreshnessBar';
import { getMarketDataStatus } from '@/lib/api';
import type { MarketDataStatus } from '@/types/allocation';

export default function MarketPage() {
  const { d, taa, meta } = useAllocationData();
  const [marketStatus, setMarketStatus] = useState<MarketDataStatus | null>(null);

  useEffect(() => {
    let active = true;
    const fetchStatus = () => {
      getMarketDataStatus().then((s) => { if (active) setMarketStatus(s); }).catch(() => {});
    };
    fetchStatus();
    const timer = setInterval(fetchStatus, 60000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  return (
    <div className="space-y-5">
      <PageHeader title="市场洞察" regime={meta.regime} regimeLabel={meta.regime_label} generatedAt={meta.generated_at} />
      <DataFreshnessBar status={marketStatus} generatedAt={meta.generated_at} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <MarketRegimeCard
          regime={meta.regime}
          regimeLabel={meta.regime_label}
          compositeScore={taa.composite_score}
          categorySummary={taa.category_summary}
          circuitBreakerTriggered={meta.circuit_breaker_triggered}
          regimePending={meta.regime_pending}
          regimePendingCount={meta.regime_pending_count}
          regimeConfirmed={meta.regime_is_confirmed}
        />
        <CircuitBreakerGauge triggered={meta.circuit_breaker_triggered} volRatio={marketStatus?.vol_ratio ?? null} />
      </div>

      <MacroSignalHeatmap signals={taa.signals} categorySummary={taa.category_summary} />
    </div>
  );
}
