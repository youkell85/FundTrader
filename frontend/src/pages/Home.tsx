import { useState, useMemo, useCallback, useEffect } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { getChangeTextClass } from "@/lib/colors";
import StatCards from "@/components/home/StatCards";
import FilterBar from "@/components/home/FilterBar";
import FundTable from "@/components/home/FundTable";

const typeLabels: Record<string, string> = {
  equity: "股票型", hybrid: "混合型", bond: "债券型",
  index: "指数型", etf: "ETF", qdii: "QDII", money: "货币型", fof: "FOF", reits: "REITs",
};

function isMissingMetric(value: unknown) {
  return value === undefined || value === null || value === "" || value === "—" || value === "暂无" || value === "鈥?";
}

function parseMetric(value: unknown): number | null {
  if (isMissingMetric(value)) return null;
  const num = parseFloat(String(value ?? "").replace("%", ""));
  return Number.isFinite(num) ? num : null;
}

function average(values: Array<number | null>) {
  const valid = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

export default function Home() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [fundType, setFundType] = useState("__all__");
  const [category, setCategory] = useState("__all__");
  const [company, setCompany] = useState("__all__");
  const [riskLevel, setRiskLevel] = useState("__all__");
  const [showXinjihuiOnly, setShowXinjihuiOnly] = useState(false);
  const [showWatchlistOnly, setShowWatchlistOnly] = useState(false);
  const [sortBy, setSortBy] = useState("dailyChange");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const pageSize = 15;
  const [searchError, setSearchError] = useState<string | null>(null);

  const { data: listData, isLoading: listLoading, refetch: refetchList } = trpc.fund.list.useQuery(
    {
      page: 1,
      pageSize: 5000,
      withMetrics: true,
      fundType: fundType !== "__all__" ? fundType : undefined,
      category: category !== "__all__" ? category : undefined,
      company: company !== "__all__" ? company : undefined,
      riskLevel: riskLevel !== "__all__" ? riskLevel : undefined,
      search: search.trim() || undefined,
      sortBy,
      sortOrder,
    },
    { staleTime: 30 * 60 * 1000, refetchOnWindowFocus: false }
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

  useEffect(() => {
    const hasRiskMetrics = allFunds.some((fund: any) => {
      const perf = fund.performance || {};
      return !isMissingMetric(perf.sharpeRatio) && !isMissingMetric(perf.maxDrawdown);
    });
    if (allFunds.length === 0 || hasRiskMetrics) return;

    const timers = [6000, 14000].map((delay) => window.setTimeout(() => {
      refetchList();
    }, delay));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [allFunds.length, refetchList]);

  const filteredFunds = useMemo(() => {
    let result = [...allFunds];
    if (fundType && fundType !== "__all__") result = result.filter((f: any) => f.fundType === fundType);
    if (category && category !== "__all__") result = result.filter((f: any) => f.category?.includes(category));
    if (company && company !== "__all__") result = result.filter((f: any) => f.company?.includes(company));
    if (riskLevel && riskLevel !== "__all__") result = result.filter((f: any) => f.riskLevel === riskLevel);
    if (showXinjihuiOnly && !showWatchlistOnly) {
      result = result.filter((f: any) => f.isXinjihui || f.source === "xinjihui");
    } else if (showWatchlistOnly && !showXinjihuiOnly) {
      result = result.filter((f: any) => f.source === "watchlist");
    }
    if (search) {
      const s = search.toLowerCase();
      result = result.filter((f: any) =>
        f.fundCode?.includes(s) || f.fundName?.toLowerCase().includes(s) || f.fundAbbr?.toLowerCase().includes(s) || f.manager?.name?.includes(s)
      );
    }
    const sortKey = sortBy;
    const sortDir = sortOrder;
    result.sort((a: any, b: any) => {
      if (showWatchlistOnly && !showXinjihuiOnly) {
        const aTime = new Date(a.updatedAt || 0).getTime();
        const bTime = new Date(b.updatedAt || 0).getTime();
        if (aTime !== bTime) return bTime - aTime;
      }
      const aPerf = a.performance || {};
      const bPerf = b.performance || {};
      const parseSortVal = (val: string | undefined) => {
        if (isMissingMetric(val)) return NaN;
        return parseFloat(val);
      };
      const aVal = sortKey.startsWith("return") || sortKey === "annualizedReturn" || sortKey === "sharpeRatio" || sortKey === "maxDrawdown"
        ? parseSortVal(aPerf[sortKey])
        : parseSortVal(a[sortKey]);
      const bVal = sortKey.startsWith("return") || sortKey === "annualizedReturn" || sortKey === "sharpeRatio" || sortKey === "maxDrawdown"
        ? parseSortVal(bPerf[sortKey])
        : parseSortVal(b[sortKey]);
      if (isNaN(aVal) && isNaN(bVal)) return 0;
      if (isNaN(aVal)) return 1;
      if (isNaN(bVal)) return -1;
      return sortDir === "desc" ? bVal - aVal : aVal - bVal;
    });
    return result;
  }, [allFunds, fundType, category, company, riskLevel, showXinjihuiOnly, showWatchlistOnly, search, sortBy, sortOrder]);

  const paginatedFunds = useMemo(() => {
    return filteredFunds.slice((page - 1) * pageSize, page * pageSize);
  }, [filteredFunds, page]);

  const totalPages = Math.max(1, Math.ceil(filteredFunds.length / pageSize));
  const currentOverview = useMemo(() => {
    const avgReturn = average(filteredFunds.map((fund: any) => parseMetric(fund.performance?.annualizedReturn ?? fund.performance?.return1y)));
    const avgSharpe = average(filteredFunds.map((fund: any) => parseMetric(fund.performance?.sharpeRatio)));
    return {
      total: filteredFunds.length,
      avgReturn: avgReturn === null ? "—" : avgReturn.toFixed(2),
      avgSharpe: avgSharpe === null ? "—" : avgSharpe.toFixed(2),
    };
  }, [filteredFunds]);

  const categoryStats = useMemo(() => {
    const groups = new Map<string, any[]>();
    for (const fund of filteredFunds) {
      const key = typeLabels[fund.fundType] || fund.category || fund.fundType || "其他";
      groups.set(key, [...(groups.get(key) || []), fund]);
    }
    const mapped = Array.from(groups.entries()).map(([label, funds]) => {
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
    });
    const preferredOrder = ["etf", "equity", "hybrid", "bond", "index", "qdii"].map((key) => typeLabels[key] || key);
    return preferredOrder.map((label) => mapped.find((item) => item.label === label) || {
      label,
      count: 0,
      avgReturn: "—",
      avgMaxDrawdown: "—",
      avgSharpe: "—",
    });
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
            setShowXinjihuiOnly(false);
            setShowWatchlistOnly(true);
            setSearch("");
            setPage(1);
          },
          onError: (err) => {
            setSearchError(`添加基金失败: ${err.message}`);
          },
        }
      );
    };

    if (/^\d{6}$/.test(query)) {
      addWatchlistFund(query);
      return;
    }

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

  const handleSortChange = (key: string) => {
    if (sortBy === key) {
      setSortOrder(sortOrder === "desc" ? "asc" : "desc");
    } else {
      setSortBy(key);
      setSortOrder("desc");
    }
    setPage(1);
  };

  const handleCategoryClick = (label: string) => {
    const nextCategory = category === label ? "__all__" : label;
    setFundType("");
    setCategory(nextCategory);
    setPage(1);
  };

  const handleReset = () => {
    setFundType("__all__");
    setCategory("__all__");
    setCompany("__all__");
    setRiskLevel("__all__");
    setSearch("");
    setShowXinjihuiOnly(false);
    setShowWatchlistOnly(false);
    setPage(1);
  };

  return (
    <div className="min-h-screen pt-14 pb-12">
      <section className="relative px-6 pt-16 pb-12 max-w-7xl mx-auto">
        <div className="mb-2">
          <h1 className="text-4xl md:text-5xl font-semibold text-white tracking-tight leading-tight" style={{ letterSpacing: "-1.2px" }}>
            洞察趋势，甄选长跑冠军
          </h1>
          <p className="mt-3 text-white/40 text-base max-w-2xl">
            基于"鑫基荟"优选池，AI驱动的产品筛选与智能配置平台
          </p>
        </div>

        <StatCards
          currentOverview={currentOverview}
          categoryStats={categoryStats}
          overview={overview}
          allFunds={allFunds}
          category={category}
          fundType={fundType}
          company={company}
          riskLevel={riskLevel}
          search={search}
          onReset={handleReset}
          onCategoryClick={handleCategoryClick}
        />

        <FilterBar
          search={search}
          searchError={searchError}
          fundType={fundType}
          category={category}
          company={company}
          riskLevel={riskLevel}
          showXinjihui={showXinjihuiOnly}
          showWatchlist={showWatchlistOnly}
          sortBy={sortBy}
          sortOrder={sortOrder}
          filterOpts={filterOpts}
          addFundByCodePending={addFundByCode.isPending}
          onSearchChange={(value) => { setSearch(value); setSearchError(null); setPage(1); }}
          onSearchSubmit={handleSearchSubmit}
          onFundTypeChange={(v) => { setFundType(v); setPage(1); }}
          onCategoryChange={(v) => { setCategory(v); setPage(1); }}
          onCompanyChange={(v) => { setCompany(v); setPage(1); }}
          onRiskLevelChange={(v) => { setRiskLevel(v); setPage(1); }}
          onToggleXinjihui={() => {
            setShowXinjihuiOnly((prev) => {
              const next = !prev;
              if (next) setShowWatchlistOnly(false);
              return next;
            });
            setPage(1);
          }}
          onToggleWatchlist={() => {
            setShowWatchlistOnly((prev) => {
              const next = !prev;
              if (next) setShowXinjihuiOnly(false);
              return next;
            });
            setPage(1);
          }}
          onSortChange={handleSortChange}
        />
      </section>

      <FundTable
        paginatedFunds={paginatedFunds}
        listLoading={listLoading}
        showXinjihui={showXinjihuiOnly}
        showWatchlistOnly={showWatchlistOnly}
        hasSearch={Boolean(search.trim())}
        totalPages={totalPages}
        page={page}
        onPageChange={setPage}
        onAddFund={(code) => addFundByCode.mutate({ code })}
        onRemoveFund={(code) => removeFund.mutate({ code })}
      />
    </div>
  );
}
