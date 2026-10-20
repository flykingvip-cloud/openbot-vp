import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sanitizeEmployeeStewardIdentity } from "../../agents/builtin-steward/employee-isolation.js";
import { BUILTIN_STEWARD_AGENT_ID } from "../../agents/builtin-steward/identity.js";
import { resolveStateDir } from "../../config/paths.js";
import type { OpenBotConfig } from "../../config/types.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import {
  findActiveCutoverOperation,
  gateCutoverWrite,
  getGatewayWorkspaceCutoverStore,
  isCutoverSourceWriteBlocked,
  listActiveCutoverOperationsForResource,
  type WorkspaceCutoverOperation,
  type WorkspaceCutoverStore,
} from "../workspace-cutover/index.js";
import { buildEmployeeStewardCutoverCatalogEntries, buildWorkspaceResourceId } from "./builders.js";
import {
  InMemoryWorkspaceResourceCatalog,
  withCatalogEntries,
  type WorkspaceResourceCatalog,
} from "./catalog.js";
import { resolveWorkspaceActorTenantId } from "./group-read.js";
import { openWorkspaceResourceAccess, resolveWorkspaceResource } from "./resolve.js"; import { resolveWorkspaceLocator, resolveWorkspaceTargetBinding } from "./strict-locator.js";
import type { WorkspaceResolveActor } from "./types.js";

export const STEWARD_BUILTIN_AGENT_ASSET_ID = "steward:builtin" as const;

export function resolveEmployeeStewardSourceWorkspaceDir(
  platformUserId: string,
  stateDir: string = resolveStateDir(process.env),
): string {
  const owner = sanitizeEmployeeStewardIdentity(platformUserId);
  return path.join(
    stateDir,
    "agents",
    normalizeAgentId(BUILTIN_STEWARD_AGENT_ID),
    "employees",
    owner,
    "workspace",
  );
}

/** Audit D1e target: tenants/<tenantId>/users/<userId>/OpenBot/agents/main/workspace */
export function resolveEmployeeStewardTargetWorkspaceDir(params: {
  tenantId: string;
  userId: string;
  stateDir?: string;
}): string {
  const owner = sanitizeEmployeeStewardIdentity(params.userId);
  const tenantId = resolveWorkspaceActorTenantId(params.tenantId);
  const stateDir = params.stateDir ?? resolveStateDir(process.env);
  return path.join(
    stateDir,
    "tenants",
    tenantId,
    "users",
    owner,
    "OpenBot",
    "agents",
    normalizeAgentId(BUILTIN_STEWARD_AGENT_ID),
    "workspace",
  );
}

export function buildEmployeeStewardCutoverCatalog(params: {
  tenantId: string;
  userId: string;
  sourceRoot: string;
  targetRoot: string;
  cutoverState?: "pre" | "post";
}): {
  catalog: WorkspaceResourceCatalog;
  resourceId: string;
  sourceBindingId: string;
  targetBindingId: string;
} {
  const entries = buildEmployeeStewardCutoverCatalogEntries({
    tenantId: resolveWorkspaceActorTenantId(params.tenantId),
    userId: sanitizeEmployeeStewardIdentity(params.userId),
    sourceRoot: params.sourceRoot,
    targetRoot: params.targetRoot,
    agentAssetId: STEWARD_BUILTIN_AGENT_ASSET_ID,
  });
  const post = params.cutoverState === "post";
  const sourceBinding = {
    ...entries.sourceBinding,
    role: post ? ("compatibility" as const) : ("canonical" as const),
    state: post ? ("read_only" as const) : ("active" as const),
  };
  const targetBinding = {
    ...entries.targetBinding,
    role: post ? ("canonical" as const) : ("compatibility" as const),
    state: post ? ("active" as const) : ("read_only" as const),
  };
  const seed = new InMemoryWorkspaceResourceCatalog({ governanceVersion: 1, status: "available", resources: { [entries.resource.resourceId]: entries.resource }, bindings: {} });
  const catalog = withCatalogEntries(seed, {
    resource: entries.resource, binding: sourceBinding,
  });
  const snap = (void import("./item7-w3-shadow.js").then((m) => m.scheduleItem7W3CatalogSynthesisShadow({ ledgerId: "S23", existingResourceId: entries.resource.resourceId })), catalog.getResource(entries.resource.resourceId) ?? (() => { throw new Error("catalog_record_required"); })(), catalog.snapshot());
  const merged = {
    ...snap,
    bindings: {
      ...snap.bindings,
      [targetBinding.bindingId]: targetBinding,
    },
  };
  return {
    catalog: {
      snapshot: () => merged,
      getResource: (id: string) => merged.resources[id] ?? null,
      getBinding: (id: string) => merged.bindings[id] ?? null,
      listBindingsForResource: (resourceId: string) =>
        Object.values(merged.bindings).filter((binding) => binding.resourceId === resourceId),
    },
    resourceId: entries.resource.resourceId,
    sourceBindingId: sourceBinding.bindingId,
    targetBindingId: targetBinding.bindingId,
  };
}

export type StewardWritableWorkspaceResult =
  | {
      ok: true;
      cwd: string;
      resourceId: string;
      bindingId: string;
      cutoverState: WorkspaceCutoverOperation["state"] | null;
    }
  | {
      ok: false;
      reason: string;
    };

/**
 * Resolve the single writable steward cwd under active cutover (fail-closed during freeze).
 */
