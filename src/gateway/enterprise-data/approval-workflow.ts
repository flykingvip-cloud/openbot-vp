import { randomUUID } from "node:crypto";
import { findApprovalPolicy } from "./approval-policy-store.js";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import { sha256Digest } from "./digest-utils.js";
import { resolveFieldClassificationsForAction } from "./masking-engine.js";
import { findScopePolicy } from "./scope-policy-store.js";
import type {
  ApprovalContextSnapshot,
  ApprovalRequest,
  ConnectorAction,
  ConnectorActionRef,
  EnterpriseDataStore,
  SeatActionGrant,
} from "./types.js";

export function buildApprovalContextSnapshot(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  grant: SeatActionGrant;
  ref: ConnectorActionRef;
}): ApprovalContextSnapshot {
  const scopePolicyId = params.grant.scopePolicyId ?? "scope-self-default";
  const scopePolicy = findScopePolicy(params.store, params.tenantId, scopePolicyId);
  const scopePolicyDigest = sha256Digest(
    scopePolicy ?? { scopePolicyId, scopeType: "SELF", filterClauses: [] },
  );
  const grantDigest = sha256Digest({
    grantId: params.grant.grantId,
    seatId: params.grant.seatId,
    connectorId: params.grant.connectorId,
    actionKey: params.grant.actionKey,
    version: params.grant.version,
    scopePolicyId: params.grant.scopePolicyId,
    approvalPolicyId: params.grant.approvalPolicyId,
  });
  const classifications = resolveFieldClassificationsForAction(
    params.store,
    params.tenantId,
    params.ref,
  );
  const classificationDigest = sha256Digest(
    classifications
      .map((item) => ({
        fieldPath: item.fieldPath,
        classification: item.classification,
        maskingPolicyId: item.maskingPolicyId,
        blockDetail: item.blockDetail,
      }))
      .toSorted((left, right) => left.fieldPath.localeCompare(right.fieldPath)),
  );
  return {
    scopePolicyId,
    scopePolicyDigest,
    grantId: params.grant.grantId,
    grantDigest,
    classificationDigest,
  };
}

function snapshotsMatch(
  current: ApprovalContextSnapshot,
  frozen?: ApprovalContextSnapshot,
): boolean {
  if (!frozen) {
    return false;
  }
  return (
    current.scopePolicyDigest === frozen.scopePolicyDigest &&
    current.grantDigest === frozen.grantDigest &&
    current.classificationDigest === frozen.classificationDigest
  );
}

function isApprovalExpired(request: ApprovalRequest, nowIso: string): boolean {
  return Boolean(request.expiresAt && request.expiresAt <= nowIso);
}

export type ApprovalCheckResult =
  | { ok: true; approvalId?: string; approvalContextId?: string }
  | {
      ok: false;
      code: "APPROVAL_REQUIRED" | "APPROVAL_EXPIRED" | "APPROVAL_INVALIDATED";
      message: string;
      details: Record<string, unknown>;
    };

export function checkApproval(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  grant: SeatActionGrant;
  action: ConnectorAction;
  ref: ConnectorActionRef;
  approvalContextId?: string;
  nowIso: string;
}): ApprovalCheckResult {
  const policyId = params.grant.approvalPolicyId;
  if (!policyId) {
    if (params.action.requiresApproval) {
      const approvalContextId = params.approvalContextId ?? randomUUID();
      return {
        ok: false,
        code: "APPROVAL_REQUIRED",
        message: "该动作需要审批后方可执行",
        details: {
          mode: "PER_REQUEST",
          approvalContextId,
        },
      };
    }
    return { ok: true };
  }
  const policy = findApprovalPolicy(params.store, params.tenantId, policyId);
  if (!policy) {
    throw new EnterpriseDataStoreError("APPROVAL_POLICY_NOT_FOUND", "Approval policy not found.");
  }
  if (policy.mode === "NONE") {
    return { ok: true };
  }
  const currentSnapshot = buildApprovalContextSnapshot({
    store: params.store,
    tenantId: params.tenantId,
    grant: params.grant,
    ref: params.ref,
  });
  if (policy.mode === "ONCE") {
    const approved = Object.values(params.store.approvalRequests).find(
      (request) =>
        request.tenantId === params.tenantId &&
        request.seatId === params.grant.seatId &&
        request.connectorId === params.ref.connectorId &&
        request.actionKey === params.ref.actionKey &&
        request.version === params.ref.version &&
        request.status === "approved" &&
        !isApprovalExpired(request, params.nowIso),
    );
    if (!approved) {
      return {
        ok: false,
        code: "APPROVAL_REQUIRED",
        message: "该动作需要一次性审批后方可执行",
        details: {
          mode: policy.mode,
          approvalPolicyId: policy.approvalPolicyId,
          approvalContextId: params.approvalContextId ?? randomUUID(),
        },
      };
    }
    if (!snapshotsMatch(currentSnapshot, approved.contextSnapshot)) {
      approved.status = "invalidated";
      return {
        ok: false,
        code: "APPROVAL_INVALIDATED",
        message: "审批上下文已变更，需重新申请",
        details: {
          approvalContextId: approved.approvalContextId,
          changedFields: ["scopePolicyId", "grantDigest", "classificationDigest"],
        },
      };
    }
    if (isApprovalExpired(approved, params.nowIso)) {
      approved.status = "expired";
      return {
        ok: false,
        code: "APPROVAL_EXPIRED",
        message: "审批已过期，需重新申请",
        details: { approvalContextId: approved.approvalContextId },
      };
    }
    return {
      ok: true,
      approvalId: approved.approvalId,
      approvalContextId: approved.approvalContextId,
    };
  }

  if (!params.approvalContextId) {
    const approvalContextId = randomUUID();
    return {
      ok: false,
      code: "APPROVAL_REQUIRED",
      message: "该动作需要审批后方可执行",
      details: {
        mode: policy.mode,
        approvalPolicyId: policy.approvalPolicyId,
        approvalContextId,
      },
    };
  }
  const request = Object.values(params.store.approvalRequests).find(
    (item) =>
      item.tenantId === params.tenantId &&
      item.approvalContextId === params.approvalContextId &&
      item.seatId === params.grant.seatId &&
      item.connectorId === params.ref.connectorId &&
      item.actionKey === params.ref.actionKey &&
      item.version === params.ref.version,
  );
  if (!request || request.status !== "approved" || request.consumedAt) {
    return {
      ok: false,
      code: "APPROVAL_REQUIRED",
      message: "该动作需要审批后方可执行",
      details: {
        mode: policy.mode,
        approvalPolicyId: policy.approvalPolicyId,
        approvalContextId: params.approvalContextId,
        pendingApprovalId: request?.approvalId,
      },
    };
  }
  if (!snapshotsMatch(currentSnapshot, request.contextSnapshot)) {
    request.status = "invalidated";
    return {
      ok: false,
      code: "APPROVAL_INVALIDATED",
      message: "审批上下文已变更，需重新申请",
      details: {
        approvalContextId: params.approvalContextId,
        changedFields: ["scopePolicyId", "grantDigest", "classificationDigest"],
      },
    };
  }
  return {
    ok: true,
    approvalId: request.approvalId,
    approvalContextId: request.approvalContextId,
  };
}

