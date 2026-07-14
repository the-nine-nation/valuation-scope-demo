/**
 * Validate data/anysis/runs/<symbol>.json and merge analysis fields into
 * data/stocks.source.json for that symbol only.
 *
 * CLI:
 *   node tools/scripts/ingest-analysis.mjs 600519
 *   node tools/scripts/ingest-analysis.mjs 600519 --path /tmp/run.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeAnalysisPayload } from "./analysis-schema.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourcePath = resolve(root, "data/stocks.source.json");
const runsDir = resolve(root, "data/anysis/runs");

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function saveJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * @param {string} symbol
 * @param {{ runPath?: string, payload?: object }} [options]
 */
export function ingestAnalysis(symbol, options = {}) {
  const code = String(symbol ?? "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(code)) {
    throw new Error("symbol must be 6 digits");
  }

  let raw = options.payload;
  if (!raw) {
    const runPath = options.runPath ?? resolve(runsDir, `${code}.json`);
    if (!existsSync(runPath)) {
      throw new Error(`run file not found: ${runPath}`);
    }
    raw = loadJson(runPath);
  }

  const { symbol: resolved, patch } = normalizeAnalysisPayload(raw, code);
  const stocks = loadJson(sourcePath);
  if (!Array.isArray(stocks)) {
    throw new Error("stocks.source.json must be an array");
  }

  const index = stocks.findIndex((s) => s.symbol === resolved);
  if (index < 0) {
    throw new Error(`${resolved} not in stocks.source.json — add stock first`);
  }

  const previous = stocks[index];
  // Preserve identity fields; only patch value-investing fields
  stocks[index] = {
    symbol: previous.symbol,
    name: previous.name,
    market: previous.market,
    industry: previous.industry,
    ...patch,
  };

  // Strip any accidental price fields if present historically
  delete stocks[index].currentPrice;
  delete stocks[index].asOf;
  delete stocks[index].valuation;

  saveJson(sourcePath, stocks);

  return {
    symbol: resolved,
    name: stocks[index].name,
    quality: stocks[index].quality,
    idealPrice: stocks[index].idealPrice,
    bands: stocks[index].bands.length,
    analyzedAt: stocks[index].analysis?.analyzedAt ?? null,
    sourcePath,
  };
}

if (process.argv[1]?.endsWith("ingest-analysis.mjs")) {
  const args = process.argv.slice(2);
  const symbol = args.find((a) => !a.startsWith("--"));
  const pathFlag = args.indexOf("--path");
  const runPath = pathFlag >= 0 ? args[pathFlag + 1] : undefined;
  if (!symbol) {
    console.error("Usage: node tools/scripts/ingest-analysis.mjs <symbol> [--path file.json]");
    process.exit(1);
  }
  try {
    const result = ingestAnalysis(symbol, { runPath });
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}
