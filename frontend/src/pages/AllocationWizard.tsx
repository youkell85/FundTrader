import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, ArrowRight, Check, Shield, Target, TrendingUp, Users, Zap, Wallet } from 'lucide-react';
import { useAllocationStore } from '@/store/allocationStore';
import { generateAllocationStream } from '@/lib/api';
import AllocationProgress, { type StepState, STEP_LABELS } from '@/components/allocation/AllocationProgress';
import { RISK_LABELS, GOAL_LABELS, HORIZON_LABELS } from '@/types/allocation';
import type { GoalType, InvestmentHorizon, RiskTolerance } from '@/types/allocation';

const STEPS = ["投资目标","风险认知","风险偏好","资产偏好","确认生成"];

const RISK_OPTIONS: { value: RiskTolerance; icon: any; desc: string; dd: number; equity: string }[] = [
  { value: "conservative", icon: Shield, desc: "债券和现金为主，稳健保值", dd: 12, equity: "约10%" },
  { value: "moderate", icon: Users, desc: "固收打底+混合增强", dd: 18, equity: "约25%" },
  { value: "balanced", icon: Target, desc: "股债均衡，收益风险并重", dd: 24, equity: "约40%" },
  { value: "aggressive", icon: TrendingUp, desc: "高权益占比，追求弹性", dd: 35, equity: "约60%" },
  { value: "radical", icon: Zap, desc: "极高权益，需承受大幅波动", dd: 45, equity: "约75%" },
];

const BEHAVIOR_QUESTIONS = [
  { id: "q1_drawdown", text: "投资组合3个月跌15%，您会？", options: [
    { value: "add", label: "加仓买入", adj: +1 }, { value: "hold", label: "持有不动", adj: 0 },
    { value: "reduce", label: "减仓一半", adj: -1 }, { value: "sell", label: "全部赎回", adj: -2 },
  ]},
  { id: "q2_rally", text: "组合1年涨30%，您会？", options: [
    { value: "chase", label: "追涨加仓", adj: 0 }, { value: "hold", label: "维持不动", adj: +1 },
    { value: "partial", label: "止盈部分", adj: 0 }, { value: "all_out", label: "全部止盈", adj: -1 },
  ]},
  { id: "q3_volatility", text: "能接受的年度波动？", options: [
    { value: "high", label: "20%+，追求高收益", adj: +2 }, { value: "medium", label: "10-15%，兼顾", adj: 0 },
    { value: "low", label: "5-8%，稳健优先", adj: -1 }, { value: "none", label: "几乎不接受亏损", adj: -2 },
  ]},
];

const TAG_OPTIONS = [{ key: "gold", label: "黄金ETF" },{ key: "qdii", label: "QDII海外" },{ key: "hk_connect", label: "港股通" },{ key: "reits", label: "公募REITs" },{ key: "commodity", label: "商品期货" },{ key: "convertible", label: "可转债" }];

