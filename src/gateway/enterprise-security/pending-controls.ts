/**
 * Enterprise controls that change gateway auth, login/session checks, or run gates.
 * Domain refusals are `{ ok: false, reason }` and write nothing.
 */
import { randomUUID } from "node:crypto";
import { loadConfig } from "../../config/config.js";
import { resolvePlatformAuthConfig } from "../platform-auth/config.js";
import { findUserByEmail, listMembershipsByUserId } from "../platform-auth/memberships.js";
import { loadStore } from "../platform-auth/store.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import type { AssetLookup } from "./asset-lookup.js";
import { ipMatchesAllowlist, validateAllowlist } from "./cidr.js";
import {
  fingerprintBody,
  idempotencyStorageKey,
  withIdempotency,
  type IdempotencyStore,
} from "./idempotency.js";
import {
  BUILTIN_ACCESS_ROLE_IDS,
  HIGH_RISK_ACCESS_PERMISSIONS,
  SERVER_ACCESS_CATALOG,
  assetControlKey,
  builtinRolePermissions,
  readTenantControls,
  updateTenantControls,
  type AccessRoleRecord,
  type AssetControlType,
  type MemberGrantRecord,
} from "./tenant-controls-store.js";

export const ENTERPRISE_ACCESS_ROLES_CREATE_METHOD = "enterprise.access.roles.create";
export const ENTERPRISE_ACCESS_PERMISSIONS_COMMIT_METHOD = "enterprise.access.permissions.commit";
export const ENTERPRISE_SECURITY_SESSION_POLICY_SET_METHOD =
  "enterprise.security.session-policy.set";
export const ENTERPRISE_SECURITY_IP_ALLOWLIST_SET_METHOD = "enterprise.security.ip-allowlist.set";
export const ENTERPRISE_SECURITY_AUDIT_EXPORT_METHOD = "enterprise.security.audit.export";
export const ENTERPRISE_MESH_ASSET_BUDGET_SET_METHOD = "enterprise.mesh.asset-budget.set";
export const ENTERPRISE_MESH_ASSET_PAUSE_METHOD = "enterprise.mesh.asset.pause";

const SERVER_PERMISSIONS = new Set<string>(SERVER_ACCESS_CATALOG);

export type MemberTarget =
  | { status: "found"; userId: string; membershipRole: "enterprise-admin" | "member" }
  | { status: "unknown" }
  | { status: "unavailable"; message: string };

export type PendingControlDeps = {
  idempotency: IdempotencyStore;
  lookupAsset: (params: {
    tenantId: string;
    assetType: AssetControlType;
    assetId: string;
  }) => Promise<AssetLookup>;
  resolveMember: (tenantId: string, targetKey: string) => Promise<MemberTarget>;
  exportAudit: (params: {
    tenantId: string;
    from: string;
    to: string;
    format: "json" | "csv";
  }) => Promise<
    | { ok: true; exportId: string; downloadPath: string }
    | { ok: false; reason: "range_too_wide" | "export_unavailable" }
  >;
};

export class PendingControlUnavailable extends Error {}

function unknownPermissions(permissionIds: string[]): boolean {
  return permissionIds.some((id) => !SERVER_PERMISSIONS.has(id));
}

function samePermissions(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const sortedLeft = [...left].toSorted();
  const sortedRight = [...right].toSorted();
  return sortedLeft.every((id, index) => id === sortedRight[index]);
}

function roleCatalog(roles: Record<string, AccessRoleRecord>): Array<{
  id: string;
  permissionIds: string[];
}> {
  return [
    { id: "viewer", permissionIds: [] },
    { id: "operator", permissionIds: [] },
    ...Object.values(roles).map((role) => ({
      id: role.id,
      permissionIds: role.permissionIds,
    })),
  ];
}

function matchingRoleId(
  roles: Record<string, AccessRoleRecord>,
  permissionIds: string[],
): string | undefined {
  const matches = roleCatalog(roles).filter((role) =>
    samePermissions(role.permissionIds, permissionIds),
  );
  return matches.length === 1 ? matches[0]?.id : undefined;
}

