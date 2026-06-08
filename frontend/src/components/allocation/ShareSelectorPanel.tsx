import { useState } from 'react';
import { Coins } from 'lucide-react';
import { SHARE_COLORS } from '@/types/allocation';
import type { ShareSelectorResponse, AllocationRequest } from '@/types/allocation';
import { selectShareClass } from '@/lib/api';
import { useAllocationStore } from '@/store/allocationStore';

const HOLDING_OPTIONS = [
  { value: 3, label: '3个月' },
  { value: 6, label: '6个月' },
  { value: 12, label: '1年' },
  { value: 24, label: '2年' },
  { value: 36, label: '3年' },
  { value: 60, label: '5年' },
];

export default function ShareSelectorPanel() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ShareSelectorResponse | null>(null);
  const [holdingMonths, setHoldingMonths] = useState(12);

  let storeReq: AllocationRequest | null = null;
  let storeOutput: any = null;
  try {
    const store = useAllocationStore();
    storeReq = store.state.config;
    storeOutput = store.state.output;
  } catch { /* no store */ }

  const handleAnalyze = async () => {
    if (!storeOutput?.funds?.length) { setError('请先生成配置方案'); return; }
    setLoading(true); setError(null);
    try {
      const funds = storeOutput.funds.map((f: any) => ({ code: f.code, name: f.name }));
      const resp = await selectShareClass({
        funds,
        holding_months: holdingMonths,
        amount: storeReq?.amount || 100000,
      });
      setData(resp);
    } catch (e: any) {
      setError(e.message || '分析失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="liquid-glass p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm text-white/70">
            <Coins className="w-4 h-4 inline mr-2" style={{ color: '#FAC858' }} />
            A/C份额选择器
          </h3>
          <div className="flex items-center gap-2">
            <select
              value={holdingMonths}
              onChange={(e) => setHoldingMonths(Number(e.target.value))}
              className="px-2 py-1 text-xs rounded bg-white/[0.05] text-white/70 border border-white/[0.08]"
            >
              {HOLDING_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button
              onClick={handleAnalyze}
              disabled={loading}
              className="px-3 py-1.5 text-xs rounded-md bg-[#3B6CFF]/20 text-[#5AA9FF] hover:bg-[#3B6CFF]/30 disabled:opacity-50"
            >
              {loading ? '分析中...' : '分析'}
            </button>
          </div>
        </div>

        {error && <div className="text-xs text-[#EE6666] mb-3">{error}</div>}

        {!data && !loading && (
          <div className="text-sm text-white/40 text-center py-8">选择持有期限后点击"分析"查看A/C份额推荐</div>
        )}

        {data && (
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-[#3B6CFF]/[0.06] border border-[#3B6CFF]/15">
              <div className="text-xs text-white/55">{data.summary}</div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-white/55 border-b border-white/[0.06]">
                    {['代码', '名称', '推荐', '盈亏平衡', 'A类成本', 'C类成本', '节省', '原因'].map((h) => (
                      <th key={h} className="text-left py-2 px-2 font-normal">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.recommendations.map((r) => (
                    <tr key={r.fund_code} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                      <td className="py-2 px-2 data-number text-[#5AA9FF]">{r.fund_code}</td>
                      <td className="py-2 px-2 text-white/70 max-w-[120px] truncate">{r.fund_name}</td>
                      <td className="py-2 px-2">
                        <span
                          className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                          style={{
                            backgroundColor: `${SHARE_COLORS[r.recommended_share]}20`,
                            color: SHARE_COLORS[r.recommended_share],
                          }}
                        >
                          {r.recommended_share}类
                        </span>
                      </td>
                      <td className="py-2 px-2 data-number text-white/60">{r.breakeven_months.toFixed(0)}月</td>
                      <td className="py-2 px-2 data-number text-white/60">{r.total_cost_a.toFixed(2)}%</td>
                      <td className="py-2 px-2 data-number text-white/60">{r.total_cost_c.toFixed(2)}%</td>
                      <td className="py-2 px-2 data-number text-[#16C784]">{r.savings.toFixed(2)}%</td>
                      <td className="py-2 px-2 text-white/40 max-w-[180px] truncate">{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Summary stats */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-center">
                <div className="text-xs text-white/55">推荐A类</div>
                <div className="data-number text-lg font-medium" style={{ color: SHARE_COLORS.A }}>
                  {data.recommendations.filter((r) => r.recommended_share === 'A').length}
                </div>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-center">
                <div className="text-xs text-white/55">推荐C类</div>
                <div className="data-number text-lg font-medium" style={{ color: SHARE_COLORS.C }}>
                  {data.recommendations.filter((r) => r.recommended_share === 'C').length}
                </div>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-center">
                <div className="text-xs text-white/55">持有期限</div>
                <div className="data-number text-lg font-medium text-white/80">{data.holding_months}月</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
