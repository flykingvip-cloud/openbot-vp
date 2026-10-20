#!/usr/bin/env node
/**
 * Platform-wide memory path + index readiness audit (read-only).
 *
 * Run inside the gateway container (or any host with access to state + tenant roots):
 *
 *   OPENBOT_STATE_DIR=/root/.openbot \
 *   OPENBOT_TENANTS_ROOT=/data/tenants \
 *     node scripts/memory-platform-audit.mjs
 *
 *   OPENBOT_STATE_DIR=... OPENBOT_TENANTS_ROOT=... \
 *     node scripts/memory-platform-audit.mjs --json > /tmp/memory-audit.json
 *
 * Does not mutate indexes, workspaces, or sqlite files.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function die(message, code = 2) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function expandUserPath(value) {
  if (!value || typeof value !== "string") {
    return value;
  }
  if (value === "~") {
    return process.env.HOME || value;
  }
  if (value.startsWith("~/")) {
    return path.join(process.env.HOME || "", value.slice(2));
  }
  return value;
}

function resolvePath(value) {
  return path.resolve(expandUserPath(value));
}

function realpathSafe(value) {
  try {
    return fs.realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function countMemoryMarkdown(workspaceDir, limits) {
  const roots = [
    path.join(workspaceDir, "MEMORY.md"),
    path.join(workspaceDir, "memory.md"),
    path.join(workspaceDir, "memory"),
  ];
  let files = 0;
  const walk = (current, depth) => {
    if (files >= limits.maxFiles || depth > limits.maxDepth) {
      limits.truncated = true;
      return;
    }
    for (const entry of listDir(current)) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files += 1;
      }
    }
  };
  for (const candidate of roots.slice(0, 2)) {
    try {
      if (fs.statSync(candidate).isFile()) {
        files += 1;
      }
    } catch {}
  }
  const memoryDir = roots[2];
  try {
    if (fs.statSync(memoryDir).isDirectory()) {
      walk(memoryDir, 0);
    }
  } catch {}
  return files;
}

function readConfig(stateDir) {
  const cfgPath = path.join(stateDir, "openbot.json");
  if (!fs.existsSync(cfgPath)) {
    die(`missing config: ${cfgPath}`);
  }
  try {
    return JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } catch (err) {
    die(`failed to parse ${cfgPath}: ${String(err)}`);
  }
}

function listAgentIds(cfg) {
  const list = cfg?.agents?.list;
  if (!Array.isArray(list) || list.length === 0) {
    return ["main"];
  }
  const ids = [];
  const seen = new Set();
  for (const entry of list) {
    const id = typeof entry?.id === "string" ? entry.id.trim() : "";
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    ids.push(id);
  }
  return ids.length > 0 ? ids : ["main"];
}

function resolveDefaultAgentId(cfg) {
  const list = cfg?.agents?.list;
  if (!Array.isArray(list) || list.length === 0) {
    return "main";
  }
  const defaults = list.filter((entry) => entry?.default);
  if (defaults.length === 1 && typeof defaults[0]?.id === "string") {
    return defaults[0].id.trim();
  }
  if (list.length === 1 && typeof list[0]?.id === "string") {
    return list[0].id.trim();
  }
  return "main";
}

function resolveAgentEntry(cfg, agentId) {
  const list = cfg?.agents?.list;
  if (!Array.isArray(list)) {
    return undefined;
  }
  return list.find((entry) => entry?.id === agentId);
}

function configuredAuditAgentRoot(cfg, stateDir, agentId) {
  const entry = resolveAgentEntry(cfg, agentId);
  const configured = entry?.workspace?.trim();
  if (configured) {
    return resolvePath(configured);
  }
  const defaultAgentId = resolveDefaultAgentId(cfg);
  if (agentId === defaultAgentId) {
    const fallback = cfg?.agents?.defaults?.workspace?.trim();
    if (fallback) {
      return resolvePath(fallback);
    }
    return resolvePath(path.join(stateDir, "workspace"));
  }
  return resolvePath(path.join(stateDir, `workspace-${agentId}`));
}

function resolveSqlitePath(stateDir, agentId, cfg) {
  const entry = resolveAgentEntry(cfg, agentId);
  const storePath = entry?.memorySearch?.store?.path?.trim();
  if (storePath) {
    return resolvePath(storePath.replaceAll("{agentId}", agentId));
  }
  const defaultsStore = cfg?.agents?.defaults?.memorySearch?.store?.path?.trim();
  if (defaultsStore) {
    return resolvePath(defaultsStore.replaceAll("{agentId}", agentId));
  }
  return path.join(stateDir, "memory", `${agentId}.sqlite`);
}

function readSidecarFingerprints(sqlitePath) {
  const sidecar = `${sqlitePath}.v1-root-guard.json`;
  if (!fs.existsSync(sidecar)) {
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(sidecar, "utf8"));
    const fps = parsed?.fingerprints ?? parsed?.recordedFingerprints;
    return Array.isArray(fps) ? fps.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function fingerprintWorkspace(workspaceDir) {
  return crypto.createHash("sha256").update(realpathSafe(workspaceDir)).digest("hex").slice(0, 16);
}

function discoverTenantWorkspaceRoots(tenantsRoot, agentId) {
  const matches = [];
  if (!tenantsRoot || !fs.existsSync(tenantsRoot)) {
    return matches;
  }
  for (const tenant of listDir(tenantsRoot)) {
    if (!tenant.isDirectory()) {
      continue;
    }
    const usersRoot = path.join(tenantsRoot, tenant.name, "users");
    if (!fs.existsSync(usersRoot)) {
      continue;
    }
    for (const user of listDir(usersRoot)) {
      if (!user.isDirectory()) {
        continue;
      }
      for (const wsName of [`workspace-${agentId}`, agentId === "main" ? "workspace" : null]) {
        if (!wsName) {
          continue;
        }
        const dir = path.join(usersRoot, user.name, "OpenBot", wsName);
        if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
          matches.push({
            kind: "tenant_workspace",
            tenantId: tenant.name,
            userId: user.name,
            path: dir,
          });
        }
      }
    }
  }
  return matches;
}

function discoverCollaborationGroupRoots(stateDir, cfg) {
  const roots = [];
  const configured = cfg?.collaboration?.defaults?.workspace?.trim();
  const candidates = [];
  if (configured) {
    candidates.push({
      kind: "configured",
      dir: path.join(resolvePath(configured), "groups"),
    });
  }
  candidates.push({
    kind: "state_shared",
    dir: path.join(stateDir, "collaboration-shared", "groups"),
  });
  candidates.push({
    kind: "agent_fallback",
    dir: path.join(stateDir, "workspace", ".openbot", "collaboration", "groups"),
  });
  const seen = new Set();
  for (const candidate of candidates) {
    const key = realpathSafe(candidate.dir);
    if (seen.has(key) || !fs.existsSync(candidate.dir)) {
      continue;
    }
    seen.add(key);
    for (const entry of listDir(candidate.dir)) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) {
        continue;
      }
      let groupId;
      try {
        groupId = decodeURIComponent(entry.name);
      } catch {
        groupId = entry.name;
      }
      const groupDir = path.join(candidate.dir, entry.name);
      const memoryDir = path.join(groupDir, "memory");
      roots.push({
        source: candidate.kind,
        groupId,
        groupDir,
        memoryDir,
        memoryDirExists: fs.existsSync(memoryDir),
      });
    }
  }
  return roots;
}

function hasConflictEvidence({ sqlitePath, dualTreeSuspected }) {
  if (dualTreeSuspected) {
    return true;
  }
  if (fs.existsSync(`${sqlitePath}.v1-root-guard.json`)) {
    return true;
  }
  return readSidecarFingerprints(sqlitePath).length > 1;
}

function classifyAgentRecovery(params) {
  const {
    memoryMdAtResolved,
    alternateRoots,
    conflictByRule,
    secretConfigured,
    resolvedWorkspace,
  } = params;
  const bestAlternate = alternateRoots
    .filter((row) => row.memoryMd > memoryMdAtResolved)
    .toSorted((a, b) => b.memoryMd - a.memoryMd)[0];

  if (bestAlternate) {
    return {
      action: "fix-workspace-path",
      priority: "P0",
      detail: `Indexer uses ${resolvedWorkspace} (${memoryMdAtResolved} md) but tenant tree has ${bestAlternate.path} (${bestAlternate.memoryMd} md). Point agents.list[].workspace or bind mount to the tree that holds files.`,
    };
  }
  if (memoryMdAtResolved === 0) {
    return {
      action: "empty-workspace",
      priority: "P0",
      detail: `No memory markdown at resolved workspace. Verify volume mount and agents.list[].workspace for this agent.`,
    };
  }
  if (conflictByRule) {
    return {
      action: "v1-maintenance-unlock-then-reindex",
      priority: "P1",
      detail: secretConfigured
        ? `Dual-tree or v1-root-guard sidecar conflict. Run memory index --force with OPENBOT_V1_ROOT_GUARD_TOKEN grant after path is correct.`
        : `Dual-tree or v1-root-guard sidecar conflict. Configure OPENBOT_V1_ROOT_GUARD_SECRET in container env, issue signed grant, then memory index --force.`,
    };
  }
  return {
    action: "reindex-ready",
    priority: "P2",
    detail:
      "Workspace has markdown and no dual-tree/sidecar conflict. openbot memory index --force --agent <id> should work.",
  };
}

function inspectAgent(params) {
  const { stateDir, tenantsRoot, cfg, agentId, limits, backend, secretConfigured } = params;
  const resolvedWorkspace = configuredAuditAgentRoot(cfg, stateDir, agentId);
  const configuredWorkspace = resolveAgentEntry(cfg, agentId)?.workspace?.trim() || null;
  const sqlitePath = resolveSqlitePath(stateDir, agentId, cfg);
  const memoryMdAtResolved = countMemoryMarkdown(resolvedWorkspace, { ...limits });
  const hostCanonical = resolvePath(
    path.join(stateDir, agentId === "main" ? "workspace" : `workspace-${agentId}`),
  );
  const alternateRoots = [];
  for (const row of discoverTenantWorkspaceRoots(tenantsRoot, agentId)) {
    alternateRoots.push({
      ...row,
      memoryMd: countMemoryMarkdown(row.path, { ...limits }),
    });
  }
  if (realpathSafe(hostCanonical) !== realpathSafe(resolvedWorkspace)) {
    alternateRoots.unshift({
      kind: "host_canonical",
      path: hostCanonical,
      memoryMd: countMemoryMarkdown(hostCanonical, { ...limits }),
    });
  }
  const dualTree =
    alternateRoots.some((row) => row.memoryMd > 0) &&
    memoryMdAtResolved !== alternateRoots[0]?.memoryMd;
  const conflictByRule = hasConflictEvidence({ sqlitePath, dualTreeSuspected: dualTree });
  const recovery = classifyAgentRecovery({
    memoryMdAtResolved,
    alternateRoots,
    conflictByRule,
    secretConfigured,
    resolvedWorkspace,
  });
  return {
    agentId,
    backend,
    configuredWorkspace,
    resolvedWorkspace,
    resolvedWorkspaceFingerprint: fingerprintWorkspace(resolvedWorkspace),
    memoryMdAtResolved,
    sqlitePath,
    sqliteExists: fs.existsSync(sqlitePath),
    sqliteBytes: fs.existsSync(sqlitePath) ? fs.statSync(sqlitePath).size : 0,
    conflictByRule,
    knownConflict: conflictByRule,
    dualTreeSuspected: dualTree || conflictByRule,
    sidecarFingerprints: readSidecarFingerprints(sqlitePath),
    alternateRoots,
    recovery,
  };
}

export function listConflictAgentIds(stateDir, tenantsRoot = "") {
  const cfg = readConfig(stateDir);
  const limits = { maxFiles: 5000, maxDepth: 8, truncated: false };
  const fromConfig = listAgentIds(cfg)
    .map((agentId) =>
      inspectAgent({
        stateDir,
        tenantsRoot,
        cfg,
        agentId,
        limits,
        backend: cfg?.memory?.backend ?? "builtin",
        secretConfigured: false,
      }),
    )
    .filter((row) => row.conflictByRule)
    .map((row) => row.agentId);
  const memoryDir = path.join(stateDir, "memory");
  const fromSidecar = listDir(memoryDir)
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sqlite"))
    .map((entry) => entry.name.slice(0, -".sqlite".length))
    .filter((agentId) =>
      fs.existsSync(path.join(memoryDir, `${agentId}.sqlite.v1-root-guard.json`)),
    );
  return [...new Set([...fromConfig, ...fromSidecar])].toSorted((a, b) => a.localeCompare(b));
}

function parseArgs(argv) {
  return { json: argv.includes("--json") };
}

function main() {
  const args = parseArgs(process.argv);
  const stateDir = resolvePath(
    process.env.OPENBOT_STATE_DIR || path.join(process.env.HOME || "", ".openbot"),
  );
  const tenantsRoot = process.env.OPENBOT_TENANTS_ROOT
    ? resolvePath(process.env.OPENBOT_TENANTS_ROOT)
    : "";
  if (!fs.existsSync(stateDir)) {
    die(`OPENBOT_STATE_DIR not found: ${stateDir}`);
  }

  const cfg = readConfig(stateDir);
  const backend = cfg?.memory?.backend ?? "builtin";
  const secretConfigured =
    typeof process.env.OPENBOT_V1_ROOT_GUARD_SECRET === "string" &&
    process.env.OPENBOT_V1_ROOT_GUARD_SECRET.length >= 16;
  const limits = { maxFiles: 5000, maxDepth: 8, truncated: false };
  const agentIds = listAgentIds(cfg);
  const agents = [];
  const groups = discoverCollaborationGroupRoots(stateDir, cfg).map((row) => ({
    ...row,
    memoryMd: row.memoryDirExists ? countMemoryMarkdown(row.memoryDir, { ...limits }) : 0,
  }));

  for (const agentId of agentIds) {
    agents.push(
      inspectAgent({
        stateDir,
        tenantsRoot,
        cfg,
        agentId,
        limits,
        backend,
        secretConfigured,
      }),
    );
  }

  const summary = {
    agentCount: agents.length,
    groupCount: groups.length,
    backend,
    v1GuardSecretConfigured: secretConfigured,
    byRecoveryAction: agents.reduce((acc, row) => {
      acc[row.recovery.action] = (acc[row.recovery.action] ?? 0) + 1;
      return acc;
    }, {}),
    p0Blockers: agents.filter((row) => row.recovery.priority === "P0").length,
    conflictAgents: agents.filter((row) => row.conflictByRule).map((row) => row.agentId),
    presetDenyAgents: agents.filter((row) => row.conflictByRule).map((row) => row.agentId),
    emptyWorkspaceAgents: agents
      .filter((row) => row.memoryMdAtResolved === 0)
      .map((row) => row.agentId),
    dualTreeAgents: agents.filter((row) => row.dualTreeSuspected).map((row) => row.agentId),
  };

  const report = {
    schema: "memory-platform-audit/v1",
    probeUtc: new Date().toISOString(),
    stateDir,
    tenantsRoot: tenantsRoot || null,
    limits: { truncated: limits.truncated },
    summary,
    agents,
    groups,
    nextSteps: [
      "1. Fix all P0 path/empty-workspace rows before any reindex.",
      "2. Configure OPENBOT_V1_ROOT_GUARD_SECRET on gateway if missing (>=16 chars).",
      "3. For each dual-tree or sidecar-conflict agent: issue signed grant, then `openbot memory index --force --agent <id>`.",
      "4. Run `openbot memory status --index` for all agents; verify Indexed N/N and search hits.",
      "5. Restart gateway once bulk reindex completes.",
      "6. Plan Phase 1A workspace_id partition cutover — conflict detection stays rule-based until migration.",
    ],
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  process.stdout.write(`Memory platform audit @ ${report.probeUtc}\n`);
  process.stdout.write(`stateDir=${stateDir}\n`);
  process.stdout.write(`backend=${backend} v1Secret=${secretConfigured ? "set" : "MISSING"}\n\n`);
  for (const agent of agents) {
    process.stdout.write(
      `[${agent.recovery.priority}] ${agent.agentId}: md=${agent.memoryMdAtResolved} workspace=${agent.resolvedWorkspace}\n`,
    );
    process.stdout.write(`  sqlite=${agent.sqlitePath} conflictByRule=${agent.conflictByRule}\n`);
    process.stdout.write(`  action=${agent.recovery.action}: ${agent.recovery.detail}\n`);
    if (agent.alternateRoots.length > 0) {
      for (const alt of agent.alternateRoots) {
        process.stdout.write(`  alt ${alt.kind}: md=${alt.memoryMd} path=${alt.path}\n`);
      }
    }
    process.stdout.write("\n");
  }
  if (groups.length > 0) {
    process.stdout.write(`Collaboration groups (${groups.length}):\n`);
    for (const group of groups) {
      process.stdout.write(
        `  ${group.groupId}: memoryMd=${group.memoryMd} dir=${group.memoryDir} source=${group.source}\n`,
      );
    }
    process.stdout.write("\n");
  }
  process.stdout.write("Summary:\n");
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main();
}
