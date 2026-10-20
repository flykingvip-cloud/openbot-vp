import { lookupEnterpriseAsset } from "../enterprise-security/asset-lookup.js";
/**
 * Remaining enterprise P0/P1 control RPCs.
 * Refusals are transport-ok payloads with `ok: false` so the UI does not toast success.
 */
import {
  appendEnterpriseAuditEvent,
  createEnterpriseAuditExport,
} from "../enterprise-security/audit-log.js";
import { normalizeClientIp } from "../enterprise-security/client-ip.js";
import {
  createFileIdempotencyStore,
  type IdempotencyStore,
} from "../enterprise-security/idempotency.js";
import {
  ENTERPRISE_ACCESS_PERMISSIONS_COMMIT_METHOD,
  ENTERPRISE_ACCESS_ROLES_CREATE_METHOD,
  ENTERPRISE_MESH_ASSET_BUDGET_SET_METHOD,
  ENTERPRISE_MESH_ASSET_PAUSE_METHOD,
  ENTERPRISE_SECURITY_AUDIT_EXPORT_METHOD,
  ENTERPRISE_SECURITY_IP_ALLOWLIST_SET_METHOD,
  ENTERPRISE_SECURITY_SESSION_POLICY_SET_METHOD,
  PendingControlUnavailable,
  commitAccessPermissions,
  createAccessRole,
  exportTenantAudit,
  resolveTenantMemberTarget,
  setAssetBudget,
  setAssetPause,
  setIpAllowlist,
  setSessionPolicy,
  type PendingControlDeps,
} from "../enterprise-security/pending-controls.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { stringValue } from "../records.js";
import type { GatewayClient, GatewayRequestHandlers, RespondFn } from "./types.js";

let depsOverride: PendingControlDeps | null = null;

export function setEnterprisePendingControlDepsForTests(deps: PendingControlDeps | null): void {
  depsOverride = deps;
}

function productionDeps(): PendingControlDeps {
  return {
    idempotency: createFileIdempotencyStore(),
    lookupAsset: lookupEnterpriseAsset,
    resolveMember: resolveTenantMemberTarget,
    exportAudit: createEnterpriseAuditExport,
  };
}

function deps(): PendingControlDeps {
  return depsOverride ?? productionDeps();
}

function scopesOf(client: GatewayClient): string[] {
  const scopes = client.connect.scopes;
  return Array.isArray(scopes) ? scopes.filter((scope) => typeof scope === "string") : [];
}

function rejectTransport(respond: RespondFn, message: string): void {
  respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
}

function rejectForbidden(respond: RespondFn, message: string): void {
  respond(false, undefined, errorShape(ErrorCodes.FORBIDDEN, message));
}

function hasOperatorScope(
  client: GatewayClient,
  scope: "operator.read" | "operator.write" | "operator.approvals",
): boolean {
  const scopes = scopesOf(client);
  if (scope === "operator.approvals") {
    return scopes.includes("operator.approvals");
  }
  if (scopes.includes("operator.admin")) {
    return true;
  }
  if (scope === "operator.read") {
    return scopes.includes("operator.read") || scopes.includes("operator.write");
  }
  return scopes.includes("operator.write");
}

function assertEnterpriseAdmin(
  client: GatewayClient | null,
  respond: RespondFn,
  scope: "operator.read" | "operator.write" | "operator.approvals",
): string | null {
  if (!client) {
    rejectForbidden(respond, "enterprise session is required");
    return null;
  }
  if (
    client.sessionDomain === "platform" ||
    client.sessionKind === "platform-admin" ||
    client.sessionKind === "platform-super-admin"
  ) {
    rejectForbidden(respond, "platform session cannot call enterprise control methods");
    return null;
  }
  if (client.sessionDomain === "employee" || client.sessionKind === "member") {
    rejectForbidden(respond, "employee session cannot call enterprise control methods");
    return null;
  }
  if (client.sessionDomain !== "enterprise" || client.sessionKind !== "enterprise-admin") {
    rejectForbidden(respond, "enterprise-admin session is required");
    return null;
  }
  if (!hasOperatorScope(client, scope)) {
    rejectForbidden(respond, `${scope} is required`);
    return null;
  }
  const tenantId = client.sessionEnterpriseId?.trim();
  if (!tenantId) {
    rejectTransport(respond, "tenant membership is required");
    return null;
  }
  return tenantId;
}

function readIdempotencyKey(params: Record<string, unknown>, respond: RespondFn): string | null {
  const idempotencyKey = stringValue(params.idempotencyKey);
  if (!idempotencyKey || idempotencyKey.length > 200) {
    rejectTransport(respond, "idempotencyKey is required");
    return null;
  }
  return idempotencyKey;
}

