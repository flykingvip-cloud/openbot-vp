/**
 * enterprise.diagnosis.approval.decide
 * Enterprise session only. Platform sessions are rejected here.
 */
import { resolveStateDir } from "../../config/paths.js";
import {
  listLiveSessionKeys,
  resolveDiagnosisConversationSession,
} from "../../diagnosis/approval-conversation.js";
import {
  ENTERPRISE_DIAGNOSIS_APPROVAL_DECIDE_METHOD,
  createFileDiagnosisApprovalStore,
  decideEnterpriseDiagnosisApproval,
  type DiagnosisApprovalRequest,
  type DiagnosisApprovalStore,
  type DiagnosisApprovalSubject,
  type DiagnosisConversationResolution,
} from "../../diagnosis/approval-ledger.js";
import { resolveDiagnosisProjectionsDir } from "../../diagnosis/report-query-projection-snapshot.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { isRecord, stringValue } from "../records.js";
import type { GatewayClient, GatewayRequestHandlers, RespondFn } from "./types.js";

const METHOD = ENTERPRISE_DIAGNOSIS_APPROVAL_DECIDE_METHOD;

type ApprovalDeps = {
  store: DiagnosisApprovalStore;
  sessionKeys: () => readonly string[];
  projectionsDir: string;
  now: () => string;
};

let depsOverride: ApprovalDeps | null = null;

export function setEnterpriseDiagnosisApprovalDepsForTests(deps: ApprovalDeps | null): void {
  depsOverride = deps;
}

function deps(): ApprovalDeps {
  if (depsOverride) {
    return depsOverride;
  }
  const stateDir = resolveStateDir();
  return {
    store: createFileDiagnosisApprovalStore(`${stateDir}/diagnosis-approvals`),
    sessionKeys: () => listLiveSessionKeys(stateDir),
    projectionsDir: resolveDiagnosisProjectionsDir(),
    now: () => new Date().toISOString(),
  };
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

function readSubject(value: unknown, respond: RespondFn): DiagnosisApprovalSubject | null {
  if (!isRecord(value) || typeof value.kind !== "string") {
    rejectTransport(respond, "subject is required");
    return null;
  }
  if (value.kind === "authorization") {
    const grantId = stringValue(value.grantId);
    if (!grantId) {
      rejectTransport(respond, "grantId is required");
      return null;
    }
    return { kind: "authorization", grantId };
  }
  if (value.kind === "conversation") {
    const signalId = stringValue(value.signalId) ?? undefined;
    const caseId = stringValue(value.caseId) ?? undefined;
    const tenantId = value.tenantId === null ? null : (stringValue(value.tenantId) ?? undefined);
    let targetRef: { targetType: string; targetId: string; tenantId: string | null } | undefined;
    if (value.targetRef !== undefined && value.targetRef !== null) {
      if (!isRecord(value.targetRef)) {
        rejectTransport(respond, "targetRef is invalid");
        return null;
      }
      const targetType = stringValue(value.targetRef.targetType);
      const targetId = stringValue(value.targetRef.targetId);
      if (!targetType || !targetId) {
        rejectTransport(respond, "targetRef is invalid");
        return null;
      }
      const refTenant =
        value.targetRef.tenantId === null ? null : (stringValue(value.targetRef.tenantId) ?? null);
      targetRef = { targetType, targetId, tenantId: refTenant };
    }
    return {
      kind: "conversation",
      ...(signalId ? { signalId } : {}),
      ...(caseId ? { caseId } : {}),
      ...(tenantId !== undefined ? { tenantId } : {}),
      ...(targetRef ? { targetRef } : {}),
    };
  }
  rejectTransport(respond, "subject.kind is not supported");
  return null;
}

function readRequest(
  params: Record<string, unknown>,
  respond: RespondFn,
): DiagnosisApprovalRequest | null {
  if (params.schemaVersion !== 1) {
    rejectTransport(respond, "schemaVersion must be 1");
    return null;
  }
  const idempotencyKey = stringValue(params.idempotencyKey);
  if (!idempotencyKey) {
    rejectTransport(respond, "idempotencyKey is required");
    return null;
  }
  if (params.decision !== "approve" && params.decision !== "deny") {
    rejectTransport(respond, "decision must be approve or deny");
    return null;
  }
  if (params.reason !== undefined && params.reason !== null && typeof params.reason !== "string") {
    rejectTransport(respond, "reason must be a string or null");
    return null;
  }
  const subject = readSubject(params.subject, respond);
  if (!subject) {
    return null;
  }
  return {
    schemaVersion: 1,
    idempotencyKey,
    subject,
    decision: params.decision,
    reason: typeof params.reason === "string" && params.reason.trim() ? params.reason.trim() : null,
  };
}

function assertEnterpriseCaller(client: GatewayClient | null, respond: RespondFn): string | null {
  if (!client) {
    rejectForbidden(respond, "enterprise session is required");
    return null;
  }
  if (
    client.sessionDomain === "platform" ||
    client.sessionKind === "platform-admin" ||
    client.sessionKind === "platform-super-admin"
  ) {
    rejectForbidden(respond, "platform session cannot call enterprise.diagnosis.approval.decide");
    return null;
  }
  if (client.sessionDomain === "employee" || client.sessionKind === "member") {
    rejectForbidden(respond, "employee session cannot call enterprise.diagnosis.approval.decide");
    return null;
  }
  if (client.sessionDomain !== "enterprise" || client.sessionKind !== "enterprise-admin") {
    rejectForbidden(respond, "enterprise-admin session is required");
    return null;
  }
  if (!scopesOf(client).includes("operator.approvals")) {
    rejectForbidden(respond, "operator.approvals is required");
    return null;
  }
  const tenantId = client.sessionEnterpriseId?.trim();
  if (!tenantId) {
    rejectTransport(respond, "tenant membership is required");
    return null;
  }
  return tenantId;
}

export const enterpriseDiagnosisApprovalHandlers: GatewayRequestHandlers = {
  [METHOD]: async ({ params, respond, client }) => {
    const tenantId = assertEnterpriseCaller(client, respond);
    if (!tenantId) {
      return;
    }
    const request = readRequest(params, respond);
    if (!request) {
      return;
    }
    const current = deps();
    try {
      const result = await decideEnterpriseDiagnosisApproval({
        tenantId,
        actorId: client?.user?.trim() || client?.platformUserId?.trim() || "enterprise-admin",
        now: current.now(),
        request,
        store: current.store,
        resolveConversation: (subject) => {
          const resolution: DiagnosisConversationResolution = resolveDiagnosisConversationSession({
            tenantId,
            signalId: subject.signalId,
            caseId: subject.caseId,
            bindings:
              subject.signalId || subject.caseId
                ? [
                    current.store.findConversation(tenantId, {
                      signalId: subject.signalId,
                      caseId: subject.caseId,
                    }),
                  ].filter((row): row is NonNullable<typeof row> => row !== null)
                : [],
            projectionsDir: current.projectionsDir,
            sessionKeys: current.sessionKeys(),
          });
          return resolution;
        },
      });
      respond(true, result);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          error instanceof Error ? error.message : "diagnosis approval unavailable",
        ),
      );
    }
  },
};
