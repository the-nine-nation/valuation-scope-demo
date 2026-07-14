import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourcePath = resolve(root, "data/stocks.source.json");
const pricesPath = resolve(root, "data/prices.snapshot.json");
const databasePath = resolve(root, "data/stocks.db");
const snapshotPath = resolve(root, "apps/web/app/data/stocks.generated.json");

mkdirSync(dirname(databasePath), { recursive: true });
mkdirSync(dirname(snapshotPath), { recursive: true });

function resolveBandName(price, bands) {
  for (const band of bands) {
    const [name, , lower, upper] = band;
    const aboveLower = lower === null || price >= lower;
    const belowUpper = upper === null || price < upper;
    if (aboveLower && belowUpper) return name;
  }
  return bands.at(-1)?.[0] ?? "未知";
}

function loadPrices() {
  if (!existsSync(pricesPath)) {
    return { asOf: null, quotes: {} };
  }
  const raw = JSON.parse(readFileSync(pricesPath, "utf8"));
  return {
    asOf: raw.asOf ?? null,
    quotes: raw.quotes && typeof raw.quotes === "object" ? raw.quotes : {},
  };
}

function normalizeAnalysis(stock) {
  const a = stock.analysis && typeof stock.analysis === "object" ? stock.analysis : {};
  return {
    summary: String(a.summary ?? stock.thesis ?? "").trim(),
    stage: String(a.stage ?? "").trim() || null,
    circleOfCompetence: String(a.circleOfCompetence ?? "").trim() || null,
    priceVerdict: String(a.priceVerdict ?? "").trim() || null,
    business: String(a.business ?? "").trim() || null,
    financials: String(a.financials ?? "").trim() || null,
    valuation: String(a.valuation ?? "").trim() || null,
    peers: String(a.peers ?? "").trim() || null,
    scenarios: Array.isArray(a.scenarios)
      ? a.scenarios.map((s) => ({
          name: String(s.name ?? "").trim(),
          assumption: String(s.assumption ?? "").trim(),
          fairValue: String(s.fairValue ?? "").trim(),
        }))
      : [],
    raiseBuyPriceWhen: Array.isArray(a.raiseBuyPriceWhen)
      ? a.raiseBuyPriceWhen.map(String)
      : [],
    vetoTriggers: Array.isArray(a.vetoTriggers) ? a.vetoTriggers.map(String) : [],
    reportMarkdown: String(a.reportMarkdown ?? "").trim() || null,
    analyzedAt: a.analyzedAt ? String(a.analyzedAt) : null,
    model: a.model ? String(a.model) : null,
  };
}

const stocks = JSON.parse(readFileSync(sourcePath, "utf8"));
if (!Array.isArray(stocks) || stocks.length === 0) {
  throw new Error(`No stocks found in ${sourcePath}`);
}

const prices = loadPrices();
const missingQuotes = [];
const merged = stocks.map((stock) => {
  if (stock.currentPrice != null || stock.asOf != null || stock.valuation != null) {
    throw new Error(
      `${stock.symbol}: price fields belong in data/prices.snapshot.json, not stocks.source.json`,
    );
  }
  const quote = prices.quotes[stock.symbol];
  if (!quote || !Number.isFinite(quote.currentPrice) || quote.currentPrice <= 0) {
    missingQuotes.push(stock.symbol);
    return null;
  }
  const currentPrice = Math.round(quote.currentPrice * 100) / 100;
  const asOf = quote.asOf ?? prices.asOf ?? "unknown";
  const valuation = resolveBandName(currentPrice, stock.bands);
  return {
    ...stock,
    currentPrice,
    asOf,
    valuation,
    analysis: normalizeAnalysis(stock),
  };
});

if (missingQuotes.length > 0) {
  throw new Error(
    `Missing prices for: ${missingQuotes.join(", ")}. Run npm run prices:update first.`,
  );
}

