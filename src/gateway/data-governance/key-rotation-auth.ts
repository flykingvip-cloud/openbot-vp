/**
 * P5-b tenant-level key-management authorization.
 * Authentication is not authorization. No new grant kind.
 */
import fs from "node:fs";
import path from "node:path";
import { isGovernanceActionAllowed, type GovernanceRole } from "../governance-policy.js";
import {
  isGovernanceAuthenticatedCall,
  type GovernanceAuthenticatedCall,
} from "./cognitive-recommendation-auth.js";
import { resolveTenantKeyManagementPolicyRoot } from "./paths.js";

const KEY_MGMT_BRAND = Symbol("openbot.tenantKeyManagementAuth");

const OPERATOR_ROLES = new Set<GovernanceRole>([
  "tenant-admin",
  "platform-admin",
  "platform-super-admin",
]);

export type TenantKeyManagementOperatorRole =
  | "tenant-admin"
  | "platform-admin"
  | "platform-super-admin";

export type TenantKeyManagementPolicy = {
  schemaVersion: 1;
  tenantId: string;
  operators: readonly {
    userId: string;
    role: TenantKeyManagementOperatorRole;
  }[];
};

/**
 * Unforgeable tenant-wide key-management context. Minted only by
 * {@link resolveTenantKeyManagementAuth} from a branded call plus the deploy-boundary
 * tenant-admin / platform key-service policy. A raw user session is never enough.
 */
export type TenantKeyManagementAuth = {
  readonly [KEY_MGMT_BRAND]: true;
  readonly callerTenantId: string;
  readonly actor: { kind: "user"; userId: string };
  readonly role: TenantKeyManagementOperatorRole;
};

export function isTenantKeyManagementAuth(value: unknown): value is TenantKeyManagementAuth {
  return Boolean(
    value && typeof value === "object" && (value as TenantKeyManagementAuth)[KEY_MGMT_BRAND],
  );
}

function mint(params: {
  callerTenantId: string;
  actor: { kind: "user"; userId: string };
  role: TenantKeyManagementOperatorRole;
}): TenantKeyManagementAuth {
  return Object.freeze({
    [KEY_MGMT_BRAND]: true as const,
    callerTenantId: params.callerTenantId,
    actor: Object.freeze({ ...params.actor }),
    role: params.role,
  });
}

function policyPath(stateDir: string, tenantId: string): string {
  return path.join(resolveTenantKeyManagementPolicyRoot(stateDir), `${tenantId}.json`);
}

function parsePolicy(raw: unknown): TenantKeyManagementPolicy | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const row = raw as Record<string, unknown>;
  if (
    Object.keys(row).some(
      (key) => key !== "schemaVersion" && key !== "tenantId" && key !== "operators",
    )
  ) {
    return null;
  }
  if (row.schemaVersion !== 1 || typeof row.tenantId !== "string" || !row.tenantId.trim()) {
    return null;
  }
  if (!Array.isArray(row.operators)) {
    return null;
  }
  const operators: TenantKeyManagementPolicy["operators"][number][] = [];
  for (const entry of row.operators) {
    if (!entry || typeof entry !== "object") {
      return null;
    }
    const operator = entry as Record<string, unknown>;
    if (Object.keys(operator).some((key) => key !== "userId" && key !== "role")) {
      return null;
    }
    if (typeof operator.userId !== "string" || !operator.userId.trim()) {
      return null;
    }
    if (typeof operator.role !== "string" || !OPERATOR_ROLES.has(operator.role as GovernanceRole)) {
      return null;
    }
    operators.push({
      userId: operator.userId.trim(),
      role: operator.role as TenantKeyManagementOperatorRole,
    });
  }
  return {
    schemaVersion: 1,
    tenantId: row.tenantId.trim(),
    operators,
  };
}

function readTenantKeyManagementPolicy(params: {
  stateDir: string;
  tenantId: string;
}): TenantKeyManagementPolicy | null {
  const dest = policyPath(params.stateDir, params.tenantId);
  if (!fs.existsSync(dest)) {
    return null;
  }
  try {
    return parsePolicy(JSON.parse(fs.readFileSync(dest, "utf8")));
  } catch {
    return null;
  }
}

/** Deploy/test boundary writer. Never called from a production key-rotation command. */
export function writeTenantKeyManagementPolicyAtDeployBoundary(params: {
  stateDir: string;
  record: TenantKeyManagementPolicy;
}): void {
  const parsed = parsePolicy(params.record);
  if (!parsed) {
    throw new Error("invalid_key_management_policy");
  }
  const dest = policyPath(params.stateDir, parsed.tenantId);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, dest);
}

/**
 * Mint tenant-wide key-management auth. Identity comes from the branded call;
 * capability comes from the deploy-boundary policy and existing governance roles.
 */
export function resolveTenantKeyManagementAuth(params: {
  call: GovernanceAuthenticatedCall;
  stateDir: string;
}): { ok: true; auth: TenantKeyManagementAuth } | { ok: false; error: "actor_not_authorized" } {
  const allowedKeys = new Set(["call", "stateDir"]);
  if (
    !isGovernanceAuthenticatedCall(params.call) ||
    Object.keys(params).some((key) => !allowedKeys.has(key))
  ) {
    return { ok: false, error: "actor_not_authorized" };
  }
  const tenantId = params.call.callerTenantId?.trim() ?? "";
  if (!tenantId || params.call.actor.kind !== "user") {
    return { ok: false, error: "actor_not_authorized" };
  }
  const userId = params.call.actor.userId.trim();
  if (!userId) {
    return { ok: false, error: "actor_not_authorized" };
  }
  const policy = readTenantKeyManagementPolicy({ stateDir: params.stateDir, tenantId });
  if (!policy || policy.tenantId !== tenantId) {
    return { ok: false, error: "actor_not_authorized" };
  }
  const operator = policy.operators.find((row) => row.userId === userId);
  if (!operator) {
    return { ok: false, error: "actor_not_authorized" };
  }
  const subject = {
    role: operator.role,
    tenantId,
    userId,
  };
  if (!isGovernanceActionAllowed(subject, "write", { kind: "tenant", tenantId })) {
    return { ok: false, error: "actor_not_authorized" };
  }
  return {
    ok: true,
    auth: mint({
      callerTenantId: tenantId,
      actor: { kind: "user", userId },
      role: operator.role,
    }),
  };
}