async function runIdempotent<T>(params: {
  deps: PendingControlDeps;
  tenantId: string;
  method: string;
  idempotencyKey: string;
  body: unknown;
  produce: () => Promise<T>;
}): Promise<T> {
  const outcome = await withIdempotency({
    store: params.deps.idempotency,
    key: idempotencyStorageKey({
      tenantId: params.tenantId,
      method: params.method,
      idempotencyKey: params.idempotencyKey,
    }),
    fingerprint: fingerprintBody(params.body),
    conflict: { ok: false, reason: "idempotency_conflict" } as T,
    produce: params.produce,
  });
  return outcome.value;
}

export async function createAccessRole(params: {
  deps: PendingControlDeps;
  tenantId: string;
  name: string;
  permissionIds: string[];
  idempotencyKey: string;
}): Promise<{ ok: boolean; roleId?: string; reason?: string }> {
  return runIdempotent({
    deps: params.deps,
    tenantId: params.tenantId,
    method: ENTERPRISE_ACCESS_ROLES_CREATE_METHOD,
    idempotencyKey: params.idempotencyKey,
    body: { name: params.name, permissionIds: params.permissionIds },
    produce: async () => {
      if (unknownPermissions(params.permissionIds)) {
        return { ok: false, reason: "unknown_permission" };
      }
      const normalized = params.name.trim();
      const takenName = normalized.toLowerCase();
      if ((BUILTIN_ACCESS_ROLE_IDS as readonly string[]).includes(takenName)) {
        return { ok: false, reason: "name_taken" };
      }
      const existing = await readTenantControls(params.tenantId);
      if (
        Object.values(existing.roles).some((role) => role.name.trim().toLowerCase() === takenName)
      ) {
        return { ok: false, reason: "name_taken" };
      }
      const roleId = `role_${randomUUID()}`;
      const revision = `rev_${randomUUID()}`;
      await updateTenantControls(params.tenantId, (document) => {
        document.roles[roleId] = {
          id: roleId,
          name: normalized,
          permissionIds: [...params.permissionIds],
          revision,
        };
      });
      return { ok: true, roleId };
    },
  });
}

export async function commitAccessPermissions(params: {
  deps: PendingControlDeps;
  tenantId: string;
  targetKind: "role" | "member";
  targetKey: string;
  permissionIds: string[];
  confirmedHighRiskPermissionIds: string[];
  idempotencyKey: string;
}): Promise<{ ok: boolean; revision?: string; reason?: string }> {
  return runIdempotent({
    deps: params.deps,
    tenantId: params.tenantId,
    method: ENTERPRISE_ACCESS_PERMISSIONS_COMMIT_METHOD,
    idempotencyKey: params.idempotencyKey,
    body: {
      targetKind: params.targetKind,
      targetKey: params.targetKey,
      permissionIds: params.permissionIds,
      confirmedHighRiskPermissionIds: params.confirmedHighRiskPermissionIds,
    },
    produce: async () => {
      if (unknownPermissions(params.permissionIds)) {
        return { ok: false, reason: "unknown_permission" };
      }
      const highRisk = params.permissionIds.filter((id) => HIGH_RISK_ACCESS_PERMISSIONS.has(id));
      if (highRisk.some((id) => !params.confirmedHighRiskPermissionIds.includes(id))) {
        return { ok: false, reason: "high_risk_confirmation_required" };
      }
      if (params.targetKind === "role") {
        if (builtinRolePermissions(params.targetKey)) {
          return { ok: false, reason: "builtin_role_fixed" };
        }
        const existing = await readTenantControls(params.tenantId);
        const role = existing.roles[params.targetKey];
        if (!role) {
          return { ok: false, reason: "unknown_target" };
        }
        const revision = `rev_${randomUUID()}`;
        await updateTenantControls(params.tenantId, (document) => {
          const current = document.roles[params.targetKey];
          if (!current) {
            return;
          }
          current.permissionIds = [...params.permissionIds];
          current.revision = revision;
          for (const grant of Object.values(document.memberGrants)) {
            if (grant.roleId === params.targetKey) {
              grant.permissionIds = [...params.permissionIds];
              grant.revision = revision;
            }
          }
        });
        return { ok: true, revision };
      }
      const member = await params.deps.resolveMember(params.tenantId, params.targetKey);
      if (member.status === "unavailable") {
        throw new PendingControlUnavailable(member.message);
      }
      if (member.status === "unknown") {
        return { ok: false, reason: "unknown_target" };
      }
      if (member.membershipRole === "enterprise-admin") {
        return { ok: false, reason: "membership_role_fixed" };
      }
      const existing = await readTenantControls(params.tenantId);
      const revision = `rev_${randomUUID()}`;
      const roleId = matchingRoleId(existing.roles, params.permissionIds);
      const grant: MemberGrantRecord = {
        userId: member.userId,
        permissionIds: [...params.permissionIds],
        revision,
        ...(roleId ? { roleId } : {}),
      };
      await updateTenantControls(params.tenantId, (document) => {
        document.memberGrants[member.userId] = grant;
      });
      return { ok: true, revision };
    },
  });
}

