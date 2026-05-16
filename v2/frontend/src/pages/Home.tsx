import { useState, useMemo, useRef, useCallback } from "react";
import { Link } from "react-router";
import { Search, TrendingUp, TrendingDown, Star, PieChart, Activity, Shield, Camera, X, Loader2 } from "lucide-react";
import {
  getEnrichedFunds,
  getFilterOptions,
  getMarketOverview,
  getContinuousMarketing,
} from "@/hooks/useFundData";

const typeLabels: Record<string, string> = {
  equity: "股票型", hybrid: "混合型", bond: "债券型",
  index: "指数型", qdii: "QDII", money: "货币型", fof: "FOF", reits: "REITs",
};
const riskLabels: Record<string, string> = {
  low: "低风险", low_medium: "中低风险", medium: "中风险",
  medium_high: "中高风险", high: "高风险",
};

interface ImageSearchResult {
  summary: string;
  recognizedCount: number;
  matchedCount: number;
  funds: any[];
}

export default function Home() {
  const allFunds = useMemo(() => getEnrichedFunds(), []);
  const filterOpts = useMemo(() => getFilterOptions(), []);
  const overview = useMemo(() => getMarketOverview(), []);

  const [search, setSearch] = useState("");
  const [fundType, setFundType] = useState("");
  const [category, setCategory] = useState("");
  const [riskLevel, setRiskLevel] = useState("");
  const [isMarketingOnly, setIsMarketingOnly] = useState(false);
  const [sortBy, setSortBy] = useState("dailyChange");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const pageSize = 15;
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);

  // Image search states
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [imageResult, setImageResult] = useState<ImageSearchResult | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredFunds = useMemo(() => {
    let result = [...allFunds];
    if (fundType) result = result.filter((f: any) => f.fundType === fundType);
    if (category) result = result.filter((f: any) => f.category?.includes(category));
    if (riskLevel) result = result.filter((f: any) => f.riskLevel === riskLevel);
    if (isMarketingOnly) result = result.filter((f: any) => f.isContinuousMarketing === 1);
    if (search) {
      const s = search.toLowerCase();
      result = result.filter((f: any) =>
        f.fundCode?.includes(s) || f.fundName?.toLowerCase().includes(s) || f.fundAbbr?.toLowerCase().includes(s) || f.manager?.name?.includes(s)
      );
    }
    const sortKey = sortBy;
    const sortDir = sortOrder;
    result.sort((a: any, b: any) => {
      const aPerf = a.performance || {};
      const bPerf = b.performance || {};
      const aVal = sortKey.startsWith("return") || sortKey === "annualizedReturn" || sortKey === "sharpeRatio" || sortKey === "maxDrawdown"
        ? parseFloat(aPerf[sortKey] || "0")
        : parseFloat(a[sortKey] || "0");
      const bVal = sortKey.startsWith("return") || sortKey === "annualizedReturn" || sortKey === "sharpeRatio" || sortKey === "maxDrawdown"
        ? parseFloat(bPerf[sortKey] || "0")
        : parseFloat(b[sortKey] || "0");
      return sortDir === "desc" ? bVal - aVal : aVal - bVal;
    });
    return result;
  }, [allFunds, fundType, category, riskLevel, isMarketingOnly, search, sortBy, sortOrder]);

  const paginatedFunds = useMemo(() => {
    return filteredFunds.slice((page - 1) * pageSize, page * pageSize);
  }, [filteredFunds, page]);

  const totalPages = Math.ceil(filteredFunds.length / pageSize);

  // Compress image before upload to reduce base64 size
  const compressImage = useCallback((file: File, maxWidth = 1200, quality = 0.7): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onload = (e) => {
        img.src = e.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement("canvas");
          let { width, height } = img;
          if (width > maxWidth) {
            height = (height * maxWidth) / width;
            width = maxWidth;
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx?.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.onerror = reject;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }, []);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      setImageError("请选择图片文件");
      return;
    }
    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setImageError("图片大小不能超过10MB");
      return;
    }

    setImageError(null);
    setImageResult(null);
    setIsRecognizing(true);

    try {
      const compressed = await compressImage(file);
      setImagePreview(compressed);

      const res = await fetch("/fund/api/image-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_base64: compressed }),
      });
      const data = await res.json();

      if (!data.success) {
        setImageError(data.error || "识别失败");
      } else {
        setImageResult({
          summary: data.summary || "",
          recognizedCount: data.recognized_count || 0,
          matchedCount: data.matched_count || 0,
          funds: data.funds || [],
        });
      }
    } catch (err: any) {
      setImageError(err.message || "上传识别失败，请重试");
    } finally {
      setIsRecognizing(false);
    }
  }, [compressImage]);

  const clearImageSearch = useCallback(() => {
    setImagePreview(null);
    setImageResult(null);
    setImageError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  return (
    <div className="min-h-screen pt-14 pb-12">
      <section className="relative px-6 pt-16 pb-12 max-w-7xl mx-auto">
        <div className="mb-2">
          <h1 className="text-4xl md:text-5xl font-semibold text-white tracking-tight leading-tight" style={{ letterSpacing: "-1.2px" }}>
            洞察趋势，甄选长跑冠军
          </h1>
          <p className="mt-3 text-white/40 text-base max-w-2xl">
            基于国元证券公募基金持续营销名单，AI驱动的产品筛选与智能配置平台
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-8">
          {[
            { label: "在售基金", value: overview.totalFunds, suffix: "只", icon: PieChart, color: "#3B6CFF" },
            { label: "持续营销", value: overview.marketingCount, suffix: "只", icon: Activity, color: "#00F0FF" },
            { label: "平均年化收益", value: overview.avgReturn, suffix: "%", icon: TrendingUp, color: "#A3FF12" },
            { label: "平均夏普比率", value: overview.avgSharpe, suffix: "", icon: Shield, color: "#FFB800" },
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
          <button
            onClick={() => fileInputRef.current?.click()}
            className="h-11 px-4 rounded-xl bg-white/[0.03] border border-white/[0.06] text-white/60 text-sm hover:bg-white/[0.06] hover:text-white transition-all flex items-center gap-2 shrink-0"
            title="拍照识别基金"
          >
            <Camera className="w-4 h-4" />
            <span className="hidden md:inline">拍照识别</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileSelect}
          />
          <div className="flex gap-2 flex-wrap">
            <select value={fundType} onChange={(e) => { setFundType(e.target.value); setPage(1); }}
              className="h-11 px-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-white/70 text-sm focus:outline-none focus:border-[#3B6CFF]/50">
              <option value="">全部类型</option>
              {Object.entries(typeLabels).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
            </select>
            <select value={riskLevel} onChange={(e) => { setRiskLevel(e.target.value); setPage(1); }}
              className="h-11 px-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-white/70 text-sm focus:outline-none focus:border-[#3B6CFF]/50">
              <option value="">全部风险</option>
              {Object.entries(riskLabels).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
            </select>
            <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}
              className="h-11 px-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-white/70 text-sm focus:outline-none focus:border-[#3B6CFF]/50">
              <option value="">全部分类</option>
              {filterOpts.categories?.map((c) => (<option key={c} value={c}>{c}</option>))}
            </select>
            <button onClick={() => { setIsMarketingOnly(!isMarketingOnly); setPage(1); }}
              className={`h-11 px-4 rounded-xl text-sm font-medium transition-all ${isMarketingOnly ? "bg-[#3B6CFF]/20 text-[#00F0FF] border border-[#3B6CFF]/30" : "bg-white/[0.03] text-white/50 border border-white/[0.06] hover:bg-white/[0.06]"}`}>
              持续营销
            </button>
          </div>
        </div>

        {/* Image search result panel */}
        {(imagePreview || isRecognizing || imageResult || imageError) && (
          <div className="mt-4 liquid-glass-sm p-4 relative">
            <button
              onClick={clearImageSearch}
              className="absolute top-3 right-3 text-white/30 hover:text-white/60 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-start gap-4">
              {imagePreview && (
                <div className="shrink-0">
                  <img src={imagePreview} alt="识别图片" className="w-24 h-24 object-cover rounded-lg border border-white/[0.06]" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <Camera className="w-4 h-4 text-[#00F0FF]" />
                  <span className="text-white/80 text-sm font-medium">AI 图片识别</span>
                  {isRecognizing && (
                    <span className="flex items-center gap-1 text-white/40 text-xs">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      识别中...
                    </span>
                  )}
                </div>
                {imageError && (
                  <p className="text-[#FF3366] text-sm">{imageError}</p>
                )}
                {imageResult && (
                  <div>
                    <p className="text-white/50 text-xs mb-2">{imageResult.summary}</p>
                    <p className="text-white/40 text-xs mb-3">
                      识别到 {imageResult.recognizedCount} 只基金，匹配到 {imageResult.matchedCount} 只
                    </p>
                    {imageResult.funds.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {imageResult.funds.map((fund: any) => (
                          <Link
                            key={fund.id || fund.code}
                            to={`/fund/${fund.id}`}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] hover:border-[#3B6CFF]/30 transition-all"
                          >
                            <div>
                              <div className="text-white text-sm font-medium">{fund.fundAbbr || fund.fundName}</div>
                              <div className="text-white/30 text-xs">{fund.fundCode}</div>
                            </div>
                            <TrendingUp className="w-3 h-3 text-[#A3FF12]" />
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <p className="text-white/30 text-sm">未在基金库中匹配到相关产品</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <span className="text-white/30 text-xs">排序:</span>
          {[
            { key: "dailyChange", label: "日涨跌" },
            { key: "return1y", label: "近1年收益" },
            { key: "sharpeRatio", label: "夏普比率" },
            { key: "maxDrawdown", label: "最大回撤" },
            { key: "nav", label: "净值" },
          ].map((s) => (
            <button key={s.key} onClick={() => { if (sortBy === s.key) setSortOrder(sortOrder === "desc" ? "asc" : "desc"); else { setSortBy(s.key); setSortOrder("desc"); } }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${sortBy === s.key ? "bg-[#3B6CFF]/15 text-[#00F0FF]" : "text-white/40 hover:text-white/70 hover:bg-white/[0.03]"}`}>
              {s.label} {sortBy === s.key && (sortOrder === "desc" ? "↓" : "↑")}
            </button>
          ))}
        </div>
      </section>

      <section className="px-6 max-w-7xl mx-auto">
        <div className="liquid-glass overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-5 py-3 text-xs text-white/30 font-medium border-b border-white/[0.06] items-center"
            style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.04) 0%, transparent 100%)" }}>
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

          {paginatedFunds.length === 0 ? (
            <div className="p-8 text-center text-white/30">暂无数据</div>
          ) : (
            paginatedFunds.map((fund: any) => {
              const perf = fund.performance;
              const dailyChange = parseFloat(fund.dailyChange || "0");
              const return1y = parseFloat(perf?.return1y || "0");
              const maxDD = parseFloat(perf?.maxDrawdown || "0");
              const sharpe = parseFloat(perf?.sharpeRatio || "0");
              return (
                <Link key={fund.id} to={`/fund/${fund.id}`}
                  className="grid grid-cols-12 gap-2 px-5 py-3 text-sm border-b border-white/[0.03] items-center hover:bg-white/[0.04] transition-all group cursor-pointer relative"
                  onMouseEnter={() => setHoveredRow(fund.id)} onMouseLeave={() => setHoveredRow(null)}>
                  <div className={`absolute top-0 left-0 w-full h-full pointer-events-none transition-all duration-500 ${hoveredRow === fund.id ? "opacity-100" : "opacity-0"}`}
                    style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.03), transparent)" }} />
                  <div className="col-span-3 relative z-10">
                    <div className="text-white font-medium text-sm">{fund.fundAbbr || fund.fundName}</div>
                    <div className="text-white/25 text-xs mt-0.5 flex items-center gap-1.5">
                      <span className="data-number">{fund.fundCode}</span>
                      <span>{fund.manager?.name}</span>
                      <span>{fund.company}</span>
                    </div>
                  </div>
                  <div className="col-span-1 text-right data-number text-white/80 relative z-10">{fund.nav}</div>
                  <div className={`col-span-1 text-right data-number font-medium ${dailyChange >= 0 ? "text-[#00F0FF]" : "text-[#FF3366]"} relative z-10`}>
                    <span className="inline-flex items-center gap-0.5">
                      {dailyChange >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {dailyChange >= 0 ? "+" : ""}{fund.dailyChange}%
                    </span>
                  </div>
                  <div className={`col-span-1 text-right data-number ${return1y >= 0 ? "text-[#00F0FF]" : "text-[#FF3366]"} relative z-10`}>
                    {return1y >= 0 ? "+" : ""}{perf?.return1y}%
                  </div>
                  <div className="col-span-1 text-right data-number text-[#A3FF12] relative z-10">{sharpe.toFixed(2)}</div>
                  <div className="col-span-1 text-right data-number text-[#FF3366] relative z-10">{maxDD.toFixed(2)}%</div>
                  <div className="col-span-1 flex justify-center relative z-10">
                    <div className="flex gap-0.5">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star key={i} className={`w-3 h-3 ${i < (fund.stars || 0) ? "text-[#FFB800] fill-[#FFB800]" : "text-white/10"}`} />
                      ))}
                    </div>
                  </div>
                  <div className="col-span-1 text-center relative z-10">
                    <span className="px-2 py-0.5 rounded text-xs bg-white/[0.05] text-white/50">{typeLabels[fund.fundType] || fund.fundType}</span>
                  </div>
                  <div className="col-span-2 flex justify-center gap-1 flex-wrap relative z-10">
                    {(fund.tags || []).slice(0, 2).map((tag: string) => (
                      <span key={tag} className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#3B6CFF]/10 text-[#00F0FF] border border-[#3B6CFF]/20">{tag}</span>
                    ))}
                  </div>
                </Link>
              );
            })
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-2 mt-6">
            <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}
              className="px-3 py-1.5 rounded-lg text-sm text-white/50 hover:text-white disabled:opacity-30 transition-all">上一页</button>
            <span className="text-white/40 text-sm data-number">{page} / {totalPages}</span>
            <button onClick={() => setPage(page + 1)} disabled={page >= totalPages}
              className="px-3 py-1.5 rounded-lg text-sm text-white/50 hover:text-white disabled:opacity-30 transition-all">下一页</button>
          </div>
        )}
      </section>
    </div>
  );
}
