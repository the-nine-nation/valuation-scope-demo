#!/usr/bin/env node
/**
 * Ensure a TCP port is free before starting the app.
 * If the port is already in use, kill the listener(s) then re-check.
 *
 * Usage: node scripts/ensure-port.mjs [port]
 * Default port: 5566
 */

import { execSync } from "node:child_process";

const port = Number(process.argv[2] ?? process.env.PORT ?? 5566);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid port: ${process.argv[2] ?? process.env.PORT}`);
  process.exit(1);
}

function listListenerPids(targetPort) {
  try {
    const out = execSync(`lsof -tiTCP:${targetPort} -sTCP:LISTEN`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return [
      ...new Set(
        out
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .map((pid) => Number(pid))
          .filter((pid) => Number.isInteger(pid) && pid > 0),
      ),
    ];
  } catch {
    return [];
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function killPids(pids, signal) {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
      console.log(`  sent ${signal} to PID ${pid}`);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") {
        continue;
      }
      console.warn(`  failed to signal PID ${pid}:`, error);
    }
  }
}

const existing = listListenerPids(port);
if (existing.length === 0) {
  console.log(`Port ${port} is free.`);
  process.exit(0);
}

console.log(
  `Port ${port} is in use by PID(s): ${existing.join(", ")}. Freeing it...`,
);
killPids(existing, "SIGTERM");

const deadline = Date.now() + 3000;
while (Date.now() < deadline) {
  sleep(150);
  if (listListenerPids(port).length === 0) {
    console.log(`Port ${port} is now free.`);
    process.exit(0);
  }
}

const remaining = listListenerPids(port);
if (remaining.length > 0) {
  console.log(`Still occupied after SIGTERM, sending SIGKILL...`);
  killPids(remaining, "SIGKILL");
  sleep(200);
}

const after = listListenerPids(port);
if (after.length > 0) {
  console.error(
    `Could not free port ${port}. Still held by PID(s): ${after.join(", ")}`,
  );
  process.exit(1);
}

console.log(`Port ${port} is now free.`);