export function createApprovalRequest(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  seatId: string;
  employeeId: string;
  ref: ConnectorActionRef;
  approvalPolicyId: string;
  approvalContextId: string;
  reason?: string;
  nowIso: string;
}): ApprovalRequest {
  const policy = findApprovalPolicy(params.store, params.tenantId, params.approvalPolicyId);
  if (!policy) {
    throw new EnterpriseDataStoreError("APPROVAL_POLICY_NOT_FOUND", "Approval policy not found.");
  }
  const existing = Object.values(params.store.approvalRequests).find(
    (item) =>
      item.tenantId === params.tenantId &&
      item.approvalContextId === params.approvalContextId &&
      item.status === "pending",
  );
  if (existing) {
    return existing;
  }
  const request: ApprovalRequest = {
    approvalId: randomUUID(),
    tenantId: params.tenantId,
    seatId: params.seatId,
    employeeId: params.employeeId,
    connectorId: params.ref.connectorId,
    actionKey: params.ref.actionKey,
    version: params.ref.version,
    approvalPolicyId: params.approvalPolicyId,
    status: "pending",
    requestedAt: params.nowIso,
    reason: params.reason,
    approvalContextId: params.approvalContextId,
  };
  params.store.approvalRequests[request.approvalId] = request;
  return request;
}

export function decideApprovalRequest(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  approvalId: string;
  decision: "approved" | "rejected";
  decidedBy: string;
  decisionNote?: string;
  contextSnapshot?: ApprovalContextSnapshot;
  nowIso: string;
}): ApprovalRequest {
  const request = params.store.approvalRequests[params.approvalId];
  if (!request || request.tenantId !== params.tenantId) {
    throw new EnterpriseDataStoreError("APPROVAL_REQUEST_NOT_FOUND", "Approval request not found.");
  }
  if (request.status !== "pending") {
    throw new EnterpriseDataStoreError(
      "APPROVAL_REQUEST_NOT_PENDING",
      "Approval request is not pending.",
    );
  }
  request.status = params.decision;
  request.decidedAt = params.nowIso;
  request.decidedBy = params.decidedBy;
  request.decisionNote = params.decisionNote;
  if (params.decision === "approved") {
    request.contextSnapshot = params.contextSnapshot;
    const policy = findApprovalPolicy(params.store, params.tenantId, request.approvalPolicyId);
    if (policy?.mode === "ONCE" && policy.expiryHours) {
      request.expiresAt = new Date(
        Date.parse(params.nowIso) + policy.expiryHours * 60 * 60 * 1000,
      ).toISOString();
    }
  }
  return request;
}

export function consumeApprovalRequest(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  approvalId: string;
  traceId: string;
  nowIso: string;
}): ApprovalRequest | null {
  const request = params.store.approvalRequests[params.approvalId];
  if (!request || request.tenantId !== params.tenantId) {
    return null;
  }
  const policy = findApprovalPolicy(params.store, params.tenantId, request.approvalPolicyId);
  if (policy?.mode !== "PER_REQUEST") {
    return request;
  }
  request.consumedAt = params.nowIso;
  request.consumedTraceId = params.traceId;
  return request;
}

export function listApprovalRequests(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  seatId?: string;
  employeeId?: string;
  status?: ApprovalRequest["status"];
}): ApprovalRequest[] {
  return Object.values(params.store.approvalRequests)
    .filter((request) => {
      if (request.tenantId !== params.tenantId) {
        return false;
      }
      if (params.seatId && request.seatId !== params.seatId) {
        return false;
      }
      if (params.employeeId && request.employeeId !== params.employeeId) {
        return false;
      }
      if (params.status && request.status !== params.status) {
        return false;
      }
      return true;
    })
    .toSorted((left, right) => right.requestedAt.localeCompare(left.requestedAt));
}
