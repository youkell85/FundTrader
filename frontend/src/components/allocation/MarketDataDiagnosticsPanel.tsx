import type {
  DataSourceHealthSnapshot,
  DataSourceProviderStatus,
  MarketDataSourcesStatus,
} from "@/types/allocation";
import type { ReactNode } from "react";

type HealthEntry = {
  title: string;
  note: string;
  tone: "ok" | "warn" | "bad";
  children?: ReactNode;
};

type Props = {
  health: DataSourceHealthSnapshot | null;
  dataSourceStatus: MarketDataSourcesStatus | null;
};

function toneClass(tone: HealthEntry["tone"]) {
  if (tone === "ok") return "text-[#16C784] border-[#16C784]/30 bg-[#16C784]/[0.08]";
  if (tone === "warn") return "text-[#FAC858] border-[#FAC858]/30 bg-[#FAC858]/[0.08]";
  return "text-[#EE6666] border-[#EE6666]/30 bg-[#EE6666]/[0.08]";
}

function Dot({ active }: { active: boolean }) {
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${active ? "bg-[#16C784]" : "bg-[#EE6666]"}`} />;
}

function ProviderList({ providers }: { providers: DataSourceProviderStatus[] }) {
  if (!providers.length) {
    return <p className="text-xs text-white/50">No provider status yet.</p>;
  }
  return (
    <div className="space-y-1.5">
      {providers.map((p) => (
        <div key={p.name} className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-2 min-w-0">
            <Dot active={!!p.available} />
            <span className="text-white/70">{p.name}</span>
            <span className="text-white/40">p{p.priority}</span>
          </span>
          <span className="text-white/40 truncate max-w-[180px]" title={p.last_error || ""}>
            {p.used ? "used" : "standby"}
            {p.fallback_reason ? ` / ${p.fallback_reason}` : ""}
            {p.last_error && ` / ${p.last_error}`}
          </span>
        </div>
      ))}
    </div>
  );
}

function QuotaList({ quotas }: { quotas: Record<string, any> | undefined }) {
  if (!quotas) return <p className="text-xs text-white/50">No quota info.</p>;
  const free = quotas.tickflow_free || {};
  const paid = quotas.tickflow_paid || {};
  const notes = quotas.quota_notes || [];

  return (
    <div className="space-y-2 text-xs">
      <div>
        <p className="text-white/50 mb-1">TickFlow Paid</p>
        <div className="grid grid-cols-2 gap-1.5 text-[11px] text-white/70">
          <span>Realtime quotes: {paid.realtime_quotes?.limit}</span>
          <span>Daily/W/M/Q/Y bars: {paid.historical_kline_1d_week_month?.limit}</span>
          <span>Batch Kline: {paid.batch_klines?.limit} · {paid.batch_klines?.symbols}</span>
          <span>Minute bars: {paid.minute_bars?.limit} · {paid.minute_bars?.max_points}</span>
          <span>Market depth: {paid.market_depth?.limit}</span>
          <span>Adjust factors: {paid.adjustment_factors?.limit}</span>
        </div>
      </div>
      <div>
        <p className="text-white/50 mb-1">TickFlow Free</p>
        <span className="text-[11px] text-white/70">
          Historical Kline: {free.historical_klines?.limit}
        </span>
      </div>
      <div>
        <p className="text-white/50">Notes</p>
        <ul className="mt-1 list-disc list-inside space-y-0.5 text-white/60">
          {notes.map((n: string) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function MarketDataDiagnosticsPanel({ health, dataSourceStatus }: Props) {
  const status = health;
  const sourceConfig = dataSourceStatus;

  const cacheItem = status?.cache;
  const streamSupported = status?.stream_supported ?? false;
  const staleAssets = status?.stale_assets || [];

  const cards: HealthEntry[] = [
    {
      title: "Service Health",
      note: status ? `status=${status.service?.health || "unknown"} · last_refresh=${status.timestamp}` : "not ready",
      tone: status?.service?.health === "healthy" ? "ok" : status ? "warn" : "bad",
      children: (
        <div className="text-xs text-white/65">
          <p>macro={status?.service?.macro_available ? "ok" : "no"}</p>
          <p>rolling={status?.service?.rolling_stats_available ? "ok" : "no"}</p>
          <p>vol={status?.service?.vol_ratio != null ? "ok" : "no"}</p>
          <p>stale_assets={staleAssets.length}</p>
        </div>
      ),
    },
    {
      title: "Cache Snapshot",
      note: cacheItem
        ? `key=${cacheItem.snapshot_cache_key}`
        : "not ready",
      tone: cacheItem && cacheItem.has_snapshot ? "ok" : cacheItem ? "warn" : "bad",
      children: (
        <div className="text-xs text-white/65">
          {cacheItem ? (
            <>
              <p>exists: {cacheItem.has_snapshot ? "yes" : "no"}</p>
              <p>age: {cacheItem.age_seconds != null ? `${cacheItem.age_seconds.toFixed(0)}s` : "n/a"}</p>
              <p>ttl: {cacheItem.ttl_seconds != null ? `${cacheItem.ttl_seconds}s` : "n/a"}</p>
            </>
          ) : (
            <p>waiting</p>
          )}
        </div>
      ),
    },
    {
      title: "Stream Channel",
      note: streamSupported ? "WebSocket enabled" : "WebSocket unavailable",
      tone: streamSupported ? "ok" : "warn",
      children: <p className="text-xs text-white/65">Fallback polling every 60s is kept for /market-data/source-status.</p>,
    },
  ];

  return (
    <section className="space-y-4 mt-4">
      <div className="grid gap-3 md:grid-cols-3">
        {cards.map((c) => (
          <div key={c.title} className={`rounded-lg border px-4 py-3 ${toneClass(c.tone)}`}>
            <div className="text-sm font-medium">{c.title}</div>
            <p className="mt-1 text-[11px] opacity-90">{c.note}</p>
            {c.children && <div className="mt-2">{c.children}</div>}
          </div>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-white/[0.12] bg-white/[0.02] p-4">
          <h4 className="text-sm font-medium mb-2">Providers</h4>
          <ProviderList providers={status?.providers || []} />
        </div>
        <div className="rounded-lg border border-white/[0.12] bg-white/[0.02] p-4">
          <h4 className="text-sm font-medium mb-2">Quotas</h4>
          <QuotaList quotas={sourceConfig?.quotas} />
        </div>
      </div>
    </section>
  );
}
