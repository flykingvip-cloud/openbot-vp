#!/usr/bin/env node
/**
 * Phase 0 read-only live workspace-root enumerator.
 *
 * Scans STATE_DIR + TENANTS_ROOT. Stdout only. Never writes under either root.
 * Does not read API keys or secret files.
 *
 *   OPENBOT_STATE_DIR=... OPENBOT_TENANTS_ROOT=... \
 *     node docs/design/evidence/memory-workspace-phase0-live-roots.mjs --mode raw-controlled
 *
 *   ... | node docs/design/evidence/memory-workspace-phase0-live-roots.mjs --mode evidence-summary \
 *         --evidence-id memory-workspace-phase0-live-20260814
 *
 *   ... | node docs/design/evidence/memory-workspace-phase0-live-roots.mjs --mode catalog-candidate \
 *         --evidence-id memory-workspace-phase0-20260814
 *
 * Repro chain (no unpublished transform):
 *   raw-controlled → evidence-summary  = committed LIVE summary schema
 *   raw-controlled → catalog-candidate = per-root candidate + coverage
 *   raw-controlled → summary-redacted  = detailed redacted roots (not the summary pin)
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAW_SCHEMA = "memory-workspace-phase0-live-roots/v1";
const SUMMARY_SCHEMA = "memory-workspace-phase0-live-roots-summary/v1";
const SCRIPT_PATH = "docs/design/evidence/memory-workspace-phase0-live-roots.mjs";

function die(message, code = 2) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    die(`missing required env: ${name}`);
  }
  return value;
}

function requireDir(name) {
  const resolved = path.resolve(requireEnv(name));
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    die(`${name} is not a directory: ${resolved}`);
  }
  return resolved;
}

function assertSafeSegment(name, value) {
  if (
    !value ||
    value === "." ||
    value === ".." ||
    path.isAbsolute(value) ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("\0")
  ) {
    die(`unsafe ${name}: ${JSON.stringify(value)}`);
  }
}

function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function contained(root, ...segments) {
  for (const seg of segments) {
    assertSafeSegment("segment", seg);
  }
  const candidate = path.resolve(root, ...segments);
  if (!isInside(root, candidate)) {
    die(`path escapes root: ${candidate}`);
  }
  return candidate;
}

function envInt(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    die(`${name} must be a non-negative number`);
  }
  return Math.floor(n);
}

function sha12(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function scriptDigest() {
  const body = fs.readFileSync(fileURLToPath(import.meta.url));
  return {
    scriptPath: SCRIPT_PATH,
    scriptSha256: crypto.createHash("sha256").update(body).digest("hex"),
  };
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function countMarkdown(dir, limits) {
  let files = 0;
  const walk = (current, depth) => {
    if (files >= limits.maxFiles || depth > limits.maxDepth) {
      limits.truncated = true;
      return;
    }
    for (const entry of listDir(current)) {
      const full = path.join(current, entry.name);
      if (!isInside(dir, full)) {
        continue;
      }
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files += 1;
      }
    }
  };
  walk(dir, 0);
  return files;
}

function sqliteMeta(filePath) {
  const st = fs.statSync(filePath);
  return { bytes: st.size, mtimeUtc: st.mtime.toISOString() };
}

function readAgentIndex(stateDir) {
  const cfgPath = path.join(stateDir, "openbot.json");
  if (!fs.existsSync(cfgPath) || !isInside(stateDir, cfgPath)) {
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } catch {
    return [];
  }
  const list = parsed?.agents?.list;
  if (!Array.isArray(list)) {
    return [];
  }
  return list.map((entry) => ({
    id: typeof entry?.id === "string" ? entry.id : "",
    ownerId: typeof entry?.ownerId === "string" ? entry.ownerId : "",
    hasWorkspaceConfig: typeof entry?.workspace === "string" && entry.workspace.trim().length > 0,
  }));
}

function readCollaborationWorkspace(stateDir) {
  const cfgPath = path.join(stateDir, "openbot.json");
  if (!fs.existsSync(cfgPath) || !isInside(stateDir, cfgPath)) {
    return "";
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    const workspace = parsed?.collaboration?.defaults?.workspace;
    return typeof workspace === "string" ? workspace.trim() : "";
  } catch {
    return "";
  }
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

function sameResolvedDir(left, right) {
  try {
    return fs.realpathSync(left) === fs.realpathSync(right);
  } catch {
    return path.resolve(left) === path.resolve(right);
  }
}

function safeDecodeSegment(name) {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/** Workspace self-report only. Never treat the returned id as authorization. */
function readGroupTenantHint(dir) {
  for (const name of ["profile.json", "operating-state.json"]) {
    const filePath = path.join(dir, name);
    if (!fs.existsSync(filePath)) {
      continue;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const tenantId =
        (typeof parsed?.tenantId === "string" && parsed.tenantId.trim()) ||
        (typeof parsed?.enterpriseId === "string" && parsed.enterpriseId.trim()) ||
        (typeof parsed?.tenant?.id === "string" && parsed.tenant.id.trim()) ||
        "";
      if (tenantId) {
        return tenantId;
      }
    } catch {
      // Group metadata is optional; missing/unreadable files stay unknown.
    }
  }
  return "";
}

