import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import {
  FolderOpen, Loader2, LayoutDashboard, Target, TrendingUp, Play,
  FileText, Star, Trash2, AlertCircle, FolderX, ChevronDown, ChevronUp,
  Shield, BarChart3, Wallet, Layers, Eye, Info,
  Copy, CheckCircle2, Download,
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import SectionCard from '@/components/ui/SectionCard';
import PlanManager from '@/components/allocation/PlanManager';
import { listPlans, getPlan, deletePlan, updatePlan } from '@/lib/api';
import { useAllocationStore } from '@/store/allocationStore';
import { useAllocationData } from '@/hooks/useAllocationData';
import type { SavedPlanItem, PlanListResponse } from '@/types/allocation';
import { RISK_LABELS } from '@/types/allocation';
import { summarizeSavedReportSnapshot } from '@/lib/allocation-report-snapshot';
import type { SnapshotModuleSummary } from '@/lib/allocation-report-snapshot';
import { generateResearchReportMarkdown } from '@/lib/fund-research';

interface PlanItemProps {
  plan: SavedPlanItem;
  restoring: string | null;
  onRestore: (id: string, path?: string) => void;
  onDelete: (id: string) => void;
  onToggleFavorite: (id: string, current: boolean) => void;
  onExport: (id: string) => void;
}

function ModuleBadge({ label, colorClass, icon: Icon }: { label: string; colorClass: string; icon: any }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded shrink-0 ${colorClass}`}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'positive' | 'negative' | 'neutral' }) {
  const color = tone === 'positive' ? 'text-[#16C784]' : tone === 'negative' ? 'text-[#EE6666]' : 'text-white/60';
  return (
    <div className="min-w-0">
      <div className="text-[10px] text-white/30 truncate">{label}</div>
      <div className={`text-xs font-medium data-number ${color}`}>{value}</div>
    </div>
  );
}

function PlanItem({ plan, restoring, onRestore, onDelete, onToggleFavorite, onExport }: PlanItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const summary: SnapshotModuleSummary = summarizeSavedReportSnapshot(plan.response);

  const handleCopyMarkdown = async () => {
    setCopyError(false);
    try {
      const res = plan.response as any;
      const md = generateResearchReportMarkdown({
        portfolioFunds: res.funds || [],
        candidates: res.researchReportSnapshot?.candidates || [],
        constraintDrafts: res.researchReportSnapshot?.constraintDrafts || [],
        backtestResult: res.backtestResult,
        dcaResult: res.dca_plan?.result || res.dcaResult,
        researchReportSnapshot: res.researchReportSnapshot,
        generatedAt: plan.created_at,
      });
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
      setTimeout(() => setCopyError(false), 3000);
    }
  };

  const handleDownloadMarkdown = () => {
    const res = plan.response as any;
    const md = generateResearchReportMarkdown({
      portfolioFunds: res.funds || [],
      candidates: res.researchReportSnapshot?.candidates || [],
      constraintDrafts: res.researchReportSnapshot?.constraintDrafts || [],
      backtestResult: res.backtestResult,
      dcaResult: res.dca_plan?.result || res.dcaResult,
      researchReportSnapshot: res.researchReportSnapshot,
      generatedAt: plan.created_at,
    });
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `saved-research-report-${plan.id.slice(0, 8)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-3 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
      {/* Header row */}
      <div className="flex items-start gap-3">
        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => onToggleFavorite(plan.id, plan.is_favorite)}
              className="text-white/50 hover:text-[#FAC858] transition-colors shrink-0"
              title={plan.is_favorite ? '取消收藏' : '收藏'}
            >
              <Star
                className={`w-3.5 h-3.5 ${
                  plan.is_favorite ? 'fill-[#FAC858] text-[#FAC858]' : ''
                }`}
              />
            </button>
            <span className="text-white/80 text-xs font-medium truncate">
              {plan.name}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] text-white/40 shrink-0">
              {RISK_LABELS[plan.risk_profile] || plan.risk_profile}
            </span>
          </div>

          {/* Module badges */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            <ModuleBadge label="配置报告" colorClass="bg-[#5470C6]/10 text-[#5470C6]/80" icon={Shield} />
            {summary.hasVariants && (
              <ModuleBadge label="多方案对比" colorClass="bg-[#9D7BFF]/10 text-[#9D7BFF]/80" icon={Layers} />
            )}
            {summary.hasDca && (
              <ModuleBadge label="定投结果" colorClass="bg-[#16C784]/10 text-[#16C784]/80" icon={Wallet} />
            )}
            {summary.hasBacktest && (
              <ModuleBadge label="策略回测" colorClass="bg-[#FAC858]/10 text-[#FAC858]/80" icon={BarChart3} />
            )}
            {summary.hasExecutionPlan && (
              <ModuleBadge label="执行计划" colorClass="bg-[#5AA9FF]/10 text-[#5AA9FF]/80" icon={Play} />
            )}
            {summary.hasResearchCandidates && (
              <ModuleBadge label="研究候选" colorClass="bg-[#EE6666]/10 text-[#EE6666]/80" icon={Eye} />
            )}
            {summary.hasConstraintDraft && (
              <ModuleBadge label="约束草案" colorClass="bg-[#73C0DE]/10 text-[#73C0DE]/80" icon={Shield} />
            )}
          </div>

          {/* Quick metrics */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-x-3 gap-y-1 mt-2">
            <Kpi label="预期年化" value={summary.metrics.expectedReturn} tone="positive" />
            <Kpi label="波动率" value={summary.metrics.volatility} />
            <Kpi label="最大回撤" value={summary.metrics.maxDrawdown} tone="negative" />
            <Kpi label="Sharpe" value={summary.metrics.sharpe} />
            <Kpi label="基金数" value={`${summary.metrics.fundCount}只`} />
            <Kpi label="方案数" value={`${summary.metrics.variantCount}`} />
          </div>

          {/* Warnings / gaps */}
          {summary.warnings.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {summary.warnings.map((w, i) => (
                <span key={i} className="inline-flex items-center gap-1 text-[10px] text-white/30">
                  <Info className="w-3 h-3" />
                  {w}
                </span>
              ))}
            </div>
          )}

          <div className="text-[10px] text-white/40 mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
            <span>保存: {plan.created_at.slice(0, 16)}</span>
            {plan.description && (
              <span className="truncate max-w-[200px]">{plan.description}</span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => onRestore(plan.id, '/allocation/result')}
            disabled={restoring === plan.id}
            className="p-1.5 rounded text-white/40 hover:text-white/80 hover:bg-white/[0.06] transition-colors disabled:opacity-50"
            title="打开概览"
          >
            {restoring === plan.id ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <LayoutDashboard className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            onClick={() => onRestore(plan.id, '/allocation/result/strategy')}
            disabled={restoring === plan.id}
            className="p-1.5 rounded text-white/40 hover:text-[#9D7BFF] hover:bg-white/[0.06] transition-colors disabled:opacity-50"
            title="打开优化"
          >
            <Target className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onRestore(plan.id, '/allocation/result/backtest')}
            disabled={restoring === plan.id}
            className="p-1.5 rounded text-white/40 hover:text-[#16C784] hover:bg-white/[0.06] transition-colors disabled:opacity-50"
            title="打开回测"
          >
            <TrendingUp className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onRestore(plan.id, '/allocation/result/execute')}
            disabled={restoring === plan.id}
            className="p-1.5 rounded text-white/40 hover:text-[#3B6CFF] hover:bg-white/[0.06] transition-colors disabled:opacity-50"
            title="打开执行"
          >
            <Play className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onExport(plan.id)}
            className="p-1.5 rounded text-white/40 hover:text-[#FAC858] hover:bg-white/[0.06] transition-colors"
            title="导出报告"
          >
            <FileText className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onDelete(plan.id)}
            className="p-1.5 rounded text-white/40 hover:text-[#EE6666] hover:bg-white/[0.06] transition-colors"
            title="删除"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Expandable detail preview */}
      <div className="mt-3 pt-2 border-t border-white/[0.04]">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-[10px] text-white/40 hover:text-white/60 transition-colors"
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          <Eye className="w-3 h-3" />
          {expanded ? '收起快照' : '查看快照'}
        </button>

        {expanded && (
          <div className="mt-2 space-y-3">
            {/* Allocation summary */}
            <div>
              <div className="text-[10px] text-white/30 mb-1">资产配置摘要</div>
              {summary.metrics.fundCount > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(plan.response as any)?.saa?.group_allocations ? (
                    Object.entries((plan.response as any).saa.group_allocations as Record<string, number>)
                      .slice(0, 4)
                      .map(([k, v]) => (
                        <div key={k} className="text-[10px] px-2 py-1 rounded bg-white/[0.02] border border-white/[0.04]">
                          <span className="text-white/40">{k}:</span>{' '}
                          <span className="text-white/60 data-number">{v}%</span>
                        </div>
                      ))
                  ) : (
                    <span className="text-[10px] text-white/25">—</span>
                  )}
                </div>
              ) : (
                <span className="text-[10px] text-white/25">暂无配置摘要</span>
              )}
            </div>

            {/* Backtest summary */}
            <div>
              <div className="text-[10px] text-white/30 mb-1">回测摘要</div>
              {summary.hasBacktest ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <Kpi label="年化收益" value={summary.backtestMetrics.annualizedReturn} tone="positive" />
                  <Kpi label="年化波动" value={summary.backtestMetrics.annualizedVolatility} />
                  <Kpi label="最大回撤" value={summary.backtestMetrics.maxDrawdown} tone="negative" />
                  <Kpi label="Sharpe" value={summary.backtestMetrics.sharpe} />
                </div>
              ) : (
                <span className="text-[10px] text-white/25">暂无策略回测结果</span>
              )}
            </div>

            {/* Variants */}
            <div>
              <div className="text-[10px] text-white/30 mb-1">多方案</div>
              {summary.hasVariants ? (
                <span className="text-[10px] text-white/50">
                  共 {summary.metrics.variantCount} 个方案对比
                </span>
              ) : (
                <span className="text-[10px] text-white/25">暂无多方案对比</span>
              )}
            </div>

            {/* DCA */}
            <div>
              <div className="text-[10px] text-white/30 mb-1">定投</div>
              {summary.hasDca ? (
                <div className="grid grid-cols-3 gap-2">
                  <Kpi label="总投入" value={summary.dcaMetrics.totalInvested} />
                  <Kpi label="期末市值" value={summary.dcaMetrics.finalValue} />
                  <Kpi label="总收益" value={summary.dcaMetrics.totalReturn} tone="positive" />
                </div>
              ) : (
                <span className="text-[10px] text-white/25">暂无定投结果</span>
              )}
            </div>

            {/* Research context */}
            <div>
              <div className="text-[10px] text-white/30 mb-1">研究候选</div>
              {summary.hasResearchContext ? (
                <div className="space-y-1">
                  <span className="text-[10px] text-white/50">
                    共 {summary.metrics.researchCandidateCount} 只候选，{summary.metrics.constraintDraftCount} 条约束草案
                  </span>
                  {summary.hasResearchCandidates && (
                    <div className="flex flex-wrap gap-1">
                      {(plan.response as any)?.researchReportSnapshot?.candidates?.slice(0, 3).map((c: any, i: number) => (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.02] border border-white/[0.04] text-white/40">
                          {c.fundCode || c.code} {c.fundName || c.name}
                        </span>
                      ))}
                      {summary.metrics.researchCandidateCount > 3 && (
                        <span className="text-[10px] text-white/25">+{summary.metrics.researchCandidateCount - 3}</span>
                      )}
                    </div>
                  )}
                  {summary.hasConstraintDraft && (
                    <div className="flex flex-wrap gap-1">
                      {(plan.response as any)?.researchReportSnapshot?.constraintDrafts?.slice(0, 3).map((d: any, i: number) => (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.02] border border-white/[0.04] text-white/40">
                          {d.fundCode} {d.action}
                        </span>
                      ))}
                      {summary.metrics.constraintDraftCount > 3 && (
                        <span className="text-[10px] text-white/25">+{summary.metrics.constraintDraftCount - 3}</span>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <span className="text-[10px] text-white/25">旧快照缺少研究候选上下文</span>
              )}
            </div>

            {/* Copy / Download Markdown */}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/[0.04]">
              <button
                onClick={handleCopyMarkdown}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-white/[0.04] hover:bg-white/[0.07] text-white/60 hover:text-white/80 transition-colors border border-white/[0.06]"
              >
                {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-[#16C784]" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? "已复制" : "复制 Markdown"}
              </button>
              <button
                onClick={handleDownloadMarkdown}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-white/[0.04] hover:bg-white/[0.07] text-white/60 hover:text-white/80 transition-colors border border-white/[0.06]"
              >
                <Download className="w-3.5 h-3.5" />
                下载 Markdown
              </button>
              {copyError && (
                <span className="text-[10px] text-[#EE6666]">复制失败，请手动复制</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PlansPage() {
  const navigate = useNavigate();
  const { meta } = useAllocationData();
  const { dispatch } = useAllocationStore();

  const [plansData, setPlansData] = useState<PlanListResponse | null>(null);
  const [plansLoading, setPlansLoading] = useState(false);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  const fetchPlans = async () => {
    setPlansLoading(true);
    setPlansError(null);
    try {
      const res = await listPlans({ limit: 50 });
      setPlansData(res);
    } catch (e: any) {
      const msg = e?.message || '获取方案列表失败';
      setPlansError(msg);
    } finally {
      setPlansLoading(false);
    }
  };

  useEffect(() => {
    fetchPlans();
  }, []);

  /** Restore a plan snapshot into the allocation store */
  const handleRestore = async (planId: string, targetPath?: string) => {
    setRestoring(planId);
    try {
      const plan = await getPlan(planId);
      if (!plan || !plan.response) {
        setPlansError('方案数据无效，无法恢复');
        return;
      }
      const req = plan.request || {};
      const res = plan.response as any;
      dispatch({ type: 'UPDATE_CONFIG', patch: req });
      dispatch({ type: 'SET_OUTPUT', output: res });
      dispatch({ type: 'SET_VARIANTS', variants: res.variants || null });
      dispatch({ type: 'SET_EXECUTION_PLAN', plan: res.execution_plan || null });
      dispatch({ type: 'SET_DCA_CONFIG', config: res.dca_plan?.config || null });
      dispatch({ type: 'SET_DCA_RESULT', result: res.dca_plan?.result || null });
      dispatch({ type: 'SET_BACKTEST_RESULT', result: res.backtestResult || null });
      navigate(targetPath || '/allocation/result');
    } catch (e: any) {
      setPlansError(e?.message || '恢复失败');
    } finally {
      setRestoring(null);
    }
  };

  const handleDelete = async (planId: string) => {
    if (!confirm('确定要删除这个方案吗？')) return;
    try {
      await deletePlan(planId);
      fetchPlans();
    } catch (e: any) {
      setPlansError(e?.message || '删除失败');
    }
  };

  const handleToggleFavorite = async (planId: string, current: boolean) => {
    try {
      await updatePlan(planId, { is_favorite: !current });
      fetchPlans();
    } catch (e: any) {
      setPlansError(e?.message || '更新失败');
    }
  };

  const handleExport = (planId: string) => {
    window.open(`/fund/api/storage/report/${planId}`, '_blank');
  };

  const plans = plansData?.plans || [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="方案快照"
        regime={meta.regime}
        regimeLabel={meta.regime_label}
        generatedAt={meta.generated_at}
      />

      {/* Saved Plans List — Report Snapshot List */}
      <SectionCard title="已保存方案" icon={FolderOpen} iconColor="#5470C6">
        {plansError && (
          <div className="flex items-center gap-2 text-xs text-[#EE6666] mb-3">
            <AlertCircle className="w-3.5 h-3.5" />
            {plansError}
          </div>
        )}

        {plansLoading ? (
          <div className="flex items-center gap-2 text-xs text-white/50 py-6">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>正在加载方案列表...</span>
          </div>
        ) : plans.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <FolderX className="w-10 h-10 text-white/15 mb-3" />
            <p className="text-sm text-white/40 mb-1">暂无已保存方案</p>
            <p className="text-xs text-white/25 max-w-xs">
              在配置结果页生成真实方案后，点击"保存方案"按钮，即可在此查看和管理所有快照。
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {plans.map((plan) => (
              <PlanItem
                key={plan.id}
                plan={plan}
                restoring={restoring}
                onRestore={handleRestore}
                onDelete={handleDelete}
                onToggleFavorite={handleToggleFavorite}
                onExport={handleExport}
              />
            ))}
          </div>
        )}
      </SectionCard>

      {/* Save New Plan */}
      <div className="max-w-2xl mx-auto">
        <PlanManager onSave={fetchPlans} />
      </div>
    </div>
  );
}
