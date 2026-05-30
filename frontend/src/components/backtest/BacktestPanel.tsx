import React, { useState } from 'react';
import { AlertCircle, Info } from 'lucide-react';
import type { BacktestRequest, BacktestResponse } from '@/types/backtest';
import { runAllocationBacktest } from '@/lib/api';
import BacktestConfig from './BacktestConfig';
import EquityCurveChart from './EquityCurveChart';
import DrawdownChart from './DrawdownChart';
import RegimeTimeline from './RegimeTimeline';
import BacktestMetricsTable from './BacktestMetricsTable';

export default function BacktestPanel() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRequest, setLastRequest] = useState<BacktestRequest | null>(null);

  const handleRun = async (req: BacktestRequest) => {
    setLoading(true);
    setError(null);
    setLastRequest(req);
    try {
      const res = await runAllocationBacktest(req);
      setResult(res);
    } catch (e: any) {
      setError(e?.message || '回测失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <BacktestConfig onRun={handleRun} loading={loading} />

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-red-300 font-medium">回测执行失败</p>
            <p className="text-xs text-red-300/60 mt-1">{error}</p>
          </div>
        </div>
      )}

      {result && (
        <>
          {/* Data quality notice */}
          {result.data_quality && (result.data_quality.assets_with_partial_history > 0 || result.data_quality.missing_assets.length > 0) && (
            <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3 flex items-start gap-2">
              <Info className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
              <div className="text-xs text-yellow-300/70">
                <span className="font-medium text-yellow-300">数据说明: </span>
                实际区间 {result.data_quality.earliest_common_date} ~ {result.data_quality.earliest_common_date},
                {result.data_quality.assets_with_full_history}/{result.data_quality.assets_with_full_history + result.data_quality.assets_with_partial_history} 资产完整覆盖
                {result.data_quality.missing_assets.length > 0 && <>, 缺失: {result.data_quality.missing_assets.join(', ')}</>}
              </div>
            </div>
          )}

          <EquityCurveChart curves={result.curves} initialAmount={lastRequest?.initial_amount || 1000000} />
          <DrawdownChart curves={result.curves} />
          <BacktestMetricsTable metrics={result.metrics} />
          <RegimeTimeline regimeHistory={result.regime_history} attribution={result.attribution} />
        </>
      )}
    </div>
  );
}