function recordValues(value) {
  if (!value || typeof value !== "object") {
    return { shape: "missing", values: [] };
  }
  if (Array.isArray(value)) {
    return { shape: "array", values: value };
  }
  return { shape: "record", values: Object.values(value) };
}

function asString(value) {
  return typeof value === "string" ? value : "";
}

export function parseRegistryStore(parsed) {
  const assetsRaw = recordValues(parsed?.assets);
  const bindingsRaw = recordValues(parsed?.ownerBindings);
  const assets = assetsRaw.values
    .map((asset) => ({
      agentAssetId: asString(asset?.agentAssetId),
      enterpriseId: asString(asset?.enterpriseId),
      agentSlug: asString(asset?.agentSlug),
      legacyAgentId: asString(asset?.legacyAgentId),
      status: asString(asset?.status),
    }))
    .filter((asset) => asset.agentAssetId);
  const ownerBindings = bindingsRaw.values
    .map((binding) => ({
      bindingId: asString(binding?.bindingId),
      enterpriseId: asString(binding?.enterpriseId),
      agentAssetId: asString(binding?.agentAssetId),
      ownerType: asString(binding?.ownerType),
      ownerId: asString(binding?.ownerId),
      isPrimary: binding?.isPrimary === true,
      endedAt: asString(binding?.endedAt) || undefined,
    }))
    .filter((binding) => binding.agentAssetId);
  return {
    available: true,
    assetShape: assetsRaw.shape,
    ownerBindingShape: bindingsRaw.shape,
    assets,
    ownerBindings,
  };
}

function readRegistryIndex(stateDir) {
  const storePath = path.join(stateDir, "openbot-agent-registry.json");
  if (!fs.existsSync(storePath) || !isInside(stateDir, storePath)) {
    return {
      available: false,
      assetShape: "missing",
      ownerBindingShape: "missing",
      assets: [],
      ownerBindings: [],
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(storePath, "utf8"));
  } catch {
    return {
      available: false,
      assetShape: "unreadable",
      ownerBindingShape: "unreadable",
      assets: [],
      ownerBindings: [],
    };
  }
  return parseRegistryStore(parsed);
}

/** Never use a global slug map. Slug/legacyAgentId is unique only inside enterpriseId. */
export function lookupAssetInEnterprise(registry, enterpriseId, slug) {
  if (!enterpriseId || !slug) {
    return { matches: [], reason: "missing-enterprise-or-slug" };
  }
  const matches = (registry.assets ?? []).filter(
    (asset) =>
      asset.enterpriseId === enterpriseId &&
      (asset.agentSlug === slug || asset.legacyAgentId === slug),
  );
  if (matches.length === 1) {
    return { matches, reason: "enterprise-scoped-exact" };
  }
  if (matches.length > 1) {
    return { matches, reason: "ambiguous-in-enterprise" };
  }
  const crossTenant = (registry.assets ?? []).filter(
    (asset) => asset.agentSlug === slug || asset.legacyAgentId === slug,
  );
  if (crossTenant.length > 0) {
    return { matches: [], reason: "slug-exists-in-other-enterprise" };
  }
  return { matches: [], reason: "no-enterprise-match" };
}

export function inferTenantForUser(tenantIds) {
  const unique = [...new Set((tenantIds ?? []).filter(Boolean))];
  if (unique.length === 1) {
    return { tenantId: unique[0], reason: "unique-user-dir" };
  }
  if (unique.length > 1) {
    return { tenantId: null, reason: "ambiguous-user-tenants" };
  }
  return { tenantId: null, reason: "employee-steward-missing-tenant" };
}

