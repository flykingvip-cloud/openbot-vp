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

import { spawnSync } from "node:child_process";
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

/**
 * Align with src/config/data-space.ts resolveDataRoot:
 * configured data.root wins; env OPENBOT_DATA_ROOT / OPENCLAW_DATA_ROOT only when config unset.
 */
function resolveAuditDataRoot(cfg) {
  const configured = cfg?.data?.root?.trim();
  if (configured) {
    return resolvePath(configured);
  }
  const dataRootEnv =
    process.env.OPENBOT_DATA_ROOT?.trim() || process.env.OPENCLAW_DATA_ROOT?.trim();
  if (dataRootEnv) {
    return resolvePath(dataRootEnv);
  }
  return resolvePath(path.join(process.env.HOME || "", "OpenBot"));
}

function resolveCogniWeaveStorePath(stateDir, cfg) {
  const explicit = cfg?.memory?.cogniweave?.storePath?.trim();
  if (explicit) {
    return resolvePath(explicit);
  }
  const dataRoot = resolveAuditDataRoot(cfg);
  return path.join(dataRoot, ".meta", "cogniweave", "canonical.sqlite");
}

/**
 * Mirror src/memory/cogniweave-manager.ts stableId for legacy workspaceId.
 * Do NOT invent production config fields (memoryScope / defaultScope / expectedEmpty).
 */
function stableId(prefix, input) {
  return `${prefix}_${crypto.createHash("sha256").update(input).digest("hex").slice(0, 16)}`;
}

/**
 * Formal default private-agent scope from the existing identity/resolution chain:
 * CogniWeaveMemoryManager (legacy, no MemoryWorkspaceHandle) uses
 *   workspaceId = stableId("ws", resolve(stateDir))
 *   + resolveCogniWeaveSearchScope({ agentId, workspaceId }) →
 *     { workspaceId, projectId: `agent:${agentId}`, agentId, visibility: "private" }
 *
 * agents.list has no formal memoryScope / cogniweave.defaultScope / expectedEmpty fields.
 * MemoryWorkspaceHandle.resourceId is also absent from agents.list — when that path is
 * active we cannot reconstruct workspaceId from config, so callers must treat missing
 * handle identity as diagnostic-insufficient / unknown (never forge a full scope).
 *
 * This helper only returns the *legacy formal default*. If the store uses a different
 * workspaceId (handle-based), resolveTrustedScopeAtomCount will yield 0 for this key;
 * without formal expected-empty evidence that stays diagnostic-insufficient, not new-empty.
 */
function resolveFormalDefaultScopeHint(params) {
  const agentId = typeof params?.agentId === "string" ? params.agentId.trim() : "";
  const stateDir = typeof params?.stateDir === "string" ? params.stateDir.trim() : "";
  if (!agentId || !stateDir) {
    return {
      scopeHint: null,
      scopeSource: "unknown",
      scopeSourceDetail:
        "agentId or stateDir missing; cannot derive formal default CogniWeave scope.",
    };
  }
  const workspaceId = stableId("ws", path.resolve(stateDir));
  return {
    scopeHint: {
      workspaceId,
      projectId: `agent:${agentId}`,
      visibility: "private",
    },
    scopeSource: "formal-default-legacy-ws+resolveCogniWeaveSearchScope",
    scopeSourceDetail:
      "Derived from CogniWeaveMemoryManager legacy workspaceId + default private agent scope. Not from invented agents.list memoryScope / cogniweave.defaultScope.",
  };
}

/**
 * Trusted scope requires workspaceId+projectId+agentId+visibility.
 * AgentId-only aggregation is incomplete and must not be treated as scope-ok evidence.
 */