export async function setSessionPolicy(params: {
  deps: PendingControlDeps;
  tenantId: string;
  idleTimeoutMinutes: number;
  idempotencyKey: string;
}): Promise<{ ok: boolean; idleTimeoutMinutes?: number; reason?: string }> {
  return runIdempotent({
    deps: params.deps,
    tenantId: params.tenantId,
    method: ENTERPRISE_SECURITY_SESSION_POLICY_SET_METHOD,
    idempotencyKey: params.idempotencyKey,
    body: { idleTimeoutMinutes: params.idleTimeoutMinutes },
    produce: async () => {
      if (params.idleTimeoutMinutes < 5 || params.idleTimeoutMinutes > 1440) {
        return { ok: false, reason: "out_of_range" };
      }
      await updateTenantControls(params.tenantId, (document) => {
        document.idleTimeoutMinutes = params.idleTimeoutMinutes;
      });
      return { ok: true, idleTimeoutMinutes: params.idleTimeoutMinutes };
    },
  });
}

export async function setIpAllowlist(params: {
  deps: PendingControlDeps;
  tenantId: string;
  cidrs: string[];
  callerIp: string | undefined;
  idempotencyKey: string;
}): Promise<{ ok: boolean; cidrs?: string[]; reason?: string }> {
  return runIdempotent({
    deps: params.deps,
    tenantId: params.tenantId,
    method: ENTERPRISE_SECURITY_IP_ALLOWLIST_SET_METHOD,
    idempotencyKey: params.idempotencyKey,
    body: { cidrs: params.cidrs },
    produce: async () => {
      const validated = validateAllowlist(params.cidrs);
      if (!validated.ok) {
        return { ok: false, reason: "cidr_invalid" };
      }
      if (!ipMatchesAllowlist(params.callerIp, validated.cidrs)) {
        return { ok: false, reason: "would_lock_out_caller" };
      }
      await updateTenantControls(params.tenantId, (document) => {
        document.ipAllowlist = validated.cidrs;
      });
      return { ok: true, cidrs: validated.cidrs };
    },
  });
}

export async function exportTenantAudit(params: {
  deps: PendingControlDeps;
  tenantId: string;
  from: string;
  to: string;
  format: "json" | "csv";
  idempotencyKey: string;
}): Promise<{ ok: boolean; exportId?: string; downloadPath?: string; reason?: string }> {
  return runIdempotent({
    deps: params.deps,
    tenantId: params.tenantId,
    method: ENTERPRISE_SECURITY_AUDIT_EXPORT_METHOD,
    idempotencyKey: params.idempotencyKey,
    body: { from: params.from, to: params.to, format: params.format },
    produce: async () => params.deps.exportAudit(params),
  });
}

