/**
 * Resolve A-share name / industry / live price by 6-digit code.
 * Sources: Eastmoney (name+industry) + Tencent qt (price).
 *
 * CLI: node tools/scripts/lookup-stock.mjs 600519
 * Import: lookupStock(symbol)
 */
import { fileURLToPath } from "node:url";

function exchangePrefix(symbol) {
  if (symbol.startsWith("6") || symbol.startsWith("9") || symbol.startsWith("5")) {
    return "sh";
  }
  return "sz";
}

function eastmoneySecId(symbol) {
  // 1 = SH, 0 = SZ
  if (symbol.startsWith("6") || symbol.startsWith("9") || symbol.startsWith("5")) {
    return `1.${symbol}`;
  }
  return `0.${symbol}`;
}

export function marketFromSymbol(symbol) {
  if (symbol.startsWith("6") || symbol.startsWith("9") || symbol.startsWith("5")) {
    return "上交所";
  }
  return "深交所";
}

function normalizeIndustry(raw) {
  if (!raw) return "待确认";
  // Eastmoney often returns "白酒Ⅱ" / "保险Ⅱ" — strip trailing sector tier marks
  return String(raw)
    .replace(/[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩI]+$/u, "")
    .replace(/\s+/g, "")
    .trim() || "待确认";
}

function formatAsOf(raw) {
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

async function fetchEastmoneyMeta(symbol) {
  const secid = eastmoneySecId(symbol);
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f57,f58,f127,f43`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "valuation-scope-demo/0.1",
      Referer: "https://quote.eastmoney.com/",
    },
  });
  if (!response.ok) {
    throw new Error(`Eastmoney meta HTTP ${response.status}`);
  }
  const payload = await response.json();
  const data = payload?.data;
  if (!data || String(data.f57) !== symbol) {
    throw new Error(`未找到代码 ${symbol}（东方财富无有效返回）`);
  }
  const name = String(data.f58 ?? "").replace(/\s+/g, "").trim();
  if (!name) {
    throw new Error(`代码 ${symbol} 无名称`);
  }
  // f43 is price * 100 when present
  let price = null;
  if (Number.isFinite(data.f43) && data.f43 > 0) {
    price = Math.round(data.f43) / 100;
  }
  return {
    symbol,
    name,
    industry: normalizeIndustry(data.f127),
    price,
    source: "eastmoney",
  };
}

async function fetchTencentQuote(symbol) {
  const key = `${exchangePrefix(symbol)}${symbol}`;
  const url = `https://qt.gtimg.cn/q=${key}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "valuation-scope-demo/0.1",
      Referer: "https://finance.qq.com/",
    },
  });
  if (!response.ok) {
    throw new Error(`Tencent quote HTTP ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  // Tencent often serves GBK
  let text;
  try {
    text = new TextDecoder("gbk").decode(buffer);
  } catch {
    text = new TextDecoder("utf-8").decode(buffer);
  }
  const match = text.match(new RegExp(`v_${key}="(.*)";?`, "i"));
  if (!match || !match[1] || match[1].trim() === "") {
    return null;
  }
  const fields = match[1].split("~");
  const name = String(fields[1] ?? "").replace(/\s+/g, "").trim();
  const price = Number.parseFloat(fields[3]);
  if (!name || !Number.isFinite(price) || price <= 0) {
    return null;
  }
  return {
    name,
    price: Math.round(price * 100) / 100,
    asOf: formatAsOf(fields[30] || fields[31]),
    source: "tencent-gtimg",
  };
}

/**
 * @param {string} rawSymbol
 * @returns {Promise<{
 *   symbol: string,
 *   name: string,
 *   market: string,
 *   industry: string,
 *   currentPrice: number | null,
 *   asOf: string | null,
 *   sources: string[],
 * }>}
 */
export async function lookupStock(rawSymbol) {
  const symbol = String(rawSymbol ?? "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(symbol)) {
    throw new Error("symbol must be 6 digits");
  }

  const sources = [];
  let name = null;
  let industry = "待确认";
  let currentPrice = null;
  let asOf = null;

  try {
    const meta = await fetchEastmoneyMeta(symbol);
    name = meta.name;
    industry = meta.industry;
    if (meta.price != null) currentPrice = meta.price;
    sources.push("eastmoney");
  } catch (error) {
    // fall through to tencent-only name
    sources.push(`eastmoney-error:${error.message}`);
  }

  try {
    const quote = await fetchTencentQuote(symbol);
    if (quote) {
      if (!name) name = quote.name;
      currentPrice = quote.price;
      asOf = quote.asOf;
      sources.push("tencent-gtimg");
    }
  } catch (error) {
    sources.push(`tencent-error:${error.message}`);
  }

  if (!name) {
    throw new Error(`无法解析代码 ${symbol} 的名称，请确认代码正确且网络可达`);
  }

  return {
    symbol,
    name,
    market: marketFromSymbol(symbol),
    industry,
    currentPrice,
    asOf,
    sources,
  };
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolveArgvPath(process.argv[1]);

function resolveArgvPath(p) {
  try {
    return fileURLToPath(new URL(p, "file:"));
  } catch {
    return p;
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("lookup-stock.mjs")) {
  const symbol = process.argv[2];
  if (!symbol) {
    console.error("Usage: node tools/scripts/lookup-stock.mjs <6-digit-code>");
    process.exit(1);
  }
  lookupStock(symbol)
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error.message || error);
      process.exit(1);
    });
}
