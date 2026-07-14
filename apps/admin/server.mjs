import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  analyzePrompt,
  buildStockFromLookup,
  ingestAnalysis,
  loadPrices,
  loadSettings,
  loadSource,
  lookupStock,
  pricesPath,
  pushSource,
  root,
  runPathFor,
  runSeed,
  saveJson,
  settingsPath,
  sourcePath,
  upsertPriceQuote,
} from "./lib/data.mjs";
import {
  analyzeSpawnOptions,
  buildAnalyzeExecArgs,
  codexVersion,
  listCodexModels,
  readCodexConfigDefaultModel,
  resolveCodexBinary,
} from "./lib/codex.mjs";

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
    "";
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
    sandbox: "workspace-write",
  };
}

function stockRow(stock, prices) {
  return {
    ...stock,
    currentPrice: prices.quotes?.[stock.symbol]?.currentPrice ?? null,
    asOf: prices.quotes?.[stock.symbol]?.asOf ?? prices.asOf ?? null,
    hasDetailAnalysis: Boolean(stock.analysis?.business && !String(stock.analysis.business).includes("【草稿】")),
  };
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
    });
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
      sandbox: "workspace-write",
    };
    if (body.autoSeedAfterWrite != null) {
      next.autoSeedAfterWrite = Boolean(body.autoSeedAfterWrite);
    }
    if (body.autoPushAfterAnalyze != null) {
      next.autoPushAfterAnalyze = Boolean(body.autoPushAfterAnalyze);
    }
    saveJson(settingsPath, next);
    json(res, 200, { ...next, ...resolvedCodex() });
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

    json(res, 201, {
      stock: stockRow(stock, loadPrices()),
      lookup: meta,
      seedLog,
      seedError,
      note: "已录入草稿。请点「AI 分析」生成价值投资字段并入库。",
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

  // Full pipeline: codex → ingest → seed → push source only
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

    const lastMessagePath = resolve(root, "data/anysis/runs", `${symbol}.last.txt`);
    const args = buildAnalyzeExecArgs({
      model: resolved.effectiveModel,
      workspace: root,
      prompt: analyzePrompt(stock, resolved.effectiveModel),
      lastMessagePath,
    });
    const result = spawnSync(
      resolved.binary.path,
      args,
      analyzeSpawnOptions(root),
    );

    if (result.error || result.status !== 0 || result.signal) {
      json(res, 500, {
        stage: "codex",
        status: result.status,
        signal: result.signal ?? null,
        error: result.error ? String(result.error.message ?? result.error) : null,
        stdout: result.stdout,
        stderr: result.stderr,
        command: [resolved.binary.path, ...args.slice(0, -1), "<prompt>"].join(" "),
        model: resolved.effectiveModel,
        runPath: runPathFor(symbol),
        lastMessagePath,
        hint:
          result.signal === "SIGTERM"
            ? "Codex timed out (25m). Check network/auth or re-run analyze."
            : "Headless exec uses approval_policy=never + empty mcp_servers. Inspect stderr/last message.",
      });
      return;
    }

    let ingestResult;
    try {
      ingestResult = ingestAnalysis(symbol);
    } catch (error) {
      json(res, 500, {
        stage: "ingest",
        error: String(error.message ?? error),
        stdout: result.stdout,
        stderr: result.stderr,
        runPath: runPathFor(symbol),
        hint: "Codex 已结束但 run JSON 校验失败。请检查 data/anysis/runs/<symbol>.json 后可 POST /api/ingest/:symbol 重试。",
      });
      return;
    }

    let seedLog = null;
    let seedError = null;
    try {
      seedLog = runSeed();
    } catch (error) {
      seedError = String(error.message ?? error);
    }

    let pushResult = null;
    let pushError = null;
    if (loadSettings().autoPushAfterAnalyze !== false) {
      try {
        pushResult = pushSource({
          message: `analysis: update ${stock.symbol} ${stock.name}`,
        });
      } catch (error) {
        pushError = String(error.message ?? error);
      }
    }

    json(res, seedError ? 500 : 200, {
      stage: "done",
      status: 0,
      model: resolved.effectiveModel,
      ingest: ingestResult,
      seedLog,
      seedError,
      push: pushResult,
      pushError,
      stock: stockRow(
        loadSource().find((s) => s.symbol === symbol),
        loadPrices(),
      ),
      stdoutTail: (result.stdout || "").slice(-4000),
    });
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
  console.log(`Admin (local only) → http://${HOST}:${PORT}/admin`);
  console.log(`Shared data root: ${root}/data`);
});
