export type FundQuote = {
  code: string;
  name: string;
  nav?: number;
  accumNav?: number;
  navDate?: string;
  dayGrowth?: number;
};

type CacheEntry = {
  expiresAt: number;
  quote: FundQuote | null;
};

const quoteCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000;

function parseNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const num = Number(String(value).replace("%", ""));
  return Number.isFinite(num) ? num : undefined;
}

function parseEastmoneyJsonp(text: string): any | null {
  const match = text.match(/jsonpgz\((.*)\);?/s);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

export async function fetchFundQuote(code: string): Promise<FundQuote | null> {
  if (!/^\d{6}$/.test(code)) return null;

  const cached = quoteCache.get(code);
  if (cached && cached.expiresAt > Date.now()) return cached.quote;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`http://fundgz.1234567.com.cn/js/${code}.js`, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Referer": "http://fund.eastmoney.com/",
      },
    });
    if (!res.ok) return null;

    const data = parseEastmoneyJsonp(await res.text());
    const name = String(data?.name || "").trim();
    if (!name || name === code) return null;

    const quote: FundQuote = {
      code: String(data?.fundcode || code),
      name,
      nav: parseNumber(data?.dwjz),
      accumNav: parseNumber(data?.ljjz),
      navDate: data?.jzrq ? String(data.jzrq) : undefined,
      dayGrowth: parseNumber(data?.gszzl),
    };
    quoteCache.set(code, { expiresAt: Date.now() + CACHE_TTL_MS, quote });
    return quote;
  } catch {
    quoteCache.set(code, { expiresAt: Date.now() + 60 * 1000, quote: null });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

