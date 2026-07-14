import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildStockFromLookup,
  ingestAnalysis,
  loadPrices,
  loadSettings,
  loadSource,
  lookupStock,
  pricesPath,
  pushSource,
  root,
  runSeed,
  saveJson,
  settingsPath,
  sourcePath,
  upsertPriceQuote,
} from "./lib/data.mjs";
import { fetchQuotesPayload } from "../../tools/lib/tencent-quotes.mjs";
import {
  codexVersion,
  listCodexModels,
  readCodexConfigDefaultModel,
  resolveCodexBinary,
} from "./lib/codex.mjs";
import {
  createAnalyzeJob,
  getActiveJobForSymbol,
  getJob,
  jobPublic,
  listJobs,
} from "./lib/jobs.mjs";
import { runAnalyzeJob } from "./lib/analyze-runner.mjs";
import { triggerPricesWorkflow } from "../../tools/scripts/trigger-prices-workflow.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dirname, "public");
const HOST = "127.0.0.1";
const PORT = Number(process.env.ADMIN_PORT ?? 5567);

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body, null, 2));
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolveBody({});
        return;
      }
      try {
        resolveBody(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function maybeSeed() {
  if (!loadSettings().autoSeedAfterWrite) return null;
  try {
    return runSeed();
  } catch (error) {
    return String(error.message ?? error);
  }
}

function serveStatic(res, filePath) {
  if (!existsSync(filePath)) {
    res.writeHead(404).end("Not found");
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(readFileSync(filePath));
}

function resolvedCodex() {
  const settings = loadSettings();
  const binary = resolveCodexBinary(settings.codexBinary);
  const modelsResult = listCodexModels(binary.path);
  const configDefault = readCodexConfigDefaultModel();
  const preferred =
    settings.analysisModel ||
    configDefault ||
    modelsResult.models[0]?.slug ||
    "gpt-5.6-sol";
  const reasoningEffort = settings.reasoningEffort || "medium";
  return {
    settings,
    binary,
    version: codexVersion(binary.path),
    models: modelsResult.models,
    modelsSource: modelsResult.source,
    modelsOk: modelsResult.ok,
    modelsError: modelsResult.error ?? null,
    configDefaultModel: configDefault,
    effectiveModel: preferred,
    reasoningEffort,
    sandbox: "workspace-write",
  };
}

function stockRow(stock, prices) {
  const activeJob = getActiveJobForSymbol(stock.symbol);
  return {
    ...stock,
    currentPrice: prices.quotes?.[stock.symbol]?.currentPrice ?? null,
    asOf: prices.quotes?.[stock.symbol]?.asOf ?? prices.asOf ?? null,
    hasDetailAnalysis: Boolean(
      stock.analysis?.business && !String(stock.analysis.business).includes("【草稿】"),
    ),
    activeJob: activeJob ? jobPublic(activeJob) : null,
  };
}

async function maybeTriggerPrices(reason) {
  const settings = loadSettings();
  if (settings.autoTriggerPricesWorkflow === false) {
    return { skipped: true, reason: "autoTriggerPricesWorkflow=false" };
  }
  try {
    return await triggerPricesWorkflow({
      localFallback: settings.pricesWorkflowLocalFallback !== false,
    });
  } catch (error) {
    return {
      ok: false,
      error: String(error.message ?? error),
      reason,
    };
  }
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/health") {
    json(res, 200, { ok: true, host: HOST, port: PORT, root });
    return;
  }

  if (req.method === "GET" && pathname === "/api/codex") {
    json(res, 200, resolvedCodex());
    return;
  }

  if (req.method === "GET" && pathname === "/api/stocks") {
    const stocks = loadSource();
    const prices = loadPrices();
    json(res, 200, {
      stocks: stocks.map((stock) => stockRow(stock, prices)),
      pricesAsOf: prices.asOf ?? null,
      jobs: listJobs({ limit: 10 }).map(jobPublic),
    });
    return;
  }

  // Live quotes (Tencent) — display only; does not require git
  if (req.method === "GET" && pathname === "/api/quotes") {
    const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
    let symbols = String(url.searchParams.get("symbols") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (symbols.length === 0) {
      symbols = loadSource().map((s) => s.symbol);
    }
    if (symbols.length === 0) {
      json(res, 400, { error: "no symbols in pool" });
      return;
    }
    try {
      const payload = await fetchQuotesPayload(symbols);
      // Optionally refresh local snapshot for seed/admin display (not pushed)
      for (const [symbol, quote] of Object.entries(payload.quotes)) {
        upsertPriceQuote(symbol, quote.currentPrice, quote.asOf);
      }
      json(res, 200, payload);
    } catch (error) {
      json(res, 502, { error: String(error.message ?? error) });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/api/jobs") {
    json(res, 200, { jobs: listJobs({ limit: 30 }).map(jobPublic) });
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/api/jobs/")) {
    const id = pathname.split("/").pop() ?? "";
    const job = getJob(id);
    if (!job) {
      json(res, 404, { error: `job ${id} not found` });
      return;
    }
    json(res, 200, jobPublic(job));
    return;
  }

  if (req.method === "GET" && pathname === "/api/settings") {
    const resolved = resolvedCodex();
    json(res, 200, {
      ...resolved.settings,
      sandbox: "workspace-write",
      resolvedBinary: resolved.binary.path,
      binarySource: resolved.binary.source,
      binaryOk: resolved.binary.ok,
      version: resolved.version,
      models: resolved.models,
      modelsSource: resolved.modelsSource,
      configDefaultModel: resolved.configDefaultModel,
      effectiveModel: resolved.effectiveModel,
      reasoningEffort: resolved.reasoningEffort,
    });
    return;
  }

  if (req.method === "PUT" && pathname === "/api/settings") {
    const body = await readBody(req);
    const current = loadSettings();
    const next = {
      ...current,
      analysisModel: String(body.analysisModel ?? current.analysisModel ?? "").trim(),
      codexBinary: String(body.codexBinary ?? current.codexBinary ?? "auto").trim() || "auto",
      reasoningEffort: String(
        body.reasoningEffort ?? current.reasoningEffort ?? "medium",
      )
        .trim()
        .toLowerCase() || "medium",
      sandbox: "workspace-write",
    };
    if (!["low", "medium", "high", "xhigh", "minimal"].includes(next.reasoningEffort)) {
      next.reasoningEffort = "medium";
    }
    if (body.autoSeedAfterWrite != null) {
      next.autoSeedAfterWrite = Boolean(body.autoSeedAfterWrite);
    }
    if (body.autoPushAfterAnalyze != null) {
      next.autoPushAfterAnalyze = Boolean(body.autoPushAfterAnalyze);
    }
    if (body.autoTriggerPricesWorkflow != null) {
      next.autoTriggerPricesWorkflow = Boolean(body.autoTriggerPricesWorkflow);
    }
    if (body.pricesWorkflowLocalFallback != null) {
      next.pricesWorkflowLocalFallback = Boolean(body.pricesWorkflowLocalFallback);
    }
    saveJson(settingsPath, next);
    const resolved = resolvedCodex();
    json(res, 200, {
      ...next,
      resolvedBinary: resolved.binary.path,
      binarySource: resolved.binary.source,
      binaryOk: resolved.binary.ok,
      version: resolved.version,
      models: resolved.models,
      modelsSource: resolved.modelsSource,
      configDefaultModel: resolved.configDefaultModel,
      effectiveModel: resolved.effectiveModel,
      reasoningEffort: resolved.reasoningEffort,
    });
    return;
  }

  // Preview name/industry by code only (does not write source)
  if (req.method === "GET" && pathname.startsWith("/api/lookup/")) {
    const symbol = pathname.split("/").pop() ?? "";
    try {
      const meta = await lookupStock(symbol);
      const exists = loadSource().some((s) => s.symbol === meta.symbol);
      json(res, 200, { ...meta, exists });
    } catch (error) {
      json(res, 400, { error: String(error.message ?? error) });
    }
    return;
  }

  // Add stock: body = { symbol } only; name/industry from lookup
  if (req.method === "POST" && pathname === "/api/stocks") {
    const body = await readBody(req);
    const symbol = String(body.symbol ?? "").replace(/\D/g, "");
    if (!/^\d{6}$/.test(symbol)) {
      json(res, 400, { error: "symbol must be 6 digits" });
      return;
    }
    const stocks = loadSource();
    if (stocks.some((s) => s.symbol === symbol)) {
      json(res, 409, { error: `${symbol} already exists` });
      return;
    }

    let meta;
    try {
      meta = await lookupStock(symbol);
    } catch (error) {
      json(res, 400, { error: String(error.message ?? error) });
      return;
    }

    // Local quote for immediate UI (not committed here — CI owns prices git)
    if (meta.currentPrice != null) {
      upsertPriceQuote(meta.symbol, meta.currentPrice, meta.asOf);
    }

    const prices = loadPrices();
    const stock = buildStockFromLookup(
      meta,
      prices.quotes?.[symbol]?.currentPrice ?? meta.currentPrice,
    );
    stocks.push(stock);
    saveJson(sourcePath, stocks);

    let seedLog = null;
    let seedError = null;
    try {
      seedLog = maybeSeed();
    } catch (error) {
      seedError = String(error.message ?? error);
    }

    // Push source (draft row) so pool is on git; prices via CI workflow
    let pushResult = null;
    let pushError = null;
    if (loadSettings().autoPushAfterAnalyze !== false) {
      try {
        pushResult = pushSource({
          message: `pool: add ${stock.symbol} ${stock.name} (draft)`,
        });
      } catch (error) {
        pushError = String(error.message ?? error);
      }
    }

    const pricesTrigger = await maybeTriggerPrices("add-stock");

    json(res, 201, {
      stock: stockRow(stock, loadPrices()),
      lookup: meta,
      seedLog,
      seedError,
      push: pushResult,
      pushError,
      pricesTrigger,
      note:
        "已录入草稿。现价本地已写入；价格 Git 更新走 CI workflow。请点「AI 分析」生成价值投资字段。",
    });
    return;
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/stocks/")) {
    const symbol = pathname.split("/").pop() ?? "";
    const stocks = loadSource();
    const next = stocks.filter((s) => s.symbol !== symbol);
    if (next.length === stocks.length) {
      json(res, 404, { error: `${symbol} not found` });
      return;
    }
    saveJson(sourcePath, next);
    const prices = loadPrices();
    if (prices.quotes?.[symbol]) {
      delete prices.quotes[symbol];
      saveJson(pricesPath, prices);
    }
    json(res, 200, { removed: symbol, seedLog: maybeSeed() });
    return;
  }

  if (req.method === "POST" && pathname === "/api/seed") {
    json(res, 200, { log: runSeed() });
    return;
  }

  if (req.method === "POST" && pathname === "/api/prices/trigger") {
    try {
      const result = await triggerPricesWorkflow({
        localFallback: loadSettings().pricesWorkflowLocalFallback !== false,
      });
      json(res, 200, result);
    } catch (error) {
      json(res, 500, { error: String(error.message ?? error) });
    }
    return;
  }

  // Deterministic ingest only (if run file already exists)
  if (req.method === "POST" && pathname.startsWith("/api/ingest/")) {
    const symbol = pathname.split("/").pop() ?? "";
    try {
      const result = ingestAnalysis(symbol);
      const seedLog = maybeSeed();
      json(res, 200, { ingest: result, seedLog });
    } catch (error) {
      json(res, 400, { error: String(error.message ?? error) });
    }
    return;
  }

  // Async full pipeline: returns job immediately; poll /api/jobs/:id
  if (req.method === "POST" && pathname.startsWith("/api/analyze/")) {
    const symbol = pathname.split("/").pop() ?? "";
    const stock = loadSource().find((s) => s.symbol === symbol);
    if (!stock) {
      json(res, 404, { error: `${symbol} not found` });
      return;
    }
    const resolved = resolvedCodex();
    if (!resolved.binary.ok || !resolved.binary.path) {
      json(res, 500, {
        error: resolved.binary.error || "Codex binary not found",
        binary: resolved.binary,
      });
      return;
    }
    if (!resolved.effectiveModel) {
      json(res, 400, { error: "No analysis model selected and no Codex default found" });
      return;
    }

    try {
      const job = createAnalyzeJob({
        symbol: stock.symbol,
        name: stock.name,
        model: resolved.effectiveModel,
        reasoningEffort: resolved.reasoningEffort,
      });
      runAnalyzeJob(job.id);
      json(res, 202, {
        accepted: true,
        job: jobPublic(job),
        poll: `/api/jobs/${job.id}`,
        model: resolved.effectiveModel,
        reasoningEffort: resolved.reasoningEffort,
        note: "分析已在后台启动。管理页会轮询进度；勿关闭 admin 进程。",
      });
    } catch (error) {
      if (error.code === "JOB_ACTIVE") {
        json(res, 409, {
          error: String(error.message ?? error),
          job: jobPublic(error.job),
        });
        return;
      }
      json(res, 500, { error: String(error.message ?? error) });
    }
    return;
  }

  res.writeHead(404).end("Not found");
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/admin")) {
      serveStatic(res, resolve(publicDir, "index.html"));
      return;
    }
    await handleApi(req, res, url.pathname);
  } catch (error) {
    json(res, 500, { error: String(error.message ?? error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Admin listening on http://${HOST}:${PORT}`);
  console.log(`Repo root: ${root}`);
});
