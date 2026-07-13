import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(root, "data/stocks.source.json");

function exchangePrefix(symbol) {
  if (symbol.startsWith("6") || symbol.startsWith("9") || symbol.startsWith("5")) {
    return "sh";
  }
  return "sz";
}

function quoteKey(symbol) {
  return `${exchangePrefix(symbol)}${symbol}`;
}

function resolveBandName(price, bands) {
  for (const band of bands) {
    const [name, , lower, upper] = band;
    const aboveLower = lower === null || price >= lower;
    const belowUpper = upper === null || price < upper;
    if (aboveLower && belowUpper) return name;
  }
  return bands.at(-1)?.[0] ?? "未知";
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

function writeSource(stocks) {
  writeFileSync(sourcePath, `${JSON.stringify(stocks, null, 2)}\n`);
}

function runSeed() {
  const result = spawnSync(process.execPath, [resolve(root, "scripts/seed-stock-db.mjs")], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`seed-stock-db failed with exit code ${result.status ?? "null"}`);
  }
}

const stocks = JSON.parse(readFileSync(sourcePath, "utf8"));
if (!Array.isArray(stocks) || stocks.length === 0) {
  throw new Error(`No stocks found in ${sourcePath}`);
}

const quotes = await fetchQuotes(stocks.map((stock) => stock.symbol));
let changed = 0;

for (const stock of stocks) {
  const quote = quotes.get(quoteKey(stock.symbol));
  if (!quote) {
    console.warn(`No quote for ${stock.symbol} (${stock.name}); keeping previous price`);
    continue;
  }

  const nextPrice = Math.round(quote.price * 100) / 100;
  const nextAsOf = quote.asOf;
  const nextValuation = resolveBandName(nextPrice, stock.bands);
  const priceChanged = nextPrice !== stock.currentPrice;
  const metaChanged = nextAsOf !== stock.asOf || nextValuation !== stock.valuation;

  if (priceChanged || metaChanged) {
    console.log(
      `${stock.symbol} ${stock.name}: ¥${stock.currentPrice} → ¥${nextPrice} (${nextAsOf}) · ${nextValuation}`,
    );
    stock.currentPrice = nextPrice;
    stock.asOf = nextAsOf;
    stock.valuation = nextValuation;
    changed += 1;
  } else {
    console.log(`${stock.symbol} ${stock.name}: unchanged ¥${nextPrice} (${nextAsOf})`);
  }
}

if (changed === 0) {
  console.log("All prices already up to date; regenerating snapshot anyway.");
} else {
  writeSource(stocks);
  console.log(`Updated ${changed} stock price(s) in ${sourcePath}`);
}

runSeed();
