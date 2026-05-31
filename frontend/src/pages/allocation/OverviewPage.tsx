import { useState, useRef, useEffect, useCallback } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { PieChart as PieIcon, Gauge, List, ChevronDown, ChevronRight, Play, AlertCircle } from 'lucide-react';
import { GROUP_COLORS, REGIME_LABELS } from '@/types/allocation';
import { useAllocationData } from '@/hooks/useAllocationData';
import { useAllocationStore } from '@/store/allocationStore';
import { generateAllocationStream } from '@/lib/api';
import AllocationProgress, { type StepState, STEP_LABELS } from '@/components/allocation/AllocationProgress';
import PageHeader from '@/components/ui/PageHeader';
import MetricCard from '@/components/ui/MetricCard';
import MarketRegimeCard from '@/components/allocation/MarketRegimeCard';
import DataFreshnessBar from '@/components/allocation/DataFreshnessBar';

const GLABELS: Record<string, string> = { equity: '权益类', fixed_income: '固收类', alternative: '另类', cash_equiv: '现金类' };

export default function OverviewPage() {
  const { d, saa, taa, funds, mc, st, pm, meta, isMock } = useAllocationData();
  const { state: storeState, dispatch } = useAllocationStore();
  const [expandLog, setExpandLog] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [streamSteps, setStreamSteps] = useState<StepState[]>(() =>
    Object.keys(STEP_LABELS).map(name => ({ name, status: "running" as const, detail: "" }))
  );
  const [currentStep, setCurrentStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const startTime = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const streamCancelRef = useRef<{ cancel: () => void } | null>(null);

  useEffect(() => { return () => { if (timerRef.current) clearInterval(timerRef.current); }; }, []);

  const startTimer = useCallback(() => {
    startTime.current = Date.now();
    timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startTime.current) / 1000)), 200);
  }, []);
  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = undefined; }
  }, []);

  const handleGenerate = () => {
    setGenerating(true);
    setGenError(null);
    setCurrentStep(0);
    setStreamSteps(Object.keys(STEP_LABELS).map(name => ({ name, status: "running" as const, detail: "" })));
    startTimer();

    streamCancelRef.current = generateAllocationStream(
      storeState.config,
      (step, _total, name, status, detail) => {
        setCurrentStep(step);
        setStreamSteps(prev => prev.map(s => s.name === name ? { ...s, status: status as StepState["status"], detail } : s));
      },
      (result) => { stopTimer(); setGenerating(false); dispatch({ type: 'SET_OUTPUT', output: result }); },
      (msg) => { stopTimer(); setGenerating(false); setGenError(msg); },
      () => { stopTimer(); setGenerating(false); },
    );
  };

  const handleCancelGenerate = () => {
    streamCancelRef.current?.cancel();
    stopTimer();
    setGenerating(false);
  };

  const pieData = Object.entries(saa.group_allocations)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ name: GLABELS[k] || k, value: v }));
  const stressData = [...st].sort((a, b) => a.impact - b.impact);

  return (
    <div className="space-y-5">
      <PageHeader
        title="配置方案"
        engineVersion={meta.engine_version}
        regime={meta.regime}
        regimeLabel={meta.regime_label}
        generatedAt={meta.generated_at}
        circuitBreakerTriggered={meta.circuit_breaker_triggered}
      />

      <DataFreshnessBar generatedAt={meta.generated_at} />

      {isMock && (
        <div className="liquid-glass p-4 border border-[#3B6CFF]/20 bg-[#3B6CFF]/[0.05]">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-white/70">当前显示为示例数据，点击生成真实配置方案</p>
              {genError && (
                <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" aria-hidden="true" /> {genError}
                </p>
              )}
            </div>
            {generating ? (
              <AllocationProgress steps={streamSteps} currentStep={currentStep} totalSteps={14} elapsed={elapsed} onCancel={handleCancelGenerate} />
            ) : (
              <button onClick={handleGenerate} disabled={generating} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#3B6CFF] text-white text-sm font-medium hover:bg-[#3B6CFF]/80 disabled:opacity-50 transition-colors focus-visible:ring-2 focus-visible:ring-[#3B6CFF]/50">
                <Play className="w-4 h-4" aria-hidden="true" /> 生成配置
              </button>
            )}
          </div>
        </div>
      )}

      {!isMock && (
        <div className="flex items-center gap-3">
          {generating ? (
            <div className="flex-1"><AllocationProgress steps={streamSteps} currentStep={currentStep} totalSteps={14} elapsed={elapsed} onCancel={handleCancelGenerate} /></div>
          ) : (
            <button onClick={handleGenerate} disabled={generating} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#3B6CFF]/10 text-[#5AA9FF] text-xs font-medium hover:bg-[#3B6CFF]/20 disabled:opacity-50 transition-colors focus-visible:ring-2 focus-visible:ring-[#3B6CFF]/50">
              <Play className="w-3.5 h-3.5" aria-hidden="true" /> 重新生成
            </button>
          )}
          {genError && (
            <p className="text-xs text-red-400 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" aria-hidden="true" /> {genError}
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-6 gap-2 md:gap-3">
        <MarketRegimeCard
          regime={meta.regime}
          regimeLabel={meta.regime_label}
          compositeScore={taa.composite_score}
          categorySummary={taa.category_summary}
          circuitBreakerTriggered={meta.circuit_breaker_triggered}
          regimePending={meta.regime_pending}
          regimePendingCount={meta.regime_pending_count}
          regimeConfirmed={meta.regime_is_confirmed}
          compact
        />
        <MetricCard label="预期年化" value={`${pm.expected_return}%`} color="#16C784" />
        <MetricCard label="波动率" value={`${pm.volatility}%`} color="#FAC858" />
        <MetricCard label="最大回撤" value={`${pm.max_drawdown}%`} color="#EE6666" />
        <MetricCard label="夏普比率" value={pm.sharpe.toFixed(2)} color="#5470C6" />
        <MetricCard label="Calmar" value={pm.calmar.toFixed(2)} color="#91CC75" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="liquid-glass p-4">
          <h3 className="text-sm text-white/70 mb-3">
            <PieIcon className="w-4 h-4 inline mr-2" style={{ color: '#3B6CFF' }} />
            资产配置
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" outerRadius={80} innerRadius={45} dataKey="value" label={({ name, value }) => name + ' ' + (value as number).toFixed(1) + '%'}>
                {pieData.map((_, i) => (
                  <Cell key={i} fill={Object.values(GROUP_COLORS)[i % 4]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="liquid-glass p-4">
          <h3 className="text-sm text-white/70 mb-3">
            <Gauge className="w-4 h-4 inline mr-2" style={{ color: '#FAC858' }} />
            风险预算瀑布
          </h3>
          <div className="space-y-2">
            {Object.entries(saa.group_allocations).map(([k, v]) => (
              <div key={k}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-white/50">{GLABELS[k] || k}</span>
                  <span className="data-number text-white/70">{v.toFixed(1)}%</span>
                </div>
                <div className="h-3 rounded-full bg-white/[0.04] overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${v}%`, backgroundColor: (GROUP_COLORS as any)[k] || '#5470C6' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="liquid-glass p-4">
        <button
          aria-expanded={expandLog}
          onClick={() => setExpandLog(!expandLog)}
          className="flex items-center justify-between w-full text-sm text-white/70 focus-visible:ring-2 focus-visible:ring-[#3B6CFF]/50 rounded-lg px-2 py-1 -mx-2 -my-1"
        >
          <span>
            <List className="w-4 h-4 inline mr-2" style={{ color: '#9D7BFF' }} aria-hidden="true" />
            配置审计日志
          </span>
          {expandLog ? <ChevronDown className="w-4 h-4" aria-hidden="true" /> : <ChevronRight className="w-4 h-4" aria-hidden="true" />}
        </button>
        {expandLog && (
          <div className="mt-3 space-y-1 text-xs text-white/45">
            <div>PORTRAIT: 风险=平衡型, 有效=平衡型</div>
            <div>
              REGIME: {meta.regime_label}
              {meta.regime_pending && !meta.regime_is_confirmed
                ? ` → 待确认: ${meta.regime_pending}(${meta.regime_pending_count}/2)`
                : ''}{' '}
              (composite={taa.composite_score.toFixed(2)})
            </div>
            <div className="text-[#16C784]">SAA: SLSQP两层求解, 权益中枢{saa.equity_center}%</div>
            <div className="text-[#5AA9FF]">
              TAA: 综合{taa.composite_score > 0 ? '+' : ''}
              {taa.composite_score.toFixed(2)}, 超配{taa.equity_adjustment}%
              {taa.fed_value != null && (
                <span className="ml-2 text-[#5AA9FF] font-medium">FED={taa.fed_value}</span>
              )}
            </div>
            <div>FUNDS: {funds.length}只映射完成</div>
            <div className="text-[#EE6666]">
              STRESS: 最坏{stressData[0]?.scenario}({stressData[0]?.impact}%)
            </div>
            <div>
              MC: 中位{mc?.median_return || 'N/A'}%, 概率{mc?.prob_positive || 'N/A'}%
            </div>
          </div>
        )}
      </div>

      <div className="liquid-glass p-4 border border-[#FFB800]/10 bg-[#FFB800]/[0.03]">
        <p className="text-xs text-white/55 leading-relaxed">{d.risk_disclaimer}</p>
      </div>
    </div>
  );
}
