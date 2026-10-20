import { resolveBillingScope } from "../billing/scope.js";
import {
  ALL_GOVERNANCE_APPROVAL_CATEGORIES,
  buildMcpMappingFulfillmentDeeplinkQuery,
  cancelGovernanceApprovalRequest,
  createCapabilityAccessRequest,
  fulfillGovernanceApprovalRequest,
  isEmployeeCreatableGovernanceCategory,
} from "../enterprise-data/capability-access-request.js";
import { EnterpriseDataStoreError } from "../enterprise-data/connector-action-store.js";
import {
  GOVERNANCE_ADMIN_REQUIRED_MESSAGE,
  requireResolvedEnterpriseAdminTenantId,
  requireResolvedEnterpriseTenantId,
  resolveSessionCapabilityAccessActorId,
} from "../enterprise-data/enterprise-data-seat-context.js";
import {
  createGovernanceApprovalRequest,
  decideGovernanceApprovalRequest,
  findGovernanceApprovalRequest,
  listGovernanceApprovalRequests,
  resolveGovernanceApprovalCenterOverview,
} from "../enterprise-data/governance-approval-store.js";
import {
  findKnowledgeLineageRecord,
  listKnowledgeLineageRecords,
} from "../enterprise-data/knowledge-lineage-store.js";
import {
  findKnowledgeSupplyAuditEvent,
  listKnowledgeSupplyAuditEvents,
} from "../enterprise-data/knowledge-supply-audit-store.js";
import {
  resolveAuditLineageOverview,
  resolveKnowledgeLineageChain,
} from "../enterprise-data/lineage-governance-store.js";
import type {
  EnterpriseDataStore,
  GovernanceApprovalCategory,
  GovernanceApprovalStatus,
  KnowledgeSupplyAuditEventType,
} from "../enterprise-data/types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { respondInvalid, stringValue } from "./billing-helpers.js";
import type { GatewayClient } from "./types.js";
import type { GatewayRequestHandlers } from "./types.js";

async function resolveGovernanceActorId(client: GatewayClient | null): Promise<string> {
  return resolveSessionCapabilityAccessActorId(client);
}

type WithStoreRunner = <T>(
  tenantId: string,
  client: import("./types.js").GatewayClient | null | undefined,
  run: (store: EnterpriseDataStore) => Promise<T> | T,
) => Promise<T>;

const GOVERNANCE_APPROVAL_CATEGORIES = ALL_GOVERNANCE_APPROVAL_CATEGORIES;

const ADMIN_ONLY_CREATE_CATEGORIES = new Set<GovernanceApprovalCategory>([
  "source_onboarding",
  "data_access",
  "capability_exposure",
  "identity_binding",
]);

