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

export function isExchangeFundCode(code: string): boolean {
  return /^5\d{5}$/.test(code) || /^159\d{3}$/.test(code);
}

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

function cleanFundName(value: string) {
  return value
    .replace(/\s*-\s*天天基金网.*$/i, "")
    .replace(/\s*基金档案.*$/i, "")
    .replace(/\s*基金概况.*$/i, "")
    .replace(/\s*\(\d{6}\).*$/, "")
    .trim();
}

function getEastmoneySecid(code: string): string | null {
  if (/^5\d{5}$/.test(code)) return `1.${code}`;
  if (/^159\d{3}$/.test(code)) return `0.${code}`;
  return null;
}

function getTencentSymbol(code: string): string | null {
  if (/^5\d{5}$/.test(code)) return `s_sh${code}`;
  if (/^159\d{3}$/.test(code)) return `s_sz${code}`;
  return null;
}

async function fetchTencentExchangeFundQuote(code: string, signal: AbortSignal): Promise<FundQuote | null> {
  const symbol = getTencentSymbol(code);
  if (!symbol) return null;

  try {
    const res = await fetch(`https://qt.gtimg.cn/q=${symbol}`, {
      signal,
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://finance.qq.com/",
      },
    });
    if (!res.ok) return null;
    const text = await res.text();
    const match = text.match(/="([^"]*)"/);
    if (!match) return null;
    const parts = match[1].split("~");
    if (parts.length < 6 || parts[2] !== code) return null;

    return {
      code,
      name: "",
      nav: parseNumber(parts[3]),
      dayGrowth: parseNumber(parts[5]),
    };
  } catch {
    return null;
  }
}

async function fetchExchangeFundQuote(code: string, signal: AbortSignal): Promise<FundQuote | null> {
  const secid = getEastmoneySecid(code);
  if (!secid) return null;

  const tencentQuote = await fetchTencentExchangeFundQuote(code, signal);
  if (tencentQuote?.dayGrowth !== undefined || tencentQuote?.nav !== undefined) {
    return tencentQuote;
  }

  try {
    const res = await fetch(
      `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f57,f58,f60,f170,f86`,
      {
        signal,
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Referer": "https://quote.eastmoney.com/",
        },
      }
    );
    if (!res.ok) return null;
    const data = await res.json() as { data?: Record<string, unknown> };
    const quote = data?.data;
    if (!quote || String(quote.f57 || "") !== code) return null;

    const price = parseNumber(quote.f43);
    const dayGrowthRaw = parseNumber(quote.f170);
    const timestamp = parseNumber(quote.f86);
    const navDate = timestamp ? new Date(timestamp * 1000).toISOString().slice(0, 10) : undefined;

    return {
      code,
      name: String(quote.f58 || "").trim(),
      nav: price === undefined ? undefined : price / 1000,
      navDate,
      dayGrowth: dayGrowthRaw === undefined ? undefined : dayGrowthRaw / 100,
    };
  } catch {
    return null;
  }
}

async function fetchFundNameFallback(code: string, signal: AbortSignal): Promise<string> {
  const urls = [
    `https://fundf10.eastmoney.com/jbgk_${code}.html`,
    `https://fund.eastmoney.com/${code}.html`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        signal,
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Referer": "https://fund.eastmoney.com/",
        },
      });
      if (!res.ok) continue;
      const html = await res.text();
      const title = html.match(/<title>(.*?)<\/title>/is)?.[1] || "";
      const h1 = html.match(/<h1[^>]*>(.*?)<\/h1>/is)?.[1] || "";
      const raw = (h1 || title).replace(/<[^>]*>/g, "");
      const name = cleanFundName(raw);
      if (name && name !== code && !/^\d{6}$/.test(name)) return name;
    } catch {
      continue;
    }
  }
  return "";
}

export async function fetchFundQuote(code: string): Promise<FundQuote | null> {
  if (!/^\d{6}$/.test(code)) return null;

  const cached = quoteCache.get(code);
  if (cached && cached.expiresAt > Date.now()) return cached.quote;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const exchangeQuote = await fetchExchangeFundQuote(code, controller.signal);
    if (exchangeQuote?.dayGrowth !== undefined || exchangeQuote?.nav !== undefined) {
      quoteCache.set(code, { expiresAt: Date.now() + CACHE_TTL_MS, quote: exchangeQuote });
      return exchangeQuote;
    }

    const res = await fetch(`http://fundgz.1234567.com.cn/js/${code}.js`, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Referer": "http://fund.eastmoney.com/",
      },
    });
    if (!res.ok) {
      const fallbackName = await fetchFundNameFallback(code, controller.signal);
      return fallbackName ? { code, name: fallbackName } : null;
    }

    const data = parseEastmoneyJsonp(await res.text());
    let name = String(data?.name || "").trim();
    if (!name || name === code) name = await fetchFundNameFallback(code, controller.signal);
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

