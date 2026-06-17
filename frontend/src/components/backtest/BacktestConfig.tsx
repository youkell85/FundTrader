import React from 'react';
import { Calendar, Play, Loader2 } from 'lucide-react';
import type { BacktestRequest, RebalanceFrequency, ComparisonMode } from '@/types/backtest';
import type { RiskTolerance } from '@/types/allocation';
import { RISK_LABELS } from '@/types/allocation';
import { FREQUENCY_LABELS, MODE_LABELS } from '@/types/backtest';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Props {
  onRun: (req: BacktestRequest) => void;
  loading: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

const DEFAULT_START = '2020-01-01';
const DEFAULT_END = new Date().toISOString().slice(0, 10);

export default function BacktestConfig({ onRun, loading, disabled = false, disabledReason }: Props) {
  const [risk, setRisk] = React.useState<RiskTolerance>('balanced');
  const [start, setStart] = React.useState(DEFAULT_START);
  const [end, setEnd] = React.useState(DEFAULT_END);
  const [freq, setFreq] = React.useState<RebalanceFrequency>('quarterly');
  const [modes, setModes] = React.useState<ComparisonMode[]>(['saa_only', 'saa_taa', 'equal_weight', 'sixty_forty']);
  const [amount, setAmount] = React.useState(1000000);

  const toggleMode = (m: ComparisonMode) => {
    setModes(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);
  };

  const handleRun = () => {
    if (disabled) return;
    if (modes.length === 0) return;
    onRun({ risk_profile: risk, start_date: start, end_date: end, rebalance_frequency: freq, comparison_modes: modes, initial_amount: amount });
  };

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
      <div className="flex items-center gap-2 mb-4">
        <Calendar className="w-4 h-4 text-white/50" />
        <span className="text-sm font-medium text-white/70">回测参数</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* 风险偏好 */}
        <div>
          <label className="block text-xs text-white/40 mb-1">风险偏好</label>
          <Select value={risk} onValueChange={(value) => setRisk(value as RiskTolerance)}>
            <SelectTrigger className="w-full rounded-lg border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/80 focus:border-white/20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover text-popover-foreground border-white/[0.08]">
              {Object.entries(RISK_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 调仓频率 */}
        <div>
          <label className="block text-xs text-white/40 mb-1">调仓频率</label>
          <Select value={freq} onValueChange={(value) => setFreq(value as RebalanceFrequency)}>
            <SelectTrigger className="w-full rounded-lg border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/80 focus:border-white/20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover text-popover-foreground border-white/[0.08]">
              {Object.entries(FREQUENCY_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 起始日期 */}
        <div>
          <label className="block text-xs text-white/40 mb-1">起始日期</label>
          <input type="date" value={start} onChange={e => setStart(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/80 outline-none focus:border-white/20" />
        </div>

        {/* 结束日期 */}
        <div>
          <label className="block text-xs text-white/40 mb-1">结束日期</label>
          <input type="date" value={end} onChange={e => setEnd(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/80 outline-none focus:border-white/20" />
        </div>
      </div>

      {/* 初始金额 */}
      <div className="mt-4">
        <label className="block text-xs text-white/40 mb-1">初始资金 (元)</label>
        <input type="number" value={amount} onChange={e => setAmount(Number(e.target.value))}
          className="w-40 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/80 outline-none focus:border-white/20" />
      </div>

      {/* 对比模式 */}
      <div className="mt-4">
        <label className="block text-xs text-white/40 mb-2">对比策略</label>
        <div className="flex flex-wrap gap-2">
          {(Object.entries(MODE_LABELS) as [ComparisonMode, string][]).map(([k, v]) => (
            <button key={k} onClick={() => toggleMode(k)}
              className={`rounded-full px-3 py-1 text-xs border transition-colors ${modes.includes(k) ? 'border-blue-500/50 bg-blue-500/10 text-blue-300' : 'border-white/10 bg-white/[0.03] text-white/40 hover:text-white/60'}`}>
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* 执行按钮 */}
      <div className="mt-5 flex flex-col items-end gap-2">
        <button onClick={handleRun} disabled={loading || disabled || modes.length === 0}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {loading ? '回测中...' : '执行回测'}
        </button>
        {disabled && disabledReason && (
          <span className="text-xs text-[#FAC858]/80">{disabledReason}</span>
        )}
      </div>
    </div>
  );
}
