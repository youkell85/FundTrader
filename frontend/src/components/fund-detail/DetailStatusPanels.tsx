import { Panel } from "@/components/report/Panel";
import { num } from "@/lib/fund-data";
import {
  STATUS_LABELS,
  STATUS_TONES,
  type CoverageEntry,
  type DetailDataStatus,
} from "@/lib/detail-status";
import type { CoverageSummary as CoverageSummaryType } from "./types";

type Signal = {
  text: string;
  tone: string;
};

function statusTone(status: DetailDataStatus): string {
  return STATUS_TONES[status] || STATUS_TONES.missing;
}

function statusLabel(status: DetailDataStatus): string {
  return STATUS_LABELS[status] || status;
}

function isGapStatus(status: DetailDataStatus): boolean {
  return status === "missing" || status === "error" || status === "partial" || status === "stale";
}

type SourceCoverageSummary = {
  fieldCoverage: number | null;
  totalFields: number;
  availableFields: number;
  partialFields: number;
  missingFields: number;
  topSources: Array<{ source: string; count: number; available: number; partial: number; missing: number }>;
  problemFields: Array<{
    field: string;
    status: DetailDataStatus;
    source?: string | null;
    missingReason?: string | null;
    asOf?: string | null;
    coverage?: number | null;
  }>;
  providers: Array<{
    name?: string;
    status?: string | null;
    available?: boolean;
    capabilities?: string[];
    lastError?: string | null;
    last_error?: string | null;
    cooldownUntil?: string | null;
    cooldown_until?: string | null;
    failureCount?: number | null;
    failure_count?: number | null;
    circuitOpen?: boolean | null;
    circuit_open?: boolean | null;
  }>;
  providerStatus: string;
  availableProviders: number;
  totalProviders: number;
  updatedAt?: string | null;
  loading: boolean;
  error: boolean;
};

function pctLabel(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  const normalized = value <= 1 ? value * 100 : value;
  return `${Math.round(normalized)}%`;
}

function providerTone(provider: SourceCoverageSummary["providers"][number]): string {
  const status = String(provider.status || "").toLowerCase();
  if (provider.available || status === "available" || status === "healthy") {
    return "text-[#16C784] border-[#16C784]/30 bg-[#16C784]/5";
  }
  if (status === "partial" || status === "degraded" || status === "cooldown" || status === "stale") {
    return "text-[#FFB800] border-[#FFB800]/30 bg-[#FFB800]/5";
  }
  return "text-white/45 border-white/10 bg-white/[0.02]";
}

function providerNote(provider: SourceCoverageSummary["providers"][number]): string {
  const parts = [provider.status || (provider.available ? "available" : "missing")];
  const failureCount = provider.failureCount ?? provider.failure_count;
  const cooldownUntil = provider.cooldownUntil || provider.cooldown_until;
  const lastError = provider.lastError || provider.last_error;
  if (failureCount) parts.push(`fail=${failureCount}`);
  if (provider.circuitOpen || provider.circuit_open) parts.push("circuit=open");
  if (cooldownUntil) parts.push(`cooldown=${cooldownUntil}`);
  if (lastError) parts.push(lastError);
  return parts.join(" / ");
}

