export type PeerPerformanceInput = Record<string, unknown>;

export type PeerPerformanceRow = {
  key: string;
  label: string;
  value: number | null;
  peerAverage: number | null;
  rank: number | null;
  total: number;
  percentile: number | null;
};

const PERIODS = [
  { key: "return1w", label: "近1周", aliases: ["near_1w", "return1w", "近1周"] },
  { key: "return1m", label: "近1个月", aliases: ["near_1m", "return1m", "近1月", "近1个月"] },
  { key: "return3m", label: "近3个月", aliases: ["near_3m", "return3m", "近3月", "近3个月"] },
  { key: "return6m", label: "近6个月", aliases: ["near_6m", "return6m", "近6月", "近6个月"] },
  { key: "return1y", label: "近1年", aliases: ["near_1y", "return1y", "近1年"] },
] as const;

function metricNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "" || value === "—" || value === "暂无") return null;
  const num = parseFloat(String(value).replace("%", ""));
  return Number.isFinite(num) ? num : null;
}

function pickMetric(item: PeerPerformanceInput, aliases: readonly string[]): number | null {
  for (const key of aliases) {
    const value = metricNumber(item[key]);
    if (value !== null) return value;
  }
  return null;
}

function normalizeType(value: unknown): string {
  return String(value || "").replace(/\s/g, "").toLowerCase();
}

function getPeerType(item: PeerPerformanceInput): string {
  const rawType = item.type ?? item.category ?? item["类型"] ?? item["基金类型"];
  return normalizeType(rawType || item.mappedType || item.fundType);
}

function round(value: number, digits = 2) {
  return Number(value.toFixed(digits));
}

export function buildPeerPerformanceRows(
  target: PeerPerformanceInput,
  allFunds: PeerPerformanceInput[]
): PeerPerformanceRow[] {
  const targetType = getPeerType(target);
  const peers = allFunds.filter((fund) => {
    const code = String(fund.code || fund.fundCode || "");
    return Boolean(targetType) && getPeerType(fund) === targetType && code !== "";
  });

  return PERIODS.map((period) => {
    const value = pickMetric(target, period.aliases);
    const values = peers
      .map((fund) => pickMetric(fund, period.aliases))
      .filter((item): item is number => item !== null);
    const total = values.length;
    const peerAverage = total > 0 ? round(values.reduce((sum, item) => sum + item, 0) / total) : null;
    const rank = value === null || total === 0 ? null : values.filter((item) => item > value).length + 1;
    const percentile = rank === null || total === 0 ? null : round((rank / total) * 100);

    return {
      key: period.key,
      label: period.label,
      value,
      peerAverage,
      rank,
      total,
      percentile,
    };
  });
}