function readCogniWeaveScopeCounts(storePath) {
  if (!fs.existsSync(storePath)) {
    return {
      readable: false,
      totalAtoms: null,
      byAgentId: {},
      byCompleteScope: {},
      scopeTrusted: false,
      error: "missing-store",
    };
  }
  try {
    const uri = `file:${storePath}?mode=ro`;
    const sql = [
      "SELECT",
      "  json_extract(payload,'$.scope.workspaceId') AS workspace_id,",
      "  json_extract(payload,'$.scope.projectId') AS project_id,",
      "  json_extract(payload,'$.scope.agentId') AS agent_id,",
      "  json_extract(payload,'$.scope.visibility') AS visibility,",
      "  COUNT(*) AS c",
      "FROM cogniweave_atoms",
      "GROUP BY 1, 2, 3, 4;",
    ].join(" ");
    const result = spawnSync("sqlite3", ["-json", uri, sql], { encoding: "utf8" });
    if (result.status !== 0) {
      return {
        readable: false,
        totalAtoms: null,
        byAgentId: {},
        byCompleteScope: {},
        scopeTrusted: false,
        error: (result.stderr || result.stdout || "sqlite-error").slice(0, 200),
      };
    }
    const rows = JSON.parse(result.stdout || "[]");
    const byAgentId = {};
    const byCompleteScope = {};
    let totalAtoms = 0;
    let completeRows = 0;
    let incompleteRows = 0;
    for (const row of rows) {
      const count = Number(row.c) || 0;
      totalAtoms += count;
      const agentId = row.agent_id == null || row.agent_id === "" ? null : String(row.agent_id);
      const workspaceId =
        row.workspace_id == null || row.workspace_id === "" ? null : String(row.workspace_id);
      const projectId =
        row.project_id == null || row.project_id === "" ? null : String(row.project_id);
      const visibility =
        row.visibility == null || row.visibility === "" ? null : String(row.visibility);
      if (agentId) {
        byAgentId[agentId] = (byAgentId[agentId] ?? 0) + count;
      }
      if (workspaceId && projectId && agentId && visibility) {
        completeRows += 1;
        const key = `${workspaceId}::${projectId}::${agentId}::${visibility}`;
        byCompleteScope[key] = (byCompleteScope[key] ?? 0) + count;
      } else {
        incompleteRows += 1;
      }
    }
    // Trusted only when every observed row carries a complete scope tuple.
    const scopeTrusted = rows.length === 0 || (completeRows > 0 && incompleteRows === 0);
    return {
      readable: true,
      totalAtoms,
      byAgentId,
      byCompleteScope,
      scopeTrusted,
      error: null,
    };
  } catch (err) {
    return {
      readable: false,
      totalAtoms: null,
      byAgentId: {},
      byCompleteScope: {},
      scopeTrusted: false,
      error: String(err).slice(0, 200),
    };
  }
}

function resolveTrustedScopeAtomCount(params) {
  const { counts, agentId, scopeHint } = params;
  if (!counts?.readable || !counts.scopeTrusted) {
    return { scopeAtomCount: null, scopeReadable: false, scopeTrusted: false };
  }
  if (scopeHint?.workspaceId && scopeHint?.projectId && scopeHint?.visibility) {
    const key = `${scopeHint.workspaceId}::${scopeHint.projectId}::${agentId}::${scopeHint.visibility}`;
    return {
      scopeAtomCount: counts.byCompleteScope?.[key] ?? 0,
      scopeReadable: true,
      scopeTrusted: true,
    };
  }
  // Without a complete scope hint we cannot attribute counts to one digital human.
  return { scopeAtomCount: null, scopeReadable: true, scopeTrusted: false };
}

