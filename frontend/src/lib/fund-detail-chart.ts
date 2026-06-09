export type NavPoint = { d: string; nav: number };
export type ReturnSeriesPoint = { d: string; value: number };
export type ReturnSeriesResult = { data: ReturnSeriesPoint[]; rangeReturn: number | null };

export function navPointsToReturnSeries(points: NavPoint[]): ReturnSeriesResult {
  if (!points.length) return { data: [], rangeReturn: null };
  const base = points[0].nav;
  const data = points.map((point) => ({
    d: point.d,
    value: base > 0 ? ((point.nav / base) - 1) * 100 : 0,
  }));
  return { data, rangeReturn: data.length ? data[data.length - 1].value : null };
}

export function backendReturnSeries(raw: Array<{ date: string; return: number }> | undefined): ReturnSeriesResult {
  if (!raw?.length) return { data: [], rangeReturn: null };
  const data = raw.map((point) => ({
    d: point.date,
    value: point.return,
  }));
  return { data, rangeReturn: data.length ? data[data.length - 1].value : null };
}

export function resolveFundReturnSeries(
  navPoints: NavPoint[],
  backendSeries: Array<{ date: string; return: number }> | undefined,
): ReturnSeriesResult {
  const fromNav = navPointsToReturnSeries(navPoints);
  return fromNav.data.length > 0 ? fromNav : backendReturnSeries(backendSeries);
}

export function chartDateTick(value: unknown): string {
  const text = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text.slice(5) : text;
}