export function classifyRoot(params) {
  const { kind, lookupReason, matchCount, tenantId, authority } = params;
  if (kind === "employee_steward") {
    if (authority === "membership-sot" && tenantId) {
      return "classified";
    }
    if (lookupReason === "ambiguous-user-tenants") {
      return "conflict";
    }
    return "unknown";
  }
  if (kind === "group_shared") {
    if (authority === "catalog-or-group-registry" && tenantId) {
      return "classified";
    }
    return "unknown";
  }
  if (kind === "group_space_mirror") {
    return "conflict";
  }
  if (kind === "host_canonical" || kind === "flat_l2_main") {
    return "conflict";
  }
  if (
    kind === "tenant_workspace" &&
    lookupReason === "enterprise-scoped-exact" &&
    matchCount === 1
  ) {
    return "classified";
  }
  if (kind === "tenant_workspace" && lookupReason === "ambiguous-in-enterprise") {
    return "conflict";
  }
  return "unknown";
}

/** Extra resolution fields only. classification stays classified|conflict|unknown. */
export function describeRootResolution(params) {
  const classification = classifyRoot(params);
  if (
    params.kind === "employee_steward" &&
    classification === "unknown" &&
    params.lookupReason === "unique-user-dir" &&
    params.tenantId
  ) {
    return {
      classification,
      resolutionStatus: "pending_authority",
      evidenceHint: "unique-user-dir",
    };
  }
  return { classification };
}

export function unexplainedRootCount(roots) {
  return (roots ?? []).filter((row) => row.classification !== "classified").length;
}

