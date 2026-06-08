import { useState } from 'react';
import { Target, TrendingUp, Zap, Shield, AlertTriangle, CheckCircle2, Info, BarChart3, Scale, Gauge, XCircle, Clock, Loader2, GitCompareArrows } from 'lucide-react';
import { ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { useAllocationData } from '@/hooks/useAllocationData';
import { useAllocationStore } from '@/store/allocationStore';
import { ASSET_CLASS_LABELS, ASSET_GROUP_LABELS, GROUP_COLORS, RISK_LABELS, GOAL_LABELS, HORIZON_LABELS, VARIANT_LABELS, VARIANT_COLORS } from '@/types/allocation';
import { generateVariants } from '@/lib/api';

/** 缺值兜底 */
function fmt(v: number | null | undefined, suffix?: string, digits = 1): string {
  if (v == null || Number.isNaN(v)) return '—';
  return `${v.toFixed(digits)}${suffix || ''}`;
}
function fmtPct(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  const s = v >= 0 ? '+' : '';
  return `${s}${v.toFixed(2)}%`;
}

/** 状态徽章 */
function StatusBadge({ status, text }: { status: 'real' | 'demo' | 'degraded' | 'pending' | 'missing'; text: string }) {
  const styles = {
    real: 'border-[#16C784]/30 bg-[#16C784]/10 text-[#16C784]',
    demo: 'border-[#FFB800]/30 bg-[#FFB800]/10 text-[#FFB800]',
    degraded: 'border-[#EE6666]/30 bg-[#EE6666]/10 text-[#EE6666]',
    pending: 'border-[#5AA9FF]/30 bg-[#5AA9FF]/10 text-[#5AA9FF]',
    missing: 'border-white/[0.08] bg-white/[0.03] text-white/35',
  };
  return (
    <span className={`rounded px-2 py-0.5 text-[11px] border ${styles[status]}`}>
      {text}
    </span>
  );
}

/** 约束状态行 */
function ConstraintRow({ rule, value, limit, passed }: { rule: string; value: string; limit: string; passed: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-xs border-b border-white/[0.03]">
      <span className="text-white/55">{rule}</span>
      <div className="flex items-center gap-2">
        <span className="data-number text-white/45">{value} / {limit}</span>
        {passed ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-[#16C784] shrink-0" />
        ) : (
          <XCircle className="w-3.5 h-3.5 text-[#EE6666] shrink-0" />
        )}
      </div>
    </div>
  );
}

export default function StrategyPage() {
  const { d, saa, taa, funds, pm, meta, constraints, isMock, variants } = useAllocationData();
  const { dispatch, state: storeState } = useAllocationStore();

  // ─── variants 生成状态 ───
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [variantsError, setVariantsError] = useState<string | null>(null);

  // ─── 派生数据 ───
  const pieData = Object.entries(saa.group_allocations || {})
    .filter(([, v]) => (v ?? 0) > 0)
    .map(([k, v]) => ({ name: ASSET_GROUP_LABELS[k] || k, value: v ?? 0 }));

  // 风险贡献数据（SAA 资产级别）
  const riskContribData = Object.entries(saa.risk_contributions || {})
    .filter(([, v]) => (v ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .slice(0, 8)
    .map(([k, v]) => ({
      name: ASSET_CLASS_LABELS[k] || k,
      value: v ?? 0,
    }));

  const totalRiskContrib = riskContribData.reduce((sum, d) => sum + d.value, 0);
  const hasRiskContrib = riskContribData.length > 0 && totalRiskContrib > 0;

  // 约束分类
  const passedCount = constraints.filter(c => c.passed).length;
  const failedCount = constraints.length - passedCount;

  // 优化目标推导：基于 SAA 特征判断
  const objectiveType = deriveObjective(saa);

  // variants 数据（从 store 读取）
  const hasVariants = variants != null && Object.keys(variants.variants || {}).length > 0;

  // 数据新鲜度与降级状态
  const isDegraded = meta.circuit_breaker_triggered || meta.taa_skipped || failedCount > 0;

  // 风险贡献元数据
  const rcSource = saa.risk_contribution_source;
  const rcDataStatus = saa.data_status;
  const rcMissingReason = saa.missing_reason;
  const rcIsPartial = rcDataStatus === 'partial' || (rcSource && rcSource !== 'covariance_matrix');

  // ─── 生成多方案对比 ───
  const handleGenerateVariants = async () => {
    if (isMock) {
      setVariantsError('当前为演示数据，无法生成多方案对比');
      return;
    }
    setVariantsLoading(true);
    setVariantsError(null);
    try {
      const req = storeState.config;
      const resp = await generateVariants(req);
      dispatch({ type: 'SET_VARIANTS', variants: resp });
    } catch (e: any) {
      setVariantsError(e?.message || '多方案对比生成失败');
    } finally {
      setVariantsLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* ===== 工作台头部 ===== */}
      <section className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold text-white tracking-tight">
              组合优化工作台
            </h1>
            <p className="mt-1 text-xs text-white/45">
              查看当前配置方案的目标函数、约束条件、权重来源与风险预算
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isMock ? (
              <StatusBadge status="demo" text="演示数据" />
            ) : (
              <StatusBadge status="real" text="真实配置" />
            )}
            {isDegraded && <StatusBadge status="degraded" text="已降级" />}
            {meta.taa_skipped && <StatusBadge status="pending" text="TAA 跳过" />}
            {meta.circuit_breaker_triggered && <StatusBadge status="degraded" text="断路器触发" />}
          </div>
        </div>

        {/* 元信息条 */}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/40">
          <span className="flex items-center gap-1">
            <Zap className="w-3 h-3" />
            引擎 {meta.engine_version}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {meta.generated_at ? new Date(meta.generated_at).toLocaleString('zh-CN') : '—'}
          </span>
          <span className="flex items-center gap-1">
            <Gauge className="w-3 h-3" />
            市场: {meta.regime_label || meta.regime || '—'}
          </span>
          {meta.regime_pending && !meta.regime_is_confirmed && (
            <span className="text-[#5AA9FF]">
              待确认: {meta.regime_pending} ({meta.regime_pending_count}/2)
            </span>
          )}
        </div>
      </section>

      {/* ===== 优化目标与组合摘要 ===== */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* 优化目标 */}
        <section className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
          <h3 className="text-xs text-white/40 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Target className="w-3.5 h-3.5 text-[#3B6CFF]" />
            优化目标
          </h3>
          <div className="space-y-2">
            <ObjectiveRow
              label="最大夏普"
              active={objectiveType === 'max_sharpe'}
              desc="在有效前沿上寻找风险调整后收益最高的组合"
            />
            <ObjectiveRow
              label="最小波动"
              active={objectiveType === 'min_vol'}
              desc="在给定收益约束下最小化组合波动率"
            />
            <ObjectiveRow
              label="风险平价"
              active={objectiveType === 'risk_parity'}
              desc="各资产风险贡献尽可能均等"
            />
            <ObjectiveRow
              label="有效风险"
              active={objectiveType === 'target_risk'}
              desc="在给定波动率目标下最大化预期收益"
            />
          </div>
          <p className="mt-3 text-[11px] text-white/35 leading-relaxed">
            当前引擎使用 Black-Litterman + SLSQP 两层优化，SAA 阶段求解战略配置，TAA 阶段在 ±10% 区间内做战术微调。
          </p>
        </section>

        {/* 组合 KPI */}
        <section className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
          <h3 className="text-xs text-white/40 uppercase tracking-wider mb-3 flex items-center gap-2">
            <BarChart3 className="w-3.5 h-3.5 text-[#5AA9FF]" />
            组合摘要
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <Kpi label="预期年化" value={fmtPct(pm?.expected_return)} tone={pm?.expected_return != null && pm.expected_return >= 0 ? 'positive' : 'negative'} />
            <Kpi label="波动率" value={fmtPct(pm?.volatility)} />
            <Kpi label="最大回撤" value={fmtPct(pm?.max_drawdown)} tone="negative" />
            <Kpi label="夏普比率" value={fmt(pm?.sharpe, '', 2)} />
            <Kpi label="Calmar" value={fmt(pm?.calmar, '', 2)} />
            <Kpi label="权益中枢" value={`${fmt(saa?.equity_center, '%', 1)}`} />
            <Kpi label="预期收益" value={fmtPct(saa?.expected_return)} tone="positive" />
            <Kpi label="预期波动" value={fmtPct(saa?.expected_volatility)} />
          </div>
        </section>

        {/* 用户画像 */}
        <section className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
          <h3 className="text-xs text-white/40 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Info className="w-3.5 h-3.5 text-[#FAC858]" />
            输入画像
          </h3>
          <div className="space-y-1.5 text-xs">
            <InfoRow label="年龄" value={d.user_profile?.age != null ? `${d.user_profile.age}岁` : '—'} />
            <InfoRow label="投资目标" value={d.user_profile?.risk_tolerance ? (GOAL_LABELS as any)[d.user_profile.horizon] || d.user_profile.horizon : '—'} />
            <InfoRow label="投资期限" value={d.user_profile?.horizon ? HORIZON_LABELS[d.user_profile.horizon] || d.user_profile.horizon : '—'} />
            <InfoRow label="风险偏好" value={d.user_profile?.risk_label || RISK_LABELS[d.user_profile?.risk_tolerance ?? 'balanced'] || '—'} />
            <InfoRow label="有效风险" value={RISK_LABELS[d.user_profile?.effective_risk ?? 'balanced'] || '—'} />
            <InfoRow label="行为校准" value={d.user_profile?.behavior_adjusted ? '已校准' : '未校准'} />
            <InfoRow label="投资金额" value={d.user_profile?.amount != null ? `${d.user_profile.amount.toLocaleString()}元` : '—'} />
            <InfoRow label="最大回撤约束" value={d.constraints?.find(c => c.rule.includes('drawdown'))?.limit ?? '—'} />
          </div>
        </section>
      </div>

      {/* ===== 资产配置与权重 ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 大类配置 */}
        <section className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
          <h3 className="text-xs text-white/40 uppercase tracking-wider mb-3 flex items-center gap-2">
            <PieChartIcon className="w-3.5 h-3.5 text-[#EE6666]" />
            大类资产配置
          </h3>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="w-full sm:w-[220px] h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" outerRadius={70} innerRadius={40} dataKey="value"
                    label={({ name, value }) => `${name} ${(value as number).toFixed(1)}%`}
                    labelLine={false}>
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={Object.values(GROUP_COLORS)[i % 4]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 space-y-2">
              {Object.entries(saa.group_allocations || {}).map(([k, v]) => (
                <div key={k}>
                  <div className="flex justify-between text-xs mb-0.5">
                    <span className="text-white/50">{ASSET_GROUP_LABELS[k] || k}</span>
                    <span className="data-number text-white/70">{fmt(v, '%')}</span>
                  </div>
                  <div className="h-2 rounded-full bg-white/[0.04] overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(v ?? 0, 100)}%`, backgroundColor: (GROUP_COLORS as any)[k] || '#5470C6' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* SAA 资产级权重 */}
        <section className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
          <h3 className="text-xs text-white/40 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Scale className="w-3.5 h-3.5 text-[#9D7BFF]" />
            SAA 战略配置权重
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-white/40 border-b border-white/[0.06]">
                  <th className="text-left py-1.5 px-2 font-normal">资产类别</th>
                  <th className="text-right py-1.5 px-2 font-normal">权重</th>
                  <th className="text-right py-1.5 px-2 font-normal">风险贡献</th>
                  <th className="text-right py-1.5 px-2 font-normal">TAA 调整</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(saa.allocations || {})
                  .filter(([, w]) => (w ?? 0) > 0)
                  .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
                  .map(([k, w]) => {
                    const rc = saa.risk_contributions?.[k];
                    const taaAdj = taa.adjustments?.[k];
                    return (
                      <tr key={k} className="border-b border-white/[0.03]">
                        <td className="py-1.5 px-2 text-white/60">{ASSET_CLASS_LABELS[k] || k}</td>
                        <td className="py-1.5 px-2 text-right data-number text-white/80">{fmt(w, '%')}</td>
                        <td className="py-1.5 px-2 text-right data-number text-[#FAC858]">
                          {rc != null ? fmt(rc, '%') : <span className="text-white/20">—</span>}
                        </td>
                        <td className="py-1.5 px-2 text-right data-number">
                          {taaAdj != null ? (
                            <span style={{ color: taaAdj > 0 ? '#16C784' : '#EE6666' }}>
                              {taaAdj > 0 ? '+' : ''}{fmt(taaAdj, '%')}
                            </span>
                          ) : (
                            <span className="text-white/20">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-[11px] text-white/30">
            SAA: 战略配置 · TAA: 战术调整 · 风险贡献: 该资产对组合总风险的边际贡献
          </div>
        </section>
      </div>

      {/* ===== 约束条件 ===== */}
      <section className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs text-white/40 uppercase tracking-wider flex items-center gap-2">
            <Shield className="w-3.5 h-3.5 text-[#16C784]" />
            约束条件
          </h3>
          <div className="flex items-center gap-2">
            {constraints.length > 0 && (
              <span className="text-[11px] text-white/35">
                {passedCount}/{constraints.length} 通过
                {failedCount > 0 && <span className="text-[#EE6666] ml-1">({failedCount} 未通过)</span>}
              </span>
            )}
          </div>
        </div>
        {constraints.length === 0 ? (
          <div className="text-sm text-white/30 py-4 text-center">暂无约束检查数据</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
            {constraints.map((c) => (
              <ConstraintRow key={c.rule} rule={c.rule} value={c.value} limit={c.limit} passed={c.passed} />
            ))}
          </div>
        )}
        {failedCount > 0 && (
          <div className="mt-2 text-[11px] text-[#FFB800]">
            ⚠ {failedCount} 项约束未满足，配置已自动降级处理。
          </div>
        )}
      </section>

      {/* ===== 风险贡献 / 风险预算 ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs text-white/40 uppercase tracking-wider flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-[#EE6666]" />
              风险贡献
            </h3>
            {!hasRiskContrib && (
              <StatusBadge status="missing" text="数据缺失" />
            )}
          </div>
          {hasRiskContrib ? (
            <>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={riskContribData} layout="vertical" margin={{ left: 60, right: 20 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.04)" horizontal={false} />
                    <XAxis type="number" tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }} unit="%" />
                    <YAxis type="category" dataKey="name" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} width={55} />
                    <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, '风险贡献']} />
                    <Bar dataKey="value" radius={[0, 3, 3, 0]} fill="#EE6666" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 text-[11px] text-white/30">
                {rcIsPartial ? (
                  <span className="text-[#FAC858]">
                    ⚠ 风险贡献来源：{rcSource || '近似计算'}。{rcMissingReason || '协方差矩阵降级，结果仅供参考。'}
                  </span>
                ) : (
                  <span>基于 SAA 协方差矩阵计算的边际风险贡献。总和 ≈ {totalRiskContrib.toFixed(1)}%。</span>
                )}
              </div>
            </>
          ) : (
            <div className="py-8 text-center">
              <AlertTriangle className="w-8 h-8 text-white/15 mx-auto mb-2" />
              <p className="text-sm text-white/35">风险贡献数据缺失</p>
              <p className="text-[11px] text-white/25 mt-1">
                后端生成配置时未返回 risk_contributions 字段，或所有值为零。
              </p>
            </div>
          )}
        </section>

        {/* 集中度检查 */}
        <section className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
          <h3 className="text-xs text-white/40 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Scale className="w-3.5 h-3.5 text-[#FAC858]" />
            集中度检查
          </h3>
          <div className="space-y-3">
            {/* 大类集中度 */}
            <div>
              <div className="text-[11px] text-white/40 mb-1.5">大类权重分布</div>
              {Object.entries(saa.group_allocations || {}).map(([k, v]) => {
                const maxClassLimit = 50; // 假设大类上限 50%
                const overLimit = (v ?? 0) > maxClassLimit;
                return (
                  <div key={k} className="flex items-center justify-between text-xs py-1">
                    <span className="text-white/55">{ASSET_GROUP_LABELS[k] || k}</span>
                    <div className="flex items-center gap-2">
                      <span className={`data-number ${overLimit ? 'text-[#EE6666]' : 'text-white/70'}`}>
                        {fmt(v, '%')}
                      </span>
                      <span className="text-white/25">/ {maxClassLimit}%</span>
                      {overLimit ? <XCircle className="w-3 h-3 text-[#EE6666]" /> : <CheckCircle2 className="w-3 h-3 text-[#16C784]" />}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* 基金级集中度 */}
            <div className="border-t border-white/[0.04] pt-3">
              <div className="text-[11px] text-white/40 mb-1.5">单基金权重 Top 5</div>
              {funds.length === 0 ? (
                <div className="text-xs text-white/25 py-2">暂无基金映射数据</div>
              ) : (
                [...funds].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0)).slice(0, 5).map((f) => {
                  const maxFundLimit = 20; // 假设单基金上限 20%
                  const overLimit = (f.weight ?? 0) > maxFundLimit;
                  return (
                    <div key={f.code} className="flex items-center justify-between text-xs py-1">
                      <span className="text-white/55 truncate max-w-[160px]">{f.name || f.code}</span>
                      <div className="flex items-center gap-2">
                        <span className={`data-number ${overLimit ? 'text-[#EE6666]' : 'text-white/70'}`}>
                          {fmt(f.weight, '%')}
                        </span>
                        <span className="text-white/25">/ {maxFundLimit}%</span>
                        {overLimit ? <XCircle className="w-3 h-3 text-[#EE6666]" /> : <CheckCircle2 className="w-3 h-3 text-[#16C784]" />}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>
      </div>

      {/* ===== 组合对比 (Variants) ===== */}
      <section className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="flex flex-wrap items-center justify-between mb-3 gap-2">
          <h3 className="text-xs text-white/40 uppercase tracking-wider flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5 text-[#5AA9FF]" />
            组合方案对比
          </h3>
          <div className="flex items-center gap-2">
            {!hasVariants && !variantsLoading && (
              <button
                onClick={handleGenerateVariants}
                disabled={variantsLoading || isMock}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-md bg-[#3B6CFF]/20 text-[#5AA9FF] hover:bg-[#3B6CFF]/30 disabled:opacity-50 transition-colors"
              >
                <GitCompareArrows className="w-3 h-3" />
                生成多方案对比
              </button>
            )}
            {!hasVariants && (
              <StatusBadge status="pending" text="待生成" />
            )}
            {hasVariants && (
              <StatusBadge status="real" text="已生成" />
            )}
          </div>
        </div>

        {variantsLoading && (
          <div className="py-6 text-center">
            <Loader2 className="w-6 h-6 text-[#5AA9FF] mx-auto mb-2 animate-spin" />
            <p className="text-sm text-white/35">正在生成三套方案对比（防御/均衡/进取）...</p>
            <p className="text-[11px] text-white/25 mt-1">每次变体需运行完整 14 步管线，约需 30-90 秒</p>
          </div>
        )}

        {variantsError && (
          <div className="py-4 text-center">
            <AlertTriangle className="w-6 h-6 text-[#EE6666] mx-auto mb-2" />
            <p className="text-sm text-[#EE6666]">{variantsError}</p>
          </div>
        )}

        {hasVariants && !variantsLoading && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-white/40 border-b border-white/[0.06]">
                  <th className="text-left py-2 px-2 font-normal">方案</th>
                  <th className="text-right py-2 px-2 font-normal">预期收益</th>
                  <th className="text-right py-2 px-2 font-normal">波动率</th>
                  <th className="text-right py-2 px-2 font-normal">夏普比率</th>
                  <th className="text-right py-2 px-2 font-normal">最大回撤</th>
                  <th className="text-right py-2 px-2 font-normal">权益占比</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(variants.variants).map(([key, v]) => (
                  <tr key={key} className="border-b border-white/[0.03]">
                    <td className="py-2 px-2">
                      <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: (VARIANT_COLORS as any)[key] || '#666' }} />
                      <span className="text-white/70">{VARIANT_LABELS[key] || key}</span>
                    </td>
                    <td className="py-2 px-2 text-right data-number text-[#16C784]">{fmtPct(v.response.saa?.expected_return)}</td>
                    <td className="py-2 px-2 text-right data-number">{fmtPct(v.response.saa?.expected_volatility)}</td>
                    <td className="py-2 px-2 text-right data-number text-[#FAC858]">{fmt(v.response.saa?.sharpe_ratio, '', 2)}</td>
                    <td className="py-2 px-2 text-right data-number text-[#EE6666]">{fmtPct(v.response.saa?.expected_max_drawdown)}</td>
                    <td className="py-2 px-2 text-right data-number">{fmt(v.response.saa?.equity_center, '%')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!hasVariants && !variantsLoading && !variantsError && (
          <div className="py-8 text-center">
            <Info className="w-8 h-8 text-white/15 mx-auto mb-2" />
            <p className="text-sm text-white/35">组合方案对比数据待生成</p>
            <p className="text-[11px] text-white/25 mt-1 max-w-md mx-auto">
              点击上方"生成多方案对比"按钮，获取防御型、均衡型、进取型三套真实方案。
              三套方案基于当前配置请求的风险等级 ±1 偏移独立运行完整管线生成。
            </p>
          </div>
        )}
      </section>

      {/* ===== 压力测试摘要 ===== */}
      <section className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
        <h3 className="text-xs text-white/40 uppercase tracking-wider mb-3 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-[#EE6666]" />
          压力测试摘要
        </h3>
        {d.stress_tests?.length === 0 ? (
          <div className="text-sm text-white/30 py-4 text-center">暂无压力测试数据</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {[...d.stress_tests].sort((a, b) => a.impact - b.impact).map((s) => (
              <div key={s.scenario} className="rounded-md border border-white/[0.04] bg-white/[0.02] px-3 py-2.5">
                <div className="text-[11px] text-white/45">{s.scenario}</div>
                <div className={`mt-1 text-sm font-medium data-number ${s.impact < -15 ? 'text-[#EE6666]' : s.impact < -5 ? 'text-[#FFB800]' : 'text-white/70'}`}>
                  {fmt(s.impact, '%')}
                </div>
                <div className="text-[10px] text-white/25 mt-0.5">
                  预计损失 {s.max_loss != null ? s.max_loss.toLocaleString() : '—'}元
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ===== 数据透明与模型说明 ===== */}
      <section className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
        <h3 className="text-xs text-white/40 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Info className="w-3.5 h-3.5 text-[#73C0DE]" />
          数据状态与模型说明
        </h3>
        <div className="space-y-2">
          {isMock && (
            <div className="rounded border border-[#FFB800]/20 bg-[#FFB800]/[0.05] px-3 py-2 text-xs text-[#FFB800]">
              当前展示为演示数据，未调用真实资产配置引擎。
            </div>
          )}
          {d.warnings?.map((w, i) => (
            <div key={i} className="rounded border border-[#FAC858]/20 bg-[#FAC858]/[0.05] px-3 py-2 text-xs text-[#FAC858]">
              ⚠ {w}
            </div>
          ))}
          {meta.taa_skipped && (
            <div className="rounded border border-[#5AA9FF]/20 bg-[#5AA9FF]/[0.05] px-3 py-2 text-xs text-[#5AA9FF]">
              TAA 调整已跳过（市场状态不明或信号不足），仅使用 SAA 战略配置。
            </div>
          )}
          {meta.regime_pending && !meta.regime_is_confirmed && (
            <div className="rounded border border-[#5AA9FF]/20 bg-[#5AA9FF]/[0.05] px-3 py-2 text-xs text-[#5AA9FF]">
              市场状态待确认：{meta.regime_pending} ({meta.regime_pending_count}/2)
            </div>
          )}
          {!hasRiskContrib && (
            <div className="rounded border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-white/35">
              风险贡献数据缺失 — 后端 /allocation/generate 未返回 risk_contributions 字段。
            </div>
          )}
          {!hasVariants && (
            <div className="rounded border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-white/35">
              组合对比数据缺失 — 需调用 /allocation/variants 获取多方案数据。
            </div>
          )}
          <div className="text-[11px] text-white/30 leading-relaxed mt-2">
            <p className="font-medium text-white/40 mb-1">模型说明</p>
            <p><strong className="text-white/45">SAA（战略配置）</strong>：Black-Litterman 框架 + 生命周期下滑路径，SLSQP 两层优化求解。目标是在给定风险预算和约束下最大化风险调整后收益。</p>
            <p className="mt-1"><strong className="text-white/45">TAA（战术调整）</strong>：综合宏观信号（PMI、CPI、FED 模型、信用利差等），在 SAA ±10% 区间内做动态微调。</p>
            <p className="mt-1"><strong className="text-white/45">压力测试</strong>：覆盖滞胀、衰退、利率冲击、权益暴跌等历史情景。</p>
            <p className="mt-1"><strong className="text-white/45">蒙特卡洛</strong>：10,000 次路径模拟，正态分布假设。</p>
            <p className="mt-1"><strong className="text-white/45">数据来源</strong>：基金净值（天天基金/akshare）、宏观指标（Tushare/IFind）、市场状态（自定义 regime detector）。</p>
          </div>
        </div>
      </section>
    </div>
  );
}

// ===== 小组件 =====

function PieChartIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
      <path d="M22 12A10 10 0 0 0 12 2v10z" />
    </svg>
  );
}

function ObjectiveRow({ label, active, desc }: { label: string; active: boolean; desc: string }) {
  return (
    <div className={`flex items-start gap-2 rounded px-2 py-1.5 text-xs ${active ? 'bg-[#3B6CFF]/[0.06] border border-[#3B6CFF]/15' : 'border border-transparent'}`}>
      <div className={`w-3.5 h-3.5 rounded-full border shrink-0 mt-0.5 ${active ? 'border-[#3B6CFF] bg-[#3B6CFF]/20' : 'border-white/15'}`}>
        {active && <div className="w-1.5 h-1.5 rounded-full bg-[#3B6CFF] mx-auto mt-0.75" />}
      </div>
      <div>
        <span className={active ? 'text-[#5AA9FF] font-medium' : 'text-white/50'}>{label}</span>
        <p className="text-[11px] text-white/30 mt-0.5">{desc}</p>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'positive' | 'negative' | 'neutral' }) {
  const color = tone === 'positive' ? 'text-[#16C784]' : tone === 'negative' ? 'text-[#EE6666]' : 'text-white/70';
  return (
    <div className="rounded-md border border-white/[0.05] bg-white/[0.02] px-2.5 py-2">
      <div className="text-[10px] text-white/35">{label}</div>
      <div className={`mt-0.5 text-sm font-medium data-number ${color}`}>{value}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-white/40">{label}</span>
      <span className="text-white/65">{value}</span>
    </div>
  );
}

/** 基于 SAA 特征推导优化目标类型（展示用，非精确判定） */
function deriveObjective(saa: any): 'max_sharpe' | 'min_vol' | 'risk_parity' | 'target_risk' {
  if (!saa) return 'max_sharpe';
  const rc = saa.risk_contributions;
  if (rc && Object.keys(rc).length > 0) {
    const vals = Object.values(rc).filter((v: any) => v != null) as number[];
    if (vals.length > 1) {
      const max = Math.max(...vals);
      const min = Math.min(...vals);
      if (max > 0 && min / max > 0.5) return 'risk_parity';
    }
  }
  if (saa.sharpe_ratio != null && saa.sharpe_ratio > 0.5) return 'max_sharpe';
  if (saa.expected_volatility != null && saa.expected_volatility < 8) return 'min_vol';
  return 'max_sharpe';
}
