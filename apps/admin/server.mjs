import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  analyzePrompt,
  buildStock,
  loadPrices,
  loadSettings,
  loadSource,
  pricesPath,
  root,
  runSeed,
  saveJson,
  settingsPath,
  sourcePath,
} from "./lib/data.mjs";
import {
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
      stocks: stocks.map((stock) => ({
        ...stock,
        currentPrice: prices.quotes?.[stock.symbol]?.currentPrice ?? null,
        asOf: prices.quotes?.[stock.symbol]?.asOf ?? prices.asOf ?? null,
      })),
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
      // analysis always needs write access to data/
      sandbox: "workspace-write",
    };
    if (body.autoSeedAfterWrite != null) {
      next.autoSeedAfterWrite = Boolean(body.autoSeedAfterWrite);
    }
    saveJson(settingsPath, next);
    json(res, 200, { ...next, ...resolvedCodex() });
    return;
  }

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
    const prices = loadPrices();
    const stock = buildStock({ ...body, symbol }, prices.quotes?.[symbol]?.currentPrice);
    stocks.push(stock);
    saveJson(sourcePath, stocks);
    json(res, 201, { stock, seedLog: maybeSeed() });
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
    const args = [
      "exec",
      "-m",
      resolved.effectiveModel,
      "-C",
      root,
      "--sandbox",
      "workspace-write",
      analyzePrompt(stock, resolved.effectiveModel),
    ];
    const result = spawnSync(resolved.binary.path, args, {
      cwd: root,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 16 * 1024 * 1024,
    });
    json(res, result.status === 0 ? 200 : 500, {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      command: [resolved.binary.path, ...args].join(" "),
      model: resolved.effectiveModel,
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
