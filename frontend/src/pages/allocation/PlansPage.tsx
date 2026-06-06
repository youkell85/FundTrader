import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import {
  FolderOpen, Loader2, LayoutDashboard, Target, TrendingUp, Play,
  FileText, Star, Trash2, AlertCircle, FolderX,
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import SectionCard from '@/components/ui/SectionCard';
import PlanManager from '@/components/allocation/PlanManager';
import { listPlans, getPlan, deletePlan, updatePlan } from '@/lib/api';
import { useAllocationStore } from '@/store/allocationStore';
import { useAllocationData } from '@/hooks/useAllocationData';
import type { SavedPlanItem, PlanListResponse } from '@/types/allocation';
import { RISK_LABELS } from '@/types/allocation';
import { isMockOutput } from '@/lib/execution-plan';

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
      dispatch({ type: 'SET_EXECUTION_PLAN', plan: res.execution_plan || null });
      dispatch({ type: 'SET_DCA_CONFIG', config: res.dca_plan?.config || null });
      dispatch({ type: 'SET_DCA_RESULT', result: res.dca_plan?.result || null });
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

  /** Check snapshot completeness */
  const getSnapshotStatus = (plan: SavedPlanItem) => {
    const res = plan.response as any || {};
    const hasExecution = !!res.execution_plan;
    const hasDca = !!res.dca_plan?.result;
    const hasBacktest = !!res.backtest_summary || !!res.backtest_results;
    return { hasExecution, hasDca, hasBacktest };
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
            {plans.map((plan) => {
              const snap = getSnapshotStatus(plan);
              return (
                <div
                  key={plan.id}
                  className="p-3 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
                >
                  <div className="flex items-start gap-3">
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => handleToggleFavorite(plan.id, plan.is_favorite)}
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
                        {/* Snapshot completeness badges */}
                        {snap.hasExecution && (
                          <span className="text-[10px] px-1 py-0.5 rounded bg-[#5470C6]/10 text-[#5470C6]/80 shrink-0">
                            执行计划
                          </span>
                        )}
                        {snap.hasDca && (
                          <span className="text-[10px] px-1 py-0.5 rounded bg-[#16C784]/10 text-[#16C784]/80 shrink-0">
                            DCA回测
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-white/40 mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                        <span>
                          保存: {plan.created_at.slice(0, 16)}
                        </span>
                        {plan.description && (
                          <span className="truncate max-w-[200px]">
                            {plan.description}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={() => handleRestore(plan.id, '/allocation/result')}
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
                        onClick={() => handleRestore(plan.id, '/allocation/result/strategy')}
                        disabled={restoring === plan.id}
                        className="p-1.5 rounded text-white/40 hover:text-[#9D7BFF] hover:bg-white/[0.06] transition-colors disabled:opacity-50"
                        title="打开优化"
                      >
                        <Target className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleRestore(plan.id, '/allocation/result/backtest')}
                        disabled={restoring === plan.id}
                        className="p-1.5 rounded text-white/40 hover:text-[#16C784] hover:bg-white/[0.06] transition-colors disabled:opacity-50"
                        title="打开回测"
                      >
                        <TrendingUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleRestore(plan.id, '/allocation/result/execute')}
                        disabled={restoring === plan.id}
                        className="p-1.5 rounded text-white/40 hover:text-[#3B6CFF] hover:bg-white/[0.06] transition-colors disabled:opacity-50"
                        title="打开执行"
                      >
                        <Play className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleExport(plan.id)}
                        className="p-1.5 rounded text-white/40 hover:text-[#FAC858] hover:bg-white/[0.06] transition-colors"
                        title="导出报告"
                      >
                        <FileText className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(plan.id)}
                        className="p-1.5 rounded text-white/40 hover:text-[#EE6666] hover:bg-white/[0.06] transition-colors"
                        title="删除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
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
