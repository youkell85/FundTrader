import { TrendingUp, PieChart, Shield } from "lucide-react";
import { UP_COLOR, DOWN_COLOR, ACCENT_PRIMARY, POSITIVE_METRIC_COLOR } from "@/lib/colors";

interface StatCardsProps {
  currentOverview: { total: number; avgReturn: string; avgSharpe: string };
  categoryStats: any[];
  category: string;
  onCategoryClick: (label: string) => void;
}

function getChangeTextClass(val: number) {
  if (val > 0) return "text-[#F5384B]";
  if (val < 0) return "text-[#16C784]";
  return "text-white/50";
}

export default function StatCards({ currentOverview, categoryStats, category, onCategoryClick }: StatCardsProps) {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-3 mt-6 md:mt-8">
        {[
          { label: "当前列表", value: currentOverview.total, suffix: "只", icon: PieChart, color: ACCENT_PRIMARY },
          { label: "平均年化收益", value: currentOverview.avgReturn, suffix: currentOverview.avgReturn === "—" ? "" : "%", icon: TrendingUp, color: parseFloat(currentOverview.avgReturn) >= 0 ? UP_COLOR : DOWN_COLOR },
          { label: "平均夏普比率", value: currentOverview.avgSharpe, suffix: "", icon: Shield, color: POSITIVE_METRIC_COLOR },
        ].map((card) => (
          <div key={card.label} className="surface p-3 md:p-4 group hover:bg-[#45B084]/[0.055] transition-all">
            <div className="flex items-center gap-2 mb-1.5 md:mb-2">
              <card.icon className="w-4 h-4" style={{ color: card.color }} />
              <span className="text-white/40 text-[11px] md:text-xs">{card.label}</span>
            </div>
            <div className="data-number text-xl md:text-2xl font-medium text-white">
              {card.value}
              <span className="text-xs md:text-sm text-white/40 ml-0.5">{card.suffix}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
        {categoryStats.map((item) => (
          <button
            key={item.label}
            onClick={() => onCategoryClick(item.key ?? item.label)}
            className={`rounded-lg border px-3 py-3 text-left transition-colors ${
              category === (item.key ?? item.label)
                ? "border-[#45B084]/40 bg-[#45B084]/12 ring-1 ring-[#45B084]/20 scale-[1.01] transition-all"
                : "border-white/[0.075] bg-white/[0.03] hover:bg-white/[0.055]"
            }`}
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-white/80 text-sm font-medium">{item.label}</span>
              <span className="data-number text-white/55 text-xs">{item.count}只</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              <div>
                <div className="text-white/50">平均年化</div>
                <div className={`data-number font-medium ${getChangeTextClass(parseFloat(item.avgReturn || "0"))}`}>{item.avgReturn === "—" ? "—" : `${item.avgReturn}%`}</div>
              </div>
              <div>
                <div className="text-white/50">最大回撤</div>
                <div className="data-number font-medium" style={{ color: "#F5384B" }}>{item.avgMaxDrawdown === "—" ? "—" : `${item.avgMaxDrawdown}%`}</div>
              </div>
              <div>
                <div className="text-white/50">夏普</div>
                <div className="data-number font-medium" style={{ color: POSITIVE_METRIC_COLOR }}>{item.avgSharpe}</div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}
