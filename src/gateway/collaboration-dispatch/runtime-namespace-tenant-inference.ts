/**
 * P0.0a migration — offline tenant inference for legacy host collaboration groups.
 *
 * Precedence: explicit operator tenant map → group-local records (`tenantId` in
 * operating-state.json / profile.json), the tenant-scoped group ACL
 * (`<tenantsRoot>/<tid>/collaboration/groups/<enc>/members.json`, workspace/group-acl.ts)
 * and a `/tenants/<tid>/collaboration/` path segment →
 * Owner decision (2026-10-05): groups with no inferable tenant go to tenant "001"
 * with reason `owner-default-tenant-001`. Conflicting or invalid candidates are
 * quarantined (not migrated) for manual disposition.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import { assertSafeTenantId } from "../tenant-store-paths.js";

export const OWNER_DEFAULT_TENANT_ID = "001";
export const OWNER_DEFAULT_TENANT_REASON = "owner-default-tenant-001";

export type TenantDecision =
  | {
      status: "resolved";
      tenantId: string;
      reason:
        | "tenant-map"
        | "group-record"
        | "group-acl"
        | "path-hint"
        | typeof OWNER_DEFAULT_TENANT_REASON;
      evidence: string[];
    }
  | {
      status: "quarantine";
      reason: "tenant-conflict" | "invalid-tenant" | "tenant-changed-since-last-migration";
      candidates: string[];
      evidence: string[];
    };

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function stringField(value: unknown, ...keys: string[]): string | null {
  let current: unknown = value;
  for (const key of keys) {
    if (!current || typeof current !== "object") {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" && current.trim() ? current.trim() : null;
}

function isSafeTenant(tenantId: string): boolean {
  try {
    assertSafeTenantId(tenantId);
    return true;
  } catch {
    return false;
  }
}

/** Tenant id from a `/tenants/<tid>/collaboration/` segment of an absolute path, if any. */
export function tenantHintFromPath(filePath: string): string | null {
  const segments = path.resolve(filePath).split(path.sep);
  for (let index = segments.length - 3; index >= 0; index -= 1) {
    if (segments[index] === "tenants" && segments[index + 2] === "collaboration") {
      return segments[index + 1] || null;
    }
  }
  return null;
}

/** Tenants whose authoritative group ACL (members.json) already lists this group. */
async function listGroupAclTenants(tenantsRoot: string | undefined, groupId: string) {
  if (!tenantsRoot) {
    return [];
  }
  const tenants = await fs.readdir(tenantsRoot, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const entry of tenants) {
    if (!entry.isDirectory()) {
      continue;
    }
    const members = path.join(
      tenantsRoot,
      entry.name,
      "collaboration",
      "groups",
      encodeURIComponent(groupId),
      "members.json",
    );
    if (
      await fs.stat(members).then(
        (st) => st.isFile(),
        () => false,
      )
    ) {
      out.push(entry.name);
    }
  }
  return out.toSorted();
}

export async function inferGroupTenant(params: {
  groupId: string;
  legacyGroupDir: string;
  tenantMap?: Record<string, string>;
  /** managed_enterprise tenants root; enables group-ACL (members.json) evidence. */
  tenantsRoot?: string;
}): Promise<TenantDecision> {
  const mapped = params.tenantMap?.[params.groupId];
  if (mapped !== undefined) {
    const tenantId = canonicalizeTenantId(mapped);
    if (!tenantId || !isSafeTenant(tenantId)) {
      return {
        status: "quarantine",
        reason: "invalid-tenant",
        candidates: [mapped],
        evidence: ["tenant-map"],
      };
    }
    return { status: "resolved", tenantId, reason: "tenant-map", evidence: ["tenant-map"] };
  }

  const candidates = new Map<string, string[]>();
  const add = (raw: string | null, evidence: string) => {
    const tenantId = canonicalizeTenantId(raw);
    if (!tenantId) {
      return;
    }
    candidates.set(tenantId, [...(candidates.get(tenantId) ?? []), evidence]);
  };
  const operatingState = await readJson(path.join(params.legacyGroupDir, "operating-state.json"));
  add(stringField(operatingState, "tenantId"), "operating-state.json:tenantId");
  add(
    stringField(operatingState, "groupProfile", "tenantId"),
    "operating-state.json:groupProfile.tenantId",
  );
  const profile = await readJson(path.join(params.legacyGroupDir, "profile.json"));
  add(stringField(profile, "tenantId"), "profile.json:tenantId");
  add(stringField(profile, "profile", "tenantId"), "profile.json:profile.tenantId");
  for (const tenantId of await listGroupAclTenants(params.tenantsRoot, params.groupId)) {
    add(tenantId, `group-acl:${tenantId}/members.json`);
  }
  add(tenantHintFromPath(params.legacyGroupDir), "path:/tenants/<tid>/");

  const evidence = [...candidates.values()].flat();
  if (candidates.size > 1) {
    return {
      status: "quarantine",
      reason: "tenant-conflict",
      candidates: [...candidates.keys()].toSorted(),
      evidence,
    };
  }
  const [only] = [...candidates.keys()];
  if (only) {
    if (!isSafeTenant(only)) {
      return { status: "quarantine", reason: "invalid-tenant", candidates: [only], evidence };
    }
    const reason = evidence.some((entry) => entry.includes(".json:"))
      ? "group-record"
      : evidence.some((entry) => entry.startsWith("group-acl:"))
        ? "group-acl"
        : "path-hint";
    return { status: "resolved", tenantId: only, reason, evidence };
  }
  return {
    status: "resolved",
    tenantId: OWNER_DEFAULT_TENANT_ID,
    reason: OWNER_DEFAULT_TENANT_REASON,
    evidence: [],
  };
}
