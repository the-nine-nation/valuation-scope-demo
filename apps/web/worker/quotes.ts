/**
 * Live A-share quotes via Tencent qt (Worker-side, no Node fs).
 * Mirrors tools/lib/tencent-quotes.mjs for Cloudflare runtime.
 */

export type LiveQuote = {
  currentPrice: number;
  asOf: string;
};

export type QuotesPayload = {
  asOf: string | null;
  updatedAt: string;
  source: "tencent-gtimg";
  live: true;
  quotes: Record<string, LiveQuote>;
};

function exchangePrefix(symbol: string): "sh" | "sz" {
  if (symbol.startsWith("6") || symbol.startsWith("9") || symbol.startsWith("5")) {
    return "sh";
  }
  return "sz";
}

function quoteKey(symbol: string): string {
  return `${exchangePrefix(symbol)}${symbol}`;
}

function formatAsOf(raw: string | undefined): string {
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

function parseTencentQuotes(text: string): Map<string, { price: number; asOf: string }> {
  const quotes = new Map<string, { price: number; asOf: string }>();
  for (const line of text.split("\n")) {
    const match = line.match(/^v_([a-z]{2}\d+)="(.*)";?\s*$/i);
    if (!match) continue;
    const fields = match[2].split("~");
    const price = Number.parseFloat(fields[3] ?? "");
    if (!Number.isFinite(price) || price <= 0) continue;
    quotes.set(match[1].toLowerCase(), {
      price,
      asOf: formatAsOf(fields[30] || fields[31]),
    });
  }
  return quotes;
}

function normalizeSymbols(raw: string[]): string[] {
  return [
    ...new Set(
      raw
        .map((s) => String(s).replace(/\D/g, ""))
        .filter((s) => /^\d{6}$/.test(s)),
    ),
  ];
}

export async function fetchQuotesPayload(symbols: string[]): Promise<QuotesPayload> {
  const codes = normalizeSymbols(symbols);
  if (codes.length === 0) {
    throw new Error("no valid 6-digit symbols");
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
  const liveMap = parseTencentQuotes(text);
  if (liveMap.size === 0) {
    throw new Error("Quote response contained no usable prices");
  }

  const quotes: Record<string, LiveQuote> = {};
  for (const symbol of codes) {
    const live = liveMap.get(quoteKey(symbol));
    if (!live) continue;
    quotes[symbol] = {
      currentPrice: Math.round(live.price * 100) / 100,
      asOf: live.asOf,
    };
  }

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

export function quotesJsonResponse(payload: QuotesPayload, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=30",
      "access-control-allow-origin": "*",
    },
  });
}

export function quotesErrorResponse(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}