function collectRaw() {
  const stateDir = requireDir("OPENBOT_STATE_DIR");
  const tenantsRoot = requireDir("OPENBOT_TENANTS_ROOT");
  const limits = {
    maxTenants: envInt("MAX_TENANTS", 32),
    maxUsers: envInt("MAX_USERS", 200),
    maxGroups: envInt("MAX_GROUPS", 200),
    maxFiles: envInt("MAX_FILES", 5000),
    maxDepth: envInt("MAX_DEPTH", 8),
    truncated: false,
  };
  const agents = readAgentIndex(stateDir);
  const registry = readRegistryIndex(stateDir);
  const ownerByAgent = new Map(agents.filter((a) => a.id).map((a) => [a.id, a.ownerId]));

  const roots = [];
  const sqlite = [];

  const memoryDir = path.join(stateDir, "memory");
  if (fs.existsSync(memoryDir) && isInside(stateDir, memoryDir)) {
    for (const entry of listDir(memoryDir)) {
      if (entry.isFile() && entry.name.endsWith(".sqlite")) {
        sqlite.push({
          agentId: entry.name.replace(/\.sqlite$/, ""),
          pathPattern: "{stateDir}/memory/<agentId>.sqlite",
          ...sqliteMeta(path.join(memoryDir, entry.name)),
        });
      }
    }
  }

  for (const entry of listDir(stateDir)) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name === "workspace" || entry.name.startsWith("workspace-")) {
      const dir = contained(stateDir, entry.name);
      const slug = entry.name === "workspace" ? "main" : entry.name.slice("workspace-".length);
      roots.push({
        classId: "host_canonical",
        kind: "host_canonical",
        slug,
        pathPattern:
          entry.name === "workspace" ? "{stateDir}/workspace" : "{stateDir}/workspace-<slug>",
        mdCount: countMarkdown(dir, limits),
        assetLookup: { matches: [], reason: "host-root-has-no-enterprise" },
        classification: classifyRoot({
          kind: "host_canonical",
          lookupReason: "host-root-has-no-enterprise",
          matchCount: 0,
        }),
      });
    }
  }

  let tenantCount = 0;
  let userCount = 0;
  const userTenants = new Map();
  for (const tenant of listDir(tenantsRoot)) {
    if (!tenant.isDirectory() || tenantCount >= limits.maxTenants) {
      if (tenant.isDirectory() && tenantCount >= limits.maxTenants) {
        limits.truncated = true;
      }
      continue;
    }
    tenantCount += 1;
    const usersRoot = contained(tenantsRoot, tenant.name, "users");
    if (!fs.existsSync(usersRoot)) {
      continue;
    }
    for (const user of listDir(usersRoot)) {
      if (!user.isDirectory() || userCount >= limits.maxUsers) {
        if (user.isDirectory() && userCount >= limits.maxUsers) {
          limits.truncated = true;
        }
        continue;
      }
      userCount += 1;
      const tenantSet = userTenants.get(user.name) ?? new Set();
      tenantSet.add(tenant.name);
      userTenants.set(user.name, tenantSet);
      const openbot = path.join(usersRoot, user.name, "OpenBot");
      if (!fs.existsSync(openbot) || !isInside(tenantsRoot, openbot)) {
        continue;
      }
      for (const ws of listDir(openbot)) {
        if (!ws.isDirectory()) {
          continue;
        }
        if (ws.name !== "workspace" && !ws.name.startsWith("workspace-")) {
          continue;
        }
        const dir = path.join(openbot, ws.name);
        const slug = ws.name === "workspace" ? "main" : ws.name.slice("workspace-".length);
        const kind = ws.name === "workspace" ? "flat_l2_main" : "tenant_workspace";
        const assetLookup =
          kind === "tenant_workspace"
            ? lookupAssetInEnterprise(registry, tenant.name, slug)
            : { matches: [], reason: "flat-l2-not-asset-scoped" };
        roots.push({
          classId: kind,
          kind,
          tenantId: tenant.name,
          userId: user.name,
          slug,
          pathPattern:
            kind === "flat_l2_main"
              ? "tenants/<tid>/users/<uid>/OpenBot/workspace"
              : "tenants/<tid>/users/<uid>/OpenBot/workspace-<slug>",
          mdCount: countMarkdown(dir, limits),
          configOwnerMatch: ownerByAgent.get(slug) === user.name,
          assetLookup: {
            reason: assetLookup.reason,
            matchCount: assetLookup.matches.length,
            agentAssetId: assetLookup.matches[0]?.agentAssetId,
            enterpriseId: assetLookup.matches[0]?.enterpriseId,
          },
          classification: classifyRoot({
            kind,
            lookupReason: assetLookup.reason,
            matchCount: assetLookup.matches.length,
          }),
        });
      }
    }
  }

  const employeeRoot = path.join(stateDir, "agents", "main", "employees");
  if (fs.existsSync(employeeRoot) && isInside(stateDir, employeeRoot)) {
    for (const user of listDir(employeeRoot)) {
      if (!user.isDirectory()) {
        continue;
      }
      const ws = path.join(employeeRoot, user.name, "workspace");
      if (!fs.existsSync(ws) || !isInside(stateDir, ws)) {
        continue;
      }
      const inferred = inferTenantForUser([...(userTenants.get(user.name) ?? [])]);
      const resolution = describeRootResolution({
        kind: "employee_steward",
        lookupReason: inferred.reason,
        matchCount: 0,
        tenantId: inferred.tenantId ?? undefined,
      });
      roots.push({
        classId: "employee_steward",
        kind: "employee_steward",
        slug: "main",
        userId: user.name,
        tenantId: inferred.tenantId ?? undefined,
        pathPattern: "{stateDir}/agents/main/employees/<user>/workspace",
        mdCount: countMarkdown(ws, limits),
        assetLookup: { matches: [], reason: inferred.reason },
        classification: resolution.classification,
        resolutionStatus: resolution.resolutionStatus,
        evidenceHint: resolution.evidenceHint,
      });
    }
  }

  const configuredWorkspace = readCollaborationWorkspace(stateDir);
  const configuredGroups = configuredWorkspace
    ? path.join(path.resolve(expandUserPath(configuredWorkspace)), "groups")
    : "";
  const sharedGroups = path.join(stateDir, "collaboration-shared", "groups");
  const agentFallbackGroups = path.join(
    stateDir,
    "workspace",
    ".openbot",
    "collaboration",
    "groups",
  );
  const spacesRoot = path.join(stateDir, "spaces");

  const pushGroupRoot = (kind, groupsDir, pathPattern) => {
    if (!groupsDir || !fs.existsSync(groupsDir) || !fs.statSync(groupsDir).isDirectory()) {
      return;
    }
    let added = 0;
    for (const entry of listDir(groupsDir)) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) {
        continue;
      }
      if (added >= limits.maxGroups) {
        limits.truncated = true;
        break;
      }
      const dir = path.join(groupsDir, entry.name);
      const groupId = safeDecodeSegment(entry.name);
      const selfReportedTenant = Boolean(readGroupTenantHint(dir));
      roots.push({
        classId: kind,
        kind,
        slug: groupId,
        groupId,
        pathPattern,
        mdCount: countMarkdown(dir, limits),
        selfReportedTenantHint: selfReportedTenant,
        assetLookup: {
          matches: [],
          reason: "group-missing-authoritative-tenant",
        },
        classification: classifyRoot({
          kind,
          lookupReason: "group-missing-authoritative-tenant",
          matchCount: 0,
        }),
      });
      added += 1;
    }
  };

  if (configuredGroups) {
    pushGroupRoot("group_shared", configuredGroups, "{collaborationRoot}/groups/<groupId>");
  }
  if (
    !configuredGroups ||
    !fs.existsSync(sharedGroups) ||
    !sameResolvedDir(configuredGroups, sharedGroups)
  ) {
    pushGroupRoot("group_shared", sharedGroups, "{stateDir}/collaboration-shared/groups/<groupId>");
  }
  if (
    !configuredGroups ||
    !fs.existsSync(agentFallbackGroups) ||
    !sameResolvedDir(configuredGroups, agentFallbackGroups)
  ) {
    pushGroupRoot(
      "group_shared",
      agentFallbackGroups,
      "{stateDir}/workspace/.openbot/collaboration/groups/<groupId>",
    );
  }
  pushGroupRoot("group_space_mirror", spacesRoot, "{stateDir}/spaces/<groupId>");

  const groupRowsById = new Map();
  for (const row of roots) {
    if (row.kind !== "group_shared" && row.kind !== "group_space_mirror") {
      continue;
    }
    const list = groupRowsById.get(row.groupId) ?? [];
    list.push(row);
    groupRowsById.set(row.groupId, list);
  }
  for (const list of groupRowsById.values()) {
    if (list.length < 2) {
      continue;
    }
    for (const row of list) {
      row.classification = "conflict";
      row.assetLookup = { ...row.assetLookup, reason: "group-root-overlap" };
    }
  }

  return {
    schema: RAW_SCHEMA,
    probeUtc: new Date().toISOString(),
    ...scriptDigest(),
    limits: {
      maxTenants: limits.maxTenants,
      maxUsers: limits.maxUsers,
      maxGroups: limits.maxGroups,
      maxFiles: limits.maxFiles,
      maxDepth: limits.maxDepth,
      truncated: limits.truncated,
    },
    cluster: {
      tenantCount,
      userDirCount: userCount,
      rootCount: roots.length,
      groupRootCount: roots.filter(
        (row) => row.kind === "group_shared" || row.kind === "group_space_mirror",
      ).length,
      sqliteCount: sqlite.length,
    },
    agents: agents.map((a) => ({
      id: a.id,
      hasOwnerId: Boolean(a.ownerId),
      hasWorkspaceConfig: a.hasWorkspaceConfig,
    })),
    registry: {
      available: registry.available,
      assetShape: registry.assetShape,
      ownerBindingShape: registry.ownerBindingShape,
      assetCount: registry.assets.length,
      ownerBindingCount: registry.ownerBindings.length,
      enterpriseCount: new Set(registry.assets.map((asset) => asset.enterpriseId).filter(Boolean))
        .size,
    },
    roots,
    sqlite,
  };
}