export function DecisionSnapshot({
  fund,
  risk,
  coverage,
  peerReturn1y,
  onNavigateSection,
}: {
  fund: any;
  risk: { maxDrawdown: number | null };
  coverage: CoverageSummaryType;
  peerReturn1y?: number | null;
  onNavigateSection?: (sectionId: string) => void;
}) {
  const perf = fund.performance || {};
  const return1y = num(perf.return1y);
  const return3y = num(perf.return3y);
  const totalScale = num(fund.totalScale);
  const peerReturn1yValue = peerReturn1y ?? null;

  const perfSignal: Signal | null =
    return1y === null && return3y === null
      ? null
      : return1y !== null && return1y > 0
        ? { text: "1Y positive", tone: "text-[#16C784]" }
        : return3y !== null && return3y > 0
          ? { text: "3Y positive", tone: "text-[#16C784]" }
          : { text: "Recent return negative", tone: "text-[#F5384B]" };

  const riskSignal: Signal | null =
    risk.maxDrawdown === null
      ? null
      : risk.maxDrawdown < -30
        ? { text: "Large drawdown", tone: "text-[#F5384B]" }
        : risk.maxDrawdown < -15
          ? { text: "Medium drawdown", tone: "text-[#FFB800]" }
          : { text: "Drawdown controlled", tone: "text-[#16C784]" };

  const peerSignal: Signal | null =
    return1y === null || peerReturn1yValue === null
      ? null
      : return1y > peerReturn1yValue
        ? { text: "Ahead of peer", tone: "text-[#16C784]" }
        : return1y < peerReturn1yValue
          ? { text: "Behind peer", tone: "text-[#E9AB60]" }
          : { text: "In line with peer", tone: "text-white/65" };

  const scaleSignal: Signal | null =
    totalScale === null
      ? null
      : totalScale > 50
        ? { text: `Scale ${totalScale.toFixed(0)}B`, tone: "text-white/65" }
        : totalScale > 5
          ? { text: `Scale ${totalScale.toFixed(0)}B`, tone: "text-white/65" }
          : { text: `Scale ${totalScale.toFixed(1)}B small`, tone: "text-[#E9AB60]" };

  const dataBad = coverage.missing + coverage.error + coverage.partial + coverage.stale;
  const dataSignal: Signal =
    dataBad === 0
      ? { text: "Data complete", tone: "text-[#16C784]" }
      : dataBad <= 3
        ? { text: `${dataBad} items need attention`, tone: "text-[#FFB800]" }
        : { text: `${dataBad} items need attention`, tone: "text-[#E9AB60]" };

  const nextSection =
    dataBad > 0
      ? { id: "gaps", label: "Review data gaps" }
      : return1y === null
        ? { id: "perf", label: "Review performance" }
        : { id: "peer", label: "Review peer comparison" };

  return (
    <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
      <SnapshotMetric label="Performance" signal={perfSignal} />
      <SnapshotMetric label="Peer" signal={peerSignal} />
      <SnapshotMetric label="Risk" signal={riskSignal} />
      <SnapshotMetric label="Scale" signal={scaleSignal} />
      <SnapshotMetric label="Data health" signal={dataSignal} />
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px] text-white/40">Next</span>
        {onNavigateSection ? (
          <button
            type="button"
            onClick={() => onNavigateSection(nextSection.id)}
            className="w-fit bg-transparent p-0 text-left font-semibold text-[#5AA9FF] hover:underline"
          >
            {nextSection.label}
          </button>
        ) : (
          <a href={`#${nextSection.id}`} className="font-semibold text-[#5AA9FF] hover:underline">
            {nextSection.label}
          </a>
        )}
      </div>
    </div>
  );
}

function SnapshotMetric({ label, signal }: { label: string; signal: Signal | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-white/40">{label}</span>
      {signal ? (
        <span className={`font-semibold ${signal.tone}`}>{signal.text}</span>
      ) : (
        <span className="text-white/25">No data</span>
      )}
    </div>
  );
}

