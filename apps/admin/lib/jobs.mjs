/**
 * In-memory analyze job store for admin progress UI.
 * Single-process only (local 127.0.0.1 admin).
 */

import { randomUUID } from "node:crypto";

/** @typedef {'queued'|'running'|'codex'|'ingest'|'seed'|'push'|'done'|'error'} JobStage */

/**
 * @typedef {object} AnalyzeJob
 * @property {string} id
 * @property {string} symbol
 * @property {string} name
 * @property {JobStage} stage
 * @property {string} status // queued | running | done | error
 * @property {string} model
 * @property {string} reasoningEffort
 * @property {number} createdAt
 * @property {number} updatedAt
 * @property {number|null} startedAt
 * @property {number|null} finishedAt
 * @property {number|null} pid
 * @property {string[]} logs
 * @property {object|null} result
 * @property {string|null} error
 * @property {number|null} tokensUsed
 * @property {string|null} lastEvent
 */

/** @type {Map<string, AnalyzeJob>} */
const jobs = new Map();

/** @type {Map<string, string>} symbol -> active job id */
const activeBySymbol = new Map();

const MAX_LOGS = 200;
const MAX_JOBS = 40;

function now() {
  return Date.now();
}

function trimStore() {
  if (jobs.size <= MAX_JOBS) return;
  const sorted = [...jobs.values()].sort((a, b) => a.updatedAt - b.updatedAt);
  for (const job of sorted) {
    if (jobs.size <= MAX_JOBS) break;
    if (job.status === "running" || job.status === "queued") continue;
    jobs.delete(job.id);
    if (activeBySymbol.get(job.symbol) === job.id) {
      activeBySymbol.delete(job.symbol);
    }
  }
}

/**
 * @param {{ symbol: string, name?: string, model: string, reasoningEffort?: string }} input
 */
export function createAnalyzeJob(input) {
  const symbol = String(input.symbol);
  const existingId = activeBySymbol.get(symbol);
  if (existingId) {
    const existing = jobs.get(existingId);
    if (existing && (existing.status === "queued" || existing.status === "running")) {
      const err = new Error(`${symbol} 已有进行中的分析任务 ${existingId}`);
      err.code = "JOB_ACTIVE";
      err.job = existing;
      throw err;
    }
  }

  const id = randomUUID();
  /** @type {AnalyzeJob} */
  const job = {
    id,
    symbol,
    name: String(input.name || symbol),
    stage: "queued",
    status: "queued",
    model: String(input.model),
    reasoningEffort: String(input.reasoningEffort || "medium"),
    createdAt: now(),
    updatedAt: now(),
    startedAt: null,
    finishedAt: null,
    pid: null,
    logs: [],
    result: null,
    error: null,
    tokensUsed: null,
    lastEvent: null,
  };
  jobs.set(id, job);
  activeBySymbol.set(symbol, id);
  appendJobLog(id, `queued · model=${job.model} · reasoning=${job.reasoningEffort}`);
  trimStore();
  return job;
}

export function getJob(id) {
  return jobs.get(id) ?? null;
}

export function getActiveJobForSymbol(symbol) {
  const id = activeBySymbol.get(symbol);
  if (!id) return null;
  const job = jobs.get(id);
  if (!job) return null;
  if (job.status === "queued" || job.status === "running") return job;
  return null;
}

export function listJobs({ limit = 20 } = {}) {
  return [...jobs.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}

/**
 * @param {string} id
 * @param {Partial<AnalyzeJob> & { log?: string }} patch
 */
export function updateJob(id, patch) {
  const job = jobs.get(id);
  if (!job) return null;
  const { log, ...rest } = patch;
  Object.assign(job, rest, { updatedAt: now() });
  if (log) appendJobLog(id, log);
  if (job.status === "done" || job.status === "error") {
    job.finishedAt = job.finishedAt ?? now();
    if (activeBySymbol.get(job.symbol) === id) {
      activeBySymbol.delete(job.symbol);
    }
  }
  return job;
}

export function appendJobLog(id, line) {
  const job = jobs.get(id);
  if (!job) return null;
  const text = String(line).trim();
  if (!text) return job;
  job.logs.push(`[${new Date().toISOString().slice(11, 19)}] ${text}`);
  if (job.logs.length > MAX_LOGS) {
    job.logs.splice(0, job.logs.length - MAX_LOGS);
  }
  job.updatedAt = now();
  job.lastEvent = text;
  return job;
}

/** Public JSON shape for UI */
export function jobPublic(job) {
  if (!job) return null;
  return {
    id: job.id,
    symbol: job.symbol,
    name: job.name,
    stage: job.stage,
    status: job.status,
    model: job.model,
    reasoningEffort: job.reasoningEffort,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    pid: job.pid,
    logs: job.logs,
    result: job.result,
    error: job.error,
    tokensUsed: job.tokensUsed,
    lastEvent: job.lastEvent,
    elapsedMs:
      (job.finishedAt ?? now()) - (job.startedAt ?? job.createdAt),
  };
}