function redactUserFactory() {
  const userMap = new Map();
  return (userId) => {
    if (!userId) {
      return undefined;
    }
    if (!userMap.has(userId)) {
      userMap.set(userId, `user-${sha12(userId)}`);
    }
    return userMap.get(userId);
  };
}

function redactLocator(value) {
  if (!value || typeof value !== "string") {
    return value;
  }
  return value.replace(
    /(workspace-|memory\/)([A-Za-z0-9._-]+?)(\.sqlite)?\b/g,
    (_, prefix, slug, ext) => {
      return `${prefix}${hashSlug(slug)}${ext ?? ""}`;
    },
  );
}

function hashSlug(slug) {
  if (!slug) {
    return slug;
  }
  if (
    slug.includes("@") ||
    slug.startsWith("agt-") ||
    slug.startsWith("grp-") ||
    slug.startsWith("space-") ||
    /gmail|qq-com|163-com|126-com|sina-com|sohu-com|email/i.test(slug)
  ) {
    return `slug-${sha12(slug)}`;
  }
  return slug;
}

function dualTreeRows(raw) {
  const tenantBySlug = new Map();
  const hostBySlug = new Map();
  for (const row of raw.roots ?? []) {
    if (row.kind === "tenant_workspace") {
      tenantBySlug.set(row.slug, (tenantBySlug.get(row.slug) ?? 0) + (row.mdCount ?? 0));
    }
    if (row.kind === "host_canonical") {
      hostBySlug.set(row.slug, row.mdCount ?? 0);
    }
  }
  const rows = [];
  for (const [slug, tenantMd] of tenantBySlug.entries()) {
    if (!hostBySlug.has(slug)) {
      continue;
    }
    rows.push({
      slug: hashSlug(slug),
      tenantMd,
      hostMd: hostBySlug.get(slug),
    });
  }
  return rows;
}

function sqliteWithDualTree(raw) {
  const dual = new Set(dualTreeRows(raw).map((row) => row.slug));
  return (raw.sqlite ?? []).map((row) => ({
    agentId: hashSlug(row.agentId),
    bytes: row.bytes,
    mtimeUtc: row.mtimeUtc,
    dualTree: dual.has(hashSlug(row.agentId)) || dual.has(row.agentId),
  }));
}

