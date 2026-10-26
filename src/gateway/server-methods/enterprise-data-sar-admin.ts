/**
 * A3 product RPCs: SAR execution bridge upsert and halt/resume under
 * enterprise-admin identity, with durable store + E5-style admin audit.
 */

import { resolveBillingScope } from "../billing/scope.js";
import { EnterpriseDataStoreError } from "../enterprise-data/connector-action-store.js";
import {
  GOVERNANCE_ADMIN_REQUIRED_MESSAGE,
  requireResolvedEnterpriseAdminTenantId,
  resolveSessionCapabilityAccessActorId,
} from "../enterprise-data/enterprise-data-seat-context.js";
import {
  listSarAdminAuditEvents,
  recordSarAdminAudit,
} from "../enterprise-data/sar-admin-audit.js";
import {
  clearSarExecutionHalt,
  evaluateSarExecutionHalt,
  setSarExecutionHalt,
} from "../enterprise-data/sar-execution-halt.js";
import {
  listSarExecutionBridges,
  upsertSarExecutionBridge,
} from "../enterprise-data/sar-governance-bridge.js";
import type {
  ConnectorActionRef,
  EnterpriseDataStore,
  SarExecutionHaltScope,
  ScopeType,
} from "../enterprise-data/types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { respondInvalid, stringValue } from "./billing-helpers.js";
import type { GatewayClient, GatewayRequestHandlers } from "./types.js";

type WithStoreRunner = <T>(
  tenantId: string,
  client: GatewayClient | null | undefined,
  run: (store: EnterpriseDataStore) => Promise<T> | T,
) => Promise<T>;

const SCOPE_TYPES = new Set<ScopeType>(["SELF", "TEAM", "DEPARTMENT", "ALL"]);
const HALT_SCOPES = new Set<SarExecutionHaltScope>(["tenant", "capability", "version"]);

function toEnterpriseDataErrorShape(error: unknown) {
  if (error instanceof EnterpriseDataStoreError) {
    return errorShape(ErrorCodes.INVALID_REQUEST, error.message, { details: { code: error.code } });
  }
  if (error instanceof Error) {
    return errorShape(ErrorCodes.INVALID_REQUEST, error.message);
  }
  return errorShape(ErrorCodes.INVALID_REQUEST, "Enterprise data operation failed.");
}

function parseActionRef(params: Record<string, unknown>): ConnectorActionRef | null {
  const actionRefRaw = params.actionRef;
  if (actionRefRaw && typeof actionRefRaw === "object") {
    const record = actionRefRaw as Record<string, unknown>;
    const connectorId = stringValue(record.connectorId);
    const actionKey = stringValue(record.actionKey);
    const version = stringValue(record.version);
    if (connectorId && actionKey && version) {
      return { connectorId, actionKey, version };
    }
  }
  const connectorId = stringValue(params.connectorId);
  const actionKey = stringValue(params.actionKey);
  const version = stringValue(params.version);
  if (!connectorId || !actionKey || !version) {
    return null;
  }
  return { connectorId, actionKey, version };
}

function parseScopeTypes(value: unknown): ScopeType[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const out: ScopeType[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !SCOPE_TYPES.has(item as ScopeType)) {
      return null;
    }
    out.push(item as ScopeType);
  }
  return out;
}

function parseFilterFields(value: unknown): string[] | null {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const fields = value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
  return fields.map((field) => field.trim());
}

async function resolveAdminActorId(
  client: GatewayClient | null | undefined,
  tenantId: string,
): Promise<string> {
  const scope = await resolveBillingScope(client ?? null, { requestedTenantId: tenantId });
  const fromUser = scope.user?.id?.trim();
  if (fromUser) {
    return fromUser;
  }
  return resolveSessionCapabilityAccessActorId(client ?? null);
}

