import type { RangeKey } from "./constants";

export function filterByRange(
  points: Array<{ d: string; nav: number }>,
  range: RangeKey,
) {
  if (range === "MAX" || points.length === 0) return points;
  const latest = new Date(points[points.length - 1].d).getTime();
  let from = latest;
  const day = 86400000;
  if (range === "1M") from = latest - 31 * day;
  if (range === "3M") from = latest - 92 * day;
  if (range === "6M") from = latest - 183 * day;
  if (range === "1Y") from = latest - 366 * day;
  if (range === "3Y") from = latest - 1096 * day;
  if (range === "5Y") from = latest - 1827 * day;
  if (range === "YTD") from = new Date(`${new Date(latest).getFullYear()}-01-01`).getTime();
  const filtered = points.filter((p) => new Date(p.d).getTime() >= from);
  return filtered.length >= 2 ? filtered : points;
}

// === 风险（基础 1y 窗口，front-end 可算） ===
export function computeRisk(points: Array<{ d: string; nav: number }>) {
  if (points.length < 3) {
    return {
      sharpe: null as number | null,
      sortino: null as number | null,
      maxDrawdown: null as number | null,
      volatility: null as number | null,
      downsideRisk: null as number | null,
      monthWinRate: null as number | null,
      diagnosticScore: null as number | null,
      worstMonth: null as number | null,
      drawdownSeries: [] as Array<{ d: string; dd: number }>,
    };
  }
  const returns: number[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1].nav;
    const cur = points[i].nav;
    if (prev > 0) returns.push((cur - prev) / prev);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  const vol = Math.sqrt(variance) * Math.sqrt(252) * 100;
  let peak = points[0].nav;
  const drawdownSeries = points.map((p) => {
    peak = Math.max(peak, p.nav);
    return { d: p.d, dd: peak > 0 ? ((p.nav - peak) / peak) * 100 : 0 };
  });
  const maxDrawdown = drawdownSeries.reduce((m, x) => Math.min(m, x.dd), 0);
  const rfDaily = 0.02 / 252;
  const sharpe = vol > 0 ? ((mean - rfDaily) * 252) / (vol / 100) : null;
  // Sortino
  const downside = returns.filter((r) => r < 0);
  const dMean = downside.length ? downside.reduce((a, b) => a + b, 0) / downside.length : 0;
  const dVar = downside.length
    ? downside.reduce((a, b) => a + (b - dMean) ** 2, 0) / Math.max(1, downside.length - 1)
    : 0;
  const downsideRisk = Math.sqrt(dVar) * Math.sqrt(252) * 100;
  const sortino = downsideRisk > 0 ? ((mean - rfDaily) * 252) / (downsideRisk / 100) : null;
  // 月胜率
  const monthMap = new Map<string, { first: number; last: number }>();
  for (const p of points) {
    const key = p.d.slice(0, 7);
    const row = monthMap.get(key);
    if (!row) monthMap.set(key, { first: p.nav, last: p.nav });
    else row.last = p.nav;
  }
  const monthReturns = Array.from(monthMap.values())
    .filter((m) => m.first > 0)
    .map((m) => ((m.last - m.first) / m.first) * 100);
  const monthWinRate =
    monthReturns.length > 0
      ? (monthReturns.filter((r) => r > 0).length / monthReturns.length) * 100
      : null;
  const worstMonth = monthReturns.length ? Math.min(...monthReturns) : null;
  // 诊断得分（简化规则：60 + 年化收益*0.6 + 夏普*8 - |回撤|）
  let diagnosticScore: number | null = null;
  if (sharpe !== null) {
    const annRet = mean * 252 * 100;
    diagnosticScore = Math.max(
      1,
      Math.min(99, Math.round(60 + annRet * 0.6 + sharpe * 8 - Math.abs(maxDrawdown))),
    );
  }
  return {
    sharpe,
    sortino,
    maxDrawdown,
    volatility: vol,
    downsideRisk,
    monthWinRate,
    diagnosticScore,
    worstMonth,
    drawdownSeries,
  };
}
