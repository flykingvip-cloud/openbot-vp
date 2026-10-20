import { resolveBillingScope } from "../billing/scope.js";
import {
  listApprovalPolicies,
  upsertApprovalPolicy,
} from "../enterprise-data/approval-policy-store.js";
import {
  buildApprovalContextSnapshot,
  createApprovalRequest,
  decideApprovalRequest,
  listApprovalRequests,
} from "../enterprise-data/approval-workflow.js";
import { getAuditTrace, listInvocationAuditEvents } from "../enterprise-data/audit-runtime.js";
import { EnterpriseDataStoreError } from "../enterprise-data/connector-action-store.js";
import { getProcessControlledSarProvider } from "../enterprise-data/controlled-sar-provider.js";
import { invokeEnterpriseDataAction } from "../enterprise-data/data-gateway.js";
import {
  assertNoClientExecutionIdentity,
  resolveTrustedEnterpriseDataExecutionContext,
  resolveTrustedScopePreviewContext,
  resolveTrustedSessionEmployeeId,
} from "../enterprise-data/enterprise-data-seat-context.js";
import {
  requireResolvedEnterpriseAdminTenantId,
  requireResolvedEnterpriseTenantId,
} from "../enterprise-data/enterprise-data-seat-context.js";
import {
  listFieldClassifications,
  previewClassificationMasking,
  upsertFieldClassification,
  upsertMaskingPolicy,
  listMaskingPolicies,
} from "../enterprise-data/field-classification-store.js";
import {
  archiveScopePolicy,
  evaluateScopePolicy,
  findScopePolicy,
  listScopePolicies,
  upsertScopePolicy,
} from "../enterprise-data/scope-policy-store.js";
import { findSeatActionGrant } from "../enterprise-data/seat-action-grant-store.js";
import type { ConnectorActionRef, EnterpriseDataStore } from "../enterprise-data/types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { respondInvalid, stringValue } from "./billing-helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

type WithStoreRunner = <T>(
  tenantId: string,
  client: import("./types.js").GatewayClient | null | undefined,
  run: (store: EnterpriseDataStore) => Promise<T> | T,
) => Promise<T>;

function parseActionRef(params: Record<string, unknown>): ConnectorActionRef | null {
  const connectorId = stringValue(params.connectorId);
  const actionKey = stringValue(params.actionKey);
  const version = stringValue(params.version);
  if (!connectorId || !actionKey || !version) {
    return null;
  }
  return { connectorId, actionKey, version };
}

function toEnterpriseDataErrorShape(error: unknown) {
  if (error instanceof EnterpriseDataStoreError) {
    return errorShape(ErrorCodes.INVALID_REQUEST, error.message, { details: { code: error.code } });
  }
  if (error instanceof Error) {
    return errorShape(ErrorCodes.INVALID_REQUEST, error.message);
  }
  return errorShape(ErrorCodes.INVALID_REQUEST, "Enterprise data operation failed.");
}

