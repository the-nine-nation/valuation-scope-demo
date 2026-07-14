import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  ANALYSIS_RUN_CONTRACT,
  REQUIRED_SKILL_STEPS,
  REQUIRED_SKILL_VERSION,
} from "../../../tools/scripts/analysis-schema.mjs";
import { ingestAnalysis } from "../../../tools/scripts/ingest-analysis.mjs";
import { pushSource } from "../../../tools/scripts/push-source.mjs";
import { lookupStock } from "../../../tools/scripts/lookup-stock.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const root = resolve(__dirname, "../../..");
export const sourcePath = resolve(root, "data/stocks.source.json");
export const pricesPath = resolve(root, "data/prices.snapshot.json");
export const settingsPath = resolve(root, "data/admin.settings.json");
export const runsDir = resolve(root, "data/anysis/runs");

export { ingestAnalysis, pushSource, lookupStock, ANALYSIS_RUN_CONTRACT };

export const defaultSettings = {
  /** "auto" = resolve PATH / ChatGPT.app bundle at runtime */
  codexBinary: "auto",
  /** empty = use ~/.codex/config.toml model, else first listed model */
  analysisModel: "gpt-5.6-sol",
  /** low | medium | high — forced via -c model_reasoning_effort */
  reasoningEffort: "medium",
  /** analysis must write data/anysis/runs + ingest into source */
  sandbox: "workspace-write",
  autoSeedAfterWrite: true,
  /** after successful ingest, commit+push only data/stocks.source.json */
  autoPushAfterAnalyze: true,
  /**
   * After add-stock / analyze, trigger GitHub Actions prices workflow
   * (workflow_dispatch) so prices stay on the CI-owned file and avoid
   * conflict with source-only analysis commits.
   */
  autoTriggerPricesWorkflow: true,
  /** if remote dispatch unavailable, run prices:update locally (no git push) */
  pricesWorkflowLocalFallback: true,
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

export function emptyAnalysisDraft() {
  return {
    summary: "【草稿】待价值投资分析后填写一句话结论。",
    stage: "待判定",
    circleOfCompetence: "部分理解",
    priceVerdict: "需要观察",
    business: "【草稿】待分析业务模式、护城河与能力圈边界。",
    financials: "【草稿】待分析营收利润质量、现金流与 ROE。",
    valuation: "【草稿】待对照历史估值与同业位置。",
    peers: "【草稿】待补充同业与海外可比定锚。",
    scenarios: [
      { name: "悲观", assumption: "待分析", fairValue: "待校准" },
      { name: "中性", assumption: "待分析", fairValue: "待校准" },
      { name: "乐观", assumption: "待分析", fairValue: "待校准" },
    ],
    raiseBuyPriceWhen: ["业绩与质量假设得到验证后，可上修买入区间。"],
    vetoTriggers: ["基本面恶化或估值逻辑失效时，区间作废。"],
    reportMarkdown: "",
    analyzedAt: null,
    model: null,
  };
}

/**
 * Create a draft stock from lookup result (no AI analysis yet).
 */
export function buildStockFromLookup(lookup, quotePrice) {
  const symbol = String(lookup.symbol ?? "").replace(/\D/g, "");
  const price =
    Number.isFinite(quotePrice) && quotePrice > 0
      ? quotePrice
      : Number.isFinite(lookup.currentPrice)
        ? lookup.currentPrice
        : null;
  return {
    symbol,
    name: String(lookup.name ?? symbol),
    market: String(lookup.market ?? marketFromSymbol(symbol)),
    industry: String(lookup.industry ?? "待确认"),
    quality: "B",
    idealPrice: "待校准",
    valuationAnchor: "待校准",
    thesis: "【草稿】已录入代码与名称，待按 charlie-munger-value-investing skill 完成分析后填写。",
    keyRisk: "【草稿】待分析后填写。",
    bands: placeholderBands(price),
    analysis: emptyAnalysisDraft(),
  };
}

/** @deprecated use buildStockFromLookup */
export function buildStock(body, quotePrice) {
  return buildStockFromLookup(
    {
      symbol: body.symbol,
      name: body.name,
      market: body.market,
      industry: body.industry,
      currentPrice: quotePrice,
    },
    quotePrice,
  );
}

export function runPathFor(symbol) {
  return resolve(runsDir, `${symbol}.json`);
}

export function analyzePrompt(stock, analysisModel) {
  const outPath = `data/anysis/runs/${stock.symbol}.json`;
  const skillRoot = "data/anysis/charlie-munger-value-investing";
  return [
    `你是本仓库的价值投资分析执行器（非交互自动化）。请严格按 ${skillRoot} skill 用中文分析【${stock.name} ${stock.symbol}】。`,
    "",
    "## Skill 必读（按序，不要跳过）",
    `1. 先读 \`${skillRoot}/SKILL.md\` 全文。`,
    `2. 按需加载 references：mental-models / data-checklist / valuation-framework / analysis-workflow / report-template / principles-checklist。`,
    `3. 按 SKILL 执行流程 0–10 完成研究；不得只套 JSON 模板空写。`,
    "",
    "## 研究工具（只读，允许）",
    "- 可用内置 **web_search**（cached/live）查公开年报、中报、公告、同业与估值背景。",
    "- 可用 shell 读本仓库文件（skill、价格快照、既有 source 字段）。",
    "- **禁止** 安装依赖、改系统、git commit/push、调用用户 MCP、打开需要交互批准的工具。",
    "- 若某数据查不到：在 analysis.sources 写明缺口，并加大安全边际或降低结论置信度。",
    "",
    "## 硬性交付（缺一不可）",
    `1. 完成研究后，把**机器可读**结果写入仓库文件：\`${outPath}\`（JSON，UTF-8，合法 JSON，不要包 markdown 代码围栏）。`,
    "2. **不要**直接编辑 data/stocks.source.json；入库由脚本完成。",
    "3. **不要**写入 currentPrice / asOf / 顶层 valuation 字段。",
    "4. **不要** git commit / push。",
    "5. bands 必须正好 5 档；analysis.business / financials / valuation 各 ≥20 字中文。",
    "6. analysis.model 填你使用的模型 slug；analysis.analyzedAt 填今天日期 YYYY-MM-DD（Asia/Shanghai）。",
    `7. analysis.skillVersion 必须精确为 \`${REQUIRED_SKILL_VERSION}\`。`,
    `8. analysis.stepsCompleted 必须包含全部步骤 id（可多不可少）：${REQUIRED_SKILL_STEPS.join(", ")}。`,
    "9. analysis.sources ≥ 2 条；每条至少 title；尽量填 url + asOf + kind（filing|quote|peer|news|other）。",
    "10. 写完文件后立即结束，不要再开长对话。",
    "",
    "## JSON 合同（写入 run 文件时必须符合；ingest 会硬校验 audit 字段）",
    ANALYSIS_RUN_CONTRACT,
    "",
    `## 标的`,
    `- 代码：${stock.symbol}`,
    `- 名称：${stock.name}`,
    `- 市场：${stock.market}`,
    `- 行业：${stock.industry}`,
    "",
    `分析模型：${analysisModel}。唯一成功条件：磁盘上出现可通过 ingest 校验的 ${outPath}。`,
  ].join("\n");
}

/**
 * Merge live quote into prices.snapshot.json for one symbol.
 */
export function upsertPriceQuote(symbol, currentPrice, asOf) {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null;
  const prices = loadPrices();
  const quotes = { ...(prices.quotes || {}) };
  quotes[symbol] = {
    currentPrice: Math.round(currentPrice * 100) / 100,
    asOf: asOf || prices.asOf || null,
  };
  const next = {
    asOf: asOf || prices.asOf || null,
    updatedAt: new Date().toISOString(),
    source: prices.source || "lookup",
    quotes,
  };
  saveJson(pricesPath, next);
  return next.quotes[symbol];
}