export function buildEvidenceSummary(raw, evidenceId) {
  const classificationCounts = (raw.roots ?? []).reduce((acc, row) => {
    acc[row.classification] = (acc[row.classification] ?? 0) + 1;
    return acc;
  }, {});
  const kindCounts = (raw.roots ?? []).reduce((acc, row) => {
    acc[row.kind] = (acc[row.kind] ?? 0) + 1;
    return acc;
  }, {});
  const agents = raw.agents ?? [];
  const dualTree = dualTreeRows(raw);
  const unknown = classificationCounts.unknown ?? 0;
  const pendingAuthority = (raw.roots ?? []).filter(
    (row) => row.resolutionStatus === "pending_authority",
  ).length;
  const notClassified = unexplainedRootCount(raw.roots);
  return {
    evidenceId,
    schema: SUMMARY_SCHEMA,
    probeUtc: raw.probeUtc,
    classification: "controlled-audit-desensitized",
    transform: "raw-controlled -> evidence-summary (no unpublished steps)",
    probe: {
      scriptPath: raw.scriptPath,
      scriptSha256: raw.scriptSha256,
      schema: raw.schema,
      truncated: Boolean(raw.limits?.truncated),
    },
    cluster: raw.cluster,
    registry: {
      available: Boolean(raw.registry?.available),
      assetShape: raw.registry?.assetShape ?? "missing",
      assetCount: raw.registry?.assetCount ?? 0,
      ownerBindingCount: raw.registry?.ownerBindingCount ?? 0,
      enterpriseCount: raw.registry?.enterpriseCount ?? 0,
      slugCount: raw.registry?.assetCount ?? 0,
    },
    agentIndex: {
      count: agents.length,
      withOwnerId: agents.filter((row) => row.hasOwnerId).length,
      withWorkspaceConfig: agents.filter((row) => row.hasWorkspaceConfig).length,
    },
    classificationCounts,
    resolutionStatusCounts: {
      pending_authority: pendingAuthority,
    },
    kindCounts,
    sqlite: sqliteWithDualTree(raw),
    dualTree,
    quarantineOpen: [
      `${kindCounts.host_canonical ?? 0} host canonical workspace trees`,
      `${kindCounts.flat_l2_main ?? 0} flat L2 OpenBot/workspace`,
      `${unknown} tenant/host/employee/group roots without a unique tenant-scoped identity`,
      `${pendingAuthority} directory-inferred employee roots pending membership authority`,
      `${kindCounts.group_shared ?? 0} collaboration group roots + ${kindCounts.group_space_mirror ?? 0} space mirrors`,
      `Registry assetShape=${raw.registry?.assetShape ?? "missing"} assetCount=${raw.registry?.assetCount ?? 0}`,
    ],
    p0ExitGate: {
      unexplainedWritableRoots: notClassified > 0 ? "open" : "closed",
      notClassifiedCount: notClassified,
      pendingAuthority,
      coveragePassed: false,
      freshLiveProbe: true,
      registryParsingTrusted: raw.registry?.assetShape === "record",
      directoryInferenceIsNotAuthority: true,
      authoritativeMembership: false,
    },
  };
}

export function workspaceKindFor(row) {
  if (row.kind === "employee_steward" || row.kind === "flat_l2_main") {
    return "employee_private";
  }
  if (row.kind === "group_shared" || row.kind === "group_space_mirror") {
    return "group_shared";
  }
  return "agent_primary";
}

export function buildCandidateResourceId(row, tokens) {
  const tenantToken = tokens.tenantToken;
  const userToken = tokens.userToken;
  const slugToken = tokens.slugToken;
  const groupToken = tokens.groupToken;
  const exactAssetId = tokens.exactAssetId;
  const reason = row.assetLookup?.reason ?? row.kind;

  if (row.kind === "group_shared" || row.kind === "group_space_mirror") {
    if (row.classification === "classified" && row.tenantId) {
      return `ws:${tenantToken}:group:${groupToken}`;
    }
    return `ws:host:unknown:${reason}:${groupToken}`;
  }

  if (row.kind === "employee_steward") {
    if (row.tenantId && row.classification === "classified") {
      return `ws:${tenantToken}:user:${userToken}:steward`;
    }
    if (row.tenantId && row.resolutionStatus === "pending_authority") {
      return `ws:${tenantToken}:user:${userToken}:pending:${row.evidenceHint ?? reason}`;
    }
    return `ws:${tenantToken}:user:${userToken}:unknown:${reason}`;
  }

  if (exactAssetId) {
    return `ws:${tenantToken}:user:${userToken}:asset:${exactAssetId}`;
  }

  const userPart = userToken !== "none" ? `:user:${userToken}` : "";
  return `ws:${tenantToken}${userPart}:unknown:${reason}:${slugToken}`;
}

