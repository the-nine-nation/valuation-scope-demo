/**
 * Commit + push only data/stocks.source.json (value-investing authority source).
 * Never stages prices, generated snapshots, settings, or admin code.
 *
 * CLI:
 *   node tools/scripts/push-source.mjs --message "analysis: update 600519"
 *   node tools/scripts/push-source.mjs --dry-run
 */
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REL = "data/stocks.source.json";

function git(args, { allowFail = false } = {}) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GIT_MASTER: "1" },
  });
  if (!allowFail && result.status !== 0) {
    const err = (result.stderr || result.stdout || "git failed").trim();
    throw new Error(err || `git ${args.join(" ")} failed`);
  }
  return {
    status: result.status ?? 1,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
  };
}

/**
 * @param {{ message?: string, dryRun?: boolean, remote?: string, branch?: string }} [options]
 */
export function pushSource(options = {}) {
  const message =
    options.message ||
    `analysis: update stocks.source.json (${new Date().toISOString().slice(0, 10)})`;
  const remote = options.remote || "origin";
  const branch = options.branch || "main";
  const dryRun = Boolean(options.dryRun);

  // Ensure only source file is dirty among staged intent
  const status = git(["status", "--porcelain", "--", REL]);
  if (!status.stdout) {
    return {
      ok: true,
      skipped: true,
      reason: "no changes in data/stocks.source.json",
    };
  }

  // Refuse if other unexpected paths would be mixed — we only add REL
  git(["add", "--", REL]);
  const staged = git(["diff", "--cached", "--name-only"]);
  const stagedFiles = staged.stdout.split("\n").filter(Boolean);
  if (stagedFiles.length === 0) {
    return { ok: true, skipped: true, reason: "nothing staged" };
  }
  if (stagedFiles.some((f) => f !== REL)) {
    git(["reset", "HEAD", "--", ...stagedFiles], { allowFail: true });
    throw new Error(`refusing to commit unexpected staged files: ${stagedFiles.join(", ")}`);
  }

  if (dryRun) {
    git(["reset", "HEAD", "--", REL], { allowFail: true });
    return { ok: true, dryRun: true, wouldCommit: REL, message };
  }

  git(["commit", "-m", message]);
  const push = git(["push", remote, branch]);
  return {
    ok: true,
    committed: REL,
    message,
    push: push.stdout || "pushed",
  };
}

if (process.argv[1]?.endsWith("push-source.mjs")) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const mi = args.indexOf("--message");
  const message = mi >= 0 ? args[mi + 1] : undefined;
  try {
    const result = pushSource({ dryRun, message });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}
