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

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
}

function parseProfileCell(html: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<th>\\s*${escaped}\\s*</th>\\s*<td[^>]*>([\\s\\S]*?)</td>`, "i"));
  return match ? stripHtml(match[1]) : "";
}

async function fetchFundProfileFallback(code: string, signal: AbortSignal): Promise<Partial<FundQuote>> {
  try {
    const res = await fetch(`https://fundf10.eastmoney.com/jbgk_${code}.html`, {
      signal,
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://fund.eastmoney.com/",
      },
    });
    if (!res.ok) return {};
    const html = await res.text();
    const title = html.match(/<title>(.*?)<\/title>/is)?.[1] || "";
    const name = cleanFundName(stripHtml(title));
    const scaleText = parseProfileCell(html, "净资产规模");
    return {
      name,
      type: parseProfileCell(html, "基金类型"),
      company: parseProfileCell(html, "基金管理人"),
      manager: parseProfileCell(html, "基金经理人"),
      totalScale: parseNumber(scaleText.match(/[\d.]+/)?.[0]),
      feeManage: parseNumber(parseProfileCell(html, "管理费率")) !== undefined ? parseNumber(parseProfileCell(html, "管理费率"))! / 100 : undefined,
      feeCustody: parseNumber(parseProfileCell(html, "托管费率")) !== undefined ? parseNumber(parseProfileCell(html, "托管费率"))! / 100 : undefined,
    };
  } catch {
    return {};
  }
}

function getEastmoneySecid(code: string): string | null {
  if (/^(5\d{5}|508\d{3})$/.test(code)) return `1.${code}`;
  if (/^(15\d{4}|16\d{4}|18\d{4})$/.test(code)) return `0.${code}`;
  return null;
}

function getTencentSymbol(code: string): string | null {
  if (/^(5\d{5}|508\d{3})$/.test(code)) return `s_sh${code}`;
  if (/^(15\d{4}|16\d{4}|18\d{4})$/.test(code)) return `s_sz${code}`;
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
  if (tencentQuote?.name && (tencentQuote.dayGrowth !== undefined || tencentQuote.nav !== undefined)) {
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
      nav: price === undefined ? tencentQuote?.nav : price / 1000,
      navDate,
      dayGrowth: dayGrowthRaw === undefined ? tencentQuote?.dayGrowth : dayGrowthRaw / 100,
    };
  } catch {
    return tencentQuote;
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
      const profile = await fetchFundProfileFallback(code, controller.signal);
      if (!exchangeQuote.name) exchangeQuote.name = profile.name || await fetchFundNameFallback(code, controller.signal);
      Object.assign(exchangeQuote, {
        type: profile.type,
        company: profile.company,
        manager: profile.manager,
        totalScale: profile.totalScale,
        feeManage: profile.feeManage,
        feeCustody: profile.feeCustody,
      });
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
      const profile = await fetchFundProfileFallback(code, controller.signal);
      const fallbackName = profile.name || await fetchFundNameFallback(code, controller.signal);
      return fallbackName ? { code, name: fallbackName, ...profile } : null;
    }

    const data = parseEastmoneyJsonp(await res.text());
    let name = String(data?.name || "").trim();
    const profile = await fetchFundProfileFallback(code, controller.signal);
    if (!name || name === code) name = profile.name || await fetchFundNameFallback(code, controller.signal);
    if (!name || name === code) return null;

    const quote: FundQuote = {
      code: String(data?.fundcode || code),
      name,
      type: profile.type,
      company: profile.company,
      manager: profile.manager,
      totalScale: profile.totalScale,
      feeManage: profile.feeManage,
      feeCustody: profile.feeCustody,
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

