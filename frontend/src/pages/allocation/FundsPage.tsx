import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router';
import {
  List, TrendingUp, DollarSign, Loader2, AlertCircle, Shield, Trash2,
} from 'lucide-react';
import { useAllocationData } from '@/hooks/useAllocationData';
import { useAuth } from '@/hooks/useAuth';
import { trpc } from '@/providers/trpc';
import PageHeader from '@/components/ui/PageHeader';
import SectionCard from '@/components/ui/SectionCard';
import FundRankingPanel from '@/components/allocation/FundRankingPanel';
import FeeAnalysisPanel from '@/components/allocation/FeeAnalysisPanel';
import ResearchCandidateMatchPanel from '@/components/allocation/ResearchCandidateMatchPanel';
import ResearchConstraintDraftPanel from '@/components/allocation/ResearchConstraintDraftPanel';
import { getFundRanking } from '@/lib/api';
import type { FundRankingResponse } from '@/types/allocation';
import { useAllocationStore } from '@/store/allocationStore';

import { feePct, returnPct, drawdownPct, sharpeFmt } from '@/lib/fund-data';

function fmtNum(v: unknown, digits = 2, suffix = ''): string {
  if (v === undefined || v === null || v === '' || v === '—') return '—';
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace('%', ''));
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}${suffix}`;
}

function parseNum(v: unknown): number | null {
  if (v === undefined || v === null || v === '' || v === '—') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace('%', ''));
  return Number.isFinite(n) ? n : null;
}

function generateCandidateNotes(fund: any): string[] {
  const perf = fund.performance || {};
  const notes: string[] = [];
  const r1y = parseNum(perf.return1y);
  const r3y = parseNum(perf.return3y);
  const sharpe = parseNum(perf.sharpeRatio);
  const mdd = parseNum(perf.maxDrawdown);
  const scale = parseNum(fund.totalScale);
  const feeM = parseNum(fund.feeManage);
  if (r1y !== null) {
    notes.push(`近1年收益 ${r1y >= 0 ? '+' : ''}${returnPct(perf.return1y)}`);
  }
  if (r3y !== null) {
    notes.push(`近3年收益 ${r3y >= 0 ? '+' : ''}${returnPct(perf.return3y)}`);
  }
  if (sharpe !== null && mdd !== null) {
    notes.push(`夏普${sharpeFmt(perf.sharpeRatio)} / 回撤${drawdownPct(perf.maxDrawdown)}`);
  }
  if (scale !== null) {
    notes.push(`规模${fmtNum(scale, 1, '亿')}`);
  }
  if (feeM !== null) {
    notes.push(`管理费${feePct(fund.feeManage)}`);
  }
  if (notes.length === 0) {
    notes.push('部分指标缺失，评估可能不完整');
  }
  return notes.slice(0, 3);
}

export default function FundsPage() {
  const { d, funds, constraints, meta, isReal } = useAllocationData();
  const { user } = useAuth();
  const utils = trpc.useUtils();

  const [rankingData, setRankingData] = useState<FundRankingResponse | null>(null);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [rankingError, setRankingError] = useState<string | null>(null);

  let preferredTags: string[] = [];
  try { preferredTags = useAllocationStore().state.config.preferred_tags; } catch {}

  useEffect(() => {
    if (!isReal) {
      setRankingData(null);
      setRankingError(null);
      return;
    }
    const fetchRankings = async () => {
      setRankingLoading(true);
      setRankingError(null);
      try {
        const res = await getFundRanking(preferredTags);
        setRankingData(res);
      } catch (e: any) {
        setRankingError(e?.message || '获取基金排名失败');
      } finally {
        setRankingLoading(false);
      }
    };
    fetchRankings();
  }, [preferredTags.join(','), isReal]);

  // Research candidates
  const { data: candidateData, isLoading: candidatesLoading } = trpc.fund.listResearchCandidates.useQuery(undefined, {
    enabled: !!user,
    staleTime: 30_000,
  });
  const removeCandidate = trpc.fund.removeResearchCandidate.useMutation({
    onSuccess: () => utils.fund.listResearchCandidates.invalidate(),
  });
  const candidates = useMemo(() => candidateData?.funds || [], [candidateData]);

  return (
    <div className="space-y-5">
      <PageHeader title="基金研究" regime={meta.regime} regimeLabel={meta.regime_label} generatedAt={meta.generated_at} />

      <SectionCard title={`基金明细 (${funds.length}只)`} icon={List} iconColor="#16C784">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-white/55 border-b border-white/[0.06]">
                {['代码', '名称', '类型', '权重', '金额', '角色', '入选理由', '评分'].map((h) => (
                  <th key={h} className="text-left py-2 px-2 font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {funds.map((f: any) => (
                <tr key={f.code} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                  <td className="py-2 px-2 data-number text-[#5AA9FF]">{f.code}</td>
                  <td className="py-2 px-2 text-white/70">{f.name}</td>
                  <td className="py-2 px-2 text-white/45">{f.type}</td>
                  <td className="py-2 px-2 data-number text-white/80">{f.weight}%</td>
                  <td className="py-2 px-2 data-number text-white/55">{f.amount.toLocaleString()}</td>
                  <td className="py-2 px-2 text-white/55">{f.role}</td>
                  <td className="py-2 px-2 text-white/40 max-w-[200px] truncate">{f.reason}</td>
                  <td className="py-2 px-2 data-number text-[#FAC858]">{f.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 space-y-1">
          {constraints.map((c: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className={c.passed ? 'text-[#16C784]' : 'text-[#EE6666]'}>{c.passed ? '✅' : '❌'}</span>
              <span className="text-white/45">
                {c.rule}: {c.value} 限制 {c.limit}
              </span>
            </div>
          ))}
        </div>
      </SectionCard>

      {!isReal && (
        <div className="liquid-glass p-4 border border-[#3B6CFF]/20 bg-[#3B6CFF]/[0.05] flex items-center gap-3">
          <AlertCircle className="w-4 h-4 text-[#5AA9FF]" />
          <p className="text-xs text-white/55">当前为演示数据，排名接口未调用。请先生成真实配置方案以查看基金排名。</p>
        </div>
      )}

      {isReal && rankingLoading && (
        <div className="flex items-center gap-2 text-xs text-white/50 px-1">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>正在加载基金排名...</span>
        </div>
      )}
      {isReal && rankingError && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-300">
          {rankingError}（使用面板内刷新重试）
        </div>
      )}
      {isReal && rankingData && (
        <SectionCard title={`API 基金排名 (${Object.keys(rankingData.rankings).length} 类)`} icon={TrendingUp} iconColor="#5AA9FF">
          <div className="flex flex-wrap gap-2">
            {Object.entries(rankingData.rankings).map(([cls, items]) => (
              <div key={cls} className="px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-xs">
                <span className="text-white/70">{cls}</span>
                <span className="text-white/40 ml-1">({items.length}只)</span>
                {items[0] && <span className="text-[#FAC858] ml-1">Top: {items[0].name}</span>}
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* 研究候选池 */}
      {user ? (
        <SectionCard title={`研究候选池 (${candidates.length}只)`} icon={Shield} iconColor="#9D7BFF">
          {candidatesLoading ? (
            <div className="flex items-center gap-2 text-xs text-white/50 py-4">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>正在加载研究候选池...</span>
            </div>
          ) : candidates.length === 0 ? (
            <div className="py-6 text-center text-xs text-white/35">
              暂无研究候选基金
              <p className="mt-1 text-white/25">在「基金研究」页添加候选基金后，将在此显示</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-white/55 border-b border-white/[0.06]">
                    {['代码', '名称', '类型', '近1年', '回撤', 'Sharpe', '规模', '费率', '研究摘要', '操作'].map((h) => (
                      <th key={h} className="text-left py-2 px-2 font-normal">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((f: any) => {
                    const perf = f.performance || {};
                    const notes = generateCandidateNotes(f);
                    const r1y = parseNum(perf.return1y);
                    return (
                      <tr key={f.fundCode} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                        <td className="py-2 px-2">
                          <Link to={`/${f.fundCode}`} className="data-number text-[#5AA9FF] hover:underline">
                            {f.fundCode}
                          </Link>
                        </td>
                        <td className="py-2 px-2 text-white/70">{f.fundAbbr || f.fundName}</td>
                        <td className="py-2 px-2 text-white/45">{f.fundType}</td>
                        <td className={`py-2 px-2 data-number ${r1y !== null && r1y >= 0 ? 'text-[#16C784]' : 'text-[#EE6666]'}`}>
                          {r1y !== null ? `${r1y >= 0 ? '+' : ''}${returnPct(perf.return1y)}` : '—'}
                        </td>
                        <td className="py-2 px-2 data-number text-[#EE6666]">{drawdownPct(perf.maxDrawdown)}</td>
                        <td className="py-2 px-2 data-number text-white/70">{sharpeFmt(perf.sharpeRatio)}</td>
                        <td className="py-2 px-2 data-number text-white/50">{fmtNum(f.totalScale, 1, '亿')}</td>
                        <td className="py-2 px-2 data-number text-white/50">{feePct(f.feeManage)}</td>
                        <td className="py-2 px-2 text-white/40 max-w-[200px] truncate">
                          {notes.map((n, i) => (
                            <span key={i} className="inline-block mr-2">• {n}</span>
                          ))}
                        </td>
                        <td className="py-2 px-2">
                          <button
                            onClick={() => removeCandidate.mutate({ code: f.fundCode })}
                            className="p-1 rounded text-[#EE6666]/60 hover:text-[#EE6666] hover:bg-[#EE6666]/10"
                            title="移出候选池"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-4 pt-4 border-t border-white/[0.04]">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs text-white/50 font-medium">候选池匹配分析</span>
              <span className="text-[10px] text-white/25">仅研究建议，不自动改权重</span>
            </div>
            <ResearchCandidateMatchPanel
              candidates={candidates}
              portfolioFunds={funds}
              loading={candidatesLoading}
            />
          </div>

          <div className="mt-4 pt-4 border-t border-white/[0.04]">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs text-white/50 font-medium">配置约束草案</span>
              <span className="text-[10px] text-white/25">研究辅助，不自动改组合</span>
            </div>
            <ResearchConstraintDraftPanel
              candidates={candidates}
              portfolioFunds={funds}
              loading={candidatesLoading}
            />
          </div>
        </SectionCard>
      ) : (
        <SectionCard title="研究候选池" icon={Shield} iconColor="#9D7BFF">
          <div className="py-6 text-center text-xs text-white/35">
            登录后查看研究候选池
            <p className="mt-1 text-white/25">在「基金研究」页添加的候选基金将在此显示</p>
          </div>
        </SectionCard>
      )}

      <FundRankingPanel />

      <FeeAnalysisPanel />
    </div>
  );
}
