import { useEffect, useState } from 'react';
import { useAllocationData } from '@/hooks/useAllocationData';
import PageHeader from '@/components/ui/PageHeader';
import MarketRegimeCard from '@/components/allocation/MarketRegimeCard';
import CircuitBreakerGauge from '@/components/allocation/CircuitBreakerGauge';
import MacroSignalHeatmap from '@/components/allocation/MacroSignalHeatmap';
import DataFreshnessBar from '@/components/allocation/DataFreshnessBar';
import MarketDataDiagnosticsPanel from '@/components/allocation/MarketDataDiagnosticsPanel';
import {
  getMarketDataSourceHealth,
  getMarketDataSourcesStatus,
  getMarketDataStatus,
  subscribeMarketDataStream,
} from '@/lib/api';
import type {
  DataSourceHealthSnapshot,
  MarketDataSourcesStatus,
  MarketDataStatus,
} from '@/types/allocation';

export default function MarketPage() {
  const { taa, meta } = useAllocationData();

  const [marketStatus, setMarketStatus] = useState<MarketDataStatus | null>(null);
  const [marketHealth, setMarketHealth] = useState<DataSourceHealthSnapshot | null>(null);
  const [sourceStatus, setSourceStatus] = useState<MarketDataSourcesStatus | null>(null);
  const [streamOk, setStreamOk] = useState<boolean>(false);

  useEffect(() => {
    let active = true;

    const fetchStatus = () => {
      getMarketDataStatus().then((s) => {
        if (active) setMarketStatus(s);
      }).catch(() => {});
    };

    const fetchSourceStatus = () => {
      getMarketDataSourcesStatus().then((s) => {
        if (active) setSourceStatus(s);
      }).catch(() => {});
    };

    const fetchHealth = () => {
      getMarketDataSourceHealth().then((s) => {
        if (active) setMarketHealth(s);
      }).catch(() => {});
    };

    const stream = subscribeMarketDataStream({
      interval: 5,
      onOpen: () => setStreamOk(true),
      onMessage: (payload) => {
        if (!active) return;
        if (payload?.type === 'market_data_health' && payload.data) {
          setMarketHealth(payload.data);
          setStreamOk(true);
        }
      },
      onClose: () => setStreamOk(false),
      onError: () => setStreamOk(false),
    });
    fetchStatus();
    fetchSourceStatus();
    fetchHealth();

    const timer = setInterval(() => {
      fetchStatus();
      fetchHealth();
      fetchSourceStatus();
    }, 60000);

    return () => {
      active = false;
      clearInterval(timer);
      setStreamOk(false);
      stream.close();
    };
  }, []);

  return (
    <div className="space-y-5">
      <PageHeader
        title="市场数据"
        regime={meta.regime}
        regimeLabel={meta.regime_label}
        generatedAt={meta.generated_at}
      />
      <DataFreshnessBar status={marketStatus} generatedAt={meta.generated_at} />
      <MarketDataDiagnosticsPanel health={marketHealth} dataSourceStatus={sourceStatus} />

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
        <CircuitBreakerGauge
          triggered={meta.circuit_breaker_triggered}
          volRatio={marketStatus?.vol_ratio ?? null}
        />
      </div>

      <div className="text-xs text-white/50">
        数据源推送：{streamOk ? '已连接' : '未连接，正在轮询兜底'}
      </div>

      <MacroSignalHeatmap
        signals={taa.signals}
        categorySummary={taa.category_summary}
      />
    </div>
  );
}

