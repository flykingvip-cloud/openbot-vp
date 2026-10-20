#!/usr/bin/env node
/**
 * Bulk memory reindex helper for dual-tree / v1-root-guard sidecar conflicts.
 *
 * Prerequisites:
 *   - memory-platform-audit.mjs shows workspace paths are correct (P0 fixed)
 *   - OPENBOT_V1_ROOT_GUARD_SECRET set in environment (>=16 chars)
 *
 * Usage (inside gateway container or via podman exec -e):
 *
 *   OPENBOT_V1_ROOT_GUARD_SECRET='...' \
 *     node scripts/memory-platform-recovery.mjs --agent <id>
 *
 *   OPENBOT_V1_ROOT_GUARD_SECRET='...' \
 *     node scripts/memory-platform-recovery.mjs --all-conflict --dry-run
 *
 * `--all-conflict` discovers agents from sidecar files and dual-tree evidence.
 * `--all-preset-deny` is a deprecated alias of `--all-conflict` (no hardcoded ids).
 *
 * Emits shell commands; by default runs `openbot memory index --force` per agent.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { signMaintenanceGrant } from "../docs/design/evidence/memory-workspace-phase0-v1-root-fingerprint.mjs";
import { listConflictAgentIds } from "./memory-platform-audit.mjs";

function die(message, code = 2) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function expandUserPath(value) {
  if (value === "~") {
    return process.env.HOME || value;
  }
  if (value.startsWith("~/")) {
    return path.join(process.env.HOME || "", value.slice(2));
  }
  return value;
}

function resolveSqlitePath(stateDir, agentId) {
  return path.resolve(expandUserPath(path.join(stateDir, "memory", `${agentId}.sqlite`)));
}

function parseArgs(argv) {
  const agents = [];
  let allConflict = false;
  let dryRun = false;
  let ttlMinutes = 30;
  let reason = "platform memory recovery bulk reindex";
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--agent") {
      agents.push(argv[++i] ?? "");
    } else if (arg.startsWith("--agent=")) {
      agents.push(arg.slice("--agent=".length));
    } else if (arg === "--all-conflict" || arg === "--all-preset-deny") {
      allConflict = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--ttl-minutes") {
      ttlMinutes = Number(argv[++i]);
    } else if (arg.startsWith("--ttl-minutes=")) {
      ttlMinutes = Number(arg.slice("--ttl-minutes=".length));
    } else if (arg === "--reason") {
      reason = argv[++i] ?? reason;
    } else if (arg.startsWith("--reason=")) {
      reason = arg.slice("--reason=".length);
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "Usage: OPENBOT_V1_ROOT_GUARD_SECRET=... node scripts/memory-platform-recovery.mjs [--agent id ...] [--all-conflict] [--dry-run]\n",
      );
      process.exit(0);
    } else {
      die(`unknown argument: ${arg}`);
    }
  }
  return { agents: agents.filter(Boolean), allConflict, dryRun, ttlMinutes, reason };
}

function runIndex(agentId, secret, token) {
  const result = spawnSync("openbot", ["memory", "index", "--force", "--agent", agentId], {
    env: {
      ...process.env,
      OPENBOT_V1_ROOT_GUARD_SECRET: secret,
      OPENBOT_V1_ROOT_GUARD_TOKEN: token,
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function main() {
  const args = parseArgs(process.argv);
  const secret = process.env.OPENBOT_V1_ROOT_GUARD_SECRET?.trim();
  if (!secret || secret.length < 16) {
    die("OPENBOT_V1_ROOT_GUARD_SECRET must be set (>=16 chars)");
  }
  const stateDir = path.resolve(expandUserPath(process.env.OPENBOT_STATE_DIR || "~/.openbot"));
  const tenantsRoot = process.env.OPENBOT_TENANTS_ROOT
    ? path.resolve(expandUserPath(process.env.OPENBOT_TENANTS_ROOT))
    : "";
  const targetAgents = args.allConflict ? listConflictAgentIds(stateDir, tenantsRoot) : args.agents;
  if (targetAgents.length === 0) {
    die("Specify --agent <id> or --all-conflict (discovers dual-tree / sidecar conflicts)");
  }
  const expiresAt = new Date(Date.now() + args.ttlMinutes * 60 * 1000).toISOString();
  const results = [];

  for (const agentId of targetAgents) {
    const sqlitePath = resolveSqlitePath(stateDir, agentId);
    if (!fs.existsSync(path.dirname(sqlitePath))) {
      results.push({
        agentId,
        ok: false,
        error: `memory dir missing: ${path.dirname(sqlitePath)}`,
      });
      continue;
    }
    const token = signMaintenanceGrant({
      secret,
      sqlitePath,
      op: "rebuild",
      reason: `${args.reason} (${agentId})`,
      expiresAt,
    });
    if (args.dryRun) {
      process.stdout.write(
        `# ${agentId}\nexport OPENBOT_V1_ROOT_GUARD_TOKEN='${token}'\nopenbot memory index --force --agent ${agentId}\n\n`,
      );
      results.push({ agentId, ok: true, dryRun: true });
      continue;
    }
    const outcome = runIndex(agentId, secret, token);
    results.push({
      agentId,
      ok: outcome.ok,
      status: outcome.status,
      stderr: outcome.stderr.trim().slice(0, 500),
    });
    if (!outcome.ok) {
      process.stderr.write(`[fail] ${agentId}: ${outcome.stderr.trim()}\n`);
    } else {
      process.stdout.write(`[ok] ${agentId}\n`);
    }
  }

  const failed = results.filter((row) => !row.ok);
  if (failed.length > 0 && !args.dryRun) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main();
}
