import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { Link } from "react-router";
import { Search, TrendingUp, TrendingDown, Star, PieChart, Shield, Camera, X, Loader2, Trash2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { UP_COLOR, DOWN_COLOR, ACCENT_PRIMARY, RISK_COLOR, POSITIVE_METRIC_COLOR, getChangeTextClass } from "@/lib/colors";

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
  const utils = trpc.useUtils();
  const { data: listData, isLoading: listLoading, refetch: refetchList } = trpc.fund.list.useQuery(
    { pageSize: 1000 },
    { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false }
  );
  const { data: filterOptsData } = trpc.fund.filterOptions.useQuery(
    undefined,
    { staleTime: 30 * 60 * 1000, refetchOnWindowFocus: false }
  );
  const { data: overviewData } = trpc.fund.marketOverview.useQuery(
    undefined,
    { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false }
  );
  const addFundByCode = trpc.fund.addByCode.useMutation({
    onSuccess: () => {
      utils.fund.list.invalidate();
      utils.fund.marketOverview.invalidate();
    },
  });
  const removeFund = trpc.fund.removeFromWatchlist.useMutation({
    onSuccess: () => {
      utils.fund.list.invalidate();
      utils.fund.marketOverview.invalidate();
    },
  });

  const allFunds = listData?.funds ?? [];
  const filterOpts = filterOptsData ?? { types: [], categories: [], companies: [], riskLevels: [] };
  const overview = overviewData ?? { totalFunds: 0, avgReturn: "0", avgSharpe: "0", avgMaxDD: "0", marketingCount: 0 };

  const [search, setSearch] = useState("");
  const [fundType, setFundType] = useState("");
  const [category, setCategory] = useState("");
  const [riskLevel, setRiskLevel] = useState("");
  const [showXinjihui, setShowXinjihui] = useState(true);
  const [sortBy, setSortBy] = useState("dailyChange");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const pageSize = 15;
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Image search states
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [imageResult, setImageResult] = useState<ImageSearchResult | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const hasMetric = (value: unknown) => (
      value !== undefined &&
      value !== null &&
      value !== "" &&
      value !== "—" &&
      value !== "鈥?"
    );
    const hasRiskMetrics = allFunds.some((fund: any) => {
      const perf = fund.performance || {};
      return hasMetric(perf.sharpeRatio) && hasMetric(perf.maxDrawdown);
    });
    if (allFunds.length === 0 || hasRiskMetrics) return;

    // 分批延迟重试，仅当数据不完整时触发
    const timers = [6000, 14000].map((delay) => window.setTimeout(() => {
      refetchList();
    }, delay));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [allFunds.length, refetchList]);

  const filteredFunds = useMemo(() => {
    let result = [...allFunds];
    if (fundType) result = result.filter((f: any) => f.fundType === fundType);
    if (category) result = result.filter((f: any) => f.category?.includes(category));
    if (riskLevel) result = result.filter((f: any) => f.riskLevel === riskLevel);
    result = showXinjihui
      ? result.filter((f: any) => f.isXinjihui || f.source === "xinjihui")
      : result.filter((f: any) => f.source === "watchlist");
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
      const parseSortVal = (val: string | undefined) => {
        if (val === "—" || val === undefined) return NaN;  // 无数据排末尾
        return parseFloat(val);
      };
      const aVal = sortKey.startsWith("return") || sortKey === "annualizedReturn" || sortKey === "sharpeRatio" || sortKey === "maxDrawdown"
        ? parseSortVal(aPerf[sortKey])
        : parseSortVal(a[sortKey]);
      const bVal = sortKey.startsWith("return") || sortKey === "annualizedReturn" || sortKey === "sharpeRatio" || sortKey === "maxDrawdown"
        ? parseSortVal(bPerf[sortKey])
        : parseSortVal(b[sortKey]);
      // NaN 排到末尾
      if (isNaN(aVal) && isNaN(bVal)) return 0;
      if (isNaN(aVal)) return 1;
      if (isNaN(bVal)) return -1;
      return sortDir === "desc" ? bVal - aVal : aVal - bVal;
    });
    return result;
  }, [allFunds, fundType, category, riskLevel, showXinjihui, search, sortBy, sortOrder]);

  const paginatedFunds = useMemo(() => {
    return filteredFunds.slice((page - 1) * pageSize, page * pageSize);
  }, [filteredFunds, page]);

  const totalPages = Math.ceil(filteredFunds.length / pageSize);
  const categoryStats = useMemo(() => {
    const parseMetric = (value: unknown) => {
      const num = parseFloat(String(value ?? "").replace("%", ""));
      return Number.isFinite(num) ? num : null;
    };
    const groups = new Map<string, any[]>();
    for (const fund of filteredFunds) {
      const key = typeLabels[fund.fundType] || fund.category || fund.fundType || "其他";
      groups.set(key, [...(groups.get(key) || []), fund]);
    }
    return Array.from(groups.entries()).map(([label, funds]) => {
      const avg = (values: Array<number | null>) => {
        const valid = values.filter((v): v is number => v !== null);
        return valid.length ? (valid.reduce((sum, v) => sum + v, 0) / valid.length).toFixed(2) : "—";
      };
      return {
        label,
        count: funds.length,
        avgReturn: avg(funds.map((f) => parseMetric(f.performance?.annualizedReturn || f.performance?.return1y))),
        avgMaxDrawdown: avg(funds.map((f) => parseMetric(f.performance?.maxDrawdown))),
        avgSharpe: avg(funds.map((f) => parseMetric(f.performance?.sharpeRatio))),
      };
    }).sort((a, b) => b.count - a.count).slice(0, 6);
  }, [filteredFunds]);

  const handleSearchSubmit = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const query = search.trim();
    setSearchError(null);
    if (addFundByCode.isPending) return;
    if (!query) return;

    const addWatchlistFund = (code: string) => {
      addFundByCode.mutate(
        { code },
        {
          onSuccess: () => {
            setShowXinjihui(false);
            setSearch("");
            setPage(1);
          },
          onError: (err) => {
            setSearchError(`添加基金失败: ${err.message}`);
          },
        }
      );
    };

    // 6位基金代码：加入自选列表
    if (/^\d{6}$/.test(query)) {
      addWatchlistFund(query);
      return;
    }

    // 名称搜索：唯一匹配时加入自选列表
    const normalizedQuery = query.toLowerCase();
    const matches = allFunds.filter((fund: any) => (
      fund.fundCode === query ||
      fund.fundName?.toLowerCase().includes(normalizedQuery) ||
      fund.fundAbbr?.toLowerCase().includes(normalizedQuery)
    ));
    const uniqueCodes = Array.from(new Set(matches.map((fund: any) => fund.fundCode).filter(Boolean)));
    if (uniqueCodes.length === 1) {
      addWatchlistFund(uniqueCodes[0]);
      return;
    }

    setSearchError(uniqueCodes.length > 1 ? "匹配到多只产品，请输入更完整的产品名称或基金代码" : "未找到匹配产品，请输入6位基金代码或产品名称");
  }, [addFundByCode, allFunds, search]);

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
            基于“鑫基荟”优选池，AI驱动的产品筛选与智能配置平台
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-3 mt-6 md:mt-8">
          {[
            { label: "当前列表", value: filteredFunds.length, suffix: "只", icon: PieChart, color: ACCENT_PRIMARY },
            { label: "平均年化收益", value: overview.avgReturn, suffix: "%", icon: TrendingUp, color: parseFloat(overview.avgReturn) >= 0 ? UP_COLOR : DOWN_COLOR },
            { label: "平均夏普比率", value: overview.avgSharpe, suffix: "", icon: Shield, color: POSITIVE_METRIC_COLOR },
          ].map((card) => (
            <div key={card.label} className="liquid-glass-sm p-3 md:p-4 group hover:bg-white/[0.06] transition-all">
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
              onClick={() => { setFundType(""); setCategory(item.label); setPage(1); }}
              className="rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-3 text-left hover:bg-white/[0.05] transition-colors"
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-white/80 text-sm font-medium">{item.label}</span>
                <span className="data-number text-white/35 text-xs">{item.count}只</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[11px]">
                <div>
                  <div className="text-white/28">平均年化</div>
                  <div className={`data-number font-medium ${getChangeTextClass(parseFloat(item.avgReturn || "0"))}`}>{item.avgReturn}%</div>
                </div>
                <div>
                  <div className="text-white/28">最大回撤</div>
                  <div className="data-number font-medium" style={{ color: RISK_COLOR }}>{item.avgMaxDrawdown}%</div>
                </div>
                <div>
                  <div className="text-white/28">夏普</div>
                  <div className="data-number font-medium" style={{ color: POSITIVE_METRIC_COLOR }}>{item.avgSharpe}</div>
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="mt-8 flex flex-col md:flex-row gap-3">
          <form className="relative flex-1" onSubmit={handleSearchSubmit}>
            <button
              type="submit"
              disabled={addFundByCode.isPending}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors disabled:opacity-50"
              title="搜索基金"
            >
              {addFundByCode.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            </button>
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setSearchError(null); setPage(1); }}
              placeholder="输入基金代码 / 名称 / 基金经理..."
              className="w-full h-11 pl-10 pr-4 rounded-xl bg-white/[0.03] border border-white/[0.06] text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-[#3B6CFF]/50 focus:bg-white/[0.05] transition-all"
            />
            {searchError && <div className="absolute left-0 top-full mt-1 text-xs text-[#FF3366]">{searchError}</div>}
          </form>
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
              className="h-11 px-3 rounded-xl bg-[#0B1021] border border-white/[0.08] text-white text-sm focus:outline-none focus:border-[#3B6CFF]/50">
              <option value="" className="bg-[#0B1021] text-white">全部类型</option>
              {Object.entries(typeLabels).map(([k, v]) => (<option key={k} value={k} className="bg-[#0B1021] text-white">{v}</option>))}
            </select>
            <select value={riskLevel} onChange={(e) => { setRiskLevel(e.target.value); setPage(1); }}
              className="h-11 px-3 rounded-xl bg-[#0B1021] border border-white/[0.08] text-white text-sm focus:outline-none focus:border-[#3B6CFF]/50">
              <option value="" className="bg-[#0B1021] text-white">全部风险</option>
              {Object.entries(riskLabels).map(([k, v]) => (<option key={k} value={k} className="bg-[#0B1021] text-white">{v}</option>))}
            </select>
            <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}
              className="h-11 px-3 rounded-xl bg-[#0B1021] border border-white/[0.08] text-white text-sm focus:outline-none focus:border-[#3B6CFF]/50">
              <option value="" className="bg-[#0B1021] text-white">全部分类</option>
              {filterOpts.categories?.map((c: string) => (<option key={c} value={c} className="bg-[#0B1021] text-white">{c}</option>))}
            </select>
            <button onClick={() => { setShowXinjihui(!showXinjihui); setPage(1); }}
              className={`h-11 px-4 rounded-xl text-sm font-medium transition-all ${showXinjihui ? "bg-[#3B6CFF]/20 text-[#00F0FF] border border-[#3B6CFF]/30" : "bg-white/[0.03] text-white/50 border border-white/[0.06] hover:bg-white/[0.06]"}`}>
              鑫基荟
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
                            to={`/${fund.fundCode || fund.code}`}
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

      <section className="px-4 md:px-6 max-w-7xl mx-auto">
        <div className="liquid-glass overflow-hidden">
          {/* 桌面端表头（仅 md+ 显示） */}
          <div className="hidden md:grid md:grid-cols-[minmax(260px,2fr)_repeat(5,minmax(92px,1fr))_minmax(150px,1fr)] gap-3 px-5 py-3 text-xs text-white/30 font-medium border-b border-white/[0.06] items-center"
            style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.04) 0%, transparent 100%)" }}>
            <div>基金产品</div>
            <div className="text-right">净值</div>
            <div className="text-right">日涨跌</div>
            <div className="text-right">近1年</div>
            <div className="text-right">夏普</div>
            <div className="text-right">回撤</div>
            <div>类型/标签</div>
          </div>

          {listLoading ? (
            <div className="p-8 text-center text-white/30 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />加载中...
            </div>
          ) : paginatedFunds.length === 0 ? (
            <div className="p-8 text-center text-white/30">{showXinjihui ? "暂无鑫基荟产品" : "暂无自选基金"}</div>
          ) : (
            paginatedFunds.map((fund: any) => {
              const perf = fund.performance;
              const dailyChange = parseFloat(fund.dailyChange || "0");
              const return1y = parseFloat(perf?.return1y || "0");
              const maxDD = perf?.maxDrawdown === "—" ? null : parseFloat(perf?.maxDrawdown || "0");
              const sharpe = perf?.sharpeRatio === "—" ? null : parseFloat(perf?.sharpeRatio || "0");
              const isWatchlistFund = fund.source === "watchlist";
              const dailyClass = getChangeTextClass(dailyChange);
              const return1yClass = getChangeTextClass(return1y);
              return (
                <div key={fund.id}
                  className="border-b border-white/[0.03] hover:bg-white/[0.04] transition-all group cursor-pointer relative"
                  onMouseEnter={() => setHoveredRow(fund.id)} onMouseLeave={() => setHoveredRow(null)}>
                  {/* 桌面端行布局 */}
                  <Link to={`/${fund.fundCode}`} className="hidden md:grid md:grid-cols-[minmax(260px,2fr)_repeat(5,minmax(92px,1fr))_minmax(150px,1fr)] gap-3 px-5 py-3.5 text-sm items-center">
                    <div className="relative z-10 min-w-0">
                      <div className="text-white font-medium text-sm flex items-center gap-1">
                        {fund.fundAbbr || fund.fundName}
                        {isWatchlistFund && <Star className="w-3 h-3 text-[#FFB800] fill-[#FFB800]" />}
                      </div>
                      <div className="text-white/25 text-xs mt-0.5 flex items-center gap-1.5">
                        <span className="data-number">{fund.fundCode}</span>
                        <span>{fund.manager?.name}</span>
                        <span>{fund.company}</span>
                      </div>
                    </div>
                    <div className="text-right data-number text-white/80 relative z-10">{fund.nav}</div>
                    <div className={`text-right data-number font-medium ${dailyClass} relative z-10`}>
                      <span className="inline-flex items-center gap-0.5">
                        {dailyChange >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {dailyChange >= 0 ? "+" : ""}{fund.dailyChange}%
                      </span>
                    </div>
                    <div className={`text-right data-number ${return1yClass} relative z-10`}>
                      {return1y >= 0 ? "+" : ""}{perf?.return1y}%
                    </div>
                    <div className="text-right data-number relative z-10" style={{ color: POSITIVE_METRIC_COLOR }}>{sharpe !== null ? sharpe.toFixed(2) : "—"}</div>
                    <div className="text-right data-number relative z-10" style={{ color: RISK_COLOR }}>{maxDD !== null ? maxDD.toFixed(2) + "%" : "—"}</div>
                    <div className="flex items-center gap-1.5 flex-wrap relative z-10">
                      <span className="px-2 py-0.5 rounded text-xs bg-white/[0.05] text-white/60">{typeLabels[fund.fundType] || fund.fundType}</span>
                      {(fund.tags || []).slice(0, 2).map((tag: string) => (
                        <span key={tag} className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#3B6CFF]/10 text-[#5AA9FF] border border-[#3B6CFF]/20">{tag}</span>
                      ))}
                    </div>
                  </Link>

                  {/* 移动端卡片布局 */}
                  <Link to={`/${fund.fundCode}`} className="md:hidden flex flex-col gap-2 px-4 py-3.5 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-white font-medium text-[15px] flex items-center gap-1 truncate">
                          {fund.fundAbbr || fund.fundName}
                          {isWatchlistFund && <Star className="w-3.5 h-3.5 text-[#FFB800] fill-[#FFB800] shrink-0" />}
                        </div>
                        <div className="text-white/30 text-xs mt-1 flex items-center gap-2 flex-wrap">
                          <span className="data-number">{fund.fundCode}</span>
                          <span className="px-1.5 py-0.5 rounded bg-white/[0.05]">{typeLabels[fund.fundType] || fund.fundType}</span>
                          <span>{fund.manager?.name}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="data-number text-white text-base font-semibold">{fund.nav}</div>
                        <div className={`data-number text-sm font-medium ${dailyClass}`}>
                          {dailyChange >= 0 ? "+" : ""}{fund.dailyChange}%
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 pt-1 text-[11px]">
                      <div>
                        <div className="text-white/30">近1年</div>
                        <div className={`data-number font-medium ${return1yClass}`}>{return1y >= 0 ? "+" : ""}{perf?.return1y}%</div>
                      </div>
                      <div>
                        <div className="text-white/30">夏普比</div>
                        <div className="data-number font-medium" style={{ color: POSITIVE_METRIC_COLOR }}>{sharpe !== null ? sharpe.toFixed(2) : "—"}</div>
                      </div>
                      <div>
                        <div className="text-white/30">最大回撤</div>
                        <div className="data-number font-medium" style={{ color: RISK_COLOR }}>{maxDD !== null ? maxDD.toFixed(2) + "%" : "—"}</div>
                      </div>
                    </div>
                  </Link>

                  {/* 移除自选按钮 - 桌面端hover显示，移动端常驻 */}
                  {isWatchlistFund && (
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        removeFund.mutate({ code: fund.fundCode });
                      }}
                      className={`absolute top-2 right-2 z-20 w-7 h-7 rounded-md bg-[#F5384B]/10 text-[#F5384B] hover:bg-[#F5384B]/20 flex items-center justify-center transition-all ${hoveredRow === fund.id ? "opacity-100" : "md:opacity-0 opacity-100"}`}
                      title="移除自选"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
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
