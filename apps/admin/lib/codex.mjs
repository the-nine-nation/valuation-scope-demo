import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";

const MAC_CANDIDATES = [
  "/Applications/ChatGPT.app/Contents/Resources/codex",
  "/Applications/Codex.app/Contents/Resources/codex",
  "/Applications/Codex.app/Contents/MacOS/codex",
];

function isExecutable(path) {
  if (!path || !existsSync(path)) return false;
  try {
    const result = spawnSync(path, ["--version"], {
      encoding: "utf8",
      timeout: 8000,
    });
    return result.status === 0 || Boolean(result.stdout || result.stderr);
  } catch {
    return false;
  }
}

function whichFromPath(name = "codex") {
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

/** Resolve Codex CLI path: explicit setting → PATH → macOS app bundles. */
export function resolveCodexBinary(preferred) {
  const trimmed = String(preferred ?? "").trim();
  if (trimmed && trimmed !== "auto" && trimmed !== "codex") {
    if (isExecutable(trimmed)) {
      return { path: trimmed, source: "settings", ok: true };
    }
    return {
      path: trimmed,
      source: "settings",
      ok: false,
      error: `configured path not executable: ${trimmed}`,
    };
  }

  if (trimmed === "codex" || !trimmed || trimmed === "auto") {
    const fromPath = whichFromPath("codex");
    if (fromPath) return { path: fromPath, source: "PATH", ok: true };
  }

  for (const candidate of MAC_CANDIDATES) {
    if (isExecutable(candidate)) {
      return { path: candidate, source: "app-bundle", ok: true };
    }
  }

  return {
    path: null,
    source: "none",
    ok: false,
    error:
      "Codex CLI not found. Install ChatGPT/Codex app or put `codex` on PATH.",
  };
}

function parseModelsJson(raw) {
  const data = JSON.parse(raw);
  const list = Array.isArray(data?.models) ? data.models : [];
  return list
    .filter((m) => m && typeof m.slug === "string")
    .filter((m) => m.visibility !== "hide")
    .map((m) => ({
      slug: m.slug,
      displayName: m.display_name ?? m.slug,
      description: m.description ?? "",
      defaultReasoning: m.default_reasoning_level ?? null,
    }));
}

function modelsFromCache() {
  const cachePath = join(homedir(), ".codex", "models_cache.json");
  if (!existsSync(cachePath)) return null;
  try {
    return {
      models: parseModelsJson(readFileSync(cachePath, "utf8")),
      source: "models_cache.json",
    };
  } catch {
    return null;
  }
}

/** Live model list via `codex debug models`, with cache / bundled fallback. */
export function listCodexModels(binaryPath) {
  if (!binaryPath) {
    const cached = modelsFromCache();
    if (cached?.models?.length) return { ...cached, ok: true };
    return { ok: false, models: [], source: "none", error: "no codex binary" };
  }

  for (const mode of ["live", "bundled"]) {
    const args = mode === "bundled" ? ["debug", "models", "--bundled"] : ["debug", "models"];
    const result = spawnSync(binaryPath, args, {
      encoding: "utf8",
      timeout: 20_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (result.status === 0 && result.stdout?.trim()) {
      try {
        return {
          ok: true,
          models: parseModelsJson(result.stdout),
          source: mode === "bundled" ? "debug models --bundled" : "debug models",
        };
      } catch {
        /* try next */
      }
    }
  }

  const cached = modelsFromCache();
  if (cached?.models?.length) return { ...cached, ok: true };

  return {
    ok: false,
    models: [],
    source: "none",
    error: "failed to list models from codex",
  };
}

export function readCodexConfigDefaultModel() {
  const configPath = join(homedir(), ".codex", "config.toml");
  if (!existsSync(configPath)) return null;
  const text = readFileSync(configPath, "utf8");
  const match = text.match(/^\s*model\s*=\s*"([^"]+)"/m);
  return match?.[1] ?? null;
}

export function codexVersion(binaryPath) {
  if (!binaryPath) return null;
  const result = spawnSync(binaryPath, ["--version"], {
    encoding: "utf8",
    timeout: 8000,
  });
  return (result.stdout || result.stderr || "").trim() || null;
}

/**
 * Non-interactive `codex exec` args for admin analyze.
 * Forces no approval prompts and empty MCP list so headless runs don't hang
 * on interactive-feedback / browser / node_repl MCP servers from ~/.codex.
 */
export function buildAnalyzeExecArgs({
  model,
  workspace,
  prompt,
  lastMessagePath = null,
}) {
  const args = [
    "exec",
    "-m",
    model,
    "-C",
    workspace,
    "--sandbox",
    "workspace-write",
    "--color",
    "never",
    // Headless automation: never block on approval UI
    "-c",
    'approval_policy="never"',
    // Disable user MCP servers (many require interactive approve / hang)
    "-c",
    "mcp_servers={}",
    // Avoid desktop notify hooks in non-interactive spawn
    "-c",
    "notify=[]",
  ];
  if (lastMessagePath) {
    args.push("-o", lastMessagePath);
  }
  args.push(prompt);
  return args;
}

/** spawnSync options for long-running analyze (no stdin hang). */
export function analyzeSpawnOptions(workspace, timeoutMs = 25 * 60 * 1000) {
  return {
    cwd: workspace,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
    timeout: timeoutMs,
    // Critical: without this, codex may wait for more stdin forever
    stdio: ["ignore", "pipe", "pipe"],
  };
}
