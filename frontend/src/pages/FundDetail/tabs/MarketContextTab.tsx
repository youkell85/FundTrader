import { ReportSection } from "@/components/report/ReportSection";
import { MarketContextPanel } from "@/components/fund-detail/DetailStatusPanels";
import type { FundDetailTabProps } from "./types";

export default function MarketContextTab({ detail }: FundDetailTabProps) {
  return (
    <div className="mt-3 space-y-6">
      <ReportSection id="market-context" title="市场上下文">
        <MarketContextPanel context={detail.marketContextQ.data} />
      </ReportSection>
    </div>
  );
}
