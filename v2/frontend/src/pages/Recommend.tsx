import { useState } from "react";
import { Link } from "react-router";
import { Shield, TrendingUp, Target, Users, Zap, ArrowRight, Loader2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import {
  UP_COLOR,
  ACCENT_PRIMARY,
  ACCENT_INFO,
  ACCENT_HIGHLIGHT,
  POSITIVE_METRIC_COLOR,
  RISK_COLOR,
} from "@/lib/colors";

function LoadingScreen() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-white/30">
      <Loader2 className="w-8 h-8 animate-spin mb-3" />
      <span className="text-sm">加载推荐方案中...</span>
    </div>
  );
}

const riskProfiles = [
  { value: "", label: "全部", icon: Target },
  { value: "conservative", label: "保守型", icon: Shield },
  { value: "moderate", label: "稳健型", icon: Users },
  { value: "balanced", label: "均衡型", icon: TrendingUp },
  { value: "aggressive", label: "进取型", icon: Zap },
];

export default function Recommend() {
  const [riskProfile, setRiskProfile] = useState("");
  const { data: recommendationsData, isLoading } = trpc.fund.recommendations.useQuery({ riskProfile: riskProfile || undefined });
  const recommendations = recommendationsData ?? [];
  const [expandedId, setExpandedId] = useState<number | null>(null);

  return (
    <div className="min-h-screen pt-14 pb-12">
      <div className="max-w-7xl mx-auto px-4 md:px-6">
        <div className="pt-8 md:pt-12 pb-6 md:pb-8">
          <h1 className="text-2xl md:text-4xl font-semibold text-white tracking-tight" style={{ letterSpacing: "-1.2px" }}>智能配置推荐</h1>
          <p className="mt-2 text-white/40 text-sm md:text-base">结合市场行情、行业趋势与客户风险偏好，AI驱动的基金配置方案</p>
        </div>

        <div className="flex gap-2 mb-6 md:mb-8 flex-wrap">
          {riskProfiles.map((rp) => {
            const Icon = rp.icon;
            return (
              <button key={rp.value} onClick={() => setRiskProfile(rp.value)}
                className={`flex items-center gap-1.5 md:gap-2 px-3 md:px-5 py-2 md:py-2.5 rounded-xl text-xs md:text-sm font-medium transition-all ${
                  riskProfile === rp.value
                    ? "bg-gradient-to-r from-[#3B6CFF] to-[#2A52CC] text-white shadow-lg shadow-[#3B6CFF]/20"
                    : "bg-white/[0.03] text-white/50 hover:bg-white/[0.06] hover:text-white/70 border border-white/[0.06]"
                }`}>
                <Icon className="w-4 h-4" />{rp.label}
              </button>
            );
          })}
        </div>

        {isLoading ? <LoadingScreen /> : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
          {recommendations.map((rec: any) => {
            const isExpanded = expandedId === rec.id;
            const allocations = rec.fundAllocations || rec.fundDetails || [];
            const totalWeight = allocations.reduce((sum: number, fd: any) => sum + (fd.weight || 0), 0) || 100;
            return (
              <div key={rec.id} className="liquid-glass overflow-hidden">
                <div className="p-4 md:p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h2 className="text-xl font-medium text-white">{rec.name}</h2>
                      <p className="text-white/30 text-sm mt-1">{rec.description}</p>
                    </div>
                    <div className="flex gap-1">
                      {rec.tags?.slice(0, 3).map((tag: string) => (
                        <span key={tag} className="px-2 py-0.5 rounded text-[10px] font-medium border" style={{ background: `${ACCENT_PRIMARY}1A`, color: ACCENT_INFO, borderColor: `${ACCENT_PRIMARY}33` }}>{tag}</span>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="liquid-glass-sm p-3 text-center">
                      <div className="text-white/30 text-xs">预期年化</div>
                      <div className="data-number text-lg font-medium" style={{ color: UP_COLOR }}>+{rec.expectedReturn}%</div>
                    </div>
                    <div className="liquid-glass-sm p-3 text-center">
                      <div className="text-white/30 text-xs">预期风险</div>
                      <div className="data-number text-lg font-medium" style={{ color: RISK_COLOR }}>{rec.expectedRisk}%</div>
                    </div>
                    <div className="liquid-glass-sm p-3 text-center">
                      <div className="text-white/30 text-xs">适用市场</div>
                      <div className="text-white/70 text-sm">{rec.marketCondition}</div>
                    </div>
                  </div>

                  <div className="mb-4">
                    <div className="flex items-center gap-1 h-3 rounded-full overflow-hidden bg-white/[0.03]">
                      {allocations.map((fd: any, i: number) => {
                        const colors = [ACCENT_PRIMARY, ACCENT_INFO, POSITIVE_METRIC_COLOR, ACCENT_HIGHLIGHT, "#9D7BFF"];
                        return <div key={i} className="h-full transition-all" style={{ width: `${(fd.weight / totalWeight) * 100}%`, backgroundColor: colors[i % colors.length] }} />;
                      })}
                    </div>
                    <div className="flex flex-wrap gap-3 mt-2">
                      {allocations.map((fd: any, i: number) => {
                        const colors = [ACCENT_PRIMARY, ACCENT_INFO, POSITIVE_METRIC_COLOR, ACCENT_HIGHLIGHT, "#9D7BFF"];
                        return (
                          <div key={i} className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: colors[i % colors.length] }} />
                            <span className="text-white/50 text-xs">{fd.fund?.fundAbbr}</span>
                            <span className="data-number text-white/70 text-xs">{fd.weight}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <button onClick={() => setExpandedId(isExpanded ? null : rec.id)}
                    className="flex items-center gap-1 text-sm transition-colors"
                    style={{ color: ACCENT_INFO }}>
                    {isExpanded ? "收起详情" : "查看详情"}
                    <ArrowRight className={`w-3.5 h-3.5 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                  </button>

                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-white/[0.06]">
                      <div className="mb-4">
                        <h3 className="text-sm mb-2 flex items-center gap-1" style={{ color: ACCENT_INFO }}><Zap className="w-3.5 h-3.5" />AI 配置逻辑</h3>
                        <p className="text-white/60 text-sm leading-relaxed">{rec.rationale}</p>
                      </div>
                      <div className="space-y-3">
                        <h3 className="text-sm text-white/50">基金配置明细</h3>
                        {allocations.map((fd: any, i: number) => (
                          <Link key={i} to={`/${fd.fundId}`}
                            className="flex items-center gap-3 liquid-glass-sm p-3 hover:bg-white/[0.06] transition-all group">
                            <div className="data-number text-white/30 text-xs w-5">{i + 1}</div>
                            <div className="flex-1">
                              <div className="text-white text-sm group-hover:text-[#5AA9FF] transition-colors">{fd.fund?.fundAbbr || fd.fund?.fundName}</div>
                              <div className="text-white/30 text-xs data-number">{fd.fund?.fundCode}</div>
                            </div>
                            <div className="text-right">
                              <div className="data-number text-white/70 text-sm">{fd.weight}%</div>
                              <div className="text-white/30 text-[10px]">{fd.reason}</div>
                            </div>
                            <ArrowRight className="w-4 h-4 text-white/20 group-hover:text-[#5AA9FF] transition-colors" />
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        )}
      </div>
    </div>
  );
}