export function buildCatalogCandidate(raw, evidenceId) {
  const redactUser = redactUserFactory();
  const dualSlugs = new Set(dualTreeRows(raw).map((row) => row.slug));
  const candidates = (raw.roots ?? []).map((row, index) => {
    const tenantToken = row.tenantId ? `tenant-${sha12(row.tenantId)}` : "host";
    const userToken = redactUser(row.userId) ?? "none";
    const slugToken = hashSlug(row.slug);
    const groupToken = hashSlug(row.groupId ?? row.slug);
    const exactAssetId =
      row.assetLookup?.reason === "enterprise-scoped-exact" && row.assetLookup?.agentAssetId
        ? `asset-${sha12(row.assetLookup.agentAssetId)}`
        : "";
    const workspaceKind = workspaceKindFor(row);
    const resourceId = buildCandidateResourceId(row, {
      tenantToken,
      userToken,
      slugToken,
      groupToken,
      exactAssetId,
    });
    const relatedSqlite = (raw.sqlite ?? []).find((item) => item.agentId === row.slug);
    return {
      candidateId: `root-${String(index + 1).padStart(3, "0")}`,
      resourceId,
      workspaceKind,
      classification: row.classification,
      resolutionStatus: row.resolutionStatus,
      evidenceHint: row.evidenceHint,
      pathPattern: redactLocator(row.pathPattern),
      slug: slugToken,
      proof:
        row.kind === "employee_steward"
          ? row.classification === "classified"
            ? "authoritative membership mapping"
            : row.resolutionStatus === "pending_authority"
              ? "directory uniqueness clue only; not membership authority"
              : "employee isolation tree without tenant boundary"
          : row.kind === "group_shared" || row.kind === "group_space_mirror"
            ? "collaboration group root inventory"
            : exactAssetId
              ? "enterprise-scoped Registry asset"
              : (row.assetLookup?.reason ?? row.kind),
      writable: false,
      binding: {
        role:
          row.kind === "host_canonical" || row.kind === "group_space_mirror"
            ? "compatibility"
            : "canonical",
        state: "read_only",
        locator: redactLocator(row.pathPattern),
      },
      related: {
        dualTree: dualSlugs.has(slugToken) || dualSlugs.has(row.slug),
        sqlite: relatedSqlite ? redactLocator(relatedSqlite.pathPattern) : undefined,
        lookupReason: row.assetLookup?.reason,
      },
    };
  });
  const classifiedAgentPrimary = candidates.filter(
    (row) => row.workspaceKind === "agent_primary" && row.classification === "classified",
  ).length;
  const agentPrimaryTotal = candidates.filter(
    (row) => row.workspaceKind === "agent_primary",
  ).length;
  const employeePrivate = candidates.filter((row) => row.workspaceKind === "employee_private");
  const groupShared = candidates.filter((row) => row.workspaceKind === "group_shared");
  const classifiedEmployeeWithTenant = employeePrivate.filter(
    (row) =>
      row.classification === "classified" &&
      row.resourceId.includes(":user:") &&
      row.resourceId.includes("tenant-"),
  ).length;
  const pendingEmployeeAuthority = employeePrivate.filter(
    (row) => row.resolutionStatus === "pending_authority",
  ).length;
  const classifiedGroupWithTenant = groupShared.filter(
    (row) => row.classification === "classified" && row.resourceId.includes(":group:"),
  ).length;
  return {
    schema: "memory-workspace-phase0-catalog-candidate/v2",
    evidenceId,
    generatedFrom: "raw-controlled -> catalog-candidate",
    note: "Per-root offline candidate only. Not a Catalog SoT. Persistent governance Catalog still absent.",
    persistentGovernanceCatalog: {
      exists: false,
      workspaceAdapter: false,
      missDenyEnabled: false,
    },
    sourceRootCount: raw.cluster?.rootCount ?? candidates.length,
    candidateCount: candidates.length,
    coverage: {
      employee_private: {
        required: "100%",
        persistentCatalog: "0%",
        observed: employeePrivate.length,
        classifiedWithTenant: classifiedEmployeeWithTenant,
        pendingAuthority: pendingEmployeeAuthority,
        uniqueResourceIds: new Set(employeePrivate.map((row) => row.resourceId)).size,
        gate: "fail",
      },
      agent_primary: {
        required: "100% exact agentAssetId",
        persistentCatalog: "0%",
        classifiedExact: classifiedAgentPrimary,
        observed: agentPrimaryTotal,
        gate: "fail",
      },
      group_shared: {
        required: "100% tenant-scoped binding",
        persistentCatalog: "0%",
        observed: groupShared.length,
        inventoried: groupShared.length > 0,
        classifiedWithTenant: classifiedGroupWithTenant,
        gate: "fail",
      },
      conflict_or_unknown: {
        required: "100% blocked + listed",
        listed: true,
        blockedInProduction: false,
        gate: "fail",
      },
    },
    candidates,
    p0ExitGate: {
      unexplainedWritableRoots: unexplainedRootCount(raw.roots) > 0 ? "open" : "closed",
      notClassifiedCount: unexplainedRootCount(raw.roots),
      pendingAuthority: pendingEmployeeAuthority,
      coverageRecomputable: true,
      coveragePassed: false,
      freshLiveProbe: evidenceId,
    },
  };
}