export function MarketContextPanel({ context }: { context: any }) {
  const sections = context?.sections || {};
  const rows = [
    { key: "etfKline", label: "ETF K-line", ...sections.etfKline },
    { key: "northFlow", label: "Northbound flow", ...sections.northFlow },
    { key: "sectorFlow", label: "Sector flow", ...sections.sectorFlow },
    { key: "holdingsFlowMatch", label: "Holdings-flow match", ...sections.holdingsFlowMatch },
    { key: "holdingsStyle", label: "Holding style", ...sections.holdingsStyle },
  ];

  return (
    <Panel
      title="Market context"
      extra={
        <span className="text-xs text-muted-foreground">
          Coverage {context?.coverage != null ? `${Math.round(Number(context.coverage) * 100)}%` : "-"}
        </span>
      }
    >
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {rows.map((row) => {
          const status = (row.status || row.dataStatus || "missing") as DetailDataStatus;
          const topIndustries = Array.isArray(row.data?.topIndustries) ? row.data.topIndustries : [];
          const matchedFlowRows = Array.isArray(row.data?.matchedFlowRows) ? row.data.matchedFlowRows : [];
          const signalDirection = row.data?.signalDirection;
          const matchScore = row.data?.matchScore;
          return (
            <div key={row.key} className="rounded-md border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium text-white/80">{row.label}</div>
                <span className={`rounded border px-2 py-0.5 text-xs ${statusTone(status)}`}>
                  {statusLabel(status)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>Source {row.source || "-"}</span>
                <span>Date {row.asOf || context?.asOf || "-"}</span>
                {signalDirection ? <span>Signal {signalDirection}</span> : null}
                {matchScore != null ? <span>Match {pctLabel(Number(matchScore))}</span> : null}
              </div>
              {matchedFlowRows.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {matchedFlowRows.slice(0, 4).map((item: any) => (
                    <span
                      key={`${row.key}-flow-${item.industry}`}
                      className="rounded border border-white/[0.08] px-2 py-0.5 text-xs text-white/55"
                    >
                      {item.industry} {item.trend || "unknown"}
                    </span>
                  ))}
                </div>
              ) : null}
              {topIndustries.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {topIndustries.slice(0, 4).map((item: any) => (
                    <span
                      key={`${row.key}-${item.industry}`}
                      className="rounded border border-white/[0.08] px-2 py-0.5 text-xs text-white/55"
                    >
                      {item.industry} {item.weight != null ? `${Number(item.weight).toFixed(2)}%` : ""}
                    </span>
                  ))}
                </div>
              ) : null}
              {row.missingReason ? <div className="mt-2 text-xs text-white/35">{row.missingReason}</div> : null}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

export function SourceCoveragePanel({ summary }: { summary: SourceCoverageSummary }) {
  if (!summary) return null;
  const hasFields = summary.totalFields > 0;
  const hasProviders = summary.totalProviders > 0;
  const healthStatus: DetailDataStatus = summary.error
    ? "error"
    : summary.loading && !hasFields && !hasProviders
      ? "pending"
      : summary.missingFields > 0
        ? "partial"
        : "available";
  const nextOpsAction =
    summary.missingFields > 0
      ? "Backfill missing fields first"
      : summary.partialFields > 0
        ? "Review partial field sources"
        : summary.availableProviders < summary.totalProviders
          ? "Check provider health"
          : "Monitor daily smoke";

  return (
    <Panel
      title="Operations coverage"
      extra={<span className={`rounded border px-2 py-0.5 text-xs ${statusTone(healthStatus)}`}>{statusLabel(healthStatus)}</span>}
    >
      <div className="grid grid-cols-1 gap-2 text-sm">
        <div className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2">
          <div className="text-[11px] text-white/40">Fields</div>
          <div className="mt-1 data-number text-lg font-semibold text-white/85">
            {hasFields ? `${summary.availableFields}/${summary.totalFields}` : "-"}
          </div>
          <div className="mt-0.5 text-xs text-white/45">
            coverage {pctLabel(summary.fieldCoverage)}
          </div>
        </div>
        <div className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2">
          <div className="text-[11px] text-white/40">Providers</div>
          <div className="mt-1 data-number text-lg font-semibold text-white/85">
            {hasProviders ? `${summary.availableProviders}/${summary.totalProviders}` : "-"}
          </div>
          <div className="mt-0.5 truncate text-xs text-white/45" title={summary.updatedAt || undefined}>
            {summary.providerStatus || "unknown"}
          </div>
        </div>
        <div className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2">
          <div className="text-[11px] text-white/40">Next</div>
          <div className="mt-1 text-sm font-semibold text-white/80">{nextOpsAction}</div>
          <div className="mt-0.5 text-xs text-white/45">
            {summary.partialFields} partial / {summary.missingFields} missing
          </div>
        </div>
      </div>

      {summary.topSources.length > 0 ? (
        <div className="mt-3">
          <div className="mb-1.5 text-[11px] text-white/40">Top field sources</div>
          <div className="flex flex-wrap gap-1.5">
            {summary.topSources.map((source) => (
              <span key={source.source} className="rounded border border-white/[0.08] bg-white/[0.02] px-2 py-1 text-[11px] text-white/60">
                {source.source} <span className="data-number text-white/80">{source.available}/{source.count}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {summary.providers.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          <div className="text-[11px] text-white/40">Provider health</div>
          {summary.providers.map((provider) => (
            <div key={provider.name || providerNote(provider)} className={`rounded border px-2.5 py-1.5 text-xs ${providerTone(provider)}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{provider.name || "unknown"}</span>
                <span className="shrink-0">{provider.available ? "available" : provider.status || "missing"}</span>
              </div>
              <div className="mt-1 truncate opacity-65" title={providerNote(provider)}>
                {(provider.capabilities || []).slice(0, 3).join(", ") || providerNote(provider)}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {summary.problemFields.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          <div className="text-[11px] text-white/40">Field gaps</div>
          {summary.problemFields.map((field) => (
            <div key={field.field} className={`rounded border px-2.5 py-1.5 text-xs ${statusTone(field.status)}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{field.field}</span>
                <span className="shrink-0">{statusLabel(field.status)}</span>
              </div>
              <div className="mt-1 truncate opacity-65" title={field.missingReason || field.source || undefined}>
                {field.source || "unattributed"}{field.missingReason ? ` / ${field.missingReason}` : ""}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}

export function DataGapsPanel({ items }: { items: CoverageEntry[] }) {
  const gaps = items.filter((it) => isGapStatus(it.status));
  if (gaps.length === 0) {
    return (
      <div className="rounded-md border border-[#16C784]/20 bg-[#16C784]/5 px-4 py-3 text-sm text-[#16C784]">
        All required detail data is available.
      </div>
    );
  }

  const severity: Record<string, number> = { error: 0, missing: 1, stale: 2, partial: 3 };
  const sorted = [...gaps].sort((a, b) => (severity[a.status] ?? 9) - (severity[b.status] ?? 9));
  const top = sorted.slice(0, 3);
  const rest = sorted.slice(3);

  return (
    <div className="space-y-2">
      {top.map((it) => (
        <GapRow key={it.key} it={it} />
      ))}
      {rest.length > 0 ? (
        <details className="group">
          <summary className="cursor-pointer select-none text-xs text-white/40 hover:text-white/60">
            Show {rest.length} more gap{rest.length > 1 ? "s" : ""}
          </summary>
          <div className="mt-2 space-y-2">
            {rest.map((it) => (
              <GapRow key={it.key} it={it} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function GapRow({ it }: { it: CoverageEntry }) {
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm ${statusTone(it.status)}`}>
      <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-current opacity-60" />
      <span className="font-medium">{it.label}</span>
      <span className="ml-1 text-[11px] opacity-70">{statusLabel(it.status)}</span>
      {it.source ? <span className="text-[10px] opacity-50">via {it.source}</span> : null}
      {it.reason ? <span className="ml-auto text-xs opacity-60">{it.reason}</span> : null}
    </div>
  );
}

export function CoverageSummary({ summary }: { summary: CoverageSummaryType }) {
  const { items, total, available, partial, stale, missing, pending, error } = summary;
  if (total === 0) return null;

  const order: DetailDataStatus[] = ["available", "partial", "stale", "pending", "missing", "error"];
  const counts: Record<string, number> = { available, partial, stale, pending, missing, error };
  const problemItems = items.filter((it) => it.status === "missing" || it.status === "error" || it.status === "partial");

  return (
    <section className="relative mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-white/[0.04] bg-white/[0.01] px-3 py-1.5 text-xs">
      <span className="text-white/50">Data coverage</span>
      <div className="flex flex-wrap gap-1.5">
        {order.map((status) => {
          const count = counts[status] || 0;
          if (count === 0) return null;
          return (
            <span
              key={status}
              className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${statusTone(status)}`}
            >
              <span className="data-number font-semibold">{count}</span>
              <span>{statusLabel(status)}</span>
            </span>
          );
        })}
      </div>
      <details className="group ml-auto">
        <summary className="cursor-pointer select-none text-[10px] text-white/35 hover:text-white/55">
          Details
        </summary>
        <div className="absolute right-0 z-20 mt-2 w-72 rounded-lg border border-white/[0.08] bg-[#0A0E1A] p-3 shadow-xl">
          <div className="grid grid-cols-1 gap-y-1.5">
            {items.map((it) => (
              <div key={it.key} className="flex min-w-0 items-center gap-2 text-xs" title={it.reason || it.label}>
                <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dotClass(it.status)}`} />
                <span className="truncate text-white/65">{it.label}</span>
                <span className={`ml-auto shrink-0 text-[10px] ${statusTone(it.status).split(" ")[0]}`}>
                  {statusLabel(it.status)}
                </span>
              </div>
            ))}
          </div>
          {problemItems.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5 border-t border-white/[0.06] pt-2">
              {problemItems.slice(0, 6).map((it) => (
                <span
                  key={`miss-${it.key}`}
                  className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${statusTone(it.status)}`}
                  title={it.reason || ""}
                >
                  <span className="font-mono">{it.endpoint}</span>
                  <span>{statusLabel(it.status)}</span>
                </span>
              ))}
              {problemItems.length > 6 ? <span className="text-[10px] text-white/40">...</span> : null}
            </div>
          ) : null}
        </div>
      </details>
    </section>
  );
}

function dotClass(status: DetailDataStatus): string {
  if (status === "available") return "bg-[#16C784]";
  if (status === "partial") return "bg-[#FFB800]";
  if (status === "stale") return "bg-[#E9AB60]";
  if (status === "pending") return "bg-[#5AA9FF]";
  if (status === "error") return "bg-[#F5384B]";
  return "bg-white/30";
}
