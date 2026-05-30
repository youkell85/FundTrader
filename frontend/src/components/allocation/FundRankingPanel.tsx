import React, { useState, useEffect } from 'react';
import { BarChart2, Trophy, Loader2, Star } from 'lucide-react';
import type { FundRankingItem, FundRankingResponse } from '@/types/allocation';
import { ASSET_CLASS_LABELS } from '@/types/allocation';
import { getFundRanking } from '@/lib/api';

const DIMENSION_LABELS: Record<string, string> = {
  tracking: '跟踪质量',
  liquidity: '流动性',
  cost: '费率',
  scale: '规模',
  performance: '绩效',
};

const SCORE_COLORS = [
  { min: 80, color: '#16C784' },
  { min: 60, color: '#5AA9FF' },
  { min: 40, color: '#FAC858' },
  { min: 0, color: '#EE6666' },
];

function getScoreColor(score: number) {
  for (const { min, color } of SCORE_COLORS) {
    if (score >= min) return color;
  }
  return '#666';
}

export default function FundRankingPanel() {
  const [data, setData] = useState<FundRankingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);

  const loadRankings = async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getFundRanking(tags, signal);
      setData(res);
      if (!selectedClass && Object.keys(res.rankings).length > 0) {
        setSelectedClass(Object.keys(res.rankings)[0]);
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setError(e?.message || '加载排名失败');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const ac = new AbortController();
    loadRankings(ac.signal);
    return () => ac.abort();
  }, []);

  const assetClasses = data ? Object.keys(data.rankings) : [];
  const currentRanking = selectedClass && data ? data.rankings[selectedClass] || [] : [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-white/50" />
            <span className="text-sm font-medium text-white/70">基金选优排名</span>
            <span className="text-xs text-white/50">5维度评分: 跟踪质量 / 流动性 / 费率 / 规模 / 绩效</span>
          </div>
          <button onClick={loadRankings} disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/60 hover:text-white/80 disabled:opacity-40">
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trophy className="w-3 h-3" />}
            {loading ? '加载中' : '刷新排名'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-300">{error}</div>
      )}

      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">
          {/* Asset class selector */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-1 max-h-[600px] overflow-y-auto">
            {assetClasses.map(ac => (
              <button key={ac} onClick={() => setSelectedClass(ac)}
                className={`w-full text-left rounded-lg px-3 py-2 text-xs transition-colors ${selectedClass === ac ? 'bg-blue-500/10 border border-blue-500/30 text-blue-300' : 'hover:bg-white/[0.04] text-white/50 border border-transparent'}`}>
                <div className="font-medium">{ASSET_CLASS_LABELS[ac] || ac}</div>
                <div className="text-[10px] mt-0.5 opacity-60">{data.rankings[ac]?.length || 0} 只候选</div>
              </button>
            ))}
          </div>

          {/* Ranking table */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 overflow-x-auto">
            {currentRanking.length > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    <th className="text-left py-2 text-xs text-white/40 font-normal">#</th>
                    <th className="text-left py-2 text-xs text-white/40 font-normal">基金</th>
                    <th className="text-center py-2 text-xs text-white/40 font-normal">总分</th>
                    <th className="text-center py-2 text-xs text-white/40 font-normal">跟踪</th>
                    <th className="text-center py-2 text-xs text-white/40 font-normal">流动性</th>
                    <th className="text-center py-2 text-xs text-white/40 font-normal">费率</th>
                    <th className="text-center py-2 text-xs text-white/40 font-normal">规模</th>
                    <th className="text-center py-2 text-xs text-white/40 font-normal">绩效</th>
                    <th className="text-left py-2 text-xs text-white/40 font-normal">亮点</th>
                  </tr>
                </thead>
                <tbody>
                  {currentRanking.map(fund => (
                    <tr key={fund.code} className={`border-b border-white/[0.03] hover:bg-white/[0.02] ${fund.is_recommended ? 'bg-green-500/[0.03]' : ''}`}>
                      <td className="py-3 px-1">
                        <div className="flex items-center gap-1">
                          {fund.is_recommended && <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />}
                          <span className="text-white/50 font-mono text-xs">{fund.rank}</span>
                        </div>
                      </td>
                      <td className="py-3">
                        <div className="text-white/85 text-xs font-medium">{fund.name}</div>
                        <div className="text-[10px] text-white/55 mt-0.5">{fund.code} | 费率{((fund.management_fee + fund.custody_fee) * 100).toFixed(2)}% | {fund.aum.toFixed(0)}亿</div>
                      </td>
                      <td className="text-center py-3">
                        <span className="font-mono font-medium text-sm" style={{ color: getScoreColor(fund.total_score) }}>
                          {fund.total_score.toFixed(0)}
                        </span>
                      </td>
                      <ScoreCell score={fund.tracking_score} />
                      <ScoreCell score={fund.liquidity_score} />
                      <ScoreCell score={fund.cost_score} />
                      <ScoreCell score={fund.scale_score} />
                      <ScoreCell score={fund.performance_score} />
                      <td className="py-3 text-xs text-white/45 max-w-[150px]">
                        {fund.reasons.length > 0 ? fund.reasons.join('、') : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-center py-12 text-white/50 text-sm">选择左侧资产类别查看排名</div>
            )}

            {/* Score dimension bar visualization */}
            {currentRanking.length > 0 && (
              <div className="mt-4 pt-4 border-t border-white/[0.06]">
                <div className="text-xs text-white/40 mb-3">维度对比 (推荐 vs 末位)</div>
                <div className="grid grid-cols-5 gap-3">
                  {(['tracking_score', 'liquidity_score', 'cost_score', 'scale_score', 'performance_score'] as const).map((dim, i) => {
                    const best = currentRanking[0]?.[dim] ?? 0;
                    const worst = currentRanking[currentRanking.length - 1]?.[dim] ?? 0;
                    const dimKey = dim.replace('_score', '');
                    return (
                      <div key={dim} className="text-center">
                        <div className="text-[10px] text-white/50 mb-1">{DIMENSION_LABELS[dimKey] || dimKey}</div>
                        <div className="h-16 flex items-end justify-center gap-1">
                          <div className="w-4 rounded-t" style={{ height: `${best * 0.6}%`, backgroundColor: '#16C784' }} title={`推荐: ${best.toFixed(0)}`} />
                          <div className="w-4 rounded-t" style={{ height: `${worst * 0.6}%`, backgroundColor: '#EE6666' }} title={`末位: ${worst.toFixed(0)}`} />
                        </div>
                        <div className="text-[9px] text-white/40 mt-1 flex justify-center gap-2">
                          <span style={{ color: '#16C784' }}>{best.toFixed(0)}</span>
                          <span style={{ color: '#EE6666' }}>{worst.toFixed(0)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreCell({ score }: { score: number }) {
  return (
    <td className="text-center py-3">
      <span className="font-mono text-xs" style={{ color: getScoreColor(score) }}>{score.toFixed(0)}</span>
    </td>
  );
}