function classifyEmptyMarkdown(params) {
  const {
    backend,
    memoryMdAtResolved,
    scopeAtomCount,
    scopeReadable,
    scopeTrusted,
    configuredWorkspace,
    cogniweaveMode,
    agentCreatedAt,
    expectedEmptyEvidence,
  } = params;
  if (memoryMdAtResolved > 0) {
    return null;
  }
  if (backend === "cogniweave" && cogniweaveMode === "rest") {
    return {
      emptyMarkdownClass: "diagnostic-insufficient",
      action: "cogniweave-rest-unknown",
      priority: "P1",
      detail:
        "CogniWeave REST mode has no verified read-only embedded SQLite diagnostic in this audit; report unknown instead of reindex.",
    };
  }
  if (backend === "cogniweave" && (!scopeReadable || scopeTrusted === false)) {
    return {
      emptyMarkdownClass: "diagnostic-insufficient",
      action: "diagnostic-insufficient",
      priority: "P1",
      detail:
        "Authoritative CogniWeave store unreadable or complete scope unresolved; do not treat empty Markdown as confirmed anomaly.",
    };
  }
  if (backend === "cogniweave" && typeof scopeAtomCount === "number" && scopeAtomCount > 0) {
    return {
      emptyMarkdownClass: "source-missing",
      action: "markdown-source-missing-but-scope-has-atoms",
      priority: "P1",
      detail: `Empty Markdown at resolved workspace but trusted scope atoms=${scopeAtomCount}. Do not force reindex; verify source bindings / ingest paths.`,
    };
  }
  if (!configuredWorkspace) {
    return {
      emptyMarkdownClass: "diagnostic-insufficient",
      action: "diagnostic-insufficient",
      priority: "P1",
      detail: "Workspace identity/path not confirmed; classification deferred.",
    };
  }
  // new-empty-agent requires creation time AND expected-no-data evidence — never infer from zero atoms alone.
  if (
    backend === "cogniweave" &&
    scopeAtomCount === 0 &&
    typeof agentCreatedAt === "string" &&
    agentCreatedAt.trim() &&
    expectedEmptyEvidence === true
  ) {
    return {
      emptyMarkdownClass: "new-empty-agent",
      action: "new-empty-agent",
      priority: "info",
      detail:
        "Trusted empty scope with agentCreatedAt and expected-empty evidence — treat as new/empty agent.",
    };
  }
  if (backend === "cogniweave" && scopeAtomCount === 0) {
    return {
      emptyMarkdownClass: "diagnostic-insufficient",
      action: "diagnostic-insufficient",
      priority: "P1",
      detail:
        "Zero atoms observed but agentCreatedAt/expected-empty evidence missing; do not infer new-empty-agent.",
    };
  }
  if (backend === "cogniweave") {
    return {
      emptyMarkdownClass: "diagnostic-insufficient",
      action: "diagnostic-insufficient",
      priority: "P1",
      detail: "Unable to confirm expected data for this scope; not a confirmed anomaly.",
    };
  }
  // builtin / qmd legacy path
  return {
    emptyMarkdownClass: "confirmed-anomaly",
    action: "empty-workspace",
    priority: "P0",
    detail:
      "No memory markdown at resolved workspace for builtin/qmd expectation. Verify volume mount and agents.list[].workspace.",
  };
}

