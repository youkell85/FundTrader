import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router';
import {
  Loader2,
  AlertCircle,
  TrendingUp,
  Wallet,
  ArrowLeft,
  Save,
  Timer,
  CheckCircle2,
  SlidersHorizontal,
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useAllocationData } from '@/hooks/useAllocationData';
import { useAllocationStore } from '@/store/allocationStore';
import PageHeader from '@/components/ui/PageHeader';
import SectionCard from '@/components/ui/SectionCard';
import { trpc } from '@/providers/trpc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  normalizeWeights,
  buildExecutionPlanFromAllocation,
  buildDcaBacktestInput,
  validateExecutionPlan,
  parseDcaResultForExecution,
} from '@/lib/execution-plan';
import type { ExecutionPlan, DcaConfig, ParsedDcaResult } from '@/lib/execution-plan';

const strategies: { value: DcaConfig['strategy']; label: string }[] = [
  { value: 'fixed_amount', label: '固定金额' },
  { value: 'fixed_ratio', label: '估值区间调节' },
  { value: 'value_averaging', label: '均线偏离调节' },
  { value: 'martingale', label: '下跌加倍投入' },
];

const frequencies: { value: DcaConfig['investFrequency']; label: string }[] = [
  { value: 'weekly', label: '每周' },
  { value: 'biweekly', label: '双周' },
  { value: 'monthly', label: '每月' },
];

