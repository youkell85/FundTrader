import { ReportSection } from "@/components/report/ReportSection";
import { DataGapsPanel } from "../components/DataGapsPanel";
import { RiskSection } from "../sections";
import type { FundDetailTabProps } from "./types";

export default function DiagnosisTab({ detail }: FundDetailTabProps) {
  return (
    <div className="mt-3 space-y-6">
      <ReportSection
        id="risk"
        title="风险画像"
        badge="后端补 ±同类对比表后升级"
      >
        <RiskSection
          risk={detail.risk}
          navSeries={detail.navSeries}
          riskSummary={detail.riskSummaryQ.data}
        />
      </ReportSection>

      <ReportSection id="gaps" title="已知数据缺口">
        <DataGapsPanel items={detail.coverage.items} />
      </ReportSection>
    </div>
  );
}
