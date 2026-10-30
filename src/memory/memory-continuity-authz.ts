/**
 * Memory safe-continuity authz (P0).
 *
 * Permission sources checked (documented for tests):
 * 1. **Tenant identity** — `MemorySearchGovernance.tenantId` (call-entry) and, for
 *    managed_enterprise, the tenant-scoped collaboration locator
 *    (`tenants/<tid>/collaboration/groups/...`). Same groupId under another
 *    tenant must not resolve to the caller's roots.
 * 2. **Membership** — authoritative `members.json` via
 *    `loadAuthoritativeGroupMembers` / `assertGroupMemberAccess`
 *    (active|invited only). Non-member and revoked (status≠active|invited) deny.
 * 3. **Path scope** — collaboration markdown is only readable when its groupId is
 *    in the caller's authorized set; denials return a reason code with **no**
 *    body or snippet.
 *
 * Builtin indexing must pass `authorizedGroupIds` into discovery helpers so we
 * never dump every group's memory into every agent index.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { OpenBotConfig } from "../config/config.js";
import {
  type CollaborationMemoryIndexRoot,
  discoverCollaborationMemoryIndexRoots,
  listCollaborationMemoryMarkdownDocs,
  type CollaborationMemoryIndexDoc,
} from "../gateway/collaboration-learning/memory-index-paths.js";
import {
  assertGroupMemberAccess,
  loadAuthoritativeGroupMembers,
} from "../gateway/workspace/group-acl.js";
import {
  resolveTrustedCollaborationGroupsRoot,
  resolveTrustedGroupLocator,
} from "../gateway/workspace/group-locator.js";
import { normalizeRelPath } from "./internal.js";
import type { MemorySearchGovernance } from "./memory-search-governance.js";
import type { MemorySearchResult } from "./types.js";

export type MemoryContinuityPermissionSource =
  | "governance.tenantId+members.json"
  | "members.json"
  | "personal_workspace_only"
  | "missing_caller_identity"
  | "managed_missing_tenant";

export type MemoryContinuityAuthzContext = {
  readonly tenantId: string | null;
  readonly userId: string | null;
  readonly profile: "personal_local" | "managed_enterprise";
  /** Group ids the caller may index/search/get. Empty when none authorized. */
  readonly authorizedGroupIds: ReadonlySet<string>;
  readonly permissionSource: MemoryContinuityPermissionSource;
  readonly roots: readonly CollaborationMemoryIndexRoot[];
};

export type MemoryPathAccessDenial = {
  readonly ok: false;
  readonly reasonCode:
    | "not_authorized"
    | "cross_tenant"
    | "non_member"
    | "revoked_or_inactive"
    | "missing_identity"
    | "invalid_path";
  readonly reason: string;
};

export type MemoryPathAccessResult =
  | { readonly ok: true; readonly absPath: string; readonly relPath: string }
  | MemoryPathAccessDenial;

const COLLAB_PATH_RE = /^collaboration\/([^/]+)\/memory(?:\/|$)/i;

