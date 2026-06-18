import { Download, FileText } from "lucide-react";
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

      <ReportSection id="report-export" title="Research report export">
        <div className="flex flex-wrap items-center gap-2">
          <ExportLink code={detail.code} format="md" label="Markdown" />
          <ExportLink code={detail.code} format="docx" label="Word" />
          <ExportLink code={detail.code} format="pdf" label="PDF" />
        </div>
      </ReportSection>
    </div>
  );
}

function ExportLink({ code, format, label }: { code: string; format: "md" | "docx" | "pdf"; label: string }) {
  const href = `/fund/api/fund/${encodeURIComponent(code)}/research-report?format=${format}`;
  return (
    <a
      href={href}
      download
      className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/70 hover:bg-white/[0.06] hover:text-white"
    >
      {format === "md" ? <FileText className="h-4 w-4" /> : <Download className="h-4 w-4" />}
      {label}
    </a>
  );
}
