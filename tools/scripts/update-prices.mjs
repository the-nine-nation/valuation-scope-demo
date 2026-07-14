import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourcePath = resolve(root, "data/stocks.source.json");
const pricesPath = resolve(root, "data/prices.snapshot.json");

function exchangePrefix(symbol) {
  if (symbol.startsWith("6") || symbol.startsWith("9") || symbol.startsWith("5")) {
    return "sh";
  }
  return "sz";
}

function quoteKey(symbol) {
  return `${exchangePrefix(symbol)}${symbol}`;
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

function parseTencentQuotes(text) {
  const quotes = new Map();
  for (const line of text.split("\n")) {
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

async function fetchQuotes(symbols) {
  const keys = symbols.map(quoteKey);
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

function loadExistingPrices() {
  if (!existsSync(pricesPath)) {
    return {
      asOf: null,
      updatedAt: null,
      source: "tencent-gtimg",
      quotes: {},
    };
  }
  const raw = JSON.parse(readFileSync(pricesPath, "utf8"));
  return {
    asOf: raw.asOf ?? null,
    updatedAt: raw.updatedAt ?? null,
    source: raw.source ?? "tencent-gtimg",
    quotes: raw.quotes && typeof raw.quotes === "object" ? { ...raw.quotes } : {},
  };
}

function writePrices(snapshot) {
  writeFileSync(pricesPath, `${JSON.stringify(snapshot, null, 2)}\n`);
}

function runSeed() {
  const result = spawnSync(
    process.execPath,
    [resolve(root, "tools/scripts/seed-stock-db.mjs")],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
  if (result.status !== 0) {
    throw new Error(`seed-stock-db failed with exit code ${result.status ?? "null"}`);
  }
}

const stocks = JSON.parse(readFileSync(sourcePath, "utf8"));
if (!Array.isArray(stocks) || stocks.length === 0) {
  throw new Error(`No stocks found in ${sourcePath}`);
}

const symbols = stocks.map((stock) => stock.symbol);
const nameBySymbol = new Map(stocks.map((stock) => [stock.symbol, stock.name]));
const liveQuotes = await fetchQuotes(symbols);
const previous = loadExistingPrices();
const nextQuotes = {};
let changed = 0;
let latestAsOf = null;

for (const symbol of symbols) {
  const live = liveQuotes.get(quoteKey(symbol));
  const prev = previous.quotes[symbol];
  const name = nameBySymbol.get(symbol) ?? symbol;

  if (!live) {
    if (prev?.currentPrice) {
      console.warn(`No quote for ${symbol} (${name}); keeping previous price ¥${prev.currentPrice}`);
      nextQuotes[symbol] = {
        currentPrice: prev.currentPrice,
        asOf: prev.asOf ?? null,
      };
      if (prev.asOf && (!latestAsOf || prev.asOf > latestAsOf)) latestAsOf = prev.asOf;
    } else {
      console.warn(`No quote for ${symbol} (${name}); no previous price to keep`);
    }
    continue;
  }

  const nextPrice = Math.round(live.price * 100) / 100;
  const nextAsOf = live.asOf;
  const prevPrice = prev?.currentPrice;
  const prevAsOf = prev?.asOf;
  const priceChanged = prevPrice !== nextPrice;
  const metaChanged = prevAsOf !== nextAsOf;

  if (priceChanged || metaChanged) {
    console.log(
      `${symbol} ${name}: ¥${prevPrice ?? "—"} → ¥${nextPrice} (${nextAsOf})`,
    );
    changed += 1;
  } else {
    console.log(`${symbol} ${name}: unchanged ¥${nextPrice} (${nextAsOf})`);
  }

  nextQuotes[symbol] = {
    currentPrice: nextPrice,
    asOf: nextAsOf,
  };
  if (nextAsOf && (!latestAsOf || nextAsOf > latestAsOf)) latestAsOf = nextAsOf;
}

const snapshot = {
  asOf: latestAsOf,
  updatedAt: new Date().toISOString(),
  source: "tencent-gtimg",
  quotes: nextQuotes,
};

const previousQuoteJson = JSON.stringify(previous.quotes);
const nextQuoteJson = JSON.stringify(nextQuotes);
const quotesChanged = previousQuoteJson !== nextQuoteJson;

if (quotesChanged) {
  writePrices(snapshot);
  console.log(`Wrote ${changed} changed quote(s) to ${pricesPath}`);
} else {
  console.log(`All prices already up to date in ${pricesPath}`);
}

runSeed();