function redact(raw, evidenceId) {
  const redactUser = redactUserFactory();
  return {
    evidenceId,
    schema: `${SUMMARY_SCHEMA}+roots`,
    transform: "raw-controlled -> summary-redacted",
    probeUtc: raw.probeUtc,
    classification: "controlled-audit-desensitized",
    probe: {
      scriptPath: raw.scriptPath,
      scriptSha256: raw.scriptSha256,
      schema: raw.schema,
      truncated: Boolean(raw.limits?.truncated),
    },
    cluster: raw.cluster,
    registry: raw.registry,
    agentIndex: {
      count: (raw.agents ?? []).length,
      withOwnerId: (raw.agents ?? []).filter((row) => row.hasOwnerId).length,
      withWorkspaceConfig: (raw.agents ?? []).filter((row) => row.hasWorkspaceConfig).length,
    },
    classificationCounts: (raw.roots ?? []).reduce((acc, row) => {
      acc[row.classification] = (acc[row.classification] ?? 0) + 1;
      return acc;
    }, {}),
    sqlite: sqliteWithDualTree(raw),
    dualTree: dualTreeRows(raw),
    roots: (raw.roots ?? []).map((row) => ({
      classId: row.classId,
      kind: row.kind,
      slug: hashSlug(row.slug),
      groupId: row.groupId ? hashSlug(row.groupId) : undefined,
      tenantId: row.tenantId ? `tenant-${sha12(row.tenantId)}` : undefined,
      userId: redactUser(row.userId),
      pathPattern: redactLocator(row.pathPattern),
      mdCount: row.mdCount,
      classification: row.classification,
      resolutionStatus: row.resolutionStatus,
      evidenceHint: row.evidenceHint,
      assetLookup: row.assetLookup
        ? {
            reason: row.assetLookup.reason,
            matchCount: row.assetLookup.matchCount,
            hasAgentAssetId: Boolean(row.assetLookup.agentAssetId),
          }
        : undefined,
    })),
  };
}

function parseArgs(argv) {
  let mode = "raw-controlled";
  let evidenceId = "";
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--mode") {
      mode = argv[++i] ?? "";
    } else if (arg.startsWith("--mode=")) {
      mode = arg.slice("--mode=".length);
    } else if (arg === "--evidence-id") {
      evidenceId = argv[++i] ?? "";
    } else if (arg.startsWith("--evidence-id=")) {
      evidenceId = arg.slice("--evidence-id=".length);
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        `Usage: OPENBOT_STATE_DIR=... OPENBOT_TENANTS_ROOT=... node ${SCRIPT_PATH} --mode raw-controlled|evidence-summary|catalog-candidate|summary-redacted\n`,
      );
      process.exit(0);
    } else {
      die(`unknown argument: ${arg}`);
    }
  }
  const allowed = new Set([
    "raw-controlled",
    "evidence-summary",
    "catalog-candidate",
    "summary-redacted",
  ]);
  if (!allowed.has(mode)) {
    die(`--mode must be raw-controlled|evidence-summary|catalog-candidate|summary-redacted`);
  }
  return { mode, evidenceId };
}

function readStdinJson() {
  const text = fs.readFileSync(0, "utf8").trim();
  if (!text) {
    die("expected raw JSON on stdin");
  }
  return JSON.parse(text);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const args = parseArgs(process.argv);
  if (args.mode === "raw-controlled") {
    process.stdout.write(`${JSON.stringify(collectRaw(), null, 2)}\n`);
  } else {
    const raw = readStdinJson();
    const evidenceId =
      args.evidenceId ||
      (args.mode === "catalog-candidate"
        ? "memory-workspace-phase0-20260814"
        : "memory-workspace-phase0-live-20260814");
    const out =
      args.mode === "evidence-summary"
        ? buildEvidenceSummary(raw, evidenceId)
        : args.mode === "catalog-candidate"
          ? buildCatalogCandidate(raw, evidenceId)
          : redact(raw, evidenceId);
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  }
}
