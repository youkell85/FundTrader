import { useState } from "react";
import { Link } from "react-router";
import {
  Activity,
  ArrowRight,
  Check,
  Gauge,
  Layers3,
  Loader2,
  PieChart,
  Shield,
  SlidersHorizontal,
  Target,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import {
  ACCENT_HIGHLIGHT,
  ACCENT_INFO,
  ACCENT_PRIMARY,
  POSITIVE_METRIC_COLOR,
  RISK_COLOR,
  UP_COLOR,
  getChangeTextClass,
} from "@/lib/colors";

const riskProfiles = [
  { value: "conservative", label: "保守型", desc: "先守住回撤", icon: Shield, maxDrawdown: 12 },
  { value: "moderate", label: "稳健型", desc: "稳中求进", icon: Users, maxDrawdown: 18 },
  { value: "balanced", label: "均衡型", desc: "收益风险平衡", icon: Target, maxDrawdown: 24 },
  { value: "aggressive", label: "进取型", desc: "提高权益弹性", icon: TrendingUp, maxDrawdown: 35 },
];

const horizons = ["3个月", "6个月", "1年", "3年"];

const fundTypes = [
  { value: "bond", label: "债券" },
  { value: "hybrid", label: "混合" },
  { value: "index", label: "指数" },
  { value: "equity", label: "股票" },
  { value: "qdii", label: "QDII" },
  { value: "money", label: "货币" },
];

const optimizationGoals = [
  { value: "balanced", label: "平衡", desc: "兼顾收益、回撤和波动" },
  { value: "risk", label: "控波动", desc: "优先压低回撤与CVaR" },
  { value: "return", label: "收益弹性", desc: "提高长期进攻性" },
];

const focusThemes = [
  { value: "all", label: "全市场" },
  { value: "income", label: "固收收益" },
  { value: "defensive", label: "防守低波" },
  { value: "growth", label: "科技成长" },
  { value: "diversified", label: "宽基/QDII" },
];

const barColors = [ACCENT_PRIMARY, ACCENT_INFO, POSITIVE_METRIC_COLOR, ACCENT_HIGHLIGHT, "#9D7BFF", "#16C784"];

function LoadingScreen() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-white/35">
      <Loader2 className="w-8 h-8 animate-spin mb-3" />
      <span className="text-sm">正在按参数生成配置...</span>
    </div>
  );
}

function metricValue(value: unknown) {
  const num = parseFloat(String(value ?? "0").replace("%", ""));
  return Number.isFinite(num) ? num : 0;
}

function yuan(value: number) {
  return Math.round(value).toLocaleString("zh-CN");
}

function PanelTitle({ icon: Icon, title }: { icon: any; title: string }) {
  return (
    <div className="flex items-center gap-2 text-white font-medium">
      <Icon className="w-4 h-4" style={{ color: ACCENT_INFO }} />
      {title}
    </div>
  );
}

function MetricTile({ label, value, color, suffix = "" }: { label: string; value: string | number; color?: string; suffix?: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-3">
      <div className="text-white/35 text-xs">{label}</div>
      <div className="data-number mt-1 text-lg font-medium" style={{ color }}>{value}{suffix}</div>
    </div>
  );
}

