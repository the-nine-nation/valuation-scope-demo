/**
 * Shared Tencent qt.gtimg.cn quote fetch for A-share symbols.
 * Used by update-prices, admin /api/quotes, and mirrored in the Worker.
 */

/**
 * @param {string} symbol
 * @returns {"sh"|"sz"}
 */
export function exchangePrefix(symbol) {
  const code = String(symbol).replace(/\D/g, "");
  if (code.startsWith("6") || code.startsWith("9") || code.startsWith("5")) {
    return "sh";
  }
  return "sz";
}

/**
 * @param {string} symbol
 */
export function quoteKey(symbol) {
  const code = String(symbol).replace(/\D/g, "");
  return `${exchangePrefix(code)}${code}`;
}

/**
 * @param {string|null|undefined} raw
 */
export function formatAsOf(raw) {
  if (!raw) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length >= 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }
  return String(raw);
}

/**
 * @param {string} text
 * @returns {Map<string, { price: number, asOf: string }>}
 */
export function parseTencentQuotes(text) {
  /** @type {Map<string, { price: number, asOf: string }>} */
  const quotes = new Map();
  for (const line of String(text).split("\n")) {
    const match = line.match(/^v_([a-z]{2}\d+)="(.*)";?\s*$/i);
    if (!match) continue;
    const fields = match[2].split("~");
    const price = Number.parseFloat(fields[3]);
    if (!Number.isFinite(price) || price <= 0) continue;
    quotes.set(match[1].toLowerCase(), {
      price,
      asOf: formatAsOf(fields[30] || fields[31]),
    });
  }
  return quotes;
}

/**
 * @param {string[]} symbols
 * @returns {Promise<Map<string, { price: number, asOf: string }>>}
 */
export async function fetchTencentQuotes(symbols) {
  const codes = [
    ...new Set(
      symbols
        .map((s) => String(s).replace(/\D/g, ""))
        .filter((s) => /^\d{6}$/.test(s)),
    ),
  ];
  if (codes.length === 0) {
    throw new Error("fetchTencentQuotes: no valid 6-digit symbols");
  }

  const keys = codes.map(quoteKey);
  const url = `https://qt.gtimg.cn/q=${keys.join(",")}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "valuation-scope-demo/0.1",
      Referer: "https://finance.qq.com/",
    },
  });
  if (!response.ok) {
    throw new Error(`Quote request failed: HTTP ${response.status}`);
  }
  const text = await response.text();
  const quotes = parseTencentQuotes(text);
  if (quotes.size === 0) {
    throw new Error("Quote response contained no usable prices");
  }
  return quotes;
}

/**
 * Normalize Map result to { symbol -> { currentPrice, asOf } }.
 * @param {string[]} symbols
 * @param {Map<string, { price: number, asOf: string }>} liveMap
 */
export function quotesBySymbol(symbols, liveMap) {
  /** @type {Record<string, { currentPrice: number, asOf: string }>} */
  const out = {};
  for (const raw of symbols) {
    const symbol = String(raw).replace(/\D/g, "");
    if (!/^\d{6}$/.test(symbol)) continue;
    const live = liveMap.get(quoteKey(symbol));
    if (!live) continue;
    out[symbol] = {
      currentPrice: Math.round(live.price * 100) / 100,
      asOf: live.asOf,
    };
  }
  return out;
}

/**
 * Fetch + normalize for API responses.
 * @param {string[]} symbols
 */
export async function fetchQuotesPayload(symbols) {
  const codes = [
    ...new Set(
      symbols
        .map((s) => String(s).replace(/\D/g, ""))
        .filter((s) => /^\d{6}$/.test(s)),
    ),
  ];
  const liveMap = await fetchTencentQuotes(codes);
  const quotes = quotesBySymbol(codes, liveMap);
  const asOfList = Object.values(quotes)
    .map((q) => q.asOf)
    .filter(Boolean)
    .sort();
  return {
    asOf: asOfList.at(-1) ?? null,
    updatedAt: new Date().toISOString(),
    source: "tencent-gtimg",
    live: true,
    quotes,
  };
}