export function resolveEmployeeStewardWritableWorkspaceDir(params: {
  tenantId: string;
  userId: string;
  cfg?: OpenBotConfig;
  cutoverStore?: WorkspaceCutoverStore;
  stateDir?: string;
  actor?: WorkspaceResolveActor; catalog?: WorkspaceResourceCatalog; grant?: { kind: "user" | "seat" | "group"; subjectId: string; purpose: string };
}): StewardWritableWorkspaceResult {
  const tenantId = resolveWorkspaceActorTenantId(params.tenantId);
  const userId = sanitizeEmployeeStewardIdentity(params.userId);
  const stewardResourceId = buildWorkspaceResourceId({ tenantId, scope: { kind: "user_owned", userId, agentAssetId: STEWARD_BUILTIN_AGENT_ASSET_ID, proof: { source: "explicit_binding", ownerType: "user", ownerId: userId, agentAssetId: STEWARD_BUILTIN_AGENT_ASSET_ID } } });
  const sourceRoot = ((located) => (located.ok ? located.handle.locator : ""))(resolveWorkspaceLocator({ catalog: params.catalog, cfg: params.cfg, tenantId, tenantContext: tenantId && userId ? { tenantId, userId, domain: "enterprise" } : null, actor: { userId, grant: params.grant }, agentAssetId: STEWARD_BUILTIN_AGENT_ASSET_ID, resourceId: stewardResourceId }));
  const targetRoot = ((located) => (located.ok ? located.handle.locator : ""))(resolveWorkspaceTargetBinding({ catalog: params.catalog, cfg: params.cfg, tenantId, tenantContext: tenantId && userId ? { tenantId, userId, domain: "enterprise" } : null, actor: { userId, grant: params.grant }, agentAssetId: STEWARD_BUILTIN_AGENT_ASSET_ID, resourceId: stewardResourceId }));
  const built = !sourceRoot || !targetRoot ? { catalog: params.catalog ?? new InMemoryWorkspaceResourceCatalog({ governanceVersion: 1, status: "available", resources: {}, bindings: {} }), resourceId: "", sourceBindingId: "", targetBindingId: "" } : (void import("./item7-w4-shadow.js").then((m) => (m.scheduleItem7W4StewardHelperShadow({ ledgerId: "S24", catalogResourceId: null }), m.scheduleItem7W4StewardHelperShadow({ ledgerId: "S25", catalogResourceId: null }))), buildEmployeeStewardCutoverCatalog({
    tenantId,
    userId,
    sourceRoot,
    targetRoot,
  }));

  const store = params.cutoverStore ?? getGatewayWorkspaceCutoverStore(params.cfg);
  const cutoverOps = listActiveCutoverOperationsForResource(store, built.resourceId);
  const cutover = findActiveCutoverOperation(cutoverOps, built.resourceId);
  const catalog =
    cutover && isCutoverSourceWriteBlocked(cutover)
      ? buildEmployeeStewardCutoverCatalog({
          tenantId,
          userId,
          sourceRoot,
          targetRoot,
          cutoverState: "post",
        }).catalog
      : built.catalog;

  const actor = params.actor ?? { tenantId, userId };
  const resolved = resolveWorkspaceResource({
    catalog,
    cfg: params.cfg,
    actor,
    resourceId: built.resourceId,
    operation: "write",
    purpose: "employee.steward.workspace.write",
    cutoverOperations: cutoverOps.length > 0 ? cutoverOps : undefined,
  });
  if (!sourceRoot || !targetRoot || !resolved.ok) {
    return { ok: false, reason: !resolved.ok && sourceRoot && targetRoot ? resolved.reason : "catalog_record_required" };
  }
  if (cutover) {
    const gate = gateCutoverWrite({ operation: cutover, bindingId: resolved.bindingId });
    if (!gate.ok) {
      return { ok: false, reason: gate.reason };
    }
  }
  const access = openWorkspaceResourceAccess({ catalog, resolved });
  if (!access) {
    return { ok: false, reason: "binding_not_found" };
  }
  return {
    ok: true,
    cwd: access.realRootPath(),
    resourceId: resolved.resourceId,
    bindingId: resolved.bindingId,
    cutoverState: cutover?.state ?? null,
  };
}

/** Digests of file names + sizes under a workspace root (shallow verified-copy check). */
export function digestWorkspaceTree(root: string): string {
  const lines: string[] = [];
  const walk = (dir: string, rel: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === "." || entry.name === "..") {
        continue;
      }
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs, childRel);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const st = fs.statSync(abs);
      lines.push(`${childRel}:${st.size}`);
    }
  };
  walk(root, "");
  return crypto.createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
}

/**
 * Verified copy for cutover — recursive file copy, never rename/mv of the source root.
 */
export function verifiedCopyStewardWorkspace(params: {
  sourceRoot: string;
  targetRoot: string;
}): { ok: true; digest: string } | { ok: false; reason: string } {
  if (!fs.existsSync(params.sourceRoot)) {
    return { ok: false, reason: "source_missing" };
  }
  // Convert a thrown mkdir/copy (permission, EIO, ...) into a structured failure so callers can
  // quarantine and recover instead of letting the exception escape mid-materialization.
  try {
    fs.mkdirSync(params.targetRoot, { recursive: true });
    fs.cpSync(params.sourceRoot, params.targetRoot, { recursive: true, force: true });
  } catch {
    return { ok: false, reason: "copy_failed" };
  }
  const sourceDigest = digestWorkspaceTree(params.sourceRoot);
  const targetDigest = digestWorkspaceTree(params.targetRoot);
  if (sourceDigest !== targetDigest) {
    return { ok: false, reason: "digest_mismatch" };
  }
  return { ok: true, digest: sourceDigest };
}

// runEmployeeStewardCutoverPilot moved to ./provision-steward-cutover.ts (Batch 24 / S26+S27
// retirement): it now provisions via provisionEmployeeStewardCutoverWorkspace and reads the
// source/target Catalog bindings, so it no longer calls the host-path resolvers here.