function StepBar({ current }: { current: number }) {
  return (
    <div className="hidden sm:flex items-center justify-center gap-2 mb-8">
      {STEPS.map((label, i) => {
        const n = i + 1, active = n === current, done = n < current;
        return (
          <React.Fragment key={label}>
            {i > 0 && <div className={`w-6 h-px ${done ? 'bg-[#3B6CFF]' : 'bg-white/10'}`} />}
            <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs border transition-all ${active ? 'bg-[#3B6CFF]/15 border-[#3B6CFF]/30 text-[#5AA9FF]' : done ? 'bg-[#00F0FF]/10 border-[#00F0FF]/20 text-[#00F0FF]' : 'bg-white/[0.03] border-white/[0.06] text-white/55'}`}>
              {done ? <Check className="w-3 h-3" /> : <span className="data-number w-4 text-center">{n}</span>}
              <span className="hidden sm:inline">{label}</span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default function AllocationWizard() {
  const { state, dispatch } = useAllocationStore();
  const navigate = useNavigate();
  const { wizardStep, config } = state;
  const next = () => dispatch({ type: "SET_STEP", step: Math.min(wizardStep + 1, 5) });
  const prev = () => dispatch({ type: "SET_STEP", step: Math.max(wizardStep - 1, 1) });
  const update = (patch: Partial<typeof config>) => dispatch({ type: "UPDATE_CONFIG", patch });

  // ─── 流式生成状态 ───
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [streamSteps, setStreamSteps] = useState<StepState[]>(() =>
    Object.keys(STEP_LABELS).map(name => ({ name, status: "running" as const, detail: "" }))
  );
  const [currentStep, setCurrentStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const startTime = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const streamCancelRef = useRef<{ cancel: () => void } | null>(null);

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const startTimer = useCallback(() => {
    startTime.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime.current) / 1000));
    }, 200);
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
      {
        age: config.age,
        goal_type: config.goal_type || "wealth",
        investment_horizon: config.investment_horizon || "medium",
        amount: config.amount || 500000,
        risk_tolerance: config.risk_tolerance,
        max_drawdown: config.max_drawdown || 24,
        preferred_tags: config.preferred_tags,
        behavior_answers: config.behavior_answers || {},
      },
      // onProgress
      (step, _total, name, status, detail) => {
        setCurrentStep(step);
        setStreamSteps(prev => prev.map(s =>
          s.name === name ? { ...s, status: status as StepState["status"], detail } : s
        ));
      },
      // onDone
      (result) => {
        stopTimer();
        setGenerating(false);
        dispatch({ type: "SET_OUTPUT", output: result });
        dispatch({ type: "SET_EXECUTION_PLAN", plan: null });
        dispatch({ type: "SET_DCA_CONFIG", config: null });
        dispatch({ type: "SET_DCA_RESULT", result: null });
        navigate("/allocation/result");
      },
      // onError
      (msg) => {
        stopTimer();
        setGenerating(false);
        setGenError(msg);
      },
      // onCancelled
      () => {
        stopTimer();
        setGenerating(false);
      },
    );
  };

  const handleCancelGenerate = () => {
    streamCancelRef.current?.cancel();
    stopTimer();
    setGenerating(false);
  };

  const behaviorAvg = config.behavior_answers ? (() => {
    let total = 0, cnt = 0;
    for (const q of BEHAVIOR_QUESTIONS) {
      const ans = config.behavior_answers?.[q.id];
      if (ans) { const opt = q.options.find(o => o.value === ans); if (opt) { total += opt.adj; cnt++; } }
    }
    return cnt > 0 ? total / cnt : 0;
  })() : null;

  const calibratedRisk: RiskTolerance = behaviorAvg !== null
    ? behaviorAvg < -0.5 ? (config.risk_tolerance === "conservative" ? "conservative" : config.risk_tolerance === "moderate" ? "conservative" : config.risk_tolerance === "balanced" ? "moderate" : config.risk_tolerance === "aggressive" ? "balanced" : "aggressive")
      : behaviorAvg > 1.5 ? (config.risk_tolerance === "conservative" ? "moderate" : config.risk_tolerance === "moderate" ? "balanced" : config.risk_tolerance === "balanced" ? "aggressive" : config.risk_tolerance === "aggressive" ? "radical" : "radical")
      : config.risk_tolerance
    : config.risk_tolerance;

  return (
    <div className="min-h-screen pt-14 pb-20">
      <div className="max-w-3xl mx-auto px-4 md:px-6">
        <div className="pt-7 pb-5">
          <h1 className="text-2xl md:text-3xl font-semibold text-white tracking-tight">专业资产配置</h1>
          <p className="mt-2 text-white/45 text-sm">智能配置引擎：战略配置、战术调整、压力测试与蒙特卡洛模拟</p>
        </div>
        <StepBar current={wizardStep} />
        <div className="sm:hidden text-center text-xs text-white/50 mb-2">
          第 {wizardStep} 步 / 共 5 步 · {STEPS[wizardStep - 1]}
        </div>
        <div className="surface-elevated p-6 md:p-8">

          {/* Step 1 */}
          {wizardStep === 1 && (
            <div className="space-y-6">
              <h2 className="text-lg text-white font-medium flex items-center gap-2"><Wallet className="w-5 h-5" style={{color:"#3B6CFF"}} />投资目标</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className="text-xs text-white/40 mb-1 block">年龄</label><input type="number" min={18} max={80} value={config.age} onChange={e => update({ age: Number(e.target.value) })} className="w-full h-11 px-3 rounded-lg input-focus text-white data-number" /></div>
                <div><label className="text-xs text-white/40 mb-1 block">投资金额 (元)</label><input type="number" min={1000} step={1000} value={config.amount} onChange={e => update({ amount: Number(e.target.value) })} className="w-full h-11 px-3 rounded-lg input-focus text-white data-number" /></div>
              </div>
              <div><label className="text-xs text-white/40 mb-2 block">投资目标</label><div className="grid grid-cols-2 md:grid-cols-4 gap-2">{(Object.entries(GOAL_LABELS) as [GoalType, string][]).map(([k, v]) => (<button key={k} onClick={() => update({ goal_type: k })} className={`h-12 rounded-lg border text-sm transition-all ${config.goal_type===k ? 'bg-[#3B6CFF]/15 border-[#3B6CFF]/35 text-[#5AA9FF]' : 'bg-white/[0.03] border-white/[0.07] text-white/50 hover:text-white/75'}`}>{v}</button>))}</div></div>
              <div><label className="text-xs text-white/40 mb-2 block">投资期限</label><div className="grid grid-cols-4 gap-2">{(Object.entries(HORIZON_LABELS) as [InvestmentHorizon, string][]).map(([k, v]) => (<button key={k} onClick={() => update({ investment_horizon: k })} className={`h-10 rounded-lg border text-xs transition-all ${config.investment_horizon===k ? 'bg-[#00F0FF]/12 border-[#00F0FF]/35 text-[#00F0FF]' : 'bg-white/[0.03] border-white/[0.07] text-white/45'}`}>{v}</button>))}</div></div>
            </div>
          )}

          {/* Step 2 */}
          {wizardStep === 2 && (
            <div className="space-y-6">
              <h2 className="text-lg text-white font-medium flex items-center gap-2"><Users className="w-5 h-5" style={{color:"#FAC858"}} />风险认知测试</h2>
              <p className="text-sm text-white/45">以下问题帮助校准有效风险偏好（自报≠实际行为）</p>
              {BEHAVIOR_QUESTIONS.map(q => (
                <div key={q.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
                  <p className="text-sm text-white/75 mb-3">{q.text}</p>
                  <div className="space-y-2">{q.options.map(opt => { const selected = config.behavior_answers?.[q.id] === opt.value; return (<button key={opt.value} onClick={() => update({ behavior_answers: { ...config.behavior_answers, [q.id]: opt.value } })} className={`w-full text-left px-3 py-2 rounded-lg border text-xs transition-all ${selected ? 'bg-[#3B6CFF]/12 border-[#3B6CFF]/30 text-[#5AA9FF]' : 'bg-white/[0.02] border-white/[0.05] text-white/50 hover:text-white/70'}`}>{opt.label}</button>); })}</div>
                </div>
              ))}
              {behaviorAvg !== null && (<div className={`rounded-lg p-3 border text-sm ${behaviorAvg < -0.5 ? 'bg-[#FFB800]/[0.06] border-[#FFB800]/20 text-[#FFB800]' : behaviorAvg > 1.5 ? 'bg-[#00F0FF]/[0.06] border-[#00F0FF]/20 text-[#00F0FF]' : 'bg-white/[0.03] border-white/[0.06] text-white/55'}`}>{behaviorAvg < -0.5 ? '行为倾向保守，有效风险偏好可能低于自报' : behaviorAvg > 1.5 ? '行为倾向积极，有效风险偏好可能高于自报' : '行为与自报基本一致'}</div>)}
            </div>
          )}

          {/* Step 3 */}
          {wizardStep === 3 && (
            <div className="space-y-6">
              <h2 className="text-lg text-white font-medium flex items-center gap-2"><Shield className="w-5 h-5" style={{color:"#EE6666"}} />风险偏好</h2>
              <div className="space-y-3">{RISK_OPTIONS.map(rp => { const Icon = rp.icon; const active = config.risk_tolerance === rp.value; const calibrated = calibratedRisk === rp.value && calibratedRisk !== config.risk_tolerance; return (<button key={rp.value} onClick={() => update({ risk_tolerance: rp.value, max_drawdown: rp.dd })} className={`w-full rounded-lg border p-4 text-left transition-all ${active ? 'bg-[#3B6CFF]/18 border-[#3B6CFF]/35' : 'bg-white/[0.03] border-white/[0.07] hover:bg-white/[0.05]'}`}><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-3"><Icon className="w-5 h-5" style={{color: active ? "#5AA9FF" : "rgba(255,255,255,0.5)"}} /><div><div className="text-sm text-white">{RISK_LABELS[rp.value]}{calibrated && <span className="ml-2 text-[10px] text-[#FAC858]">行为校准建议</span>}</div><div className="text-[11px] text-white/40 mt-0.5">{rp.desc}</div></div></div><div className="text-right text-[11px] text-white/55 data-number">回撤{rp.dd}% · 权益{rp.equity}</div></div></button>); })}</div>
              <div><div className="flex justify-between text-xs mb-2"><span className="text-white/55">最大回撤约束</span><span className="data-number text-[#EE6666]">{config.max_drawdown}%</span></div><input type="range" min={5} max={45} step={1} value={config.max_drawdown || 24} onChange={e => update({ max_drawdown: Number(e.target.value) })} className="w-full accent-[#3B6CFF]" /></div>
            </div>
          )}

          {/* Step 4 */}
          {wizardStep === 4 && (
            <div className="space-y-6">
              <h2 className="text-lg text-white font-medium flex items-center gap-2"><Target className="w-5 h-5" style={{color:"#16C784"}} />资产偏好</h2>
              <p className="text-sm text-white/45">勾选希望纳入组合的资产</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">{TAG_OPTIONS.map(tag => { const active = config.preferred_tags.includes(tag.key); return (<button key={tag.key} onClick={() => update({ preferred_tags: active ? config.preferred_tags.filter(t => t !== tag.key) : [...config.preferred_tags, tag.key] })} className={`h-14 rounded-lg border transition-all flex items-center justify-center gap-2 ${active ? 'bg-[#3B6CFF]/12 border-[#3B6CFF]/30 text-[#5AA9FF]' : 'bg-white/[0.03] border-white/[0.07] text-white/45 hover:text-white/70'}`}>{active && <Check className="w-4 h-4" />}{tag.label}</button>); })}</div>
            </div>
          )}

          {/* Step 5 */}
          {wizardStep === 5 && (
            <div className="space-y-6">
              <h2 className="text-lg text-white font-medium flex items-center gap-2"><Check className="w-5 h-5" style={{color:"#16C784"}} />确认配置</h2>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] p-5 space-y-3">{[["年龄", `${config.age}岁`],["投资目标", GOAL_LABELS[config.goal_type||"wealth"]],["投资金额", `${(config.amount||0).toLocaleString()}元`],["投资期限", HORIZON_LABELS[config.investment_horizon||"medium"]],["风险偏好", `${RISK_LABELS[config.risk_tolerance]}${behaviorAvg !== null && calibratedRisk !== config.risk_tolerance ? ' → 建议'+RISK_LABELS[calibratedRisk] : ''}`],["最大回撤", `${config.max_drawdown}%`],["资产偏好", config.preferred_tags.length > 0 ? config.preferred_tags.map(t => TAG_OPTIONS.find(o=>o.key===t)?.label).join("、") : "无特殊偏好"]].map(([l,v]) => (<div key={l} className="flex justify-between text-sm"><span className="text-white/45">{l}</span><span className="text-white/80">{v}</span></div>))}</div>

              {generating ? (
                <AllocationProgress
                  steps={streamSteps}
                  currentStep={currentStep}
                  totalSteps={14}
                  elapsed={elapsed}
                  onCancel={handleCancelGenerate}
                />
              ) : (
                <button onClick={handleGenerate} className="w-full h-12 rounded-lg bg-gradient-to-r from-[#3B6CFF] to-[#2A52CC] text-white font-medium text-sm flex items-center justify-center gap-2 hover:from-[#4B7CFF] hover:to-[#3A62DC] transition-all">
                  <Zap className="w-4 h-4" /> 生成配置方案
                </button>
              )}

              {genError && <p className="text-xs text-[#EE6666] mt-2">生成失败: {genError}</p>}
            </div>
          )}

          <div className="flex justify-between mt-8 pt-6 border-t border-white/[0.06]">
            <button onClick={prev} disabled={wizardStep===1} className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-white/[0.08] text-white/50 text-sm disabled:opacity-30 disabled:cursor-not-allowed hover:text-white/75"><ArrowLeft className="w-4 h-4" />上一步</button>
            {wizardStep < 5 && <button onClick={next} className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-[#3B6CFF]/15 border border-[#3B6CFF]/30 text-[#5AA9FF] text-sm hover:bg-[#3B6CFF]/25">下一步<ArrowRight className="w-4 h-4" /></button>}
          </div>
        </div>
      </div>
    </div>
  );
}