export function createEnterpriseDataSarAdminHandlers(
  withEnterpriseDataStore: WithStoreRunner,
): GatewayRequestHandlers {
  return {
    "enterprise-data.sar.bridges.upsert": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const sourceId = stringValue(params.sourceId);
      const bindingId = stringValue(params.bindingId);
      const userId = stringValue(params.userId);
      const capabilityId = stringValue(params.capabilityId);
      const version = stringValue(params.capabilityVersion) ?? stringValue(params.sarVersion);
      const artifactDigest = stringValue(params.artifactDigest);
      const actionRef = parseActionRef(params);
      const supportedScopeTypes = parseScopeTypes(params.supportedScopeTypes);
      const enforcedFilterFields = parseFilterFields(params.enforcedFilterFields);
      const verificationRaw = stringValue(params.verification) ?? "passed";
      if (
        !sourceId ||
        !bindingId ||
        !userId ||
        !capabilityId ||
        !version ||
        !artifactDigest ||
        !actionRef ||
        !supportedScopeTypes ||
        enforcedFilterFields === null
      ) {
        respondInvalid(
          respond,
          "sourceId, bindingId, userId, capabilityId, capabilityVersion/sarVersion, artifactDigest, actionRef (or connectorId/actionKey/version), and supportedScopeTypes are required",
        );
        return;
      }
      if (
        verificationRaw !== "unverified" &&
        verificationRaw !== "passed" &&
        verificationRaw !== "failed" &&
        verificationRaw !== "stale"
      ) {
        respondInvalid(respond, "verification must be unverified|passed|failed|stale");
        return;
      }
      const effect = stringValue(params.effect) ?? "read";
      if (effect !== "read") {
        respondInvalid(respond, "Only read bridges are accepted on this admin path.");
        return;
      }
      try {
        const actorId = await resolveAdminActorId(client, tenantId);
        const nowIso = new Date().toISOString();
        const result = await withEnterpriseDataStore(tenantId, client, (store) => {
          const bridge = upsertSarExecutionBridge({
            store,
            tenantId,
            nowIso,
            bridge: {
              bridgeId: stringValue(params.bridgeId) || undefined,
              sourceId,
              actionRef,
              capabilityId,
              version,
              artifactDigest,
              skillId: stringValue(params.skillId) || undefined,
              bindingId,
              userId,
              verification: verificationRaw,
              validator: stringValue(params.validator) || undefined,
              effect: "read",
              supportedScopeTypes,
              enforcedFilterFields,
            },
          });
          const audit = recordSarAdminAudit({
            store,
            tenantId,
            action: "bridge_upsert",
            actorId,
            nowIso,
            subjectId: bridge.bridgeId,
            capabilityId: bridge.capabilityId,
            version: bridge.version,
            summary: `upsert SAR bridge ${bridge.bridgeId} → ${bridge.capabilityId}@${bridge.version}`,
          });
          return { bridge, audit, actorId };
        });
        respond(true, {
          tenantId,
          bridge: result.bridge,
          audit: result.audit,
          caller: { actorId: result.actorId, role: "enterprise-admin" },
        });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.sar.bridges.list": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      try {
        const bridges = await withEnterpriseDataStore(tenantId, client, (store) =>
          listSarExecutionBridges({
            store,
            tenantId,
            sourceId: stringValue(params.sourceId) || undefined,
          }),
        );
        respond(true, { tenantId, bridges });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.sar.halts.set": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const scopeRaw = stringValue(params.scope);
      const reason = stringValue(params.reason);
      if (!scopeRaw || !HALT_SCOPES.has(scopeRaw as SarExecutionHaltScope) || !reason) {
        respondInvalid(respond, "scope (tenant|capability|version) and reason are required");
        return;
      }
      const scope = scopeRaw as SarExecutionHaltScope;
      try {
        const actorId = await resolveAdminActorId(client, tenantId);
        const nowIso = new Date().toISOString();
        const result = await withEnterpriseDataStore(tenantId, client, (store) => {
          const halt = setSarExecutionHalt({
            store,
            tenantId,
            scope,
            capabilityId: stringValue(params.capabilityId) || undefined,
            version: stringValue(params.version) || undefined,
            reason,
            haltedBy: actorId,
            nowIso,
          });
          const audit = recordSarAdminAudit({
            store,
            tenantId,
            action: "halt_set",
            actorId,
            nowIso,
            subjectId: halt.haltId,
            capabilityId: halt.capabilityId,
            version: halt.version,
            haltScope: halt.scope,
            recordHaltSemantics: true,
            summary: `set SAR halt ${halt.scope} (${halt.haltId}): ${reason}`,
          });
          const evaluation = evaluateSarExecutionHalt({
            store,
            tenantId,
            capabilityId: halt.capabilityId ?? stringValue(params.capabilityId) ?? "",
            version: halt.version ?? stringValue(params.version) ?? "",
          });
          return { halt, audit, evaluation, actorId };
        });
        respond(true, {
          tenantId,
          halt: result.halt,
          audit: result.audit,
          // Honest E5 / P4 semantics — never claim withdrawal of in-flight work.
          inFlightSideEffectsWithdrawn: false,
          priorWriteMayBeReplayed: false,
          blocksNewRun: true,
          evaluation: {
            blocked: result.evaluation.blocked,
            inFlightSideEffectsWithdrawn: result.evaluation.inFlightSideEffectsWithdrawn,
            priorWriteMayBeReplayed: result.evaluation.priorWriteMayBeReplayed,
            blocksNewRun: result.evaluation.blocksNewRun,
          },
          caller: { actorId: result.actorId, role: "enterprise-admin" },
        });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.sar.halts.clear": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const haltId = stringValue(params.haltId);
      if (!haltId) {
        respondInvalid(respond, "haltId is required");
        return;
      }
      try {
        const actorId = await resolveAdminActorId(client, tenantId);
        const nowIso = new Date().toISOString();
        const result = await withEnterpriseDataStore(tenantId, client, (store) => {
          const cleared = clearSarExecutionHalt({ store, tenantId, haltId });
          if (!cleared) {
            throw new EnterpriseDataStoreError(
              "SAR_HALT_NOT_FOUND",
              "SAR execution halt not found.",
            );
          }
          const audit = recordSarAdminAudit({
            store,
            tenantId,
            action: "halt_clear",
            actorId,
            nowIso,
            subjectId: cleared.haltId,
            capabilityId: cleared.capabilityId,
            version: cleared.version,
            haltScope: cleared.scope,
            summary: `clear SAR halt ${cleared.scope} (${cleared.haltId}) — resume new runs`,
          });
          return { halt: cleared, audit, actorId };
        });
        respond(true, {
          tenantId,
          halt: result.halt,
          audit: result.audit,
          resumed: true,
          inFlightSideEffectsWithdrawn: false,
          priorWriteMayBeReplayed: false,
          caller: { actorId: result.actorId, role: "enterprise-admin" },
        });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.sar.admin-audit.list": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const actionRaw = stringValue(params.action);
      if (
        actionRaw &&
        actionRaw !== "bridge_upsert" &&
        actionRaw !== "halt_set" &&
        actionRaw !== "halt_clear"
      ) {
        respondInvalid(respond, "action must be bridge_upsert|halt_set|halt_clear");
        return;
      }
      try {
        const events = await withEnterpriseDataStore(tenantId, client, (store) =>
          listSarAdminAuditEvents({
            store,
            tenantId,
            action: actionRaw as "bridge_upsert" | "halt_set" | "halt_clear" | undefined,
            limit: typeof params.limit === "number" ? params.limit : undefined,
          }),
        );
        respond(true, { tenantId, events });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },
  };
}

// Re-export message for tests that assert unauthorized wording.
export { GOVERNANCE_ADMIN_REQUIRED_MESSAGE };
