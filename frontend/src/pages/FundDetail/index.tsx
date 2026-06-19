import { Suspense, lazy, useCallback } from "react";
import { Link, useSearchParams } from "react-router";
import { AlertCircle, ArrowLeft, RefreshCw } from "lucide-react";
import { num } from "@/lib/fund-data";
import { CoverageSummary, DecisionSnapshot } from "@/components/fund-detail/DetailStatusPanels";
import { KpiStrip, PartialBanner, ResearchHeader } from "./sections";
import { useFundDetailData } from "./useFundDetailData";
import type { FundDetailTabKey } from "./tabs/types";

const OverviewTab = lazy(() => import("./tabs/OverviewTab"));
const PerformanceTab = lazy(() => import("./tabs/PerformanceTab"));
const HoldingsTab = lazy(() => import("./tabs/HoldingsTab"));
const MarketContextTab = lazy(() => import("./tabs/MarketContextTab"));
const DiagnosisTab = lazy(() => import("./tabs/DiagnosisTab"));

const TABS: Array<{ key: FundDetailTabKey; label: string }> = [
  { key: "overview", label: "概览" },
  { key: "performance", label: "业绩" },
  { key: "holdings", label: "持仓" },
  { key: "market", label: "市场" },
  { key: "diagnosis", label: "诊断" },
];

const TAB_COMPONENTS = {
  overview: OverviewTab,
  performance: PerformanceTab,
  holdings: HoldingsTab,
  market: MarketContextTab,
  diagnosis: DiagnosisTab,
};

export default function FundDetail() {
  const detail = useFundDetailData();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab") as FundDetailTabKey | null;
  const selectedTab = TABS.some((tab) => tab.key === requestedTab) ? requestedTab! : "overview";
  const SelectedTab = TAB_COMPONENTS[selectedTab];

  const scrollToSection = useCallback((sectionId: string, attempt = 0) => {
    window.setTimeout(() => {
      const target = document.getElementById(sectionId);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (attempt < 8) scrollToSection(sectionId, attempt + 1);
    }, attempt === 0 ? 80 : 120);
  }, []);

  const tabForSection = useCallback((sectionId: string): FundDetailTabKey => {
    if (sectionId === "gaps" || sectionId === "risk" || sectionId === "report-export") return "diagnosis";
    if (sectionId === "perf") return "performance";
    if (sectionId === "peer") return "performance";
    return selectedTab;
  }, [selectedTab]);

  const selectTab = useCallback((tab: FundDetailTabKey, sectionId?: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("tab", tab);
      return next;
    }, { replace: true });
    if (sectionId) scrollToSection(sectionId);
  }, [scrollToSection, setSearchParams]);

  const navigateToSection = useCallback((sectionId: string) => {
    selectTab(tabForSection(sectionId), sectionId);
  }, [selectTab, tabForSection]);

  if (detail.loading) {
    return <div className="min-h-screen pt-20 text-center text-muted-foreground">加载基金详情中...</div>;
  }

  if (detail.err || !detail.fund) {
    const errMessage = detail.err instanceof Error ? detail.err.message : String(detail.err || "");
    return (
      <div className="min-h-screen pt-20 text-center">
        <div className="inline-flex flex-col items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-6 text-white/85">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <div className="text-lg font-medium">基金详情加载失败</div>
          {errMessage ? <div className="max-w-md text-sm text-muted-foreground">{errMessage}</div> : null}
          <div className="flex gap-2">
            <button
              onClick={() => detail.detailQuery.refetch()}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90"
            >
              <RefreshCw className="h-4 w-4" />
              重试
            </button>
            <Link
              to={detail.from}
              className="inline-flex items-center gap-1 rounded-md border px-3 py-2 text-sm hover:bg-secondary"
            >
              <ArrowLeft className="h-4 w-4" />
              返回
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const fundName = detail.fund.fundName || detail.fund.fundAbbr || detail.fund.fundCode || "--";
  const isPartial = Boolean((detail.fund as any)?._partial);
  const navDate = detail.fund.navDate || detail.fund.nav_date || detail.navPoints[detail.navPoints.length - 1]?.d || "-";

  return (
    <div className="min-h-screen pb-12 pt-14">
      <div className="mx-auto max-w-[1440px] px-3 md:px-5">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Link to={detail.from} className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            返回
          </Link>
          <span>/</span>
          <span className="truncate">{fundName}</span>
          {isPartial ? (
            <button
              onClick={() => detail.detailQuery.refetch()}
              className="ml-auto inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-secondary"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              补全数据中
            </button>
          ) : null}
        </div>

        <ResearchHeader
          fund={detail.fund}
          fundName={fundName}
          code={detail.code}
          navDate={navDate}
          isPartial={isPartial}
          coverage={detail.coverage}
          onRefresh={() => detail.detailQuery.refetch()}
        />

        <DecisionSnapshot
          fund={detail.fund}
          risk={detail.risk}
          coverage={detail.coverage}
          peerReturn1y={num((detail.peerPerformanceQ.data as any)?.peer?.return1y)}
          onNavigateSection={navigateToSection}
        />
        <CoverageSummary summary={detail.coverage} />
        <KpiStrip fund={detail.fund} risk={detail.risk} />
        {isPartial && <PartialBanner code={detail.code} />}

        <div className="mt-4 flex flex-wrap gap-1 border-b border-white/[0.06]">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => selectTab(tab.key)}
              className={`rounded-t-md px-3 py-2 text-sm ${
                selectedTab === tab.key
                  ? "border border-b-0 border-white/[0.08] bg-white/[0.05] text-white"
                  : "text-muted-foreground hover:bg-white/[0.03] hover:text-white/75"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <Suspense fallback={<div className="mt-4 text-sm text-muted-foreground">加载分栏中...</div>}>
          <SelectedTab detail={detail} onSelectTab={selectTab} />
        </Suspense>
      </div>
    </div>
  );
}
