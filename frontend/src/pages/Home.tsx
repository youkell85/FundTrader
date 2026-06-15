import { useState, useMemo, useCallback } from "react";
import { trpc } from "@/providers/trpc";
import StatCards from "@/components/home/StatCards";
import FilterBar from "@/components/home/FilterBar";
import FundTable from "@/components/home/FundTable";

const typeLabels: Record<string, string> = {
  equity: "股票型",
  hybrid: "混合型",
  bond: "债券型",
  index: "指数型",
  etf: "ETF",
  qdii: "QDII",
  money: "货币型",
  fof: "FOF",
  reits: "REITs",
};

type CategoryMetricRow = {
  category?: string | null;
  total_count?: number | string | null;
  avg_annual_return_eq?: number | string | null;
  avg_max_drawdown_eq?: number | string | null;
  avg_sharpe_eq?: number | string | null;
};

function isMissingMetric(value: unknown) {
  return value === undefined || value === null || value === "" || value === "—" || value === "-";
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

  // 首屏轻量加载：小分页、不带重指标，确保 3 秒内渲染
  const {
    data: listData,
    isLoading: listLoading,
    isError: listIsError,
    error: listError,
    refetch: refetchList,
  } = trpc.fund.list.useQuery(
    {
      page: 1,
      pageSize: 100,
      withMetrics: false,
      fundType: fundType !== "__all__" ? fundType : undefined,
      category: category !== "__all__" ? category : undefined,
      company: company !== "__all__" ? company : undefined,
      riskLevel: riskLevel !== "__all__" ? riskLevel : undefined,
      search: search.trim() || undefined,
      sortBy,
      sortOrder,
    },
    { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false, retry: 1 }
  );
  const { data: filterOptsData } = trpc.fund.filterOptions.useQuery(
    undefined,
    { staleTime: 30 * 60 * 1000, refetchOnWindowFocus: false }
  );
  const { data: categoryMetricsData } = trpc.fund.categoryMetrics.useQuery(
    {
      windowDays: 365,
      riskFreeRate: 0.02,
      xinjihuiOnly: showXinjihuiOnly && !showWatchlistOnly,
    },
    { staleTime: 6 * 60 * 60 * 1000, refetchOnWindowFocus: false, enabled: !showWatchlistOnly }
  );

  const addFundByCode = trpc.fund.addByCode.useMutation({
    onSuccess: () => {
      utils.fund.list.invalidate();
    },
  });
  const removeFund = trpc.fund.removeFromWatchlist.useMutation({
    onSuccess: () => {
      utils.fund.list.invalidate();
    },
  });

  const allFunds = listData?.funds ?? [];
  const listDegraded = (listData as any)?.degraded === true;
  const listMissingReason = (listData as any)?.missingReason;
  const listFilteredLocally = (listData as any)?.filteredLocally === true;
  const listWatchlistLimited = (listData as any)?.watchlistLimited === true;
  const filterOpts = filterOptsData ?? { types: [], categories: [], companies: [], riskLevels: [] };
  // 快照路径只拉 xinjihui 前 100 条，以下筛选维度是本地过滤，结果可能不完整：
  //   fundType / company / riskLevel / watchlist
  // category 和 search 由后端 snapshot API 直接支持，不在此列
  const isLocalFilterLimited =
    (listFilteredLocally || listWatchlistLimited) &&
    (fundType !== "__all__" || company !== "__all__" || riskLevel !== "__all__" || showWatchlistOnly);

  const filteredFunds = useMemo(() => {
    let result = [...allFunds];
    if (fundType !== "__all__") result = result.filter((f: any) => f.fundType === fundType);
    if (category !== "__all__") result = result.filter((f: any) => f.category?.includes(category));
    if (company !== "__all__") result = result.filter((f: any) => f.company?.includes(company));
    if (riskLevel !== "__all__") result = result.filter((f: any) => f.riskLevel === riskLevel);
    if (showXinjihuiOnly && !showWatchlistOnly) result = result.filter((f: any) => f.isXinjihui || f.source === "xinjihui");
    if (showWatchlistOnly && !showXinjihuiOnly) result = result.filter((f: any) => f.source === "watchlist");
    if (search) {
      const s = search.toLowerCase();
      result = result.filter((f: any) =>
        f.fundCode?.includes(s) || f.fundName?.toLowerCase().includes(s) || f.fundAbbr?.toLowerCase().includes(s) || f.manager?.name?.includes(s)
      );
    }
    const parseSortVal = (val: string | undefined) => {
      if (isMissingMetric(val)) return Number.NaN;
      return parseFloat(val);
    };
    result.sort((a: any, b: any) => {
      const aPerf = a.performance || {};
      const bPerf = b.performance || {};
      const aVal = sortBy.startsWith("return") || sortBy === "annualizedReturn" || sortBy === "sharpeRatio" || sortBy === "maxDrawdown"
        ? parseSortVal(aPerf[sortBy])
        : parseSortVal(a[sortBy]);
      const bVal = sortBy.startsWith("return") || sortBy === "annualizedReturn" || sortBy === "sharpeRatio" || sortBy === "maxDrawdown"
        ? parseSortVal(bPerf[sortBy])
        : parseSortVal(b[sortBy]);
      if (Number.isNaN(aVal) && Number.isNaN(bVal)) return 0;
      if (Number.isNaN(aVal)) return 1;
      if (Number.isNaN(bVal)) return -1;
      return sortOrder === "desc" ? bVal - aVal : aVal - bVal;
    });
    return result;
  }, [allFunds, fundType, category, company, riskLevel, showXinjihuiOnly, showWatchlistOnly, search, sortBy, sortOrder]);

  const paginatedFunds = useMemo(() => filteredFunds.slice((page - 1) * pageSize, page * pageSize), [filteredFunds, page]);
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

  const baseFundsForCategoryStats = useMemo(() => {
    let result = [...allFunds];
    if (company !== "__all__") result = result.filter((f: any) => f.company?.includes(company));
    if (riskLevel !== "__all__") result = result.filter((f: any) => f.riskLevel === riskLevel);
    if (search) {
      const s = search.toLowerCase();
      result = result.filter((f: any) =>
        f.fundCode?.includes(s) || f.fundName?.toLowerCase().includes(s) || f.fundAbbr?.toLowerCase().includes(s) || f.manager?.name?.includes(s)
      );
    }
    if (showXinjihuiOnly && !showWatchlistOnly) result = result.filter((f: any) => f.isXinjihui || f.source === "xinjihui");
    if (showWatchlistOnly && !showXinjihuiOnly) result = result.filter((f: any) => f.source === "watchlist");
    return result;
  }, [allFunds, company, riskLevel, search, showXinjihuiOnly, showWatchlistOnly]);

  const categoryStats = useMemo(() => {
    const preferredOrder = ["etf", "equity", "hybrid", "bond", "index", "qdii"] as const;
    const apiRows: CategoryMetricRow[] = Array.isArray((categoryMetricsData as any)?.rows) ? (categoryMetricsData as any).rows : [];
    if (!showWatchlistOnly && apiRows.length > 0) {
      const rowByCategory = new Map<string, CategoryMetricRow>(apiRows.map((r) => [String(r.category || ""), r]));
      return preferredOrder.map((key) => {
        const row = rowByCategory.get(key);
        const label = typeLabels[key] || key;
        return {
          key,
          label,
          count: Number(row?.total_count || 0),
          avgReturn: row?.avg_annual_return_eq != null ? (Number(row.avg_annual_return_eq) * 100).toFixed(2) : "—",
          avgMaxDrawdown: row?.avg_max_drawdown_eq != null ? (Number(row.avg_max_drawdown_eq) * 100).toFixed(2) : "—",
          avgSharpe: row?.avg_sharpe_eq != null ? Number(row.avg_sharpe_eq).toFixed(2) : "—",
        };
      });
    }
    const groups = new Map<string, any[]>();
    for (const fund of baseFundsForCategoryStats) {
      const ft = fund.fundType || "other";
      groups.set(ft, [...(groups.get(ft) || []), fund]);
    }
    const mapped = Array.from(groups.entries()).map(([ft, funds]) => {
      const avg = (values: Array<number | null>) => {
        const valid = values.filter((v): v is number => v !== null);
        return valid.length ? (valid.reduce((sum, v) => sum + v, 0) / valid.length).toFixed(2) : "—";
      };
      return {
        key: ft,
        label: typeLabels[ft] || ft,
        count: funds.length,
        avgReturn: avg(funds.map((f) => parseMetric(f.performance?.annualizedReturn || f.performance?.return1y))),
        avgMaxDrawdown: avg(funds.map((f) => parseMetric(f.performance?.maxDrawdown))),
        avgSharpe: avg(funds.map((f) => parseMetric(f.performance?.sharpeRatio))),
      };
    });
    return preferredOrder.map((key) => mapped.find((item) => item.key === key) || {
      key,
      label: typeLabels[key] || key,
      count: 0,
      avgReturn: "—",
      avgMaxDrawdown: "—",
      avgSharpe: "—",
    });
  }, [baseFundsForCategoryStats, categoryMetricsData, showWatchlistOnly]);

  const handleSearchSubmit = useCallback((e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const query = search.trim();
    setSearchError(null);
    if (addFundByCode.isPending || !query) return;
    const addWatchlistFund = (code: string) => addFundByCode.mutate(
      { code },
      {
        onSuccess: () => {
          setShowXinjihuiOnly(false);
          setShowWatchlistOnly(true);
          setSearch("");
          setPage(1);
        },
        onError: (err) => setSearchError(`添加基金失败: ${err.message}`),
      }
    );
    if (/^\d{6}$/.test(query)) return addWatchlistFund(query);
    const normalized = query.toLowerCase();
    const matches = allFunds.filter((f: any) =>
      f.fundCode === query || f.fundName?.toLowerCase().includes(normalized) || f.fundAbbr?.toLowerCase().includes(normalized));
    const uniqueCodes = Array.from(new Set(matches.map((f: any) => f.fundCode).filter(Boolean)));
    if (uniqueCodes.length === 1) return addWatchlistFund(uniqueCodes[0]);
    setSearchError(uniqueCodes.length > 1 ? "匹配到多只产品，请输入更完整名称或代码" : "未找到匹配产品");
  }, [addFundByCode, allFunds, search]);

  const handleSortChange = (key: string) => {
    if (sortBy === key) setSortOrder(sortOrder === "desc" ? "asc" : "desc");
    else {
      setSortBy(key);
      setSortOrder("desc");
    }
    setPage(1);
  };

  const handleCategoryClick = (key: string) => {
    setCategory("__all__");
    setFundType(fundType === key ? "__all__" : key);
    setPage(1);
  };

  return (
    <div className="min-h-screen pt-14 pb-12">
      <section className="relative px-4 sm:px-6 pt-10 pb-8 max-w-7xl mx-auto">
        <div className="mb-2 rounded-md border border-white/[0.08] bg-[#101411]/70 p-5 md:p-6">
          <h1 className="text-3xl md:text-4xl font-semibold text-white tracking-tight leading-tight">洞察趋势，甄选长跑冠军</h1>
          <p className="mt-3 text-[#cfc5b7]/70 text-sm md:text-base max-w-2xl">基于鑫基荟优选池，智能驱动的产品筛选与配置平台</p>
        </div>

        <StatCards
          currentOverview={currentOverview}
          categoryStats={categoryStats}
          category={fundType}
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
        listIsError={listIsError}
        listError={listError?.message ?? null}
        listDegraded={listDegraded}
        listMissingReason={listMissingReason}
        isLocalFilterLimited={isLocalFilterLimited}
        showXinjihui={showXinjihuiOnly}
        showWatchlistOnly={showWatchlistOnly}
        hasSearch={Boolean(search.trim())}
        totalPages={totalPages}
        page={page}
        onPageChange={setPage}
        onAddFund={(code) => addFundByCode.mutate({ code })}
        onRemoveFund={(code) => removeFund.mutate({ code })}
        onRetry={() => refetchList()}
      />
    </div>
  );
}
