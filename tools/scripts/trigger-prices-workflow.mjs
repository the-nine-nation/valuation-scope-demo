/**
 * Trigger GitHub Actions "Daily prices and deploy" via workflow_dispatch,
 * so prices.snapshot.json is updated on git without mixing into analysis commits.
 *
 * CLI:
 *   node tools/scripts/trigger-prices-workflow.mjs
 *   node tools/scripts/trigger-prices-workflow.mjs --local-fallback
 *
 * Auth (first match wins):
 *   GH_TOKEN / GITHUB_TOKEN env
 *   `gh` CLI if installed and logged in
 */
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WORKFLOW_FILE = "daily-prices.yml";
const REPO_DEFAULT = "the-nine-nation/valuation-scope-demo";

function gitRemoteRepo() {
  const result = spawnSync("git", ["remote", "get-url", "origin"], {
    cwd: root,
    encoding: "utf8",
  });
  const url = (result.stdout || "").trim();
  const m = url.match(/github\.com[:/](.+?)(?:\.git)?$/i);
  return m?.[1] ?? REPO_DEFAULT;
}

function which(cmd) {
  const result = spawnSync("which", [cmd], { encoding: "utf8" });
  return result.status === 0 ? (result.stdout || "").trim() : null;
}

/**
 * @param {{ localFallback?: boolean, ref?: string }} [options]
 */
export async function triggerPricesWorkflow(options = {}) {
  const ref = options.ref || "main";
  const repo = gitRemoteRepo();
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
  const ghPath = which("gh");

  if (ghPath) {
    const result = spawnSync(
      ghPath,
      ["workflow", "run", WORKFLOW_FILE, "--ref", ref, "--repo", repo],
      { cwd: root, encoding: "utf8", env: process.env },
    );
    if (result.status === 0) {
      return {
        ok: true,
        method: "gh",
        repo,
        workflow: WORKFLOW_FILE,
        ref,
        stdout: (result.stdout || "").trim(),
      };
    }
    // fall through to token / local
    var ghError = (result.stderr || result.stdout || "gh workflow run failed").trim();
  }

  if (token) {
    const url = `https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "valuation-scope-admin",
      },
      body: JSON.stringify({ ref }),
    });
    if (response.status === 204 || response.ok) {
      return {
        ok: true,
        method: "api",
        repo,
        workflow: WORKFLOW_FILE,
        ref,
        status: response.status,
      };
    }
    const body = await response.text();
    if (!options.localFallback) {
      throw new Error(
        `workflow_dispatch failed HTTP ${response.status}: ${body.slice(0, 400)}` +
          (ghError ? ` (gh: ${ghError})` : ""),
      );
    }
    var apiError = `HTTP ${response.status}: ${body.slice(0, 200)}`;
  }

  if (options.localFallback) {
    const local = spawnSync(process.execPath, [resolve(root, "tools/scripts/update-prices.mjs")], {
      cwd: root,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (local.status !== 0) {
      throw new Error(
        `local prices:update failed: ${(local.stderr || local.stdout || "").trim()}` +
          (apiError ? ` · api: ${apiError}` : "") +
          (ghError ? ` · gh: ${ghError}` : ""),
      );
    }
    return {
      ok: true,
      method: "local-fallback",
      repo,
      workflow: WORKFLOW_FILE,
      note:
        "No gh/token for workflow_dispatch; ran prices:update locally. " +
        "prices.snapshot.json is local — CI still owns git commits for prices.",
      stdout: (local.stdout || "").trim().slice(-2000),
      skippedRemote: true,
      reason: apiError || ghError || "no GH_TOKEN/GITHUB_TOKEN and no gh CLI",
    };
  }

  throw new Error(
    "Cannot trigger prices workflow: install `gh` and login, or set GH_TOKEN/GITHUB_TOKEN." +
      (ghError ? ` gh: ${ghError}` : "") +
      (apiError ? ` api: ${apiError}` : ""),
  );
}

if (process.argv[1]?.endsWith("trigger-prices-workflow.mjs")) {
  const localFallback = process.argv.includes("--local-fallback");
  try {
    const result = await triggerPricesWorkflow({ localFallback });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}
