/**
 * Async analyze pipeline: spawn codex with JSON events → ingest → seed → push source.
 */
import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  analyzePrompt,
  ingestAnalysis,
  loadSettings,
  loadSource,
  loadPrices,
  pushSource,
  root,
  runPathFor,
  runSeed,
} from "./data.mjs";
import {
  buildAnalyzeExecArgs,
  resolveCodexBinary,
  summarizeCodexJsonLine,
} from "./codex.mjs";
import { appendJobLog, updateJob } from "./jobs.mjs";
import { triggerPricesWorkflow } from "../../../tools/scripts/trigger-prices-workflow.mjs";

const DEFAULT_TIMEOUT_MS = 25 * 60 * 1000;

function stockRowLite(stock) {
  const prices = loadPrices();
  return {
    symbol: stock.symbol,
    name: stock.name,
    quality: stock.quality,
    idealPrice: stock.idealPrice,
    model: stock.analysis?.model ?? null,
    summary: stock.analysis?.summary ?? null,
    currentPrice: prices.quotes?.[stock.symbol]?.currentPrice ?? null,
    asOf: prices.quotes?.[stock.symbol]?.asOf ?? null,
  };
}

/**
 * Run full analyze pipeline for an existing job id (fire-and-forget).
 * @param {string} jobId
 * @param {{ timeoutMs?: number }} [options]
 */
export function runAnalyzeJob(jobId, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // defer so createAnalyzeJob can return first
  setImmediate(() => {
    void executeAnalyzeJob(jobId, timeoutMs).catch((error) => {
      updateJob(jobId, {
        status: "error",
        stage: "error",
        error: String(error.message ?? error),
        log: `fatal: ${error.message ?? error}`,
      });
    });
  });
}

/**
 * @param {string} jobId
 * @param {number} timeoutMs
 */
async function executeAnalyzeJob(jobId, timeoutMs) {
  const settings = loadSettings();
  const jobStart = updateJob(jobId, {
    status: "running",
    stage: "codex",
    startedAt: Date.now(),
    log: "starting codex exec…",
  });
  if (!jobStart) return;

  const stock = loadSource().find((s) => s.symbol === jobStart.symbol);
  if (!stock) {
    updateJob(jobId, {
      status: "error",
      stage: "error",
      error: `${jobStart.symbol} not in stocks.source.json`,
      log: "stock missing from source",
    });
    return;
  }

  const binary = resolveCodexBinary(settings.codexBinary);
  if (!binary.ok || !binary.path) {
    updateJob(jobId, {
      status: "error",
      stage: "error",
      error: binary.error || "Codex binary not found",
      log: binary.error || "no codex binary",
    });
    return;
  }

  const model = jobStart.model;
  const reasoningEffort = jobStart.reasoningEffort || settings.reasoningEffort || "medium";
  const lastMessagePath = resolve(root, "data/anysis/runs", `${stock.symbol}.last.txt`);
  const stderrPath = resolve(root, "data/anysis/runs", `${stock.symbol}.codex.stderr.log`);
  const args = buildAnalyzeExecArgs({
    model,
    workspace: root,
    prompt: analyzePrompt(stock, model),
    lastMessagePath,
    reasoningEffort,
    jsonEvents: true,
  });

  appendJobLog(
    jobId,
    `codex ${binary.path} · -m ${model} · reasoning=${reasoningEffort}`,
  );

  const exit = await spawnCodexWithProgress({
    jobId,
    binaryPath: binary.path,
    args,
    timeoutMs,
    stderrPath,
  });

  if (exit.signal === "SIGTERM" || exit.timedOut) {
    updateJob(jobId, {
      status: "error",
      stage: "error",
      error: `Codex timed out after ${Math.round(timeoutMs / 60000)}m`,
      log: `timeout ${timeoutMs}ms`,
    });
    return;
  }
  if (exit.code !== 0) {
    updateJob(jobId, {
      status: "error",
      stage: "error",
      error: `Codex exit ${exit.code}${exit.error ? `: ${exit.error}` : ""}`,
      log: `codex exit ${exit.code}`,
    });
    return;
  }

  if (!existsSync(runPathFor(stock.symbol))) {
    updateJob(jobId, {
      status: "error",
      stage: "error",
      error: `Codex finished but missing ${runPathFor(stock.symbol)}`,
      log: "run json missing",
    });
    return;
  }

  updateJob(jobId, { stage: "ingest", log: "ingest-analysis…" });
  let ingestResult;
  try {
    ingestResult = ingestAnalysis(stock.symbol);
    appendJobLog(
      jobId,
      `ingest ok · quality=${ingestResult.quality} · ideal=${ingestResult.idealPrice}`,
    );
  } catch (error) {
    updateJob(jobId, {
      status: "error",
      stage: "error",
      error: `ingest: ${error.message ?? error}`,
      log: `ingest failed: ${error.message ?? error}`,
    });
    return;
  }

  let seedLog = null;
  let seedError = null;
  updateJob(jobId, { stage: "seed", log: "seed…" });
  try {
    seedLog = runSeed();
    appendJobLog(jobId, "seed ok");
  } catch (error) {
    seedError = String(error.message ?? error);
    appendJobLog(jobId, `seed error: ${seedError}`);
  }

  let pushResult = null;
  let pushError = null;
  if (settings.autoPushAfterAnalyze !== false) {
    updateJob(jobId, { stage: "push", log: "push-source (analysis only)…" });
    try {
      pushResult = pushSource({
        message: `analysis: update ${stock.symbol} ${stock.name}`,
      });
      appendJobLog(
        jobId,
        pushResult.skipped
          ? `push skipped: ${pushResult.reason}`
          : `push ok: ${pushResult.message || "pushed"}`,
      );
    } catch (error) {
      pushError = String(error.message ?? error);
      appendJobLog(jobId, `push error: ${pushError}`);
    }
  }

  let pricesTrigger = null;
  let pricesTriggerError = null;
  if (settings.autoTriggerPricesWorkflow !== false) {
    appendJobLog(jobId, "trigger prices workflow (CI)…");
    try {
      pricesTrigger = await triggerPricesWorkflow({
        localFallback: settings.pricesWorkflowLocalFallback !== false,
      });
      appendJobLog(
        jobId,
        `prices: ${pricesTrigger.method}${pricesTrigger.skippedRemote ? " (local only)" : ""}`,
      );
    } catch (error) {
      pricesTriggerError = String(error.message ?? error);
      appendJobLog(jobId, `prices trigger: ${pricesTriggerError}`);
    }
  }

  const updated = loadSource().find((s) => s.symbol === stock.symbol);
  updateJob(jobId, {
    status: seedError ? "error" : "done",
    stage: seedError ? "error" : "done",
    error: seedError,
    result: {
      ingest: ingestResult,
      seedLog,
      seedError,
      push: pushResult,
      pushError,
      pricesTrigger,
      pricesTriggerError,
      stock: updated ? stockRowLite(updated) : null,
      model,
      reasoningEffort,
      tokensUsed: jobStart.tokensUsed ?? null,
    },
    log: seedError ? `done with seed error` : "done",
  });
}

