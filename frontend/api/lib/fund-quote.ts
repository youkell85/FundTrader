import { getFundSnapshot } from "./fundtrader-client";

export type FundQuote = {
  code: string;
  name: string;
  type?: string;
  company?: string;
  manager?: string;
  totalScale?: number;
  feeManage?: number;
  feeCustody?: number;
  nav?: number;
  accumNav?: number;
  navDate?: string;
  dayGrowth?: number;
  dataQuality?: string;
  staleLevel?: string;
  updatedAt?: string;
};

type CacheEntry = {
  expiresAt: number;
  quote: FundQuote | null;
};

const quoteCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000;

export function isExchangeFundCode(code: string): boolean {
  return /^(5\d{5}|508\d{3}|15\d{4}|16\d{4}|18\d{4})$/.test(code);
}

function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const num = Number(String(value).replace("%", ""));
  return Number.isFinite(num) ? num : undefined;
}

export async function fetchFundQuote(code: string): Promise<FundQuote | null> {
  if (!/^\d{6}$/.test(code)) return null;

  const cached = quoteCache.get(code);
  if (cached && cached.expiresAt > Date.now()) return cached.quote;

  try {
    const snapshot = await getFundSnapshot(code, true);
    if (!snapshot || snapshot.data_quality === "missing") {
      quoteCache.set(code, { expiresAt: Date.now() + 60 * 1000, quote: null });
      return null;
    }

    const quote: FundQuote = {
      code,
      name: String(snapshot.name || code),
      type: snapshot.type ? String(snapshot.type) : undefined,
      company: snapshot.company ? String(snapshot.company) : undefined,
      totalScale: toNumber(snapshot.total_scale),
      feeManage: toNumber(snapshot.feeManage),
      feeCustody: toNumber(snapshot.feeCustody),
      nav: toNumber(snapshot.nav),
      accumNav: toNumber(snapshot.accum_nav),
      navDate: snapshot.nav_date ? String(snapshot.nav_date) : undefined,
      dayGrowth: toNumber(snapshot.day_growth),
      dataQuality: snapshot.data_quality ? String(snapshot.data_quality) : undefined,
      staleLevel: snapshot.stale_level ? String(snapshot.stale_level) : undefined,
      updatedAt: snapshot.updated_at ? String(snapshot.updated_at) : undefined,
    };
    quoteCache.set(code, { expiresAt: Date.now() + CACHE_TTL_MS, quote });
    return quote;
  } catch {
    quoteCache.set(code, { expiresAt: Date.now() + 60 * 1000, quote: null });
    return null;
  }
}
