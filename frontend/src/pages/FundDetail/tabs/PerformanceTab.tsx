import { ReportSection } from "@/components/report/ReportSection";
import { HistorySection, PeerSection, PerformanceSection } from "../sections";
import type { FundDetailTabProps } from "./types";

export default function PerformanceTab({ detail }: FundDetailTabProps) {
  return (
    <div className="mt-3 space-y-6">
      <ReportSection id="perf" title="业绩与回撤">
        <PerformanceSection
          series={detail.series}
          navSeries={detail.navSeries}
          range={detail.range}
          setRange={detail.setRange}
          performanceRows={detail.performanceRows}
        />
        <div className="mt-3">
          <HistorySection
            yearReturns={detail.yearReturns}
            apiRows={(detail.yearReturnsQ.data?.rows || []) as Array<{
              year: number;
              fundReturn: number | null;
              hs300Return: number | null;
              peerReturn: number | null;
              rank: { rank: number; total: number } | null;
            }>}
          />
        </div>
      </ReportSection>

      <ReportSection id="peer" title="同类与基准对比">
        <PeerSection peerData={detail.peerPerformanceQ.data} performanceRows={detail.performanceRows} />
      </ReportSection>
    </div>
  );
}
