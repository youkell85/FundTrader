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

function healthLabel(value: string | undefined | null) {
  if (value === "healthy") return "健康";
  if (value === "degraded") return "降级";
  if (value === "unhealthy") return "异常";
  return "未知";
}

function okLabel(value: boolean | undefined | null) {
  return value ? "正常" : "不可用";
}

function formatQuotaNote(note: string) {
  return note
    .replace("1m/5m/15m/30m/60m", "1/5/15/30/60 分钟线")
    .replace("period.normalize sample=1d", "周期规范化示例：日线")
    .replace(/(\d+)\s*symbols?/gi, "$1 个标的")
    .replace(/(\d+)\/min/g, "$1 次/分钟")
    .replace("up to", "最多")
    .replace("bars/interval", "条/周期")
    .replace("Daily/weekly/monthly/quarterly/yearly", "日线/周线/月线/季线/年线")
    .replace("calendar days", "个自然日")
    .replace("period.normalize sample", "周期规范化示例");
}

function formatQuotaValue(value: unknown) {
  if (value == null) return "暂无";
  return String(value)
    .replace(/(\d+)\s*symbols?/gi, "$1 个标的")
    .replace(/(\d+)\/min/g, "$1 次/分钟");
}

function ProviderList({ providers }: { providers: DataSourceProviderStatus[] }) {
  if (!providers.length) {
    return <p className="text-xs text-white/50">暂无供应商状态。</p>;
  }
  return (
    <div className="space-y-1.5">
      {providers.map((p) => (
        <div key={p.name} className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-2 min-w-0">
            <Dot active={!!p.available} />
            <span className="text-white/70">{p.name}</span>
            <span className="text-white/40">优先级 {p.priority}</span>
          </span>
          <span className="text-white/40 truncate max-w-[180px]" title={p.last_error || ""}>
            {p.used ? "使用中" : "备用"}
            {p.fallback_reason ? ` / ${p.fallback_reason}` : ""}
            {p.last_error && ` / ${p.last_error}`}
          </span>
        </div>
      ))}
    </div>
  );
}

function QuotaList({ quotas }: { quotas: Record<string, any> | undefined }) {
  if (!quotas) return <p className="text-xs text-white/50">暂无额度信息。</p>;
  const free = quotas.tickflow_free || {};
  const paid = quotas.tickflow_paid || {};
  const notes = quotas.quota_notes || [];

  return (
    <div className="space-y-2 text-xs">
      <div>
        <p className="text-white/50 mb-1">TickFlow 付费版</p>
        <div className="grid grid-cols-2 gap-1.5 text-[11px] text-white/70">
          <span>实时行情：{formatQuotaValue(paid.realtime_quotes?.limit)}</span>
          <span>日/周/月/季/年 K 线：{formatQuotaValue(paid.historical_kline_1d_week_month?.limit)}</span>
          <span>批量 K 线：{formatQuotaValue(paid.batch_klines?.limit)} · {formatQuotaValue(paid.batch_klines?.symbols)}</span>
          <span>分钟线：{formatQuotaValue(paid.minute_bars?.limit)} · {paid.minute_bars?.max_points} 条</span>
          <span>市场深度：{formatQuotaValue(paid.market_depth?.limit)}</span>
          <span>复权因子：{formatQuotaValue(paid.adjustment_factors?.limit)}</span>
        </div>
      </div>
      <div>
        <p className="text-white/50 mb-1">TickFlow 免费版</p>
        <span className="text-[11px] text-white/70">
          历史 K 线：{formatQuotaValue(free.historical_klines?.limit)}
        </span>
      </div>
      <div>
        <p className="text-white/50">说明</p>
        <ul className="mt-1 list-disc list-inside space-y-0.5 text-white/60">
          {notes.map((n: string) => (
            <li key={n}>{formatQuotaNote(n)}</li>
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
      title: "服务健康",
      note: status ? `状态：${healthLabel(status.service?.health)} · 最近刷新：${status.timestamp}` : "未就绪",
      tone: status?.service?.health === "healthy" ? "ok" : status ? "warn" : "bad",
      children: (
        <div className="text-xs text-white/65">
          <p>宏观数据：{okLabel(status?.service?.macro_available)}</p>
          <p>滚动统计：{okLabel(status?.service?.rolling_stats_available)}</p>
          <p>波动率：{status?.service?.vol_ratio != null ? "正常" : "不可用"}</p>
          <p>过期资产：{staleAssets.length}</p>
        </div>
      ),
    },
    {
      title: "缓存快照",
      note: cacheItem
        ? "缓存记录已返回"
        : "未就绪",
      tone: cacheItem && cacheItem.has_snapshot ? "ok" : cacheItem ? "warn" : "bad",
      children: (
        <div className="text-xs text-white/65">
          {cacheItem ? (
            <>
              <p>存在：{cacheItem.has_snapshot ? "是" : "否"}</p>
              <p>年龄：{cacheItem.age_seconds != null ? `${cacheItem.age_seconds.toFixed(0)}秒` : "暂无"}</p>
              <p>有效期：{cacheItem.ttl_seconds != null ? `${cacheItem.ttl_seconds}秒` : "暂无"}</p>
            </>
          ) : (
            <p>等待中</p>
          )}
        </div>
      ),
    },
    {
      title: "推送通道",
      note: streamSupported ? "实时推送已启用" : "实时推送不可用",
      tone: streamSupported ? "ok" : "warn",
      children: <p className="text-xs text-white/65">保留 60 秒一次的轮询兜底，用于市场数据源状态。</p>,
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
          <h4 className="text-sm font-medium mb-2">数据供应商</h4>
          <ProviderList providers={status?.providers || []} />
        </div>
        <div className="rounded-lg border border-white/[0.12] bg-white/[0.02] p-4">
          <h4 className="text-sm font-medium mb-2">额度</h4>
          <QuotaList quotas={sourceConfig?.quotas} />
        </div>
      </div>
    </section>
  );
}
