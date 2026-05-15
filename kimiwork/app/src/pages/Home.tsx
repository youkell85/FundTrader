import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Search, TrendingUp, TrendingDown, Star, PieChart, Activity, Shield } from "lucide-react";
import { Link } from "react-router";

export default function Home() {
  const [search, setSearch] = useState("");
  const [fundType, setFundType] = useState("");
  const [category, setCategory] = useState("");
  const [riskLevel, setRiskLevel] = useState("");
  const [isMarketingOnly, setIsMarketingOnly] = useState(false);
  const [sortBy, setSortBy] = useState("dailyChange");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  const { data: overview } = trpc.fund.marketOverview.useQuery();
  const { data: filterOpts } = trpc.fund.filterOptions.useQuery();
  const { data: fundList, isLoading } = trpc.fund.list.useQuery({
    search: search || undefined,
    fundType: fundType || undefined,
    category: category || undefined,
    riskLevel: riskLevel || undefined,
    isContinuousMarketing: isMarketingOnly ? 1 : undefined,
    sortBy,
    sortOrder,
    page,
    pageSize: 15,
  });

  const [hoveredRow, setHoveredRow] = useState<number | null>(null);

  const typeLabels: Record<string, string> = {
    equity: "股票型", hybrid: "混合型", bond: "债券型",
    index: "指数型", qdii: "QDII", money: "货币型", fof: "FOF", reits: "REITs",
  };
  const riskLabels: Record<string, string> = {
    low: "低风险", low_medium: "中低风险", medium: "中风险",
    medium_high: "中高风险", high: "高风险",
  };


  return (
    <div className="min-h-screen pt-14 pb-12">
      {/* Hero Section */}
      <section className="relative px-6 pt-16 pb-12 max-w-7xl mx-auto">
        <div className="mb-2">
          <h1 className="text-4xl md:text-5xl font-semibold text-white tracking-tight leading-tight" style={{ letterSpacing: "-1.2px" }}>
            洞察趋势，甄选长跑冠军
          </h1>
          <p className="mt-3 text-white/40 text-base max-w-2xl">
            基于国元证券公募基金持续营销名单，AI驱动的产品筛选与智能配置平台
          </p>
        </div>

        {/* Market Overview Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-8">
          {[
            { label: "在售基金", value: overview?.totalFunds || 0, suffix: "只", icon: PieChart, color: "#3B6CFF" },
            { label: "持续营销", value: overview?.marketingCount || 0, suffix: "只", icon: Activity, color: "#00F0FF" },
            { label: "平均年化收益", value: overview?.avgReturn || "0", suffix: "%", icon: TrendingUp, color: "#A3FF12" },
            { label: "平均夏普比率", value: overview?.avgSharpe || "0", suffix: "", icon: Shield, color: "#FFB800" },
          ].map((card) => (
            <div key={card.label} className="liquid-glass-sm p-4 group hover:bg-white/[0.06] transition-all">
              <div className="flex items-center gap-2 mb-2">
                <card.icon className="w-4 h-4" style={{ color: card.color }} />
                <span className="text-white/40 text-xs">{card.label}</span>
              </div>
              <div className="data-number text-2xl font-medium text-white">
                {card.value}
                <span className="text-sm text-white/40 ml-0.5">{card.suffix}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Search & Filter */}
        <div className="mt-8 flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="输入基金代码 / 名称 / 基金经理..."
              className="w-full h-11 pl-10 pr-4 rounded-xl bg-white/[0.03] border border-white/[0.06] text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-[#3B6CFF]/50 focus:bg-white/[0.05] transition-all"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <select
              value={fundType}
              onChange={(e) => { setFundType(e.target.value); setPage(1); }}
              className="h-11 px-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-white/70 text-sm focus:outline-none focus:border-[#3B6CFF]/50"
            >
              <option value="">全部类型</option>
              {Object.entries(typeLabels).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <select
              value={riskLevel}
              onChange={(e) => { setRiskLevel(e.target.value); setPage(1); }}
              className="h-11 px-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-white/70 text-sm focus:outline-none focus:border-[#3B6CFF]/50"
            >
              <option value="">全部风险</option>
              {Object.entries(riskLabels).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <select
              value={category}
              onChange={(e) => { setCategory(e.target.value); setPage(1); }}
              className="h-11 px-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-white/70 text-sm focus:outline-none focus:border-[#3B6CFF]/50"
            >
              <option value="">全部分类</option>
              {filterOpts?.categories?.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <button
              onClick={() => { setIsMarketingOnly(!isMarketingOnly); setPage(1); }}
              className={`h-11 px-4 rounded-xl text-sm font-medium transition-all ${
                isMarketingOnly
                  ? "bg-[#3B6CFF]/20 text-[#00F0FF] border border-[#3B6CFF]/30"
                  : "bg-white/[0.03] text-white/50 border border-white/[0.06] hover:bg-white/[0.06]"
              }`}
            >
              持续营销
            </button>
          </div>
        </div>

        {/* Sort */}
        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <span className="text-white/30 text-xs">排序:</span>
          {[
            { key: "dailyChange", label: "日涨跌" },
            { key: "return1y", label: "近1年收益" },
            { key: "sharpeRatio", label: "夏普比率" },
            { key: "maxDrawdown", label: "最大回撤" },
            { key: "nav", label: "净值" },
          ].map((s) => (
            <button
              key={s.key}
              onClick={() => {
                if (sortBy === s.key) setSortOrder(sortOrder === "desc" ? "asc" : "desc");
                else { setSortBy(s.key); setSortOrder("desc"); }
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                sortBy === s.key
                  ? "bg-[#3B6CFF]/15 text-[#00F0FF]"
                  : "text-white/40 hover:text-white/70 hover:bg-white/[0.03]"
              }`}
            >
              {s.label} {sortBy === s.key && (sortOrder === "desc" ? "↓" : "↑")}
            </button>
          ))}
        </div>
      </section>

      {/* Fund List */}
      <section className="px-6 max-w-7xl mx-auto">
        <div className="liquid-glass overflow-hidden">
          {/* Table Header */}
          <div className="grid grid-cols-12 gap-2 px-5 py-3 text-xs text-white/30 font-medium border-b border-white/[0.06] items-center" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.04) 0%, transparent 100%)" }}>
            <div className="col-span-3">基金名称</div>
            <div className="col-span-1 text-right">净值</div>
            <div className="col-span-1 text-right">日涨跌</div>
            <div className="col-span-1 text-right">近1年</div>
            <div className="col-span-1 text-right">夏普比</div>
            <div className="col-span-1 text-right">最大回撤</div>
            <div className="col-span-1 text-center">评级</div>
            <div className="col-span-1 text-center">类型</div>
            <div className="col-span-2 text-center">AI标签</div>
          </div>

          {/* Table Body */}
          {isLoading ? (
            <div className="p-8 text-center text-white/30">加载中...</div>
          ) : fundList?.funds.length === 0 ? (
            <div className="p-8 text-center text-white/30">暂无数据</div>
          ) : (
            fundList?.funds.map((fund: any) => {
              const perf = fund.performance;
              const dailyChange = parseFloat(fund.dailyChange || "0");
              const return1y = parseFloat(perf?.return1y || "0");
              const maxDD = parseFloat(perf?.maxDrawdown || "0");
              const sharpe = parseFloat(perf?.sharpeRatio || "0");

              return (
                <Link
                  key={fund.id}
                  to={`/fund/${fund.id}`}
                  className="grid grid-cols-12 gap-2 px-5 py-3 text-sm border-b border-white/[0.03] items-center hover:bg-white/[0.04] transition-all group cursor-pointer relative"
                  onMouseEnter={() => setHoveredRow(fund.id)}
                  onMouseLeave={() => setHoveredRow(null)}
                >
                  <div
                    className={`absolute top-0 left-0 w-full h-full pointer-events-none transition-all duration-600 ${
                      hoveredRow === fund.id ? "scan-line-active" : ""
                    }`}
                    style={{
                      background: hoveredRow === fund.id
                        ? "linear-gradient(90deg, transparent, rgba(255,255,255,0.03), transparent)"
                        : "transparent",
                      transform: hoveredRow === fund.id ? "translateX(0)" : "translateX(-100%)",
                      transition: "transform 0.6s ease, background 0.3s",
                    }}
                  />
                  <div className="col-span-3">
                    <div className="text-white font-medium text-sm">{fund.fundAbbr || fund.fundName}</div>
                    <div className="text-white/25 text-xs mt-0.5 flex items-center gap-1.5">
                      <span className="data-number">{fund.fundCode}</span>
                      <span>{fund.manager?.name}</span>
                      <span>{fund.company}</span>
                    </div>
                  </div>
                  <div className="col-span-1 text-right data-number text-white/80">{fund.nav}</div>
                  <div className={`col-span-1 text-right data-number font-medium ${dailyChange >= 0 ? "text-[#00F0FF]" : "text-[#FF3366]"}`}>
                    <span className="inline-flex items-center gap-0.5">
                      {dailyChange >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {dailyChange >= 0 ? "+" : ""}{fund.dailyChange}%
                    </span>
                  </div>
                  <div className={`col-span-1 text-right data-number ${return1y >= 0 ? "text-[#00F0FF]" : "text-[#FF3366]"}`}>
                    {return1y >= 0 ? "+" : ""}{perf?.return1y}%
                  </div>
                  <div className="col-span-1 text-right data-number text-[#A3FF12]">{sharpe.toFixed(2)}</div>
                  <div className="col-span-1 text-right data-number text-[#FF3366]">{maxDD.toFixed(2)}%</div>
                  <div className="col-span-1 flex justify-center">
                    <div className="flex gap-0.5">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star key={i} className={`w-3 h-3 ${i < (fund.stars || 0) ? "text-[#FFB800] fill-[#FFB800]" : "text-white/10"}`} />
                      ))}
                    </div>
                  </div>
                  <div className="col-span-1 text-center">
                    <span className="px-2 py-0.5 rounded text-xs bg-white/[0.05] text-white/50">
                      {typeLabels[fund.fundType] || fund.fundType}
                    </span>
                  </div>
                  <div className="col-span-2 flex justify-center gap-1 flex-wrap">
                    {(fund.tags || []).slice(0, 2).map((tag: string) => (
                      <span key={tag} className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#3B6CFF]/10 text-[#00F0FF] border border-[#3B6CFF]/20">
                        {tag}
                      </span>
                    ))}
                  </div>
                </Link>
              );
            })
          )}
        </div>

        {/* Pagination */}
        {fundList && fundList.total > fundList.pageSize && (
          <div className="flex justify-center items-center gap-2 mt-6">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 rounded-lg text-sm text-white/50 hover:text-white disabled:opacity-30 transition-all"
            >
              上一页
            </button>
            <span className="text-white/40 text-sm data-number">
              {page} / {Math.ceil(fundList.total / fundList.pageSize)}
            </span>
            <button
              onClick={() => setPage(page + 1)}
              disabled={page >= Math.ceil(fundList.total / fundList.pageSize)}
              className="px-3 py-1.5 rounded-lg text-sm text-white/50 hover:text-white disabled:opacity-30 transition-all"
            >
              下一页
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