/**
 * @param {{ jobId: string, binaryPath: string, args: string[], timeoutMs: number, stderrPath: string }} opts
 */
function spawnCodexWithProgress(opts) {
  const { jobId, binaryPath, args, timeoutMs, stderrPath } = opts;
  return new Promise((resolvePromise) => {
    const child = spawn(binaryPath, args, {
      cwd: root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    updateJob(jobId, { pid: child.pid ?? null, log: `pid ${child.pid}` });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      appendJobLog(jobId, "timeout — sending SIGTERM");
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }, 5000);
    }, timeoutMs);

    let stdoutBuf = "";
    const stderrStream = createWriteStream(stderrPath, { flags: "w" });
    child.stderr?.pipe(stderrStream);

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdoutBuf += chunk;
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop() ?? "";
      for (const line of lines) {
        handleStdoutLine(jobId, line);
      }
    });

    // Also parse stderr JSONL if codex writes events there
    let stderrBuf = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderrBuf += chunk;
      if (stderrBuf.length > 64_000) {
        // keep tail for line parse
        stderrBuf = stderrBuf.slice(-32_000);
      }
      const lines = stderrBuf.split("\n");
      stderrBuf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim().startsWith("{")) handleStdoutLine(jobId, line);
      }
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      stderrStream.end();
      resolvePromise({ code: null, signal: null, error: String(error.message ?? error), timedOut });
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (stdoutBuf.trim()) handleStdoutLine(jobId, stdoutBuf);
      stderrStream.end();
      resolvePromise({ code, signal, error: null, timedOut });
    });
  });
}

function handleStdoutLine(jobId, line) {
  const summary = summarizeCodexJsonLine(line);
  if (!summary) return;
  if (summary.tokensUsed != null) {
    updateJob(jobId, {
      tokensUsed: summary.tokensUsed,
      log: summary.text,
    });
  } else {
    appendJobLog(jobId, summary.text);
  }
}