/** Parse `collaboration/<groupId>/memory/...` → groupId, or null. */
export function parseCollaborationMemoryGroupId(relPath: string): string | null {
  const normalized = normalizeRelPath(relPath);
  const match = COLLAB_PATH_RE.exec(normalized);
  if (!match?.[1]) {
    return null;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function isCollaborationMemoryRelPath(relPath: string): boolean {
  return parseCollaborationMemoryGroupId(relPath) !== null;
}

function extractUserIdFromGovernance(
  governance: MemorySearchGovernance | undefined,
  authenticatedUserId?: string | null,
): string | null {
  const explicit = authenticatedUserId?.trim();
  if (explicit) {
    return explicit;
  }
  const proof = governance?.ownershipProof;
  if (!proof) {
    return null;
  }
  if (proof.owner.kind === "user") {
    return proof.owner.userId?.trim() || null;
  }
  return null;
}

async function listGroupIdsUnderRoot(groupsRoot: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(groupsRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        try {
          return decodeURIComponent(entry.name);
        } catch {
          return entry.name;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Resolve which collaboration groups the caller may read, then discover only
 * those memory roots (never all groups for every agent).
 */
export async function resolveMemoryContinuityAuthz(params: {
  cfg: OpenBotConfig;
  governance?: MemorySearchGovernance;
  authenticatedUserId?: string | null;
  /** When set, only these group ids are considered (still membership-filtered). */
  candidateGroupIds?: readonly string[];
  profile?: "personal_local" | "managed_enterprise";
}): Promise<MemoryContinuityAuthzContext> {
  const tenantId = params.governance?.tenantId?.trim() || null;
  const userId = extractUserIdFromGovernance(params.governance, params.authenticatedUserId);
  // Trusted security mode must be passed explicitly (tool/search-manager entry).
  // Do NOT infer managed_enterprise from tenant presence alone — that would let a
  // tenant-bearing personal call fall into managed roots, and a managed call
  // missing tenant fall through to personal roots. Default is personal_local;
  // managed without tenant fails closed below.
  const profile = params.profile ?? "personal_local";

  if (!userId) {
    // No caller identity → do not attach any collaboration roots (DM/personal
    // workspace memory still works via the agent workspace).
    return {
      tenantId,
      userId: null,
      profile,
      authorizedGroupIds: new Set(),
      permissionSource: "missing_caller_identity",
      roots: [],
    };
  }

  if (profile === "managed_enterprise" && !tenantId) {
    // Fail closed: managed mode without tenant must NOT fall through to personal roots.
    return {
      tenantId: null,
      userId,
      profile,
      authorizedGroupIds: new Set(),
      permissionSource: "managed_missing_tenant",
      roots: [],
    };
  }

  let candidateIds: string[];
  if (params.candidateGroupIds && params.candidateGroupIds.length > 0) {
    candidateIds = [...new Set(params.candidateGroupIds.map((id) => id.trim()).filter(Boolean))];
  } else if (profile === "managed_enterprise" && tenantId) {
    const groupsRoot = resolveTrustedCollaborationGroupsRoot({
      tenantId,
      profile: "managed_enterprise",
      cfg: params.cfg,
    });
    candidateIds = await listGroupIdsUnderRoot(groupsRoot);
  } else {
    const discovered = await discoverCollaborationMemoryIndexRoots(params.cfg, {
      authorizedGroupIds: undefined,
    });
    candidateIds = discovered.map((root) => root.groupId);
  }

  const authorized: string[] = [];
  for (const groupId of candidateIds) {
    const denial = await assertGroupMemberAccess({
      groupId,
      userId,
      tenantId,
      profile,
      cfg: params.cfg,
    });
    if (!denial) {
      authorized.push(groupId);
    }
  }

  const authorizedGroupIds = new Set(authorized);
  const roots = await discoverCollaborationMemoryIndexRoots(params.cfg, {
    tenantId,
    profile,
    authorizedGroupIds,
  });

  return {
    tenantId,
    userId,
    profile,
    authorizedGroupIds,
    permissionSource:
      profile === "managed_enterprise" ? "governance.tenantId+members.json" : "members.json",
    roots,
  };
}

/** Resolve abs path for an authorized collaboration memory relPath. */
export function resolveAuthorizedCollaborationAbsPath(params: {
  relPath: string;
  roots: readonly CollaborationMemoryIndexRoot[];
}): string | null {
  const normalized = normalizeRelPath(params.relPath);
  const groupId = parseCollaborationMemoryGroupId(normalized);
  if (!groupId) {
    return null;
  }
  const root = params.roots.find((entry) => entry.groupId === groupId);
  if (!root) {
    return null;
  }
  if (normalized !== root.indexPrefix && !normalized.startsWith(`${root.indexPrefix}/`)) {
    return null;
  }
  const rest = normalized.slice(root.indexPrefix.length).replace(/^\//, "");
  return rest ? path.join(root.memoryDir, rest) : root.memoryDir;
}

/**
 * Assert the caller may read this memory path. Collaboration paths require
 * membership; denials never include file body/snippets.
 */
export async function assertMemoryContinuityPathAccess(params: {
  relPath: string;
  authz: MemoryContinuityAuthzContext;
  cfg: OpenBotConfig;
}): Promise<MemoryPathAccessResult> {
  const relPath = normalizeRelPath(params.relPath);
  if (!relPath) {
    return { ok: false, reasonCode: "invalid_path", reason: "path required" };
  }

  const groupId = parseCollaborationMemoryGroupId(relPath);
  if (!groupId) {
    // Non-collaboration paths are scoped by the caller's agent workspace /
    // manager instance (separate cache key / dataRoot). Allowed here.
    return { ok: true, absPath: "", relPath };
  }

  if (!params.authz.userId) {
    return {
      ok: false,
      reasonCode: "missing_identity",
      reason: "not authorized",
    };
  }

  if (!params.authz.authorizedGroupIds.has(groupId)) {
    // Distinguish revoked vs never-member when membership file is readable.
    try {
      const members = await loadAuthoritativeGroupMembers({
        groupId,
        tenantId: params.authz.tenantId,
        profile: params.authz.profile,
        cfg: params.cfg,
      });
      const match = members.find(
        (member) =>
          typeof member.userId === "string" &&
          member.userId.trim().toLowerCase() === params.authz.userId!.toLowerCase(),
      );
      if (match && match.status !== "active" && match.status !== "invited") {
        return {
          ok: false,
          reasonCode: "revoked_or_inactive",
          reason: "not authorized",
        };
      }
    } catch {
      // Fall through to generic non_member / cross_tenant denial.
    }

    if (params.authz.profile === "managed_enterprise") {
      // Same groupId under another tenant must not leak — treat as cross_tenant
      // when the caller's tenant-scoped roots do not contain this group.
      return {
        ok: false,
        reasonCode: "cross_tenant",
        reason: "not authorized",
      };
    }
    return {
      ok: false,
      reasonCode: "non_member",
      reason: "not authorized",
    };
  }

  const absPath = resolveAuthorizedCollaborationAbsPath({
    relPath,
    roots: params.authz.roots,
  });
  if (!absPath) {
    return { ok: false, reasonCode: "not_authorized", reason: "not authorized" };
  }
  return { ok: true, absPath, relPath };
}

/** Drop unauthorized collaboration hits; never rewrite snippets of denied rows. */
export function filterMemorySearchResultsForAuthz(params: {
  results: MemorySearchResult[];
  authz: MemoryContinuityAuthzContext;
}): MemorySearchResult[] {
  return params.results.filter((entry) => {
    const groupId = parseCollaborationMemoryGroupId(entry.path);
    if (!groupId) {
      return true;
    }
    return params.authz.authorizedGroupIds.has(groupId);
  });
}

/** List markdown docs for authorized roots only (reuse discovery helpers). */
export async function listAuthorizedCollaborationMemoryMarkdownDocs(
  authz: MemoryContinuityAuthzContext,
): Promise<CollaborationMemoryIndexDoc[]> {
  if (authz.roots.length === 0) {
    return [];
  }
  const docs = await Promise.all(
    authz.roots.map((root) => listCollaborationMemoryMarkdownDocs(root)),
  );
  return docs.flat();
}

/** Stable cache component so two callers never share an over-privileged index. */
export function memoryContinuityAuthzCacheComponent(
  authz: MemoryContinuityAuthzContext | undefined,
): string {
  if (!authz) {
    return "collab:none";
  }
  const groups = [...authz.authorizedGroupIds].toSorted().join(",");
  const tenant = authz.tenantId?.trim() || "-";
  const user = authz.userId?.trim() || "-";
  return `collab:${authz.profile}:${tenant}:${user}:${groups || "-"}`;
}

/** Test helper: resolve managed group memory dir for a tenant. */
export function resolveManagedGroupMemoryDir(params: {
  groupId: string;
  tenantId: string;
  cfg?: OpenBotConfig;
}): string {
  const locator = resolveTrustedGroupLocator({
    groupId: params.groupId,
    tenantId: params.tenantId,
    profile: "managed_enterprise",
    cfg: params.cfg ?? {},
  });
  return path.join(locator, "memory");
}
