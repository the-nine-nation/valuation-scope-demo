import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchTencentQuotes,
  quotesBySymbol,
} from "../lib/tencent-quotes.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourcePath = resolve(root, "data/stocks.source.json");
const pricesPath = resolve(root, "data/prices.snapshot.json");

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
const liveMap = await fetchTencentQuotes(symbols);
const liveQuotes = quotesBySymbol(symbols, liveMap);
const previous = loadExistingPrices();
const nextQuotes = {};
let changed = 0;
let latestAsOf = null;

for (const symbol of symbols) {
  const live = liveQuotes[symbol];
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

  const nextPrice = live.currentPrice;
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
