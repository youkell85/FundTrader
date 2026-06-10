import { useState, useRef, useEffect, useCallback } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import {
  PieChart as PieIcon, Gauge, List, ChevronDown, ChevronRight, Play, AlertCircle,
  User, Target, Clock, Shield, Wallet, TrendingUp, BarChart3, Scale,
  FileText, Zap, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import { GROUP_COLORS, ASSET_CLASS_LABELS, ASSET_GROUP_LABELS, RISK_LABELS, GOAL_LABELS, HORIZON_LABELS } from '@/types/allocation';
import { useAllocationData } from '@/hooks/useAllocationData';
import { useAllocationStore } from '@/store/allocationStore';
import { generateAllocationStream, getMarketDataStatus } from '@/lib/api';
import AllocationProgress, { type StepState, STEP_LABELS } from '@/components/allocation/AllocationProgress';
import DataFreshnessBar from '@/components/allocation/DataFreshnessBar';
import type { AllocationDataQuality, MarketDataStatus } from '@/types/allocation';

const GLABELS = ASSET_GROUP_LABELS;

/** 缺值兜底：null/undefined → 显示 — */
function fmt(v: number | null | undefined, suffix?: string, digits = 1): string {
  if (v == null || Number.isNaN(v)) return '—';
  return `${v.toFixed(digits)}${suffix || ''}`;
}
function fmtPct(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  const s = v >= 0 ? '+' : '';
  return `${s}${v.toFixed(2)}%`;
}

export default function OverviewPage() {
  const { d, saa, taa, funds, mc, st, pm, meta, constraints, isMock, isReal } = useAllocationData();
  const { state: storeState, dispatch } = useAllocationStore();
  const [expandLog, setExpandLog] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [streamSteps, setStreamSteps] = useState<StepState[]>(() =>
    Object.keys(STEP_LABELS).map(name => ({ name, status: "running" as const, detail: "" })),
  );
  const [currentStep, setCurrentStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [marketStatus, setMarketStatus] = useState<MarketDataStatus | null>(null);
  const startTime = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const streamCancelRef = useRef<{ cancel: () => void } | null>(null);

  useEffect(() => { return () => { if (timerRef.current) clearInterval(timerRef.current); }; }, []);

  useEffect(() => {
    let active = true;
    const fetchStatus = () => {
      getMarketDataStatus().then((status) => { if (active) setMarketStatus(status); }).catch(() => {});
    };
    fetchStatus();
    const timer = setInterval(fetchStatus, 60000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  const startTimer = useCallback(() => {
    startTime.current = Date.now();
    timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startTime.current) / 1000)), 200);
  }, []);
  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = undefined; }
  }, []);

  const handleGenerate = () => {
    setGenerating(true);
    setGenError(null);
    setCurrentStep(0);
    setStreamSteps(Object.keys(STEP_LABELS).map(name => ({ name, status: "running" as const, detail: "" })));
    startTimer();

    streamCancelRef.current = generateAllocationStream(
      storeState.config,
      (step, _total, name, status, detail) => {
        setCurrentStep(step);
        setStreamSteps(prev => prev.map(s => s.name === name ? { ...s, status: status as StepState["status"], detail } : s));
      },
      (result) => { stopTimer(); setGenerating(false); dispatch({ type: 'SET_OUTPUT', output: result }); },
      (msg) => { stopTimer(); setGenerating(false); setGenError(msg); },
      () => { stopTimer(); setGenerating(false); },
    );
  };

  const handleCancelGenerate = () => {
    streamCancelRef.current?.cancel();
    stopTimer();
    setGenerating(false);
  };

  const pieData = Object.entries(saa.group_allocations)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ name: GLABELS[k] || k, value: v }));
  const stressData = [...st].sort((a, b) => a.impact - b.impact);

  const profile = d.user_profile;

  // 约束检查
  const failedConstraints = constraints.filter(c => !c.passed);

  return (
    <div className="space-y-5">
      {/* ===== 报告摘要区 ===== */}
      <section className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold text-white tracking-tight">
              配置研究报告
            </h1>
            <p className="mt-1 text-xs text-white/45">
              引擎 {meta.engine_version} · {meta.generated_at ? new Date(meta.generated_at).toLocaleString('zh-CN') : '—'}
              {meta.regime_label && (
                <span className="ml-2 rounded border border-white/[0.08] px-1.5 py-0.5 text-[11px]">
                  {meta.regime_label}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isMock ? (
              <span className="rounded border border-[#FFB800]/30 bg-[#FFB800]/10 px-2 py-0.5 text-xs text-[#FFB800]">
                演示数据
              </span>
            ) : (
              <span className="rounded border border-[#16C784]/30 bg-[#16C784]/10 px-2 py-0.5 text-xs text-[#16C784]">
                真实配置
              </span>
            )}
            {meta.circuit_breaker_triggered && (
              <span className="rounded border border-[#EE6666]/30 bg-[#EE6666]/10 px-2 py-0.5 text-xs text-[#EE6666]">
                断路器触发
              </span>
            )}
          </div>
        </div>

        {/* 用户画像 */}
        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-7">
          <ProfileItem icon={User} label="年龄" value={`${profile?.age ?? '—'}岁`} />
          <ProfileItem icon={Target} label="目标" value={profile?.horizon ? GOAL_LABELS[profile.horizon as keyof typeof GOAL_LABELS] || profile.horizon : '—'} />
          <ProfileItem icon={Clock} label="期限" value={profile?.horizon ? HORIZON_LABELS[profile.horizon as keyof typeof HORIZON_LABELS] || profile.horizon : '—'} />
          <ProfileItem icon={Shield} label="风险偏好" value={profile?.risk_label ?? RISK_LABELS[profile?.risk_tolerance ?? 'balanced'] ?? '—'} />
          <ProfileItem icon={Wallet} label="金额" value={`${(profile?.amount ?? 0).toLocaleString()}元`} />
          <ProfileItem icon={Scale} label="最大回撤约束" value={`${d.constraints?.find(c => c.rule.includes('drawdown'))?.limit ?? '—'}`} />
          <ProfileItem icon={Zap} label="有效风险" value={RISK_LABELS[profile?.effective_risk ?? 'balanced'] ?? '—'} behavior={profile?.behavior_adjusted} />
        </div>
      </section>

      {/* 生成按钮区 */}
      {isMock && (
        <div className="liquid-glass p-4 border border-[#3B6CFF]/20 bg-[#3B6CFF]/[0.05]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm text-white/70">当前显示为示例数据，点击生成真实配置方案</p>
              {genError && (
                <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" aria-hidden="true" /> {genError}
                </p>
              )}
            </div>
            {generating ? (
              <AllocationProgress steps={streamSteps} currentStep={currentStep} totalSteps={14} elapsed={elapsed} onCancel={handleCancelGenerate} />
            ) : (
              <button onClick={handleGenerate} disabled={generating} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#3B6CFF] text-white text-sm font-medium hover:bg-[#3B6CFF]/80 disabled:opacity-50 transition-colors">
                <Play className="w-4 h-4" aria-hidden="true" /> 生成配置
              </button>
            )}
          </div>
        </div>
      )}

      {!isMock && (
        <div className="flex items-center gap-3">
          {generating ? (
            <div className="flex-1"><AllocationProgress steps={streamSteps} currentStep={currentStep} totalSteps={14} elapsed={elapsed} onCancel={handleCancelGenerate} /></div>
          ) : (
            <button onClick={handleGenerate} disabled={generating} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#3B6CFF]/10 text-[#5AA9FF] text-xs font-medium hover:bg-[#3B6CFF]/20 disabled:opacity-50 transition-colors">
              <Play className="w-3.5 h-3.5" aria-hidden="true" /> 重新生成
            </button>
          )}
          {genError && (
            <p className="text-xs text-red-400 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" aria-hidden="true" /> {genError}
            </p>
          )}
        </div>
      )}

      <DataFreshnessBar status={marketStatus} generatedAt={meta.generated_at} />
      <AllocationQualitySummary quality={d.data_quality} />

      {/* ===== 预期指标条 ===== */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2 md:gap-3">
        <KpiCard label="预期年化" value={fmtPct(pm.expected_return)} tone={pm.expected_return >= 0 ? 'positive' : 'negative'} />
        <KpiCard label="波动率" value={fmtPct(pm.volatility)} />
        <KpiCard label="最大回撤" value={fmtPct(pm.max_drawdown)} tone="negative" />
        <KpiCard label="夏普比率" value={fmt(pm.sharpe, '', 2)} />
        <KpiCard label="Calmar" value={fmt(pm.calmar, '', 2)} />
        <KpiCard label="权益中枢" value={`${fmt(saa.equity_center, '%', 1)}`} />
      </div>

      {/* ===== 资产配置 ===== */}
      <section>
        <h2 className="text-base font-semibold text-white/85 mb-3 flex items-center gap-2">
          <PieIcon className="w-4 h-4 text-[#3B6CFF]" />
          资产配置
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="liquid-glass p-4">
            <h3 className="text-xs text-white/50 mb-3">大类权重</h3>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" outerRadius={80} innerRadius={45} dataKey="value"
                    label={({ name, value }) => name + ' ' + (value as number).toFixed(1) + '%'}>
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={Object.values(GROUP_COLORS)[i % 4]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="liquid-glass p-4">
            <h3 className="text-xs text-white/50 mb-3">风险预算瀑布</h3>
            <div className="space-y-2">
              {Object.entries(saa.group_allocations).map(([k, v]) => (
                <div key={k}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-white/50">{GLABELS[k] || k}</span>
                    <span className="data-number text-white/70">{v.toFixed(1)}%</span>
                  </div>
                  <div className="h-3 rounded-full bg-white/[0.04] overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${v}%`, backgroundColor: (GROUP_COLORS as any)[k] || '#5470C6' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ===== 基金候选 ===== */}
      <section>
        <h2 className="text-base font-semibold text-white/85 mb-3 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-[#5AA9FF]" />
          核心基金候选
        </h2>
        <div className="liquid-glass p-4 overflow-x-auto">
          {funds.length === 0 ? (
            <div className="text-sm text-white/45 py-6 text-center">暂无基金映射数据</div>
          ) : (
            <table className="w-full min-w-[640px] text-xs">
              <thead>
                <tr className="text-white/45 border-b border-white/[0.06]">
                  <th className="text-left py-2 px-2 font-normal">代码</th>
                  <th className="text-left py-2 px-2 font-normal">名称</th>
                  <th className="text-left py-2 px-2 font-normal">类型</th>
                  <th className="text-left py-2 px-2 font-normal">角色</th>
                  <th className="text-right py-2 px-2 font-normal">权重</th>
                  <th className="text-right py-2 px-2 font-normal">金额(元)</th>
                  <th className="text-left py-2 px-2 font-normal">入选理由</th>
                </tr>
              </thead>
              <tbody>
                {funds.map((f) => (
                  <tr key={f.code} className="border-b border-white/[0.03]">
                    <td className="py-2 px-2 data-number text-[#5AA9FF]">{f.code}</td>
                    <td className="py-2 px-2 text-white/70">{f.name}</td>
                    <td className="py-2 px-2 text-white/45">{ASSET_CLASS_LABELS[f.asset_class] || f.asset_class}</td>
                    <td className="py-2 px-2 text-white/45">{f.role}</td>
                    <td className="py-2 px-2 text-right data-number">{f.weight?.toFixed(1)}%</td>
                    <td className="py-2 px-2 text-right data-number text-white/55">{f.amount?.toLocaleString?.() ?? '—'}</td>
                    <td className="py-2 px-2 text-white/40 max-w-[240px] truncate" title={f.reason}>{f.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* ===== 风险与压力测试 ===== */}
      <section>
        <h2 className="text-base font-semibold text-white/85 mb-3 flex items-center gap-2">
          <Gauge className="w-4 h-4 text-[#EE6666]" />
          风险画像与压力测试
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 压力情景 */}
          <div className="liquid-glass p-4">
            <h3 className="text-xs text-white/50 mb-3">压力情景</h3>
            <div className="space-y-2">
              {stressData.length === 0 ? (
                <div className="text-sm text-white/45 py-4 text-center">暂无压力测试数据</div>
              ) : (
                stressData.map((s) => (
                  <div key={s.scenario} className="flex items-center justify-between text-xs">
                    <span className="text-white/55">{s.scenario}</span>
                    <span className={`data-number ${s.impact < -15 ? 'text-[#EE6666]' : s.impact < -5 ? 'text-[#FFB800]' : 'text-white/70'}`}>
                      {s.impact.toFixed(1)}%
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 蒙特卡洛 */}
          <div className="liquid-glass p-4">
            <h3 className="text-xs text-white/50 mb-3">蒙特卡洛 (1y)</h3>
            {mc ? (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Metric label="中位收益" value={fmtPct(mc.median_return)} />
                <Metric label="正收益概率" value={`${(mc.prob_positive * 100).toFixed(0)}%`} />
                <Metric label="VaR 95%" value={fmtPct(mc.var_95)} />
                <Metric label="CVaR 95%" value={fmtPct(mc.cvar_95)} />
                <Metric label="10%分位" value={fmtPct(mc.percentile_10)} />
                <Metric label="90%分位" value={fmtPct(mc.percentile_90)} />
              </div>
            ) : (
              <div className="text-sm text-white/45 py-4 text-center">暂无蒙特卡洛数据</div>
            )}
          </div>
        </div>

        {/* 约束检查 */}
        {constraints.length > 0 && (
          <div className="mt-3 liquid-glass p-4">
            <h3 className="text-xs text-white/50 mb-2">约束检查</h3>
            <div className="space-y-1.5">
              {constraints.map((c) => (
                <div key={c.rule} className="flex items-center justify-between text-xs">
                  <span className="text-white/55">{c.rule}</span>
                  <div className="flex items-center gap-2">
                    <span className="data-number text-white/45">{c.value} / {c.limit}</span>
                    {c.passed ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#16C784]" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-[#EE6666]" />
                    )}
                  </div>
                </div>
              ))}
            </div>
            {failedConstraints.length > 0 && (
              <div className="mt-2 text-xs text-[#FFB800]">
                ⚠ {failedConstraints.length} 项约束未通过，配置已降级处理。
              </div>
            )}
          </div>
        )}
      </section>

      {/* ===== 执行建议 ===== */}
      <section>
        <h2 className="text-base font-semibold text-white/85 mb-3 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-[#16C784]" />
          执行建议
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <SuggestionCard
            icon={FileText}
            title="定投方案"
            desc={isReal ? '已生成执行计划，可进入"执行计划"页配置定投参数并回测。' : '先生成真实配置方案后，可制定定投计划。'}
            action={isReal ? { label: '前往执行计划', href: '/allocation/result/execute' } : undefined}
          />
          <SuggestionCard
            icon={Scale}
            title="再平衡"
            desc={`建议再平衡频率：季度。当前权益中枢 ${fmt(saa.equity_center, '%', 1)}，偏离 ±5% 时触发。`}
          />
          <SuggestionCard
            icon={Zap}
            title="保存方案"
            desc={isReal ? '将当前配置保存到方案管理，支持后续跟踪和再平衡提醒。' : '生成真实配置后可保存。'}
            action={isReal ? { label: '保存方案', href: '/allocation/result/plans' } : undefined}
          />
        </div>
      </section>

      {/* ===== 数据缺口与模型说明 ===== */}
      <section>
        <h2 className="text-base font-semibold text-white/85 mb-3 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-[#FFB800]" />
          数据缺口与模型说明
        </h2>
        <div className="space-y-2">
          {isMock && (
            <div className="rounded-lg border border-[#FFB800]/20 bg-[#FFB800]/[0.05] px-4 py-3 text-sm text-[#FFB800]">
              当前展示为演示数据，未调用真实资产配置引擎。点击上方"生成配置"获取真实结果。
            </div>
          )}
          {d.warnings?.map((w, i) => (
            <div key={i} className="rounded-lg border border-[#FAC858]/20 bg-[#FAC858]/[0.05] px-4 py-2 text-xs text-[#FAC858]">
              ⚠ {w}
            </div>
          ))}
          {meta.taa_skipped && (
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-2 text-xs text-white/45">
              TAA 调整已跳过（市场状态不明或信号不足），仅使用 SAA 战略配置。
            </div>
          )}
          {meta.regime_pending && !meta.regime_is_confirmed && (
            <div className="rounded-lg border border-[#5AA9FF]/20 bg-[#5AA9FF]/[0.05] px-4 py-2 text-xs text-[#5AA9FF]">
              市场状态待确认：{meta.regime_pending} ({meta.regime_pending_count}/2)
            </div>
          )}
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-xs text-white/45 leading-relaxed">
            <p className="font-medium text-white/55 mb-1">模型说明</p>
            <p>SAA：基于两层贝叶斯混合框架（Anchor先验 + Signal数据驱动）+ 生命周期下滑路径，使用 SLSQP 6级fallback优化求解。</p>
            <p>TAA：综合宏观信号（PMI、CPI、FED模型、信用利差等）对 SAA 做±10%区间调整。</p>
            <p>压力测试：覆盖滞胀、衰退、利率冲击、权益暴跌等情景。</p>
            <p>蒙特卡洛：1,000 次路径模拟，Cholesky 分解关联 + 体制感知跳跃扩散（非正态尾部）。</p>
          </div>
        </div>
      </section>

      {/* ===== 审计日志 ===== */}
      <div className="liquid-glass p-4">
        <button
          aria-expanded={expandLog}
          onClick={() => setExpandLog(!expandLog)}
          className="flex items-center justify-between w-full text-sm text-white/70 focus-visible:ring-2 focus-visible:ring-[#3B6CFF]/50 rounded-lg px-2 py-1 -mx-2 -my-1"
        >
          <span>
            <List className="w-4 h-4 inline mr-2" style={{ color: '#9D7BFF' }} aria-hidden="true" />
            配置审计日志
          </span>
          {expandLog ? <ChevronDown className="w-4 h-4" aria-hidden="true" /> : <ChevronRight className="w-4 h-4" aria-hidden="true" />}
        </button>
        {expandLog && (
          <div className="mt-3 space-y-1 text-xs text-white/45">
            <div>PORTRAIT: 风险={profile?.risk_label || '—'}, 有效={profile?.effective_risk ? RISK_LABELS[profile.effective_risk] : '—'}{profile?.behavior_adjusted ? ' (行为校准)' : ''}</div>
            <div>
              REGIME: {meta.regime_label}
              {meta.regime_pending && !meta.regime_is_confirmed
                ? ` → 待确认: ${meta.regime_pending}(${meta.regime_pending_count}/2)`
                : ''}{' '}
              (composite={taa.composite_score.toFixed(2)})
            </div>
            <div className="text-[#16C784]">SAA: SLSQP两层求解, 权益中枢{saa.equity_center}%</div>
            <div className="text-[#5AA9FF]">
              TAA: 综合{taa.composite_score > 0 ? '+' : ''}
              {taa.composite_score.toFixed(2)}, 超配{taa.equity_adjustment}%
              {taa.fed_value != null && (
                <span className="ml-2 text-[#5AA9FF] font-medium">FED={taa.fed_value}</span>
              )}
            </div>
            <div>FUNDS: {funds.length}只映射完成</div>
            <div className="text-[#EE6666]">
              STRESS: 最坏{stressData[0]?.scenario}({stressData[0]?.impact}%)
            </div>
            <div>
              MC: 中位{mc?.median_return != null ? `${mc.median_return.toFixed(1)}%` : 'N/A'}, 概率{mc?.prob_positive != null ? `${(mc.prob_positive * 100).toFixed(0)}%` : 'N/A'}
            </div>
          </div>
        )}
      </div>

      <div className="liquid-glass p-4 border border-[#FFB800]/10 bg-[#FFB800]/[0.03]">
        <p className="text-xs text-white/55 leading-relaxed">{d.risk_disclaimer}</p>
      </div>
    </div>
  );
}

// ===== 小组件 =====

function ProfileItem({ icon: Icon, label, value, behavior }: { icon: any; label: string; value: string; behavior?: boolean }) {
  return (
    <div className="rounded-md border border-white/[0.05] bg-white/[0.02] px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] text-white/35">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <div className="mt-0.5 text-sm font-medium text-white/75 truncate">
        {value}
        {behavior && <span className="ml-1 text-[10px] text-[#FAC858]">(校准)</span>}
      </div>
    </div>
  );
}

function AllocationQualitySummary({ quality }: { quality?: AllocationDataQuality | null }) {
  if (!quality) return null;
  const invalidAssets = Object.entries(quality.invalid_assets || {});
  const assumptions = quality.assumptions_used || [];
  const statusText: Record<string, string> = {
    real: '真实',
    partial: '部分降级',
    assumption: '假设',
    stale: '过期',
    missing: '缺失',
    rejected: '已拒绝',
  };
  const tone = quality.overall_status === 'real'
    ? 'border-[#16C784]/20 bg-[#16C784]/[0.05] text-[#16C784]'
    : 'border-[#FAC858]/20 bg-[#FAC858]/[0.05] text-[#FAC858]';

  return (
    <div className={`rounded-lg border px-4 py-3 text-xs ${tone}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium">数据质量: {statusText[quality.overall_status] || quality.overall_status}</span>
        <span>CMA: {statusText[quality.cma?.status] || quality.cma?.status}</span>
        {quality.cma?.coverage != null && <span>覆盖率: {(quality.cma.coverage * 100).toFixed(0)}%</span>}
        <span>基金映射: {statusText[quality.fund_mapping?.status] || quality.fund_mapping?.status}</span>
        <span>蒙特卡洛: {statusText[quality.monte_carlo?.status] || quality.monte_carlo?.status}</span>
      </div>
      {(invalidAssets.length > 0 || assumptions.length > 0) && (
        <div className="mt-2 text-white/45 leading-relaxed">
          {invalidAssets.length > 0 && (
            <div>无效资产: {invalidAssets.map(([asset, reason]) => `${asset}(${reason})`).join(', ')}</div>
          )}
          {assumptions.length > 0 && (
            <div>使用假设: {assumptions.join(', ')}</div>
          )}
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, tone }: { label: string; value: string; tone?: 'positive' | 'negative' | 'neutral' }) {
  const color = tone === 'positive' ? 'text-[#16C784]' : tone === 'negative' ? 'text-[#EE6666]' : 'text-white/80';
  return (
    <div className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
      <div className="text-[11px] text-white/40">{label}</div>
      <div className={`mt-1 text-base font-semibold data-number ${color}`}>{value}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/[0.05] bg-white/[0.02] px-2.5 py-2">
      <div className="text-[10px] text-white/35">{label}</div>
      <div className="mt-0.5 text-xs font-medium data-number text-white/70">{value}</div>
    </div>
  );
}

function SuggestionCard({ icon: Icon, title, desc, action }: { icon: any; title: string; desc: string; action?: { label: string; href: string } }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-[#5AA9FF]" />
        <h3 className="text-sm font-medium text-white/80">{title}</h3>
      </div>
      <p className="text-xs text-white/45 leading-relaxed">{desc}</p>
      {action && (
        <a
          href={action.href}
          className="mt-3 inline-flex items-center gap-1 rounded-md border border-[#3B6CFF]/30 bg-[#3B6CFF]/10 px-2.5 py-1 text-xs text-[#5AA9FF] hover:bg-[#3B6CFF]/20 transition-colors"
        >
          {action.label}
        </a>
      )}
    </div>
  );
}