export async function setAssetBudget(params: {
  deps: PendingControlDeps;
  tenantId: string;
  assetType: AssetControlType;
  assetId: string;
  monthlyLimitCents: number;
  idempotencyKey: string;
}): Promise<{
  ok: boolean;
  budget?: { assetType: "agent"; assetId: string; monthlyLimitCents: number };
  reason?: string;
}> {
  return runIdempotent({
    deps: params.deps,
    tenantId: params.tenantId,
    method: ENTERPRISE_MESH_ASSET_BUDGET_SET_METHOD,
    idempotencyKey: params.idempotencyKey,
    body: {
      assetType: params.assetType,
      assetId: params.assetId,
      monthlyLimitCents: params.monthlyLimitCents,
    },
    produce: async () => {
      if (params.assetType === "group") {
        return { ok: false, reason: "spend_not_metered" };
      }
      const lookup = await params.deps.lookupAsset({
        tenantId: params.tenantId,
        assetType: "agent",
        assetId: params.assetId,
      });
      if (lookup.status === "unavailable") {
        throw new PendingControlUnavailable(lookup.message);
      }
      if (lookup.status === "tenant_mismatch") {
        return { ok: false, reason: "tenant_mismatch" };
      }
      if (lookup.status === "not_found") {
        return { ok: false, reason: "asset_not_found" };
      }
      const budget = {
        assetType: "agent" as const,
        assetId: params.assetId,
        monthlyLimitCents: params.monthlyLimitCents,
      };
      await updateTenantControls(params.tenantId, (document) => {
        document.assetBudgets[assetControlKey("agent", params.assetId)] = budget;
      });
      return { ok: true, budget };
    },
  });
}

export async function setAssetPause(params: {
  deps: PendingControlDeps;
  tenantId: string;
  assetType: AssetControlType;
  assetId: string;
  action: "pause" | "resume";
  reason: string;
  idempotencyKey: string;
}): Promise<{ ok: boolean; governanceStatus?: "paused" | "normal"; reason?: string }> {
  return runIdempotent({
    deps: params.deps,
    tenantId: params.tenantId,
    method: ENTERPRISE_MESH_ASSET_PAUSE_METHOD,
    idempotencyKey: params.idempotencyKey,
    body: {
      assetType: params.assetType,
      assetId: params.assetId,
      action: params.action,
      reason: params.reason,
    },
    produce: async () => {
      const lookup = await params.deps.lookupAsset(params);
      if (lookup.status === "unavailable") {
        throw new PendingControlUnavailable(lookup.message);
      }
      if (lookup.status === "tenant_mismatch") {
        return { ok: false, reason: "tenant_mismatch" };
      }
      if (lookup.status === "not_found") {
        return { ok: false, reason: "asset_not_found" };
      }
      const existing = await readTenantControls(params.tenantId);
      const current = existing.assetPauses[assetControlKey(params.assetType, params.assetId)];
      const paused = current?.paused;
      const nextPaused = params.action === "pause";
      if (paused === nextPaused) {
        return { ok: false, reason: "already_in_state" };
      }
      await updateTenantControls(params.tenantId, (document) => {
        document.assetPauses[assetControlKey(params.assetType, params.assetId)] = {
          assetType: params.assetType,
          assetId: params.assetId,
          paused: nextPaused,
          reason: params.reason,
        };
      });
      return { ok: true, governanceStatus: nextPaused ? "paused" : "normal" };
    },
  });
}

export async function resolveTenantMemberTarget(
  tenantId: string,
  targetKey: string,
): Promise<MemberTarget> {
  try {
    const cfg = loadConfig();
    const config = resolvePlatformAuthConfig(cfg.gateway?.auth?.trustedProxy);
    if (!config?.enabled) {
      return { status: "unavailable", message: "platform auth is not enabled" };
    }
    const store = await loadStore(config);
    const canonical = canonicalizeTenantId(tenantId) ?? tenantId;
    const byId = store.users[targetKey];
    const byEmail = findUserByEmail(store, targetKey);
    const user = byId ?? byEmail;
    if (!user) {
      return { status: "unknown" };
    }
    const memberships = listMembershipsByUserId(store, user.id).filter((entry) => {
      const enterpriseId = canonicalizeTenantId(entry.enterpriseId) ?? entry.enterpriseId;
      return enterpriseId === canonical;
    });
    if (memberships.length === 0) {
      return { status: "unknown" };
    }
    const membershipRole = memberships.some((entry) => entry.membershipRole === "enterprise-admin")
      ? "enterprise-admin"
      : "member";
    return { status: "found", userId: user.id, membershipRole };
  } catch (error) {
    const message = error instanceof Error ? error.message : "member lookup failed";
    return { status: "unavailable", message };
  }
}
