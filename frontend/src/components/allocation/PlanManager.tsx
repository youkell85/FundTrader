import React, { useState, useEffect } from 'react';
import { Save, Download, Star, Trash2, FileText, Clock } from 'lucide-react';
import { savePlan, listPlans, deletePlan, updatePlan } from '@/lib/api';
import type { SavedPlanItem, PlanListResponse } from '@/types/allocation';
import { useAllocationStore } from '@/store/allocationStore';
import { RISK_LABELS } from '@/types/allocation';
import { isMockOutput } from '@/lib/execution-plan';

interface PlanManagerProps {
  onSave?: () => void;
}

export default function PlanManager({ onSave }: PlanManagerProps) {
  const [plans, setPlans] = useState<PlanListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [planName, setPlanName] = useState('');
  const [showList, setShowList] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  let storeOutput: any = null;
  let storeConfig: any = null;
  let store: any = null;
  try {
    store = useAllocationStore();
    storeOutput = store.state.output;
    storeConfig = store.state.config;
  } catch {}

  const fetchPlans = async () => {
    setLoading(true);
    try {
      const res = await listPlans({ limit: 20 });
      setPlans(res);
    } catch (e: any) {
      console.error('Failed to fetch plans:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (showList) fetchPlans();
  }, [showList]);

  const handleSave = async () => {
    if (!storeOutput || !storeConfig) {
      setMessage({ type: 'error', text: '请先生成配置方案' });
      return;
    }
    if (isMockOutput(storeOutput)) {
      setMessage({ type: 'error', text: '演示数据不可保存，请生成真实配置方案' });
      return;
    }
    setSaving(true);
    try {
      const name = planName.trim() || `配置方案 ${new Date().toLocaleDateString()}`;
      const responseWithExecution = {
        ...(storeOutput as any),
        execution_plan: store.executionPlan,
        dca_plan: {
          config: store.dcaConfig,
          result: store.dcaResult,
        },
      };
      await savePlan({
        name,
        request: storeConfig as any,
        response: responseWithExecution,
      });
      setMessage({ type: 'success', text: `方案"${name}"已保存` });
      setPlanName('');
      onSave?.();
      setTimeout(() => setMessage(null), 3000);
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || '保存失败' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (planId: string) => {
    if (!confirm('确定要删除这个方案吗？')) return;
    try {
      await deletePlan(planId);
      setMessage({ type: 'success', text: '方案已删除' });
      fetchPlans();
      setTimeout(() => setMessage(null), 3000);
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || '删除失败' });
    }
  };

  const handleToggleFavorite = async (planId: string, current: boolean) => {
    try {
      await updatePlan(planId, { is_favorite: !current });
      fetchPlans();
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || '更新失败' });
    }
  };

  const handleExport = (planId: string) => {
    const url = `/fund/api/storage/report/${planId}`;
    window.open(url, '_blank');
  };

  const handleExportCurrent = () => {
    // Export current plan directly (without saving)
    if (!storeOutput) {
      setMessage({ type: 'error', text: '请先生成配置方案' });
      return;
    }
    if (isMockOutput(storeOutput)) {
      setMessage({ type: 'error', text: '演示数据不可导出，请生成真实配置方案' });
      return;
    }
    // Create a blob URL with the HTML content
    const html = generateQuickReport(storeOutput);
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  return (
    <div className="space-y-4">
      {/* Message */}
      {message && (
        <div className={`liquid-glass p-3 text-xs rounded-lg ${
          message.type === 'success' ? 'text-[#16C784] border-l-2 border-[#16C784]' : 'text-[#EE6666] border-l-2 border-[#EE6666]'
        }`}>
          {message.text}
        </div>
      )}

      {/* Save Section */}
      <div className="liquid-glass p-4">
        <h3 className="text-sm font-medium text-white/80 mb-3 flex items-center gap-2">
          <Save className="w-4 h-4 text-[#5470C6]" />保存当前方案
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={planName}
            onChange={(e) => setPlanName(e.target.value)}
            placeholder="方案名称（可选）"
            className="flex-1 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white text-xs placeholder:text-white/30 focus:outline-none focus:border-[#5470C6]/50"
          />
          <button
            onClick={handleSave}
            disabled={saving || !storeOutput || isMockOutput(storeOutput)}
            className="px-4 py-2 rounded-lg bg-[#5470C6]/20 text-[#5470C6] text-xs font-medium hover:bg-[#5470C6]/30 transition-colors disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      {/* Export Section */}
      <div className="liquid-glass p-4">
        <h3 className="text-sm font-medium text-white/80 mb-3 flex items-center gap-2">
          <FileText className="w-4 h-4 text-[#FAC858]" />导出报告
        </h3>
        <div className="flex gap-2">
          <button
            onClick={handleExportCurrent}
            disabled={!storeOutput || isMockOutput(storeOutput)}
            className="flex-1 px-4 py-2 rounded-lg bg-[#FAC858]/10 text-[#FAC858] text-xs font-medium hover:bg-[#FAC858]/20 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Download className="w-3.5 h-3.5" />导出当前方案 PDF
          </button>
        </div>
      </div>

      {/* Saved Plans List */}
      <div className="liquid-glass p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-white/80 flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#16C784]" />已保存方案
          </h3>
          <button
            onClick={() => setShowList(!showList)}
            className="text-xs text-white/50 hover:text-white/80 transition-colors"
          >
            {showList ? '收起' : '展开'} ({plans?.total || 0})
          </button>
        </div>

        {showList && (
          <div className="space-y-2">
            {loading ? (
              <div className="text-center py-4 text-white/50 text-xs">加载中...</div>
            ) : !plans || plans.plans.length === 0 ? (
              <div className="text-center py-4 text-white/50 text-xs">暂无保存的方案</div>
            ) : (
              plans.plans.map((plan) => (
                <div key={plan.id} className="p-3 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleToggleFavorite(plan.id, plan.is_favorite)}
                          className="text-white/50 hover:text-[#FAC858] transition-colors"
                        >
                          <Star className={`w-3.5 h-3.5 ${plan.is_favorite ? 'fill-[#FAC858] text-[#FAC858]' : ''}`} />
                        </button>
                        <span className="text-white/80 text-xs font-medium truncate">{plan.name}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] text-white/40">
                          {RISK_LABELS[plan.risk_profile] || plan.risk_profile}
                        </span>
                      </div>
                      <div className="text-[10px] text-white/50 mt-1">
                        {plan.created_at.slice(0, 16)} | {plan.description || '无描述'}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 ml-2">
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
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Quick inline report generation (for export without saving)
function generateQuickReport(data: any): string {
  const meta = data.meta || {};
  const user = data.user_profile || {};
  const saa = data.saa || {};
  const funds = data.funds || [];

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>资产配置方案报告</title>
  <style>
    body { font-family: -apple-system, "PingFang SC", sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; color: #333; }
    h1 { text-align: center; border-bottom: 2px solid #e9ecef; padding-bottom: 16px; margin-bottom: 24px; }
    .section { margin-bottom: 24px; }
    .section h2 { font-size: 18px; border-left: 4px solid #3b82f6; padding-left: 12px; margin-bottom: 12px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
    .card { background: #f8f9fa; padding: 12px; border-radius: 6px; }
    .card-label { font-size: 12px; color: #6c757d; }
    .card-value { font-size: 18px; font-weight: 600; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { padding: 8px 12px; border-bottom: 1px solid #e9ecef; text-align: left; }
    th { background: #f8f9fa; font-weight: 600; }
    .footer { margin-top: 40px; text-align: center; font-size: 12px; color: #6c757d; border-top: 1px solid #e9ecef; padding-top: 16px; }
    .warning { background: #fef3c7; padding: 12px; border-radius: 6px; margin-top: 20px; font-size: 14px; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <h1>资产配置方案报告</h1>
  <div class="section">
    <h2>用户画像</h2>
    <div class="grid">
      <div class="card"><div class="card-label">风险偏好</div><div class="card-value">${user.risk_label || '平衡型'}</div></div>
      <div class="card"><div class="card-label">年龄</div><div class="card-value">${user.age || 35}岁</div></div>
      <div class="card"><div class="card-label">投资金额</div><div class="card-value">¥${(user.amount || 500000).toLocaleString()}</div></div>
    </div>
  </div>
  <div class="section">
    <h2>组合指标</h2>
    <div class="grid">
      <div class="card"><div class="card-label">预期收益</div><div class="card-value" style="color:#10b981">${(saa.expected_return || 0).toFixed(1)}%</div></div>
      <div class="card"><div class="card-label">预期波动</div><div class="card-value">${(saa.expected_volatility || 0).toFixed(1)}%</div></div>
      <div class="card"><div class="card-label">夏普比率</div><div class="card-value" style="color:#3b82f6">${(saa.sharpe_ratio || 0).toFixed(2)}</div></div>
    </div>
  </div>
  <div class="section">
    <h2>推荐基金 (${funds.length}只)</h2>
    <table>
      <tr><th>代码</th><th>名称</th><th>权重</th><th>金额</th><th>角色</th></tr>
      ${funds.map((f: any) => `<tr><td>${f.code}</td><td>${f.name}</td><td>${f.weight}%</td><td>¥${f.amount?.toLocaleString()}</td><td>${f.role}</td></tr>`).join('')}
    </table>
  </div>
  <div class="warning"><strong>风险提示：</strong>本报告仅供参考，不构成投资建议。投资有风险，入市需谨慎。</div>
  <div class="footer">
    FundTrader 智能资产配置平台 | ${new Date().toLocaleString()}
    <br><button onclick="window.print()" style="margin-top:12px;padding:8px 20px;background:#3b82f6;color:white;border:none;border-radius:4px;cursor:pointer">打印/保存PDF</button>
  </div>
</body>
</html>`;
}