function todayString() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export default function ExecutePage() {
  const { d, meta, isReal } = useAllocationData();
  const { state, dispatch } = useAllocationStore();
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const [plan, setPlan] = useState<ExecutionPlan | null>(state.executionPlan);
  const [config, setConfig] = useState<DcaConfig | null>(state.dcaConfig);
  const [result, setResult] = useState<ParsedDcaResult | null>(state.dcaResult);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const startTimer = useCallback(() => {
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
  }, []);
  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = undefined; }
  }, []);

  useEffect(() => { return () => { if (timerRef.current) clearInterval(timerRef.current); }; }, []);

  // 初始化：从 allocation output 构建执行计划
  useEffect(() => {
    if (!isReal || !d) return;
    if (plan) return;
    const newPlan = buildExecutionPlanFromAllocation(d);
    setPlan(newPlan);
    dispatch({ type: 'SET_EXECUTION_PLAN', plan: newPlan });
    if (!config) {
      const newConfig = buildDcaBacktestInput(newPlan, {
        startDate: '2020-01-01',
        endDate: todayString(),
      });
      setConfig(newConfig);
      dispatch({ type: 'SET_DCA_CONFIG', config: newConfig });
    }
  }, [isReal, d, plan, config, dispatch]);

  // 从 store 恢复
  useEffect(() => {
    if (state.executionPlan && !plan) setPlan(state.executionPlan);
    if (state.dcaConfig && !config) setConfig(state.dcaConfig);
    if (state.dcaResult && !result) setResult(state.dcaResult);
  }, [state.executionPlan, state.dcaConfig, state.dcaResult, plan, config, result]);

  const guard = useMemo(() => {
    if (!isReal) return { blocked: true, message: '当前为演示数据，请先生成真实配置方案' };
    const v = validateExecutionPlan(plan);
    if (!v.valid) return { blocked: true, message: v.error || '执行计划无效' };
    return { blocked: false };
  }, [isReal, plan]);

  const handleWeightChange = (index: number, value: number) => {
    if (!plan) return;
    const newWeights = normalizeWeights(plan.funds.length, plan.funds.map((f) => f.weight), index, value);
    const newFunds = plan.funds.map((f, i) => ({ ...f, weight: newWeights[i] }));
    const newPlan = { ...plan, funds: newFunds };
    setPlan(newPlan);
    dispatch({ type: 'SET_EXECUTION_PLAN', plan: newPlan });
    if (config) {
      const newConfig = { ...config, weights: newWeights };
      setConfig(newConfig);
      dispatch({ type: 'SET_DCA_CONFIG', config: newConfig });
    }
  };

  const handleConfigChange = (patch: Partial<DcaConfig>) => {
    if (!config) return;
    const newConfig = { ...config, ...patch };
    setConfig(newConfig);
    dispatch({ type: 'SET_DCA_CONFIG', config: newConfig });
  };

  const handleRunBacktest = async () => {
    if (guard.blocked || !plan || !config) return;
    setLoading(true);
    setError(null);
    startTimer();
    try {
      const raw = await utils.fund.runBacktest.fetch({
        fundCodes: plan.funds.map((f) => f.code),
        weights: plan.funds.map((f) => f.weight),
        strategy: config.strategy,
        startDate: config.startDate,
        endDate: config.endDate,
        investAmount: config.investAmount,
        investFrequency: config.investFrequency,
        feeRate: config.feeRate,
        slippageRate: config.slippageRate,
      } as any);
      const parsed = parseDcaResultForExecution(raw);
      setResult(parsed);
      dispatch({ type: 'SET_DCA_RESULT', result: parsed });
    } catch (e: any) {
      setError(e?.message || '回测失败，请检查参数后重试');
    } finally {
      setLoading(false);
      stopTimer();
    }
  };

  const handleSavePlan = () => {
    if (!isReal || !d) return;
    navigate('/allocation/result/plans');
  };

  if (!isReal) {
    return (
      <div className="space-y-5">
        <PageHeader title="执行计划" regime={meta.regime} regimeLabel={meta.regime_label} generatedAt={meta.generated_at} />
        <div className="surface-elevated p-6 flex flex-col items-center gap-4 text-center">
          <AlertCircle className="w-10 h-10 text-[#3B6CFF]/50" />
          <h2 className="text-lg text-white/70">尚未生成配置方案</h2>
          <p className="text-sm text-white/45">请先完成资产配置画像采集，生成真实配置方案后再进入执行计划。</p>
          <button
            onClick={() => navigate('/allocation')}
            className="px-5 py-2.5 rounded-lg bg-[#3B6CFF] text-white text-sm font-medium hover:bg-[#3B6CFF]/80 flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" /> 前往画像采集
          </button>
        </div>
      </div>
    );
  }

  const hasBenchmark = result?.curve?.some(p => (p as any).benchmark != null);

  return (
    <div className="space-y-5">
      <PageHeader title="执行计划" regime={meta.regime} regimeLabel={meta.regime_label} generatedAt={meta.generated_at} />

      <SectionCard title="基金组合与权重" icon={Wallet} iconColor="#3B6CFF">
        {plan && (
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-white/55 border-b border-white/[0.06]">
                    {['代码', '名称', '角色', '权重', '金额'].map((h) => (
                      <th key={h} className="text-left py-2 px-2 font-normal">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {plan.funds.map((f, i) => (
                    <tr key={f.code} className="border-b border-white/[0.03]">
                      <td className="py-2 px-2 data-number text-[#5AA9FF]">{f.code}</td>
                      <td className="py-2 px-2 text-white/70">{f.name}</td>
                      <td className="py-2 px-2 text-white/45">{f.role}</td>
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={f.weight}
                            onChange={(e) => handleWeightChange(i, Number(e.target.value))}
                            className="w-24 accent-[#3B6CFF]"
                          />
                          <span className="data-number text-white/80 w-10">{f.weight}%</span>
                        </div>
                      </td>
                      <td className="py-2 px-2 data-number text-white/55">
                        {Math.round(plan.totalAmount * (f.weight / 100)).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between text-xs text-white/40 px-1">
              <span>总权重 {plan.funds.reduce((s, f) => s + f.weight, 0)}%</span>
              <span>总金额 {plan.totalAmount.toLocaleString()}元</span>
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard title="定投参数" icon={SlidersHorizontal} iconColor="#FAC858">
        {config && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[11px] text-white/40 mb-1 block">策略</label>
              <Select
                value={config.strategy}
                onValueChange={(v) => handleConfigChange({ strategy: v as DcaConfig['strategy'] })}
              >
                <SelectTrigger className="w-full h-10 input-focus text-white text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="input-focus">
                  {strategies.map((s) => (
                    <SelectItem key={s.value} value={s.value} className="text-white text-xs focus:bg-white/[0.06] focus:text-white">
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[11px] text-white/40 mb-1 block">频率</label>
              <Select
                value={config.investFrequency}
                onValueChange={(v) => handleConfigChange({ investFrequency: v as DcaConfig['investFrequency'] })}
              >
                <SelectTrigger className="w-full h-10 input-focus text-white text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="input-focus">
                  {frequencies.map((f) => (
                    <SelectItem key={f.value} value={f.value} className="text-white text-xs focus:bg-white/[0.06] focus:text-white">
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[11px] text-white/40 mb-1 block">单期金额 (元)</label>
              <input
                type="number"
                min={100}
                step={100}
                value={config.investAmount}
                onChange={(e) => handleConfigChange({ investAmount: Number(e.target.value) })}
                className="w-full h-10 px-3 rounded-lg input-focus text-white text-xs data-number"
              />
            </div>
            <div>
              <label className="text-[11px] text-white/40 mb-1 block">起始日期</label>
              <input
                type="date"
                value={config.startDate}
                max={config.endDate}
                onChange={(e) => handleConfigChange({ startDate: e.target.value })}
                className="w-full h-10 px-3 rounded-lg input-focus text-white text-xs data-number"
              />
            </div>
            <div>
              <label className="text-[11px] text-white/40 mb-1 block">结束日期</label>
              <input
                type="date"
                value={config.endDate}
                min={config.startDate}
                onChange={(e) => handleConfigChange({ endDate: e.target.value })}
                className="w-full h-10 px-3 rounded-lg input-focus text-white text-xs data-number"
              />
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard title="定投回测" icon={TrendingUp} iconColor="#16C784">
        {/* Loading progress indicator */}
        {loading && (
          <div className="mb-4 rounded-lg border border-[#3B6CFF]/20 bg-[#3B6CFF]/[0.05] p-4 flex items-center gap-4">
            <div className="relative shrink-0">
              <Loader2 className="w-8 h-8 text-[#3B6CFF] animate-spin" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-sm text-white/70">
                <Timer className="w-4 h-4 text-[#5AA9FF]" />
                <span>回测运行中...</span>
              </div>
              <div className="mt-1.5 flex items-center gap-3">
                <span className="text-xs text-white/50 tabular-nums">已耗时 {elapsed}s</span>
                <div className="flex-1 h-1.5 rounded-full bg-white/[0.04] overflow-hidden max-w-[200px]">
                  <div
                    className="h-full rounded-full bg-[#3B6CFF] transition-all duration-1000"
                    style={{ width: `${Math.min(100, (elapsed / 60) * 100)}%` }}
                  />
                </div>
                <span className="text-[10px] text-white/30">预计 30-60s</span>
              </div>
              <p className="mt-1.5 text-[11px] text-white/35">
                正在获取基金净值数据并模拟定投路径，多基金组合回测需要逐个拉取数据，请耐心等待
              </p>
            </div>
            <button
              onClick={() => { setLoading(false); stopTimer(); setError('已取消'); }}
              className="px-3 py-1.5 rounded-md border border-white/[0.1] bg-white/[0.03] text-xs text-white/50 hover:text-white/70 hover:bg-white/[0.06] transition-colors shrink-0"
            >
              取消
            </button>
          </div>
        )}

        {/* Run button */}
        {!loading && (
          <div className="flex items-center gap-3 mb-3">
            <button
              onClick={handleRunBacktest}
              disabled={guard.blocked}
              className="px-4 py-2 rounded-lg bg-[#16C784]/20 text-[#16C784] text-xs font-medium hover:bg-[#16C784]/30 disabled:opacity-50 flex items-center gap-2"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              运行定投回测
            </button>
            {error && <span className="text-xs text-[#EE6666]">{error}</span>}
          </div>
        )}

        {/* KPI cards */}
        {result && (
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <div className="surface p-3">
              <div className="text-[10px] text-white/50">累计投入</div>
              <div className="data-number text-sm text-white/80">{Math.round(result.totalInvested).toLocaleString()}</div>
            </div>
            <div className="surface p-3">
              <div className="text-[10px] text-white/50">期末市值</div>
              <div className="data-number text-sm text-[#16C784]">{Math.round(result.finalValue).toLocaleString()}</div>
            </div>
            <div className="surface p-3">
              <div className="text-[10px] text-white/50">总收益</div>
              <div className={`data-number text-sm ${result.totalReturn >= 0 ? 'text-[#16C784]' : 'text-[#EE6666]'}`}>
                {result.totalReturn >= 0 ? '+' : ''}{result.totalReturn.toFixed(2)}%
              </div>
            </div>
            <div className="surface p-3">
              <div className="text-[10px] text-white/50">年化收益</div>
              <div className={`data-number text-sm ${result.annualizedReturn >= 0 ? 'text-[#16C784]' : 'text-[#EE6666]'}`}>
                {result.annualizedReturn >= 0 ? '+' : ''}{result.annualizedReturn.toFixed(2)}%
              </div>
            </div>
            <div className="surface p-3">
              <div className="text-[10px] text-white/50">最大回撤</div>
              <div className="data-number text-sm text-[#EE6666]">{result.maxDrawdown.toFixed(2)}%</div>
            </div>
            <div className="surface p-3">
              <div className="text-[10px] text-white/50">夏普比率</div>
              <div className="data-number text-sm text-[#5470C6]">{result.sharpeRatio.toFixed(2)}</div>
            </div>
            <div className="surface p-3">
              <div className="text-[10px] text-white/50">费率成本</div>
              <div className="data-number text-sm text-[#FAC858]">{Math.round(result.feeCost).toLocaleString()}</div>
            </div>
          </div>
        )}

        {/* Curve chart */}
        {result?.curve && result.curve.length > 2 && (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
            <h3 className="text-sm font-medium text-white/70 mb-4">定投累计收益曲线</h3>
            <ResponsiveContainer width="100%" height={320}>
              <LineChart
                data={result.curve}
                margin={{ top: 5, right: 20, bottom: 5, left: 10 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 11 }}
                  tickFormatter={(d: string) => String(d).slice(0, 7)}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 11 }}
                  tickFormatter={(v: number) => v >= 10000 ? `${(v / 10000).toFixed(1)}万` : v.toFixed(0)}
                />
                <Tooltip
                  contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
                  labelStyle={{ color: 'rgba(255,255,255,0.5)' }}
                  formatter={(val: number, name: string) => {
                    const labels: Record<string, string> = { value: '组合市值', invested: '累计投入', benchmark: '买入持有' };
                    const formatted = val >= 10000 ? `${(val / 10000).toFixed(2)}万` : val.toFixed(2);
                    return [formatted, labels[name] || name];
                  }}
                />
                <Legend
                  formatter={(v: string) => {
                    const labels: Record<string, string> = { value: '组合市值', invested: '累计投入', benchmark: '买入持有' };
                    return labels[v] || v;
                  }}
                  wrapperStyle={{ fontSize: 12 }}
                />
                <Line type="monotone" dataKey="invested" stroke="#5470C6" strokeWidth={1.5} strokeDasharray="4 2" dot={false} name="invested" />
                <Line type="monotone" dataKey="value" stroke="#16C784" strokeWidth={2} dot={false} name="value" />
                {hasBenchmark && (
                  <Line type="monotone" dataKey="benchmark" stroke="#9D7BFF" strokeWidth={1.5} strokeDasharray="8 4" dot={false} name="benchmark" />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </SectionCard>

      {result && (
        <div className="flex justify-end">
          <button
            onClick={handleSavePlan}
            className="px-5 py-2.5 rounded-lg bg-[#3B6CFF] text-white text-sm font-medium hover:bg-[#3B6CFF]/80 flex items-center gap-2"
          >
            <Save className="w-4 h-4" /> 保存至方案管理
          </button>
        </div>
      )}
    </div>
  );
}