async function resolveIsEnterpriseAdmin(
  client: GatewayClient | null,
  params: Record<string, unknown>,
): Promise<boolean> {
  const requestedTenantId =
    typeof params.tenantId === "string"
      ? params.tenantId
      : typeof params.enterpriseId === "string"
        ? params.enterpriseId
        : null;
  const scope = await resolveBillingScope(client, { requestedTenantId });
  return Boolean(scope.isEnterpriseAdmin);
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

export function createEnterpriseDataM5Handlers(
  withEnterpriseDataStore: WithStoreRunner,
): GatewayRequestHandlers {
  return {
    "enterprise-data.lineage.list": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      try {
        const records = await withEnterpriseDataStore(tenantId, client, (store) =>
          listKnowledgeLineageRecords({
            store,
            tenantId,
            objectId: stringValue(params.objectId) || undefined,
            projectionId: stringValue(params.projectionId) || undefined,
          }),
        );
        respond(true, { tenantId, records });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.lineage.get": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const lineageId = stringValue(params.lineageId);
      if (!lineageId) {
        respondInvalid(respond, "lineageId is required");
        return;
      }
      try {
        const record = await withEnterpriseDataStore(tenantId, client, (store) => {
          const found = findKnowledgeLineageRecord(store, tenantId, lineageId);
          if (!found) {
            throw new EnterpriseDataStoreError(
              "LINEAGE_NOT_FOUND",
              "Knowledge lineage record not found.",
            );
          }
          return found;
        });
        respond(true, { tenantId, record });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.lineage.resolve": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const objectId = stringValue(params.objectId);
      const lineageId = stringValue(params.lineageId);
      if (!objectId && !lineageId) {
        respondInvalid(respond, "objectId or lineageId is required");
        return;
      }
      try {
        const resolution = await withEnterpriseDataStore(tenantId, client, (store) =>
          resolveKnowledgeLineageChain({
            store,
            tenantId,
            objectId: objectId || undefined,
            lineageId: lineageId || undefined,
          }),
        );
        respond(true, { tenantId, resolution });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.audit-lineage.overview": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      try {
        const overview = await withEnterpriseDataStore(tenantId, client, (store) =>
          resolveAuditLineageOverview({ store, tenantId }),
        );
        respond(true, { tenantId, overview });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.supply-audit.list": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      try {
        const events = await withEnterpriseDataStore(tenantId, client, (store) =>
          listKnowledgeSupplyAuditEvents({
            store,
            tenantId,
            projectionId: stringValue(params.projectionId) || undefined,
            bindingId: stringValue(params.bindingId) || undefined,
            objectId: stringValue(params.objectId) || undefined,
            eventType:
              typeof params.eventType === "string"
                ? (params.eventType as KnowledgeSupplyAuditEventType)
                : undefined,
            status:
              params.status === "success" || params.status === "failure"
                ? params.status
                : undefined,
            limit: typeof params.limit === "number" ? params.limit : undefined,
          }),
        );
        respond(true, { tenantId, events });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.supply-audit.get": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const auditId = stringValue(params.auditId);
      if (!auditId) {
        respondInvalid(respond, "auditId is required");
        return;
      }
      try {
        const event = await withEnterpriseDataStore(tenantId, client, (store) => {
          const found = findKnowledgeSupplyAuditEvent(store, tenantId, auditId);
          if (!found) {
            throw new EnterpriseDataStoreError(
              "SUPPLY_AUDIT_NOT_FOUND",
              "Knowledge supply audit not found.",
            );
          }
          return found;
        });
        respond(true, { tenantId, event });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.governance-approvals.list": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const category = stringValue(params.category) as GovernanceApprovalCategory | null;
      if (category && !GOVERNANCE_APPROVAL_CATEGORIES.has(category)) {
        respondInvalid(respond, "category is invalid");
        return;
      }
      try {
        const isAdmin = await resolveIsEnterpriseAdmin(client, params);
        const actorId = await resolveGovernanceActorId(client);
        const requests = await withEnterpriseDataStore(tenantId, client, (store) =>
          listGovernanceApprovalRequests({
            store,
            tenantId,
            category: category || undefined,
            status:
              params.status === "pending" ||
              params.status === "approved" ||
              params.status === "rejected" ||
              params.status === "cancelled"
                ? (params.status as GovernanceApprovalStatus)
                : undefined,
            requestedBy: isAdmin ? undefined : actorId,
          }),
        );
        respond(true, { tenantId, requests });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.governance-approvals.get": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const approvalId = stringValue(params.approvalId);
      if (!approvalId) {
        respondInvalid(respond, "approvalId is required");
        return;
      }
      try {
        const isAdmin = await resolveIsEnterpriseAdmin(client, params);
        const actorId = await resolveGovernanceActorId(client);
        const request = await withEnterpriseDataStore(tenantId, client, (store) => {
          const found = findGovernanceApprovalRequest(store, tenantId, approvalId);
          if (!found) {
            throw new EnterpriseDataStoreError(
              "GOVERNANCE_APPROVAL_NOT_FOUND",
              "Governance approval request not found.",
            );
          }
          if (!isAdmin && found.requestedBy !== actorId) {
            throw new EnterpriseDataStoreError(
              "GOVERNANCE_APPROVAL_FORBIDDEN",
              "Only the requester or an enterprise admin can view this approval.",
            );
          }
          if (isAdmin && found.status === "pending" && found.reviewState === "submitted") {
            found.reviewState = "in_review";
          }
          return found;
        });
        const fulfillmentDeeplinkQuery = buildMcpMappingFulfillmentDeeplinkQuery(request);
        respond(true, {
          tenantId,
          request,
          ...(fulfillmentDeeplinkQuery ? { fulfillmentDeeplinkQuery } : {}),
        });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.governance-approvals.create": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const category = stringValue(params.category) as GovernanceApprovalCategory | null;
      if (!category || !GOVERNANCE_APPROVAL_CATEGORIES.has(category)) {
        respondInvalid(respond, "category is invalid");
        return;
      }
      try {
        const isAdmin = await resolveIsEnterpriseAdmin(client, params);
        if (!isAdmin && !isEmployeeCreatableGovernanceCategory(category)) {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.INVALID_REQUEST, GOVERNANCE_ADMIN_REQUIRED_MESSAGE),
          );
          return;
        }
        if (
          isAdmin &&
          !ADMIN_ONLY_CREATE_CATEGORIES.has(category) &&
          !isEmployeeCreatableGovernanceCategory(category)
        ) {
          // seat_capability_access / enterprise_knowledge_access keep using knowledge.* employee RPCs
          if (category === "seat_capability_access" || category === "enterprise_knowledge_access") {
            respondInvalid(
              respond,
              "Use knowledge.access.request / knowledge.enterprise.access.request for this category",
            );
            return;
          }
        }
        const requestedBy = await resolveGovernanceActorId(client);
        const nowIso = new Date().toISOString();
        const request = await withEnterpriseDataStore(tenantId, client, (store) => {
          if (isEmployeeCreatableGovernanceCategory(category)) {
            return createCapabilityAccessRequest({
              store,
              tenantId,
              category,
              requestedBy,
              nowIso,
              reason: stringValue(params.reason) || undefined,
              requesterSeatId: stringValue(params.requesterSeatId) || undefined,
              clientRequestId: stringValue(params.clientRequestId) || undefined,
              catalogId: stringValue(params.catalogId) || undefined,
              templateId: stringValue(params.templateId) || undefined,
              mcpServer: stringValue(params.mcpServer) || undefined,
              mcpTool: stringValue(params.mcpTool) || undefined,
              discoveryStatusSnapshot:
                params.discoveryStatusSnapshot === "unmapped" ||
                params.discoveryStatusSnapshot === "mapped_pending_grant" ||
                params.discoveryStatusSnapshot === "authorized"
                  ? params.discoveryStatusSnapshot
                  : undefined,
              identityScope:
                params.identityScope === "personal" || params.identityScope === "enterprise"
                  ? params.identityScope
                  : undefined,
              identityId: stringValue(params.identityId) || undefined,
              targetAgentId: stringValue(params.targetAgentId) || undefined,
              packId: stringValue(params.packId) || undefined,
              skillKey: stringValue(params.skillKey) || undefined,
              targetRobotId: stringValue(params.targetRobotId) || undefined,
            });
          }
          const subjectId = stringValue(params.subjectId);
          if (!subjectId) {
            throw new EnterpriseDataStoreError(
              "INVALID_REQUEST",
              "category and subjectId are required",
            );
          }
          return createGovernanceApprovalRequest({
            store,
            tenantId,
            category,
            subjectId,
            requestedBy,
            reason: stringValue(params.reason) || undefined,
            nowIso,
            requesterSeatId: stringValue(params.requesterSeatId) || undefined,
          });
        });
        respond(true, { tenantId, request });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.governance-approvals.decide": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const approvalId = stringValue(params.approvalId);
      const decision = params.decision;
      if (!approvalId) {
        respondInvalid(respond, "approvalId is required");
        return;
      }
      if (decision !== "approved" && decision !== "rejected") {
        respondInvalid(respond, "decision must be approved or rejected");
        return;
      }
      const fulfillmentMode =
        params.fulfillmentMode === "approve_intent_only" ||
        params.fulfillmentMode === "approve_and_provision"
          ? params.fulfillmentMode
          : undefined;
      try {
        const decidedBy = await resolveGovernanceActorId(client);
        const request = await withEnterpriseDataStore(tenantId, client, (store) =>
          decideGovernanceApprovalRequest({
            store,
            tenantId,
            approvalId,
            decision,
            decidedBy,
            decisionNote: stringValue(params.decisionNote) || undefined,
            nowIso: new Date().toISOString(),
            fulfillmentMode,
          }),
        );
        const fulfillmentDeeplinkQuery = buildMcpMappingFulfillmentDeeplinkQuery(request);
        respond(true, {
          tenantId,
          request,
          ...(fulfillmentDeeplinkQuery ? { fulfillmentDeeplinkQuery } : {}),
        });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.governance-approvals.cancel": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const approvalId = stringValue(params.approvalId);
      if (!approvalId) {
        respondInvalid(respond, "approvalId is required");
        return;
      }
      try {
        const isAdmin = await resolveIsEnterpriseAdmin(client, params);
        const actorId = await resolveGovernanceActorId(client);
        const request = await withEnterpriseDataStore(tenantId, client, (store) =>
          cancelGovernanceApprovalRequest({
            store,
            tenantId,
            approvalId,
            actorId,
            asAdmin: isAdmin,
            nowIso: new Date().toISOString(),
            decisionNote: stringValue(params.decisionNote) || undefined,
          }),
        );
        respond(true, { tenantId, request });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.governance-approvals.fulfill": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const approvalId = stringValue(params.approvalId);
      if (!approvalId) {
        respondInvalid(respond, "approvalId is required");
        return;
      }
      try {
        const fulfilledBy = await resolveGovernanceActorId(client);
        const request = await withEnterpriseDataStore(tenantId, client, (store) =>
          fulfillGovernanceApprovalRequest({
            store,
            tenantId,
            approvalId,
            fulfilledBy,
            nowIso: new Date().toISOString(),
            provisionReceipt:
              params.provisionReceipt && typeof params.provisionReceipt === "object"
                ? (params.provisionReceipt as {
                    handlerRef?: string;
                    capabilityId?: string;
                    grantId?: string;
                    enrollmentId?: string;
                    packId?: string;
                    skillKey?: string;
                    targetRobotId?: string;
                  })
                : undefined,
          }),
        );
        respond(true, { tenantId, request });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.governance-approvals.overview": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      try {
        const overview = await withEnterpriseDataStore(tenantId, client, (store) =>
          resolveGovernanceApprovalCenterOverview({ store, tenantId }),
        );
        respond(true, { tenantId, overview });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },
  };
}
