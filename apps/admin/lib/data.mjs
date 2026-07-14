import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const root = resolve(__dirname, "../../..");
export const sourcePath = resolve(root, "data/stocks.source.json");
export const pricesPath = resolve(root, "data/prices.snapshot.json");
export const settingsPath = resolve(root, "data/admin.settings.json");

export const defaultSettings = {
  /** "auto" = resolve PATH / ChatGPT.app bundle at runtime */
  codexBinary: "auto",
  /** empty = use ~/.codex/config.toml model, else first listed model */
  analysisModel: "",
  /** analysis must write data/stocks.source.json */
  sandbox: "workspace-write",
  autoSeedAfterWrite: true,
};

export function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

export function saveJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function loadSettings() {
  return { ...defaultSettings, ...loadJson(settingsPath, {}) };
}

export function loadSource() {
  const stocks = loadJson(sourcePath, []);
  if (!Array.isArray(stocks)) throw new Error("stocks.source.json must be an array");
  return stocks;
}

export function loadPrices() {
  return loadJson(pricesPath, { asOf: null, quotes: {} });
}

export function runSeed() {
  const result = spawnSync(
    process.execPath,
    [resolve(root, "tools/scripts/seed-stock-db.mjs")],
    { cwd: root, stdio: "pipe", encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "seed failed");
  }
  return result.stdout.trim();
}

export function marketFromSymbol(symbol) {
  if (symbol.startsWith("6") || symbol.startsWith("9") || symbol.startsWith("5")) {
    return "上交所";
  }
  return "深交所";
}

export function placeholderBands(price) {
  const p = Number.isFinite(price) && price > 0 ? price : 100;
  const cuts = [0.75, 0.85, 0.95, 1.1].map((m) => Math.round(p * m * 100) / 100);
  return [
    ["深度低估", `¥${cuts[0]} 以下`, null, cuts[0], "【草稿】占位区间，待价值投资分析后校准。"],
    ["舒适买入", `¥${cuts[0]}–${cuts[1]}`, cuts[0], cuts[1], "【草稿】占位区间，待价值投资分析后校准。"],
    ["合理偏低", `¥${cuts[1]}–${cuts[2]}`, cuts[1], cuts[2], "【草稿】占位区间，待价值投资分析后校准。"],
    ["合理区", `¥${cuts[2]}–${cuts[3]}`, cuts[2], cuts[3], "【草稿】占位区间，待价值投资分析后校准。"],
    ["偏贵区", `¥${cuts[3]} 以上`, cuts[3], null, "【草稿】占位区间，待价值投资分析后校准。"],
  ];
}

export function buildStock(body, quotePrice) {
  const symbol = String(body.symbol ?? "").replace(/\D/g, "");
  return {
    symbol,
    name: String(body.name ?? symbol),
    market: String(body.market ?? marketFromSymbol(symbol)),
    industry: String(body.industry ?? "待填写"),
    quality: String(body.quality ?? "B"),
    idealPrice: "待校准",
    valuationAnchor: "待校准",
    thesis: "【草稿】待按 charlie-munger-value-investing skill 完成分析后填写。",
    keyRisk: "【草稿】待分析后填写。",
    bands: placeholderBands(quotePrice),
  };
}

export function analyzePrompt(stock, analysisModel) {
  return [
    `请按 data/anysis/charlie-munger-value-investing skill 用中文分析【${stock.name} ${stock.symbol}】。`,
    "完成后更新 data/stocks.source.json 中该 symbol 的 quality / idealPrice / valuationAnchor / thesis / keyRisk / bands（正好 5 档）。",
    "不要写入 currentPrice / asOf / valuation。不要 commit。",
    `分析模型偏好：${analysisModel}（由管理页设置，请使用当前会话模型完成）。`,
  ].join("\n");
}