function readPermissionIds(value: unknown, respond: RespondFn): string[] | null {
  if (!Array.isArray(value) || value.some((entry) => !stringValue(entry))) {
    rejectTransport(respond, "permissionIds must be a string array");
    return null;
  }
  return value
    .map((entry) => stringValue(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function callerIp(client: GatewayClient): string | undefined {
  // The handshake already applied trusted-proxy rules. Do not read raw headers again.
  return normalizeClientIp(client.clientIp);
}

async function finish(
  respond: RespondFn,
  tenantId: string,
  method: string,
  actorUserId: string | undefined,
  action: () => Promise<Record<string, unknown>>,
): Promise<void> {
  try {
    const body = await action();
    if (body.ok === true) {
      try {
        await appendEnterpriseAuditEvent({
          ts: new Date().toISOString(),
          tenantId,
          kind: "control_write",
          method,
          ...(actorUserId ? { actorUserId } : {}),
          summary: method,
        });
      } catch {
        // The control write already landed. Audit failure stays off the success payload.
      }
    }
    respond(true, body);
  } catch (error) {
    if (error instanceof PendingControlUnavailable) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, error.message));
      return;
    }
    const message = error instanceof Error ? error.message : "enterprise control failed";
    respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, message));
  }
}

export const enterprisePendingControlHandlers: GatewayRequestHandlers = {
  [ENTERPRISE_ACCESS_ROLES_CREATE_METHOD]: async ({ params, respond, client }) => {
    const tenantId = assertEnterpriseAdmin(client, respond, "operator.write");
    if (!tenantId || !client) {
      return;
    }
    const name = stringValue(params.name)?.trim() ?? "";
    if (name.length < 1 || name.length > 64) {
      rejectTransport(respond, "name must be 1 to 64 characters");
      return;
    }
    const permissionIds = readPermissionIds(params.permissionIds, respond);
    const idempotencyKey = permissionIds ? readIdempotencyKey(params, respond) : null;
    if (!permissionIds || !idempotencyKey) {
      return;
    }
    const current = deps();
    await finish(
      respond,
      tenantId,
      ENTERPRISE_ACCESS_ROLES_CREATE_METHOD,
      client.platformUserId,
      () => createAccessRole({ deps: current, tenantId, name, permissionIds, idempotencyKey }),
    );
  },

  [ENTERPRISE_ACCESS_PERMISSIONS_COMMIT_METHOD]: async ({ params, respond, client }) => {
    const tenantId = assertEnterpriseAdmin(client, respond, "operator.write");
    if (!tenantId || !client) {
      return;
    }
    const targetKind =
      params.targetKind === "role" || params.targetKind === "member"
        ? params.targetKind
        : undefined;
    if (!targetKind) {
      rejectTransport(respond, "targetKind must be role or member");
      return;
    }
    const targetKey = stringValue(params.targetKey);
    if (!targetKey) {
      rejectTransport(respond, "targetKey is required");
      return;
    }
    const permissionIds = readPermissionIds(params.permissionIds, respond);
    if (!permissionIds) {
      return;
    }
    const confirmed = params.confirmedHighRiskPermissionIds;
    const confirmedHighRiskPermissionIds = Array.isArray(confirmed)
      ? confirmed.filter((entry): entry is string => typeof entry === "string")
      : [];
    if (confirmed !== undefined && !Array.isArray(confirmed)) {
      rejectTransport(respond, "confirmedHighRiskPermissionIds must be a string array");
      return;
    }
    const idempotencyKey = readIdempotencyKey(params, respond);
    if (!idempotencyKey) {
      return;
    }
    const current = deps();
    await finish(
      respond,
      tenantId,
      ENTERPRISE_ACCESS_PERMISSIONS_COMMIT_METHOD,
      client.platformUserId,
      () =>
        commitAccessPermissions({
          deps: current,
          tenantId,
          targetKind,
          targetKey,
          permissionIds,
          confirmedHighRiskPermissionIds,
          idempotencyKey,
        }),
    );
  },

  [ENTERPRISE_SECURITY_SESSION_POLICY_SET_METHOD]: async ({ params, respond, client }) => {
    const tenantId = assertEnterpriseAdmin(client, respond, "operator.write");
    if (!tenantId || !client) {
      return;
    }
    const idleTimeoutMinutes = params.idleTimeoutMinutes;
    if (typeof idleTimeoutMinutes !== "number" || !Number.isInteger(idleTimeoutMinutes)) {
      rejectTransport(respond, "idleTimeoutMinutes must be an integer");
      return;
    }
    const idempotencyKey = readIdempotencyKey(params, respond);
    if (!idempotencyKey) {
      return;
    }
    const current = deps();
    await finish(
      respond,
      tenantId,
      ENTERPRISE_SECURITY_SESSION_POLICY_SET_METHOD,
      client.platformUserId,
      () => setSessionPolicy({ deps: current, tenantId, idleTimeoutMinutes, idempotencyKey }),
    );
  },

  [ENTERPRISE_SECURITY_IP_ALLOWLIST_SET_METHOD]: async ({ params, respond, client }) => {
    const tenantId = assertEnterpriseAdmin(client, respond, "operator.write");
    if (!tenantId || !client) {
      return;
    }
    if (!Array.isArray(params.cidrs) || params.cidrs.some((entry) => typeof entry !== "string")) {
      rejectTransport(respond, "cidrs must be a string array");
      return;
    }
    const idempotencyKey = readIdempotencyKey(params, respond);
    if (!idempotencyKey) {
      return;
    }
    const current = deps();
    await finish(
      respond,
      tenantId,
      ENTERPRISE_SECURITY_IP_ALLOWLIST_SET_METHOD,
      client.platformUserId,
      () =>
        setIpAllowlist({
          deps: current,
          tenantId,
          cidrs: params.cidrs as string[],
          callerIp: callerIp(client),
          idempotencyKey,
        }),
    );
  },

  [ENTERPRISE_SECURITY_AUDIT_EXPORT_METHOD]: async ({ params, respond, client }) => {
    const tenantId = assertEnterpriseAdmin(client, respond, "operator.read");
    if (!tenantId || !client) {
      return;
    }
    const from = stringValue(params.from);
    const to = stringValue(params.to);
    if (!from || !to || !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to))) {
      rejectTransport(respond, "from and to must be ISO times");
      return;
    }
    const format = params.format === "json" || params.format === "csv" ? params.format : undefined;
    if (!format) {
      rejectTransport(respond, "format must be json or csv");
      return;
    }
    const idempotencyKey = readIdempotencyKey(params, respond);
    if (!idempotencyKey) {
      return;
    }
    const current = deps();
    await finish(
      respond,
      tenantId,
      ENTERPRISE_SECURITY_AUDIT_EXPORT_METHOD,
      client.platformUserId,
      () =>
        exportTenantAudit({
          deps: current,
          tenantId,
          from,
          to,
          format,
          idempotencyKey,
        }),
    );
  },

  [ENTERPRISE_MESH_ASSET_BUDGET_SET_METHOD]: async ({ params, respond, client }) => {
    const tenantId = assertEnterpriseAdmin(client, respond, "operator.write");
    if (!tenantId || !client) {
      return;
    }
    // enterprise-admin is the only caller this method accepts, and that role
    // always holds usage:budget. Member grants are enforced on budget.set.
    const assetType =
      params.assetType === "agent" || params.assetType === "group" ? params.assetType : undefined;
    if (!assetType) {
      rejectTransport(respond, "assetType must be agent or group");
      return;
    }
    const assetId = stringValue(params.assetId);
    if (!assetId) {
      rejectTransport(respond, "assetId is required");
      return;
    }
    const monthlyLimitCents = params.monthlyLimitCents;
    if (
      typeof monthlyLimitCents !== "number" ||
      !Number.isInteger(monthlyLimitCents) ||
      monthlyLimitCents < 0
    ) {
      rejectTransport(respond, "monthlyLimitCents must be an integer >= 0");
      return;
    }
    const idempotencyKey = readIdempotencyKey(params, respond);
    if (!idempotencyKey) {
      return;
    }
    const current = deps();
    await finish(
      respond,
      tenantId,
      ENTERPRISE_MESH_ASSET_BUDGET_SET_METHOD,
      client.platformUserId,
      () =>
        setAssetBudget({
          deps: current,
          tenantId,
          assetType,
          assetId,
          monthlyLimitCents,
          idempotencyKey,
        }),
    );
  },

  [ENTERPRISE_MESH_ASSET_PAUSE_METHOD]: async ({ params, respond, client }) => {
    const tenantId = assertEnterpriseAdmin(client, respond, "operator.approvals");
    if (!tenantId || !client) {
      return;
    }
    const assetType =
      params.assetType === "agent" || params.assetType === "group" ? params.assetType : undefined;
    if (!assetType) {
      rejectTransport(respond, "assetType must be agent or group");
      return;
    }
    const assetId = stringValue(params.assetId);
    const reason = stringValue(params.reason)?.trim() ?? "";
    if (!assetId || !reason) {
      rejectTransport(respond, "assetId and reason are required");
      return;
    }
    const action =
      params.action === "pause" || params.action === "resume" ? params.action : undefined;
    if (!action) {
      rejectTransport(respond, "action must be pause or resume");
      return;
    }
    const idempotencyKey = readIdempotencyKey(params, respond);
    if (!idempotencyKey) {
      return;
    }
    const current = deps();
    await finish(respond, tenantId, ENTERPRISE_MESH_ASSET_PAUSE_METHOD, client.platformUserId, () =>
      setAssetPause({
        deps: current,
        tenantId,
        assetType,
        assetId,
        action,
        reason,
        idempotencyKey,
      }),
    );
  },
};

export function enterprisePendingIdempotencyForTests(): IdempotencyStore {
  return deps().idempotency;
}