const db = new DatabaseSync(databasePath);
db.exec("PRAGMA foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS stocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    market TEXT NOT NULL,
    industry TEXT NOT NULL,
    current_price REAL NOT NULL,
    as_of TEXT NOT NULL,
    quality TEXT NOT NULL,
    valuation TEXT NOT NULL,
    thesis TEXT NOT NULL,
    ideal_price TEXT NOT NULL,
    valuation_anchor TEXT NOT NULL,
    key_risk TEXT NOT NULL,
    analysis_json TEXT
  ) STRICT;
  CREATE TABLE IF NOT EXISTS valuation_bands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_id INTEGER NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
    level INTEGER NOT NULL CHECK(level BETWEEN 1 AND 5),
    name TEXT NOT NULL,
    range_label TEXT NOT NULL,
    lower_bound REAL,
    upper_bound REAL,
    action TEXT NOT NULL,
    UNIQUE(stock_id, level)
  ) STRICT;
`);

// Migrate older DBs missing analysis_json
try {
  db.exec("ALTER TABLE stocks ADD COLUMN analysis_json TEXT");
} catch {
  // column already exists
}

const insertStock = db.prepare(`
  INSERT INTO stocks (
    symbol, name, market, industry, current_price, as_of, quality, valuation,
    thesis, ideal_price, valuation_anchor, key_risk, analysis_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertBand = db.prepare(`
  INSERT INTO valuation_bands (
    stock_id, level, name, range_label, lower_bound, upper_bound, action
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`);

db.exec("BEGIN");
try {
  db.exec("DELETE FROM valuation_bands");
  db.exec("DELETE FROM stocks");
  db.exec("DELETE FROM sqlite_sequence WHERE name IN ('valuation_bands', 'stocks')");
  for (const stock of merged) {
    const result = insertStock.run(
      stock.symbol,
      stock.name,
      stock.market,
      stock.industry,
      stock.currentPrice,
      stock.asOf,
      stock.quality,
      stock.valuation,
      stock.thesis,
      stock.idealPrice,
      stock.valuationAnchor,
      stock.keyRisk,
      JSON.stringify(stock.analysis),
    );
    stock.bands.forEach((band, index) => {
      insertBand.run(result.lastInsertRowid, index + 1, ...band);
    });
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

const rows = db
  .prepare(
    `
  SELECT
    s.id, s.symbol, s.name, s.market, s.industry,
    s.current_price AS currentPrice, s.as_of AS asOf, s.quality, s.valuation,
    s.thesis, s.ideal_price AS idealPrice, s.valuation_anchor AS valuationAnchor,
    s.key_risk AS keyRisk, s.analysis_json AS analysisJson,
    b.level, b.name AS bandName, b.range_label AS rangeLabel,
    b.lower_bound AS lowerBound, b.upper_bound AS upperBound, b.action
  FROM stocks s
  JOIN valuation_bands b ON b.stock_id = s.id
  ORDER BY s.id, b.level
`,
  )
  .all();

const snapshot = [];
for (const row of rows) {
  let stock = snapshot.at(-1);
  if (!stock || stock.id !== row.id) {
    let analysis = null;
    if (row.analysisJson) {
      try {
        analysis = JSON.parse(row.analysisJson);
      } catch {
        analysis = null;
      }
    }
    stock = {
      id: row.id,
      symbol: row.symbol,
      name: row.name,
      market: row.market,
      industry: row.industry,
      currentPrice: row.currentPrice,
      asOf: row.asOf,
      quality: row.quality,
      valuation: row.valuation,
      thesis: row.thesis,
      idealPrice: row.idealPrice,
      valuationAnchor: row.valuationAnchor,
      keyRisk: row.keyRisk,
      analysis,
      bands: [],
    };
    snapshot.push(stock);
  }
  stock.bands.push({
    level: row.level,
    name: row.bandName,
    rangeLabel: row.rangeLabel,
    lowerBound: row.lowerBound,
    upperBound: row.upperBound,
    action: row.action,
  });
}

writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
db.close();

console.log(
  `Seeded ${snapshot.length} stocks and ${rows.length} valuation bands from source + prices.`,
);
