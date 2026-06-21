import { Download, FileText } from "lucide-react";
import { ReportSection } from "@/components/report/ReportSection";
import { trpc } from "@/providers/trpc";
import { DataGapsPanel } from "../components/DataGapsPanel";
import { RiskSection } from "../sections";
import type { FundDetailTabProps } from "./types";

export default function DiagnosisTab({ detail }: FundDetailTabProps) {
  const reportQ = trpc.fund.fundResearchReport.useQuery(
    { code: detail.code },
    { enabled: /^\d{6}$/.test(detail.code), staleTime: 30 * 60 * 1000, refetchOnWindowFocus: false },
  );
  const evidencePack = reportQ.data?.evidencePack as EvidencePackV2 | undefined;
  const readiness = evidencePack?.conclusionReadiness;
  const coverage = evidencePack?.coverageSummary;
  const criticalMissing = evidencePack?.criticalMissingEvidence || [];
  const fundEvents = evidencePack?.fund_events;
  const eventRows = fundEvents?.events || [];
  const exportDisabled = reportQ.isLoading || reportQ.data?.dataStatus === "missing" || readiness?.status === "insufficient_data";

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
          peerRisk={detail.peerRiskQ.data}
          performance={(detail.fund as any)?.performance}
        />
      </ReportSection>

      <ReportSection id="gaps" title="已知数据缺口">
        <DataGapsPanel items={detail.coverage.items} />
      </ReportSection>

      <ReportSection id="evidence-readiness" title="Evidence readiness">
        <div className="grid gap-3 text-xs text-white/60 md:grid-cols-3">
          <ReadinessMetric
            label="Readiness"
            value={readiness?.status || (reportQ.isLoading ? "loading" : reportQ.isError ? "missing" : "unknown")}
            tone={readiness?.status === "ready" ? "good" : readiness?.status === "insufficient_data" ? "bad" : "warn"}
          />
          <ReadinessMetric
            label="Coverage"
            value={typeof coverage?.coverage === "number" ? `${Math.round(coverage.coverage * 100)}%` : "unknown"}
            tone={(coverage?.coverage || 0) >= 0.9 ? "good" : (coverage?.coverage || 0) > 0 ? "warn" : "bad"}
          />
          <ReadinessMetric
            label="Critical gaps"
            value={String(readiness?.missingCriticalCount ?? criticalMissing.length)}
            tone={criticalMissing.length === 0 ? "good" : criticalMissing.some((item) => item.blocking) ? "bad" : "warn"}
          />
        </div>
        {readiness?.reason && (
          <p className="mt-3 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/55">
            {readiness.reason}
          </p>
        )}
        {criticalMissing.length > 0 && (
          <div className="mt-3 space-y-2">
            {criticalMissing.slice(0, 4).map((item) => (
              <div key={`${item.category}-${item.status}`} className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium text-white/75">{item.label || item.category}</span>
                  <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] uppercase text-white/45">
                    {item.status}
                  </span>
                  {item.blocking && (
                    <span className="rounded border border-red-400/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] uppercase text-red-200">
                      blocking
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-white/45">{item.missingReason}</p>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium text-white/70">Fund events</span>
            <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] uppercase text-white/45">
              {fundEvents?.dataStatus || fundEvents?.status || "unknown"}
            </span>
          </div>
          {eventRows.length > 0 ? (
            <div className="space-y-2">
              {eventRows.slice(0, 4).map((event) => (
                <div key={`${event.published_at}-${event.title}`} className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-white/65">
                    <span>{event.published_at || "no date"}</span>
                    <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] uppercase text-white/40">
                      {event.event_type || "event"}
                    </span>
                    <span className="text-white/45">{event.source}</span>
                  </div>
                  <div className="mt-1 text-sm text-white/75">{event.title}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-white/45">
              {fundEvents?.missingReason || fundEvents?.data_quality?.missing_reason || "No fund events available."}
            </p>
          )}
        </div>
      </ReportSection>

      <ReportSection id="report-export" title="Research report export">
        <div className="flex flex-wrap items-center gap-2">
          <ExportLink code={detail.code} format="md" label="Markdown" disabled={exportDisabled} />
          <ExportLink code={detail.code} format="docx" label="Word" disabled={exportDisabled} />
          <ExportLink code={detail.code} format="pdf" label="PDF" disabled={exportDisabled} />
          {exportDisabled && (
            <span className="text-xs text-white/40">
              Report export is disabled until backend evidence is usable.
            </span>
          )}
        </div>
      </ReportSection>
    </div>
  );
}

type EvidencePackV2 = {
  conclusionReadiness?: {
    status?: string;
    conclusionStrength?: string;
    missingCriticalCount?: number;
    blockingMissingCount?: number;
    reason?: string | null;
  };
  coverageSummary?: {
    status?: string;
    coverage?: number;
    availableFields?: number;
    partialFields?: number;
    missingFields?: number;
    totalFields?: number;
  };
  criticalMissingEvidence?: Array<{
    category?: string;
    label?: string;
    status?: string;
    blocking?: boolean;
    missingReason?: string;
  }>;
  fund_events?: {
    status?: string;
    dataStatus?: string;
    missingReason?: string | null;
    data_quality?: { missing_reason?: string | null };
    events?: Array<{
      title?: string;
      url?: string;
      source?: string;
      published_at?: string;
      event_type?: string;
      summary?: string;
    }>;
  };
};

function ReadinessMetric({ label, value, tone }: { label: string; value: string; tone: "good" | "warn" | "bad" }) {
  const toneClass =
    tone === "good"
      ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-100"
      : tone === "bad"
        ? "border-red-400/25 bg-red-500/10 text-red-100"
        : "border-amber-400/25 bg-amber-500/10 text-amber-100";
  return (
    <div className={`rounded-md border px-3 py-2 ${toneClass}`}>
      <div className="text-[10px] uppercase tracking-normal opacity-70">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

function ExportLink({ code, format, label, disabled }: { code: string; format: "md" | "docx" | "pdf"; label: string; disabled?: boolean }) {
  const href = `/fund/api/fund/${encodeURIComponent(code)}/research-report?format=${format}`;
  if (disabled) {
    return (
      <button
        type="button"
        disabled
        className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 text-sm text-white/25"
      >
        {format === "md" ? <FileText className="h-4 w-4" /> : <Download className="h-4 w-4" />}
        {label}
      </button>
    );
  }
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