export default function Recommend() {
  const [riskProfile, setRiskProfile] = useState("balanced");
  const [horizon, setHorizon] = useState("1年");
  const [maxDrawdown, setMaxDrawdown] = useState(24);
  const [amount, setAmount] = useState(100000);
  const [preferredTypes, setPreferredTypes] = useState<string[]>(["bond", "hybrid", "index", "equity"]);
  const [optimizationGoal, setOptimizationGoal] = useState("balanced");
  const [focusTheme, setFocusTheme] = useState("all");
  const [activePlanId, setActivePlanId] = useState<number | null>(null);
  const [expandedFundCode, setExpandedFundCode] = useState<string | null>(null);

  const { data: recommendationsData, isLoading } = trpc.fund.recommendations.useQuery({
    riskProfile,
    horizon,
    preferredTypes,
    maxDrawdown,
    amount,
    optimizationGoal,
    focusTheme,
  });
  const recommendations = recommendationsData ?? [];
  const activePlan = recommendations.find((item: any) => item.id === activePlanId) ?? recommendations[0];
  const allocations = (activePlan as any)?.fundAllocations || [];
  const totalWeight = allocations.reduce((sum: number, item: any) => sum + (item.weight || 0), 0) || 100;

  const updateRiskProfile = (value: string) => {
    const profile = riskProfiles.find((item) => item.value === value);
    setRiskProfile(value);
    if (profile) setMaxDrawdown(profile.maxDrawdown);
  };

  const toggleType = (value: string) => {
    setPreferredTypes((prev) => (
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]
    ));
  };

  return (
    <div className="min-h-screen pt-14 pb-20 md:pb-12">
      <div className="max-w-7xl mx-auto px-4 md:px-6">
        <div className="pt-7 md:pt-10 pb-5 md:pb-6">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
            <div>
              <h1 className="text-2xl md:text-4xl font-semibold text-white tracking-tight">配置组合</h1>
              <p className="mt-2 max-w-3xl text-white/48 text-sm md:text-base leading-relaxed">
                用风险档位、周期、回撤上限和投资偏好生成三套可比较方案，并展示大类权重、约束结果、压力测试和产品入选理由。
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-xs text-white/45">
              <Activity className="w-4 h-4" style={{ color: ACCENT_INFO }} />
              参数变化会实时重新排序组合
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-4 md:gap-6 items-start">
          <aside className="liquid-glass p-4 md:p-5 xl:sticky xl:top-20">
            <div className="flex items-center justify-between gap-3 mb-4">
              <PanelTitle icon={SlidersHorizontal} title="配置参数" />
              <span className="text-[11px] text-white/35 data-number">{preferredTypes.length}类已选</span>
            </div>

            <div className="space-y-5">
              <section>
                <div className="text-xs text-white/35 mb-2">风险承受能力</div>
                <div className="grid grid-cols-2 gap-2">
                  {riskProfiles.map((rp) => {
                    const Icon = rp.icon;
                    const active = riskProfile === rp.value;
                    return (
                      <button
                        key={rp.value}
                        onClick={() => updateRiskProfile(rp.value)}
                        className={`min-h-14 rounded-lg border px-3 text-left transition-all ${
                          active ? "bg-[#3B6CFF]/18 border-[#3B6CFF]/35 text-white" : "bg-white/[0.03] border-white/[0.07] text-white/55 hover:text-white/80"
                        }`}
                      >
                        <div className="flex items-center gap-2 text-sm">
                          <Icon className="w-4 h-4" />{rp.label}
                        </div>
                        <div className="mt-1 text-[11px] text-white/35">{rp.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section>
                <div className="text-xs text-white/35 mb-2">投资周期</div>
                <div className="grid grid-cols-4 gap-2">
                  {horizons.map((item) => (
                    <button
                      key={item}
                      onClick={() => setHorizon(item)}
                      className={`h-9 rounded-lg text-xs border transition-all ${
                        horizon === item ? "bg-[#00F0FF]/12 border-[#00F0FF]/35 text-[#00F0FF]" : "bg-white/[0.03] border-white/[0.07] text-white/45 hover:text-white/70"
                      }`}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <div className="flex justify-between text-xs mb-2">
                  <span className="text-white/35">最大回撤约束</span>
                  <span className="data-number" style={{ color: RISK_COLOR }}>{maxDrawdown}%</span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={45}
                  step={1}
                  value={maxDrawdown}
                  onChange={(event) => setMaxDrawdown(Number(event.target.value))}
                  className="w-full accent-[#3B6CFF]"
                />
                <div className="mt-1 flex justify-between text-[10px] text-white/25">
                  <span>严格</span>
                  <span>宽松</span>
                </div>
              </section>

              <section>
                <div className="text-xs text-white/35 mb-2">优化目标</div>
                <div className="grid grid-cols-3 gap-2">
                  {optimizationGoals.map((item) => (
                    <button
                      key={item.value}
                      title={item.desc}
                      onClick={() => setOptimizationGoal(item.value)}
                      className={`h-10 rounded-lg text-xs border transition-all ${
                        optimizationGoal === item.value ? "bg-[#3B6CFF]/15 border-[#3B6CFF]/35 text-[#5AA9FF]" : "bg-white/[0.03] border-white/[0.07] text-white/45 hover:text-white/70"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <div className="text-xs text-white/35 mb-2">投资方向</div>
                <div className="flex flex-wrap gap-2">
                  {focusThemes.map((item) => (
                    <button
                      key={item.value}
                      onClick={() => setFocusTheme(item.value)}
                      className={`h-8 px-3 rounded-lg text-xs border transition-all ${
                        focusTheme === item.value ? "bg-[#00F0FF]/12 border-[#00F0FF]/30 text-[#00F0FF]" : "bg-white/[0.03] border-white/[0.06] text-white/42 hover:text-white/70"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <div className="text-xs text-white/35 mb-2">基金大类</div>
                <div className="flex flex-wrap gap-2">
                  {fundTypes.map((item) => {
                    const active = preferredTypes.includes(item.value);
                    return (
                      <button
                        key={item.value}
                        onClick={() => toggleType(item.value)}
                        className={`h-8 px-3 rounded-lg text-xs border flex items-center gap-1.5 transition-all ${
                          active ? "bg-white/[0.08] border-white/[0.16] text-white" : "bg-white/[0.02] border-white/[0.06] text-white/35"
                        }`}
                      >
                        {active && <Check className="w-3 h-3" />}{item.label}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section>
                <label className="text-xs text-white/35 mb-2 block">计划配置金额</label>
                <input
                  type="number"
                  min={1000}
                  step={1000}
                  value={amount}
                  onChange={(event) => setAmount(Number(event.target.value) || 0)}
                  className="w-full h-10 px-3 rounded-lg bg-[#0B1021] border border-white/[0.08] text-white text-sm data-number focus:outline-none focus:border-[#3B6CFF]/50"
                />
              </section>
            </div>
          </aside>

          <main className="min-w-0">
            {isLoading ? <LoadingScreen /> : !activePlan ? (
              <div className="liquid-glass p-8 text-center text-white/45">当前参数下暂无可配置产品，请放宽回撤约束或增加基金大类。</div>
            ) : (
              <div className="space-y-4 md:space-y-6">
                <section className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                  {recommendations.map((rec: any) => {
                    const active = activePlan.id === rec.id;
                    return (
                      <button
                        key={rec.id}
                        onClick={() => setActivePlanId(rec.id)}
                        className={`rounded-lg border p-4 text-left transition-all ${
                          active ? "bg-[#3B6CFF]/14 border-[#3B6CFF]/35" : "bg-white/[0.025] border-white/[0.06] hover:bg-white/[0.05]"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-white font-medium">{rec.name}</div>
                            <div className="mt-1 text-xs text-white/38 leading-relaxed">{rec.description}</div>
                          </div>
                          <div className="data-number text-sm" style={{ color: active ? ACCENT_INFO : "rgba(255,255,255,0.38)" }}>{rec.score}</div>
                        </div>
                        <div className="mt-4 grid grid-cols-3 gap-2">
                          <div>
                            <div className="text-[10px] text-white/30">年化</div>
                            <div className={`data-number text-sm ${getChangeTextClass(rec.expectedReturn)}`}>{Number(rec.expectedReturn) >= 0 ? "+" : ""}{rec.expectedReturn}%</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-white/30">回撤</div>
                            <div className="data-number text-sm" style={{ color: RISK_COLOR }}>{rec.expectedRisk}%</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-white/30">夏普</div>
                            <div className="data-number text-sm" style={{ color: POSITIVE_METRIC_COLOR }}>{rec.sharpe}</div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </section>

                <section className="liquid-glass p-4 md:p-6">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-5">
                    <div>
                      <div className="flex items-center gap-2 text-white/45 text-xs mb-2">
                        <PieChart className="w-4 h-4" style={{ color: ACCENT_INFO }} />
                        当前方案
                      </div>
                      <h2 className="text-xl md:text-2xl text-white font-medium">{activePlan.name}</h2>
                      <p className="mt-1 text-sm text-white/45 leading-relaxed">{activePlan.rationale}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {activePlan.tags?.map((tag: string) => (
                        <span key={tag} className="px-2 py-0.5 rounded text-[10px] font-medium border" style={{ background: `${ACCENT_PRIMARY}1A`, color: ACCENT_INFO, borderColor: `${ACCENT_PRIMARY}33` }}>{tag}</span>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 md:gap-3 mb-5">
                    <MetricTile label="预估年化" value={`${Number(activePlan.expectedReturn) >= 0 ? "+" : ""}${activePlan.expectedReturn}`} suffix="%" color={UP_COLOR} />
                    <MetricTile label="组合回撤" value={activePlan.expectedRisk} suffix="%" color={RISK_COLOR} />
                    <MetricTile label="估算波动" value={activePlan.volatility} suffix="%" color={ACCENT_INFO} />
                    <MetricTile label="夏普" value={activePlan.sharpe} color={POSITIVE_METRIC_COLOR} />
                    <MetricTile label="CVaR95" value={activePlan.cvar95} suffix="%" color={ACCENT_HIGHLIGHT} />
                  </div>

                  <div className="mb-5">
                    <div className="flex items-center gap-1 h-3 rounded-full overflow-hidden bg-white/[0.04]">
                      {allocations.map((fd: any, index: number) => (
                        <div
                          key={`${fd.fund?.fundCode || fd.fundId}-${index}`}
                          className="h-full transition-all"
                          style={{ width: `${(fd.weight / totalWeight) * 100}%`, backgroundColor: barColors[index % barColors.length] }}
                        />
                      ))}
                    </div>
                    <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2">
                      {allocations.map((fd: any, index: number) => {
                        const fund = fd.fund || {};
                        return (
                          <div key={`${fund.fundCode || fd.fundId}-legend`} className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.025] border border-white/[0.05] px-3 py-2">
                            <div className="min-w-0 flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: barColors[index % barColors.length] }} />
                              <span className="text-xs text-white/58 truncate">{fd.role}</span>
                            </div>
                            <span className="data-number text-xs text-white/75">{fd.weight}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div>
                      <PanelTitle icon={Gauge} title="约束检查" />
                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {activePlan.constraints?.map((item: any) => (
                          <div key={item.label} className="rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 text-sm text-white/65">
                              <span className={`w-2 h-2 rounded-full ${item.passed ? "bg-[#16C784]" : "bg-[#FFB800]"}`} />
                              {item.label}
                            </div>
                            <span className="data-number text-xs text-white/45">{item.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <PanelTitle icon={Zap} title="压力情景" />
                      <div className="mt-3 space-y-2">
                        {activePlan.stressTests?.map((item: any) => (
                          <div key={item.label} className="rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-sm text-white/65">{item.label}</span>
                              <span className="data-number text-sm" style={{ color: RISK_COLOR }}>{item.loss}%</span>
                            </div>
                            <div className="mt-1 text-[11px] text-white/35 leading-relaxed">{item.note}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>

                <section className="liquid-glass p-4 md:p-6">
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <PanelTitle icon={Layers3} title="产品明细" />
                    <span className="text-xs text-white/35">配置金额 {yuan(amount)}</span>
                  </div>

                  <div className="space-y-2">
                    {allocations.map((fd: any, index: number) => {
                      const fund = fd.fund || {};
                      const code = String(fund.fundCode || fd.fundId || index);
                      const expanded = expandedFundCode === code;
                      const perf = fund.performance || {};
                      return (
                        <div key={code} className="rounded-lg border border-white/[0.06] bg-white/[0.025] overflow-hidden">
                          <button
                            onClick={() => setExpandedFundCode(expanded ? null : code)}
                            className="w-full grid grid-cols-[1fr_auto] md:grid-cols-[1fr_72px_92px_92px_96px] gap-3 items-center p-3 text-left hover:bg-white/[0.035] transition-colors"
                          >
                            <div className="min-w-0 flex items-center gap-3">
                              <div className="w-2.5 h-10 rounded-full shrink-0" style={{ backgroundColor: barColors[index % barColors.length] }} />
                              <div className="min-w-0">
                                <div className="text-white text-sm truncate">{fund.fundAbbr || fund.fundName}</div>
                                <div className="text-white/35 text-xs data-number truncate">{fund.fundCode} · {fund.category} · {fd.role}</div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="data-number text-white text-sm">{fd.weight}%</div>
                              <div className="data-number text-white/35 text-xs">{yuan(amount * fd.weight / 100)}</div>
                            </div>
                            <div className={`hidden md:block data-number text-sm ${getChangeTextClass(perf?.return1y)}`}>
                              {metricValue(perf?.return1y) >= 0 ? "+" : ""}{metricValue(perf?.return1y).toFixed(2)}%
                            </div>
                            <div className="hidden md:block data-number text-sm" style={{ color: RISK_COLOR }}>
                              {metricValue(perf?.maxDrawdown).toFixed(2)}%
                            </div>
                            <div className="hidden md:flex items-center justify-end gap-2">
                              <span className="data-number text-sm" style={{ color: POSITIVE_METRIC_COLOR }}>{metricValue(perf?.sharpeRatio).toFixed(2)}</span>
                              <ArrowRight className={`w-4 h-4 text-white/25 transition-transform ${expanded ? "rotate-90" : ""}`} />
                            </div>
                          </button>
                          {expanded && (
                            <div className="border-t border-white/[0.05] px-3 py-3">
                              <div className="grid grid-cols-3 gap-2 md:hidden mb-3">
                                <MetricTile label="近1年" value={`${metricValue(perf?.return1y) >= 0 ? "+" : ""}${metricValue(perf?.return1y).toFixed(2)}`} suffix="%" color={UP_COLOR} />
                                <MetricTile label="回撤" value={metricValue(perf?.maxDrawdown).toFixed(2)} suffix="%" color={RISK_COLOR} />
                                <MetricTile label="夏普" value={metricValue(perf?.sharpeRatio).toFixed(2)} color={POSITIVE_METRIC_COLOR} />
                              </div>
                              <p className="text-white/55 text-sm leading-relaxed">{fd.reason}</p>
                              <Link to={`/${fund.fundCode || fd.fundId}`} className="mt-3 inline-flex items-center gap-1 text-sm" style={{ color: ACCENT_INFO }}>
                                查看基金详情 <ArrowRight className="w-3.5 h-3.5" />
                              </Link>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
