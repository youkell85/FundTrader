import { useState } from "react";
import { Link } from "react-router";
import { Shield, TrendingUp, Target, Users, Zap, ArrowRight, Loader2, SlidersHorizontal, Check } from "lucide-react";
import { trpc } from "@/providers/trpc";
import {
  UP_COLOR,
  ACCENT_PRIMARY,
  ACCENT_INFO,
  ACCENT_HIGHLIGHT,
  POSITIVE_METRIC_COLOR,
  RISK_COLOR,
} from "@/lib/colors";

const riskProfiles = [
  { value: "conservative", label: "保守型", icon: Shield, maxDrawdown: 12 },
  { value: "moderate", label: "稳健型", icon: Users, maxDrawdown: 18 },
  { value: "balanced", label: "均衡型", icon: Target, maxDrawdown: 24 },
  { value: "aggressive", label: "进取型", icon: TrendingUp, maxDrawdown: 35 },
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

function LoadingScreen() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-white/35">
      <Loader2 className="w-8 h-8 animate-spin mb-3" />
      <span className="text-sm">正在按参数生成配置...</span>
    </div>
  );
}

export default function Recommend() {
  const [riskProfile, setRiskProfile] = useState("balanced");
  const [horizon, setHorizon] = useState("1年");
  const [maxDrawdown, setMaxDrawdown] = useState(24);
  const [amount, setAmount] = useState(100000);
  const [preferredTypes, setPreferredTypes] = useState<string[]>(["bond", "hybrid", "index", "equity"]);
  const [expandedId, setExpandedId] = useState<number | null>(1);

  const { data: recommendationsData, isLoading } = trpc.fund.recommendations.useQuery({
    riskProfile,
    horizon,
    preferredTypes,
    maxDrawdown,
    amount,
  });
  const recommendations = recommendationsData ?? [];

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
    <div className="min-h-screen pt-14 pb-12">
      <div className="max-w-7xl mx-auto px-4 md:px-6">
        <div className="pt-8 md:pt-12 pb-5 md:pb-7">
          <h1 className="text-2xl md:text-4xl font-semibold text-white tracking-tight">配置组合</h1>
          <p className="mt-2 text-white/45 text-sm md:text-base">按风险承受、投资周期、基金类型和回撤约束，从鑫基荟池内生成可调整组合。</p>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-4 md:gap-6">
          <aside className="liquid-glass p-4 md:p-5 h-fit">
            <div className="flex items-center gap-2 text-white font-medium mb-4">
              <SlidersHorizontal className="w-5 h-5" style={{ color: ACCENT_INFO }} />
              配置参数
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
                        className={`h-11 rounded-lg border text-sm flex items-center justify-center gap-2 transition-all ${
                          active ? "bg-[#3B6CFF]/18 border-[#3B6CFF]/35 text-white" : "bg-white/[0.03] border-white/[0.07] text-white/50 hover:text-white/75"
                        }`}
                      >
                        <Icon className="w-4 h-4" />{rp.label}
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
                  onChange={(e) => setMaxDrawdown(Number(e.target.value))}
                  className="w-full accent-[#3B6CFF]"
                />
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
                  onChange={(e) => setAmount(Number(e.target.value) || 0)}
                  className="w-full h-10 px-3 rounded-lg bg-[#0B1021] border border-white/[0.08] text-white text-sm data-number focus:outline-none focus:border-[#3B6CFF]/50"
                />
              </section>
            </div>
          </aside>

          <main>
            {isLoading ? <LoadingScreen /> : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                {recommendations.map((rec: any) => {
                  const isExpanded = expandedId === rec.id;
                  const allocations = rec.fundAllocations || rec.fundDetails || [];
                  const totalWeight = allocations.reduce((sum: number, fd: any) => sum + (fd.weight || 0), 0) || 100;
                  return (
                    <div key={rec.id} className="liquid-glass overflow-hidden lg:col-span-2">
                      <div className="p-4 md:p-6">
                        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-5">
                          <div>
                            <h2 className="text-xl md:text-2xl font-medium text-white">{rec.name}</h2>
                            <p className="text-white/40 text-sm mt-1">{rec.description}</p>
                          </div>
                          <div className="flex gap-1 flex-wrap">
                            {rec.tags?.slice(0, 4).map((tag: string) => (
                              <span key={tag} className="px-2 py-0.5 rounded text-[10px] font-medium border" style={{ background: `${ACCENT_PRIMARY}1A`, color: ACCENT_INFO, borderColor: `${ACCENT_PRIMARY}33` }}>{tag}</span>
                            ))}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 mb-5">
                          <div className="liquid-glass-sm p-3 text-center">
                            <div className="text-white/30 text-xs">预估年化</div>
                            <div className="data-number text-lg font-medium" style={{ color: UP_COLOR }}>+{rec.expectedReturn}%</div>
                          </div>
                          <div className="liquid-glass-sm p-3 text-center">
                            <div className="text-white/30 text-xs">预估回撤</div>
                            <div className="data-number text-lg font-medium" style={{ color: RISK_COLOR }}>{rec.expectedRisk}%</div>
                          </div>
                          <div className="liquid-glass-sm p-3 text-center">
                            <div className="text-white/30 text-xs">适用周期</div>
                            <div className="text-white/75 text-sm">{rec.marketCondition}</div>
                          </div>
                          <div className="liquid-glass-sm p-3 text-center">
                            <div className="text-white/30 text-xs">配置金额</div>
                            <div className="data-number text-lg font-medium" style={{ color: POSITIVE_METRIC_COLOR }}>{amount.toLocaleString()}</div>
                          </div>
                        </div>

                        <div className="mb-5">
                          <div className="flex items-center gap-1 h-3 rounded-full overflow-hidden bg-white/[0.03]">
                            {allocations.map((fd: any, i: number) => {
                              const colors = [ACCENT_PRIMARY, ACCENT_INFO, POSITIVE_METRIC_COLOR, ACCENT_HIGHLIGHT, "#9D7BFF"];
                              return <div key={i} className="h-full transition-all" style={{ width: `${(fd.weight / totalWeight) * 100}%`, backgroundColor: colors[i % colors.length] }} />;
                            })}
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
                            {allocations.map((fd: any, i: number) => {
                              const colors = [ACCENT_PRIMARY, ACCENT_INFO, POSITIVE_METRIC_COLOR, ACCENT_HIGHLIGHT, "#9D7BFF"];
                              const fund = fd.fund || {};
                              return (
                                <Link key={`${fund.fundCode || i}`} to={`/${fund.fundCode || fd.fundId}`}
                                  className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] p-3 hover:bg-white/[0.06] transition-all group">
                                  <div className="w-2.5 h-9 rounded-full" style={{ backgroundColor: colors[i % colors.length] }} />
                                  <div className="min-w-0 flex-1">
                                    <div className="text-white text-sm truncate group-hover:text-[#5AA9FF] transition-colors">{fund.fundAbbr || fund.fundName}</div>
                                    <div className="text-white/32 text-xs data-number">{fund.fundCode} · {fund.category}</div>
                                    <div className="flex items-center gap-2 text-[11px] mt-1">
                                      <span className="data-number" style={{ color: RISK_COLOR }}>回撤 {fund.performance?.maxDrawdown ?? "—"}%</span>
                                      <span className="data-number" style={{ color: POSITIVE_METRIC_COLOR }}>夏普 {fund.performance?.sharpeRatio ?? "—"}</span>
                                    </div>
                                    <div className="text-white/42 text-[11px] leading-relaxed mt-1">{fd.reason}</div>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <div className="data-number text-white text-sm">{fd.weight}%</div>
                                    <div className="data-number text-white/35 text-xs">{Math.round(amount * fd.weight / 100).toLocaleString()}</div>
                                  </div>
                                  <ArrowRight className="w-4 h-4 text-white/20 group-hover:text-[#5AA9FF] transition-colors" />
                                </Link>
                              );
                            })}
                          </div>
                        </div>

                        <button onClick={() => setExpandedId(isExpanded ? null : rec.id)}
                          className="flex items-center gap-1 text-sm transition-colors"
                          style={{ color: ACCENT_INFO }}>
                          {isExpanded ? "收起逻辑" : "查看配置逻辑"}
                          <ArrowRight className={`w-3.5 h-3.5 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                        </button>

                        {isExpanded && (
                          <div className="mt-4 pt-4 border-t border-white/[0.06]">
                            <h3 className="text-sm mb-2 flex items-center gap-1" style={{ color: ACCENT_INFO }}><Zap className="w-3.5 h-3.5" />配置逻辑</h3>
                            <p className="text-white/65 text-sm leading-relaxed">{rec.rationale}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
