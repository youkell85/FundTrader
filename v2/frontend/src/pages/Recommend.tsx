import { useState, useMemo } from "react";
import { Link } from "react-router";
import { Shield, TrendingUp, Target, Users, Zap, ArrowRight } from "lucide-react";
import { getRecommendations } from "@/hooks/useFundData";

const riskProfiles = [
  { value: "", label: "全部", icon: Target },
  { value: "conservative", label: "保守型", icon: Shield },
  { value: "moderate", label: "稳健型", icon: Users },
  { value: "balanced", label: "均衡型", icon: TrendingUp },
  { value: "aggressive", label: "进取型", icon: Zap },
];

export default function Recommend() {
  const [riskProfile, setRiskProfile] = useState("");
  const recommendations = useMemo(() => getRecommendations(riskProfile || undefined), [riskProfile]);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  return (
    <div className="min-h-screen pt-14 pb-12">
      <div className="max-w-7xl mx-auto px-6">
        <div className="pt-12 pb-8">
          <h1 className="text-4xl font-semibold text-white tracking-tight" style={{ letterSpacing: "-1.2px" }}>智能配置推荐</h1>
          <p className="mt-2 text-white/40 text-base">结合市场行情、行业趋势与客户风险偏好，AI驱动的基金配置方案</p>
        </div>

        <div className="flex gap-2 mb-8 flex-wrap">
          {riskProfiles.map((rp) => {
            const Icon = rp.icon;
            return (
              <button key={rp.value} onClick={() => setRiskProfile(rp.value)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  riskProfile === rp.value
                    ? "bg-gradient-to-r from-[#3B6CFF] to-[#2A52CC] text-white shadow-lg shadow-[#3B6CFF]/20"
                    : "bg-white/[0.03] text-white/50 hover:bg-white/[0.06] hover:text-white/70 border border-white/[0.06]"
                }`}>
                <Icon className="w-4 h-4" />{rp.label}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {recommendations.map((rec: any) => {
            const isExpanded = expandedId === rec.id;
            const totalWeight = rec.fundDetails?.reduce((sum: number, fd: any) => sum + (fd.weight || 0), 0) || 100;
            return (
              <div key={rec.id} className="liquid-glass overflow-hidden">
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h2 className="text-xl font-medium text-white">{rec.name}</h2>
                      <p className="text-white/30 text-sm mt-1">{rec.description}</p>
                    </div>
                    <div className="flex gap-1">
                      {rec.tags?.slice(0, 3).map((tag: string) => (
                        <span key={tag} className="px-2 py-0.5 rounded text-[10px] font-medium bg-[#3B6CFF]/10 text-[#00F0FF] border border-[#3B6CFF]/20">{tag}</span>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="liquid-glass-sm p-3 text-center">
                      <div className="text-white/25 text-xs">预期年化</div>
                      <div className="data-number text-lg font-medium text-[#A3FF12]">+{rec.expectedReturn}%</div>
                    </div>
                    <div className="liquid-glass-sm p-3 text-center">
                      <div className="text-white/25 text-xs">预期风险</div>
                      <div className="data-number text-lg font-medium text-[#FFB800]">{rec.expectedRisk}%</div>
                    </div>
                    <div className="liquid-glass-sm p-3 text-center">
                      <div className="text-white/25 text-xs">适用市场</div>
                      <div className="text-white/60 text-sm">{rec.marketCondition}</div>
                    </div>
                  </div>

                  <div className="mb-4">
                    <div className="flex items-center gap-1 h-3 rounded-full overflow-hidden bg-white/[0.03]">
                      {rec.fundDetails?.map((fd: any, i: number) => {
                        const colors = ["#3B6CFF", "#00F0FF", "#A3FF12", "#FFB800", "#FF3366"];
                        return <div key={i} className="h-full transition-all" style={{ width: `${(fd.weight / totalWeight) * 100}%`, backgroundColor: colors[i % colors.length] }} />;
                      })}
                    </div>
                    <div className="flex flex-wrap gap-3 mt-2">
                      {rec.fundDetails?.map((fd: any, i: number) => {
                        const colors = ["#3B6CFF", "#00F0FF", "#A3FF12", "#FFB800", "#FF3366"];
                        return (
                          <div key={i} className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: colors[i % colors.length] }} />
                            <span className="text-white/40 text-xs">{fd.fund?.fundAbbr}</span>
                            <span className="data-number text-white/60 text-xs">{fd.weight}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <button onClick={() => setExpandedId(isExpanded ? null : rec.id)}
                    className="flex items-center gap-1 text-[#00F0FF] text-sm hover:text-[#4A9CFF] transition-colors">
                    {isExpanded ? "收起详情" : "查看详情"}
                    <ArrowRight className={`w-3.5 h-3.5 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                  </button>

                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-white/[0.06]">
                      <div className="mb-4">
                        <h3 className="text-sm text-[#00F0FF] mb-2 flex items-center gap-1"><Zap className="w-3.5 h-3.5" />AI 配置逻辑</h3>
                        <p className="text-white/50 text-sm leading-relaxed">{rec.rationale}</p>
                      </div>
                      <div className="space-y-3">
                        <h3 className="text-sm text-white/40">基金配置明细</h3>
                        {rec.fundDetails?.map((fd: any, i: number) => (
                          <Link key={i} to={`/fund/${fd.fundId}`}
                            className="flex items-center gap-3 liquid-glass-sm p-3 hover:bg-white/[0.06] transition-all group">
                            <div className="data-number text-white/20 text-xs w-5">{i + 1}</div>
                            <div className="flex-1">
                              <div className="text-white text-sm group-hover:text-[#00F0FF] transition-colors">{fd.fund?.fundAbbr || fd.fund?.fundName}</div>
                              <div className="text-white/25 text-xs data-number">{fd.fund?.fundCode}</div>
                            </div>
                            <div className="text-right">
                              <div className="data-number text-white/60 text-sm">{fd.weight}%</div>
                              <div className="text-white/25 text-[10px]">{fd.reason}</div>
                            </div>
                            <ArrowRight className="w-4 h-4 text-white/10 group-hover:text-[#00F0FF] transition-colors" />
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
      </div>
    </div>
  );
}
