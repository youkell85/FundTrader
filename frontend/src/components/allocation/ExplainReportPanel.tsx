import React, { useState } from 'react';
import { FileText, Info, AlertTriangle, CheckCircle, BarChart3 } from 'lucide-react';
import { EXPLAIN_ICON_COLORS } from '@/types/allocation';
import type { ExplainReportModel, AllocationRequest } from '@/types/allocation';
import { getExplainReport } from '@/lib/api';
import { useAllocationStore } from '@/store/allocationStore';

const ICON_MAP: Record<string, React.ReactNode> = {
  info: <Info className="w-4 h-4" />,
  warning: <AlertTriangle className="w-4 h-4" />,
  success: <CheckCircle className="w-4 h-4" />,
  chart: <BarChart3 className="w-4 h-4" />,
};

export default function ExplainReportPanel() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ExplainReportModel | null>(null);

  let storeReq: AllocationRequest | null = null;
  try { storeReq = useAllocationStore().state.config; } catch { /* no store */ }

  const handleGenerate = async () => {
    if (!storeReq) { setError('请先生成配置方案'); return; }
    setLoading(true); setError(null);
    try {
      const resp = await getExplainReport(storeReq);
      setData(resp);
    } catch (e: any) {
      setError(e.message || '生成失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="liquid-glass p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm text-white/70">
            <FileText className="w-4 h-4 inline mr-2" style={{ color: '#16C784' }} />
            可解释性报告
          </h3>
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="px-3 py-1.5 text-xs rounded-md bg-[#3B6CFF]/20 text-[#5AA9FF] hover:bg-[#3B6CFF]/30 disabled:opacity-50"
          >
            {loading ? '生成中...' : '生成报告'}
          </button>
        </div>

        {error && <div className="text-xs text-[#EE6666] mb-3">{error}</div>}

        {!data && !loading && (
          <div className="text-sm text-white/40 text-center py-8">点击"生成报告"查看配置方案的详细解释</div>
        )}

        {data && (
          <div className="space-y-4">
            {/* Confidence score */}
            <div className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
              <div className="text-xs text-white/50">置信度评分</div>
              <div className="flex-1 h-2 rounded-full bg-white/[0.04] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${data.confidence_score * 100}%`,
                    backgroundColor: data.confidence_score > 0.7 ? '#16C784' : data.confidence_score > 0.4 ? '#FAC858' : '#EE6666',
                  }}
                />
              </div>
              <div className="data-number text-sm text-white/80">{(data.confidence_score * 100).toFixed(0)}%</div>
            </div>

            {/* Overall summary */}
            <div className="p-3 rounded-lg bg-[#3B6CFF]/[0.06] border border-[#3B6CFF]/15">
              <div className="text-xs text-white/55 leading-relaxed">{data.overall_summary}</div>
            </div>

            {/* Sections */}
            {data.sections.map((section, idx) => (
              <div key={idx} className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span style={{ color: EXPLAIN_ICON_COLORS[section.icon] || '#5470C6' }}>
                    {ICON_MAP[section.icon] || ICON_MAP.info}
                  </span>
                  <span className="text-sm text-white/80 font-medium">{section.title}</span>
                </div>
                <div className="text-xs text-white/55 mb-2">{section.summary}</div>
                {section.details.length > 0 && (
                  <ul className="space-y-1">
                    {section.details.map((d, i) => (
                      <li key={i} className="text-xs text-white/40 flex items-start gap-1.5">
                        <span className="text-white/40 mt-0.5">-</span>
                        <span>{d}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