export function createEnterpriseDataM1Handlers(
  withEnterpriseDataStore: WithStoreRunner,
): GatewayRequestHandlers {
  const handlers: GatewayRequestHandlers = {
    "enterprise-data.scope.list": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const policies = await withEnterpriseDataStore(tenantId, client, (store) =>
        listScopePolicies({ store, tenantId }),
      );
      respond(true, { tenantId, policies });
    },

    "enterprise-data.scope.get": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      const scopePolicyId = stringValue(params.scopePolicyId);
      if (!tenantId || !scopePolicyId) {
        respondInvalid(respond, "scopePolicyId is required");
        return;
      }
      try {
        const policy = await withEnterpriseDataStore(tenantId, client, (store) => {
          const found = findScopePolicy(store, tenantId, scopePolicyId);
          if (!found) {
            throw new EnterpriseDataStoreError("SCOPE_POLICY_NOT_FOUND", "Scope policy not found.");
          }
          return found;
        });
        respond(true, { tenantId, policy });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.scope.upsert": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      const displayName = stringValue(params.displayName);
      const scopeType = params.scopeType;
      if (!tenantId || !displayName) {
        respondInvalid(respond, "displayName is required");
        return;
      }
      if (
        scopeType !== "SELF" &&
        scopeType !== "TEAM" &&
        scopeType !== "DEPARTMENT" &&
        scopeType !== "ALL"
      ) {
        respondInvalid(respond, "scopeType must be SELF, TEAM, DEPARTMENT, or ALL");
        return;
      }
      try {
        const policy = await withEnterpriseDataStore(tenantId, client, (store) =>
          upsertScopePolicy({
            store,
            tenantId,
            nowIso: new Date().toISOString(),
            policy: {
              scopePolicyId: stringValue(params.scopePolicyId) || undefined,
              displayName,
              scopeType,
              filterClauses: Array.isArray(params.filterClauses)
                ? (params.filterClauses as never[])
                : undefined,
              filterDescription: stringValue(params.filterDescription) || undefined,
            },
          }),
        );
        respond(true, { tenantId, policy });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.scope.delete": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      const scopePolicyId = stringValue(params.scopePolicyId);
      if (!tenantId || !scopePolicyId) {
        respondInvalid(respond, "scopePolicyId is required");
        return;
      }
      try {
        const policy = await withEnterpriseDataStore(tenantId, client, (store) =>
          archiveScopePolicy({
            store,
            tenantId,
            scopePolicyId,
            nowIso: new Date().toISOString(),
          }),
        );
        respond(true, { tenantId, policy });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.scope.preview": async ({ client, params, respond }) => {
      const scopePolicyId = stringValue(params.scopePolicyId);
      const seatId = stringValue(params.seatId);
      if (!scopePolicyId || !seatId) {
        respondInvalid(respond, "scopePolicyId and seatId are required");
        return;
      }
      if (
        stringValue(params.employeeId) ||
        stringValue(params.teamLabel) ||
        stringValue(params.roleCode) ||
        stringValue(params.departmentId)
      ) {
        respondInvalid(
          respond,
          "employeeId, teamLabel, roleCode, and departmentId must be resolved server-side for scope preview.",
        );
        return;
      }
      try {
        const previewContext = await resolveTrustedScopePreviewContext({ client, seatId });
        const tenantId = previewContext.tenantId;
        const result = await withEnterpriseDataStore(tenantId, client, (store) => {
          const policy = findScopePolicy(store, tenantId, scopePolicyId);
          if (!policy) {
            throw new EnterpriseDataStoreError("SCOPE_POLICY_NOT_FOUND", "Scope policy not found.");
          }
          return evaluateScopePolicy({ policy, context: previewContext });
        });
        respond(true, { tenantId, result });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.classification.list": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const ref = parseActionRef(params);
      const classifications = await withEnterpriseDataStore(tenantId, client, (store) =>
        listFieldClassifications({ store, tenantId, ref: ref ?? undefined }),
      );
      respond(true, { tenantId, classifications });
    },

    "enterprise-data.classification.upsert": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      const ref = parseActionRef(params);
      const fieldPath = stringValue(params.fieldPath);
      const classification = params.classification;
      if (!tenantId || !ref || !fieldPath) {
        respondInvalid(respond, "connectorId, actionKey, version, and fieldPath are required");
        return;
      }
      if (
        classification !== "PUBLIC" &&
        classification !== "INTERNAL" &&
        classification !== "CONFIDENTIAL" &&
        classification !== "RESTRICTED"
      ) {
        respondInvalid(respond, "classification is invalid");
        return;
      }
      try {
        const record = await withEnterpriseDataStore(tenantId, client, (store) =>
          upsertFieldClassification({
            store,
            tenantId,
            nowIso: new Date().toISOString(),
            classification: {
              classificationId: stringValue(params.classificationId) || undefined,
              connectorId: ref.connectorId,
              actionKey: ref.actionKey,
              version: ref.version,
              fieldPath,
              classification,
              maskingPolicyId: stringValue(params.maskingPolicyId) || undefined,
              blockDetail:
                params.blockDetail === true
                  ? true
                  : params.blockDetail === false
                    ? false
                    : undefined,
            },
          }),
        );
        respond(true, { tenantId, classification: record });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.classification.preview": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      const ref = parseActionRef(params);
      if (!tenantId || !ref || params.samplePayload == null) {
        respondInvalid(respond, "connectorId, actionKey, version, and samplePayload are required");
        return;
      }
      const result = await withEnterpriseDataStore(tenantId, client, (store) =>
        previewClassificationMasking({
          store,
          tenantId,
          ref,
          samplePayload: params.samplePayload,
        }),
      );
      respond(true, { tenantId, result });
    },

    "enterprise-data.masking.list": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const policies = await withEnterpriseDataStore(tenantId, client, (store) =>
        listMaskingPolicies({ store, tenantId }),
      );
      respond(true, { tenantId, policies });
    },

    "enterprise-data.masking.upsert": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      const displayName = stringValue(params.displayName);
      const strategy = params.strategy;
      if (!tenantId || !displayName) {
        respondInvalid(respond, "displayName is required");
        return;
      }
      if (
        strategy !== "redact" &&
        strategy !== "partial_phone" &&
        strategy !== "partial_email" &&
        strategy !== "hash" &&
        strategy !== "aggregate_only"
      ) {
        respondInvalid(respond, "strategy is invalid");
        return;
      }
      const policy = await withEnterpriseDataStore(tenantId, client, (store) =>
        upsertMaskingPolicy({
          store,
          tenantId,
          nowIso: new Date().toISOString(),
          policy: {
            maskingPolicyId: stringValue(params.maskingPolicyId) || undefined,
            displayName,
            strategy,
            config:
              params.config && typeof params.config === "object"
                ? (params.config as Record<string, unknown>)
                : undefined,
          },
        }),
      );
      respond(true, { tenantId, policy });
    },

    "enterprise-data.approval.policies.list": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const policies = await withEnterpriseDataStore(tenantId, client, (store) =>
        listApprovalPolicies({ store, tenantId }),
      );
      respond(true, { tenantId, policies });
    },

    "enterprise-data.approval.policies.upsert": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      const displayName = stringValue(params.displayName);
      const mode = params.mode;
      if (!tenantId || !displayName) {
        respondInvalid(respond, "displayName is required");
        return;
      }
      if (mode !== "NONE" && mode !== "ONCE" && mode !== "PER_REQUEST") {
        respondInvalid(respond, "mode must be NONE, ONCE, or PER_REQUEST");
        return;
      }
      try {
        const policy = await withEnterpriseDataStore(tenantId, client, (store) =>
          upsertApprovalPolicy({
            store,
            tenantId,
            nowIso: new Date().toISOString(),
            policy: {
              approvalPolicyId: stringValue(params.approvalPolicyId) || undefined,
              displayName,
              mode,
              approverRole: "enterprise-admin",
              expiryHours: typeof params.expiryHours === "number" ? params.expiryHours : undefined,
            },
          }),
        );
        respond(true, { tenantId, policy });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.approval.requests.create": async ({ client, params, respond }) => {
      const ref = parseActionRef(params);
      const approvalContextId = stringValue(params.approvalContextId);
      if (!ref || !approvalContextId) {
        respondInvalid(
          respond,
          "connectorId, actionKey, version, and approvalContextId are required",
        );
        return;
      }
      try {
        assertNoClientExecutionIdentity(params);
        const context = await resolveTrustedEnterpriseDataExecutionContext(client);
        const request = await withEnterpriseDataStore(context.tenantId, client, (store) => {
          const grant = findSeatActionGrant(store, context.tenantId, context.seatId, ref);
          if (!grant?.approvalPolicyId) {
            throw new EnterpriseDataStoreError(
              "NO_ACTION_GRANT",
              "Grant or approval policy not found.",
            );
          }
          return createApprovalRequest({
            store,
            tenantId: context.tenantId,
            seatId: context.seatId,
            employeeId: context.employeeId,
            ref,
            approvalPolicyId: grant.approvalPolicyId,
            approvalContextId,
            reason: stringValue(params.reason) || undefined,
            nowIso: new Date().toISOString(),
          });
        });
        respond(true, { tenantId: context.tenantId, request });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.approval.requests.decide": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      const approvalId = stringValue(params.approvalId);
      const decision = params.decision;
      if (!tenantId || !approvalId) {
        respondInvalid(respond, "approvalId is required");
        return;
      }
      if (decision !== "approved" && decision !== "rejected") {
        respondInvalid(respond, "decision must be approved or rejected");
        return;
      }
      try {
        const decidedBy = await resolveTrustedSessionEmployeeId(client);
        const request = await withEnterpriseDataStore(tenantId, client, (store) => {
          const pending = store.approvalRequests[approvalId];
          if (!pending) {
            throw new EnterpriseDataStoreError(
              "APPROVAL_REQUEST_NOT_FOUND",
              "Approval request not found.",
            );
          }
          let snapshot;
          if (decision === "approved") {
            const grant = findSeatActionGrant(store, tenantId, pending.seatId, pending);
            if (!grant) {
              throw new EnterpriseDataStoreError("NO_ACTION_GRANT", "Seat action grant not found.");
            }
            snapshot = buildApprovalContextSnapshot({
              store,
              tenantId,
              grant,
              ref: pending,
            });
          }
          return decideApprovalRequest({
            store,
            tenantId,
            approvalId,
            decision,
            decidedBy,
            decisionNote: stringValue(params.decisionNote) || undefined,
            contextSnapshot: snapshot,
            nowIso: new Date().toISOString(),
          });
        });
        respond(true, { tenantId, request });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.approval.requests.list": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      try {
        const scope = await resolveBillingScope(client);
        const employeeId = scope.isEnterpriseAdmin
          ? undefined
          : await resolveTrustedSessionEmployeeId(client);
        const requests = await withEnterpriseDataStore(tenantId, client, (store) =>
          listApprovalRequests({
            store,
            tenantId,
            seatId: scope.isEnterpriseAdmin ? stringValue(params.seatId) || undefined : undefined,
            employeeId,
            status:
              params.status === "pending" ||
              params.status === "approved" ||
              params.status === "rejected" ||
              params.status === "expired" ||
              params.status === "superseded" ||
              params.status === "invalidated"
                ? params.status
                : undefined,
          }),
        );
        respond(true, { tenantId, requests });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.audit.invocations.list": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      try {
        const scope = await resolveBillingScope(client);
        let seatId: string | undefined;
        let employeeId: string | undefined;
        if (scope.isEnterpriseAdmin) {
          seatId = stringValue(params.seatId) || undefined;
        } else {
          employeeId = await resolveTrustedSessionEmployeeId(client);
        }
        const events = await withEnterpriseDataStore(tenantId, client, (store) =>
          listInvocationAuditEvents({
            store,
            tenantId,
            seatId,
            employeeId,
            limit: typeof params.limit === "number" ? params.limit : undefined,
          }),
        );
        respond(true, { tenantId, events });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.audit.trace.get": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      const traceId = stringValue(params.traceId);
      if (!tenantId || !traceId) {
        respondInvalid(respond, "traceId is required");
        return;
      }
      const trace = await withEnterpriseDataStore(tenantId, client, (store) =>
        getAuditTrace({ store, tenantId, traceId }),
      );
      respond(true, { tenantId, trace });
    },

    "enterprise-data.invoke": async ({ client, params, respond }) => {
      const ref = parseActionRef(params);
      if (!ref) {
        respondInvalid(respond, "connectorId, actionKey, and version are required");
        return;
      }
      try {
        assertNoClientExecutionIdentity(params);
        const context = await resolveTrustedEnterpriseDataExecutionContext(client);
        const result = await withEnterpriseDataStore(context.tenantId, client, (store) =>
          invokeEnterpriseDataAction({
            store,
            context,
            ref,
            input:
              params.input && typeof params.input === "object"
                ? (params.input as Record<string, unknown>)
                : undefined,
            approvalContextId: stringValue(params.approvalContextId) || undefined,
            sourceId: stringValue(params.sourceId) || undefined,
            sarProvider: getProcessControlledSarProvider(),
            nowIso: new Date().toISOString(),
          }),
        );
        if (result.ok) {
          respond(true, { tenantId: context.tenantId, result });
        } else {
          respond(
            false,
            { tenantId: context.tenantId, result },
            errorShape(ErrorCodes.INVALID_REQUEST, result.message, {
              details: { code: result.code, traceId: result.traceId, info: result.details },
            }),
          );
        }
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },
  };
  return handlers;
}