function classifyAgentRecovery(params) {
  const {
    memoryMdAtResolved,
    alternateRoots,
    conflictByRule,
    secretConfigured,
    resolvedWorkspace,
    backend,
    scopeAtomCount,
    scopeReadable,
    scopeTrusted,
    configuredWorkspace,
    cogniweaveMode,
    agentCreatedAt,
    expectedEmptyEvidence,
  } = params;
  const bestAlternate = alternateRoots
    .filter((row) => row.memoryMd > memoryMdAtResolved)
    .toSorted((a, b) => b.memoryMd - a.memoryMd)[0];

  if (bestAlternate) {
    return {
      action: "fix-workspace-path",
      priority: "P0",
      emptyMarkdownClass: memoryMdAtResolved === 0 ? "source-missing" : undefined,
      detail: `Indexer uses ${resolvedWorkspace} (${memoryMdAtResolved} md) but tenant tree has ${bestAlternate.path} (${bestAlternate.memoryMd} md). Point agents.list[].workspace or bind mount to the tree that holds files.`,
    };
  }
  const emptyClass = classifyEmptyMarkdown({
    backend,
    memoryMdAtResolved,
    scopeAtomCount,
    scopeReadable,
    scopeTrusted,
    configuredWorkspace,
    cogniweaveMode,
    agentCreatedAt,
    expectedEmptyEvidence,
  });
  if (emptyClass) {
    return emptyClass;
  }
  if (conflictByRule) {
    if (backend === "cogniweave") {
      return {
        action: "cogniweave-conflict-diagnose",
        priority: "P1",
        detail:
          "Dual-tree/sidecar conflict under CogniWeave. Diagnose scope bindings; do not unconditionally force reindex.",
      };
    }
    return {
      action: "v1-maintenance-unlock-then-reindex",
      priority: "P1",
      detail: secretConfigured
        ? `Dual-tree or v1-root-guard sidecar conflict. Run memory index --force with OPENBOT_V1_ROOT_GUARD_TOKEN grant after path is correct.`
        : `Dual-tree or v1-root-guard sidecar conflict. Configure OPENBOT_V1_ROOT_GUARD_SECRET in container env, issue signed grant, then memory index --force.`,
    };
  }
  if (backend === "cogniweave") {
    // Non-empty Markdown alone is insufficient — require trusted scope + readable store.
    if (scopeTrusted === true && scopeReadable === true && typeof scopeAtomCount === "number") {
      return {
        action: "cogniweave-scope-ok",
        priority: "info",
        detail:
          "Workspace markdown present and trusted complete scope evidence readable; no unconditional force reindex suggested.",
      };
    }
    return {
      action: "diagnostic-insufficient",
      emptyMarkdownClass: "diagnostic-insufficient",
      priority: "P1",
      detail:
        "Markdown present but complete CogniWeave scope/backend evidence incomplete; continue diagnosis before declaring scope-ok.",
    };
  }
  if (backend === "qmd") {
    return {
      action: "qmd-update-if-stale",
      priority: "P2",
      detail:
        "QMD backend: run qmd update only when collection freshness checks indicate staleness.",
    };
  }
  return {
    action: "reindex-ready",
    priority: "P2",
    detail:
      "Workspace has markdown and no dual-tree/sidecar conflict. openbot memory index --force --agent <id> may be appropriate for builtin.",
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
  const cogniweaveMode = cfg?.memory?.cogniweave?.mode ?? "embedded";
  const scopeAtomCount = typeof params.scopeAtomCount === "number" ? params.scopeAtomCount : null;
  const scopeReadable = params.scopeReadable === true;
  const scopeTrusted = params.scopeTrusted === true;
  const agentCreatedAt = typeof params.agentCreatedAt === "string" ? params.agentCreatedAt : null;
  const expectedEmptyEvidence = params.expectedEmptyEvidence === true;
  const recovery = classifyAgentRecovery({
    memoryMdAtResolved,
    alternateRoots,
    conflictByRule,
    secretConfigured,
    resolvedWorkspace,
    backend,
    scopeAtomCount,
    scopeReadable,
    scopeTrusted,
    configuredWorkspace,
    cogniweaveMode,
    agentCreatedAt,
    expectedEmptyEvidence,
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
    scopeAtomCount,
    scopeReadable,
    scopeTrusted,
    agentCreatedAt,
    expectedEmptyEvidence,
    dataRootResolved: resolveAuditDataRoot(cfg),
    emptyMarkdownClass: recovery.emptyMarkdownClass ?? null,
    conflictByRule,
    knownConflict: conflictByRule,
    dualTreeSuspected: dualTree || conflictByRule,
    sidecarFingerprints: readSidecarFingerprints(sqlitePath),
    alternateRoots,
    recovery,
  };
}

export {
  classifyEmptyMarkdown,
  classifyAgentRecovery,
  resolveAuditDataRoot,
  resolveCogniWeaveStorePath,
  resolveTrustedScopeAtomCount,
  readCogniWeaveScopeCounts,
  resolveFormalDefaultScopeHint,
  stableId,
};

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

  const cogniweaveStore =
    backend === "cogniweave" ? resolveCogniWeaveStorePath(stateDir, cfg) : null;
  const cogniweaveCounts =
    backend === "cogniweave" && cogniweaveStore
      ? readCogniWeaveScopeCounts(cogniweaveStore)
      : {
          readable: false,
          totalAtoms: null,
          byAgentId: {},
          byCompleteScope: {},
          scopeTrusted: false,
          error: "not-cogniweave",
        };

  for (const agentId of agentIds) {
    // Scope from formal identity chain only — never agents.list[].memoryScope /
    // memory.cogniweave.defaultScope / expectedEmpty / expectedNoData (not in schema).
    const scopeResolution = resolveFormalDefaultScopeHint({ agentId, stateDir });
    const scopeHint = scopeResolution.scopeHint;
    const trusted =
      backend === "cogniweave"
        ? resolveTrustedScopeAtomCount({ counts: cogniweaveCounts, agentId, scopeHint })
        : { scopeAtomCount: null, scopeReadable: true, scopeTrusted: true };
    // AgentConfig has no createdAt / expectedEmpty. Without formal evidence,
    // expectedEmptyEvidence stays false → new-empty-agent is never inferred from config alone.
    const agentCreatedAt = null;
    const expectedEmptyEvidence = false;
    const row = inspectAgent({
      stateDir,
      tenantsRoot,
      cfg,
      agentId,
      limits,
      backend,
      secretConfigured,
      scopeAtomCount: trusted.scopeAtomCount,
      scopeReadable: backend === "cogniweave" ? trusted.scopeReadable : true,
      scopeTrusted: backend === "cogniweave" ? trusted.scopeTrusted : true,
      agentCreatedAt,
      expectedEmptyEvidence,
    });
    agents.push({
      ...row,
      scopeSource: scopeResolution.scopeSource,
      scopeSourceDetail: scopeResolution.scopeSourceDetail,
      scopeHint: scopeHint
        ? {
            workspaceId: scopeHint.workspaceId,
            projectId: scopeHint.projectId,
            visibility: scopeHint.visibility,
          }
        : null,
    });
  }

  const summary = {
    agentCount: agents.length,
    groupCount: groups.length,
    backend,
    dataRootResolved: resolveAuditDataRoot(cfg),
    cogniweaveScopeTrusted: cogniweaveCounts.scopeTrusted,
    auditSchema: "memory-platform-audit/v2",
    v1GuardSecretConfigured: secretConfigured,
    cogniweaveStore: cogniweaveStore,
    cogniweaveScopeReadable: cogniweaveCounts.readable,
    byRecoveryAction: agents.reduce((acc, row) => {
      acc[row.recovery.action] = (acc[row.recovery.action] ?? 0) + 1;
      return acc;
    }, {}),
    byEmptyMarkdownClass: agents.reduce((acc, row) => {
      const key = row.emptyMarkdownClass ?? "none";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
    p0Blockers: agents.filter((row) => row.recovery.priority === "P0").length,
    conflictAgents: agents.filter((row) => row.conflictByRule).map((row) => row.agentId),
    presetDenyAgents: agents.filter((row) => row.conflictByRule).map((row) => row.agentId),
    emptyWorkspaceAgents: agents
      .filter((row) => row.recovery.action === "empty-workspace")
      .map((row) => row.agentId),
    dualTreeAgents: agents.filter((row) => row.dualTreeSuspected).map((row) => row.agentId),
  };

  const report = {
    schema: "memory-platform-audit/v2",
    compatibleWith: ["memory-platform-audit/v1"],
    probeUtc: new Date().toISOString(),
    stateDir,
    tenantsRoot: tenantsRoot || null,
    limits: { truncated: limits.truncated },
    summary,
    agents,
    groups,
    nextSteps:
      backend === "cogniweave"
        ? [
            "1. Review emptyMarkdownClass (new-empty-agent / source-missing / diagnostic-insufficient / confirmed-anomaly); do not treat all empty Markdown as P0.",
            "2. Use trusted complete-scope atom counts only (formal default legacy scope or unknown); never invent agents.list memoryScope/expectedEmpty; never use full-DB or agentId-only totals to prove one agent healthy.",
            "3. Do not unconditionally force reindex on CogniWeave; diagnose bindings/sources first.",
            "4. REST mode remains diagnostic-insufficient until a verified read-only diagnostic API exists.",
          ]
        : [
            "1. Fix all P0 path/empty-workspace rows before any reindex.",
            "2. Configure OPENBOT_V1_ROOT_GUARD_SECRET on gateway if missing (>=16 chars).",
            "3. For builtin dual-tree/sidecar conflicts: signed grant then conditional reindex.",
            "4. For qmd: update collections only when freshness checks indicate staleness.",
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
