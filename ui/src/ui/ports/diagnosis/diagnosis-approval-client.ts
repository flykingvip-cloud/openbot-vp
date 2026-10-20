/**
 * Platform diagnosis approval client.
 * Calls platform.diagnosis.approval.decide only. Success requires status
 * recorded and an effect that matches the request.
 */
import type { GatewayBrowserClient } from "../../gateway.ts";
import { generateUUID } from "../../uuid.ts";

export const PLATFORM_DIAGNOSIS_APPROVAL_DECIDE_METHOD = "platform.diagnosis.approval.decide";

const APPROVALS_SCOPE = "operator.approvals";

export type PlatformDiagnosisApprovalEffect =
  | { type: "grant"; grantId: string; grantStatus: "APPROVED" | "DENIED" }
  | { type: "conversation"; opened: true; sessionKey: string }
  | { type: "export"; filename: string; mediaType: "application/json"; body: string }
  | { type: "none"; reason: string };

export type PlatformDiagnosisApprovalPayload = {
  approvalId?: string;
  subjectKind?: string;
  decision?: "approve" | "deny";
  status?: string;
  grantId?: string | null;
  reason?: string;
  effect?: PlatformDiagnosisApprovalEffect;
};

export function canCallPlatformDiagnosisApproval(input: {
  connected: boolean;
  scopes: readonly string[] | null | undefined;
  sessionKind: string | null | undefined;
  methods: readonly string[] | null | undefined;
}): boolean {
  if (!input.connected) {
    return false;
  }
  if (input.sessionKind !== "platform-admin" && input.sessionKind !== "platform-super-admin") {
    return false;
  }
  if (!input.scopes?.includes(APPROVALS_SCOPE)) {
    return false;
  }
  return input.methods?.includes(PLATFORM_DIAGNOSIS_APPROVAL_DECIDE_METHOD) === true;
}

export function grantEffectMatches(
  payload: PlatformDiagnosisApprovalPayload | null | undefined,
  grantId: string,
  decision: "approve" | "deny",
): boolean {
  return (
    payload?.status === "recorded" &&
    payload.effect?.type === "grant" &&
    payload.effect.grantId === grantId &&
    payload.effect.grantStatus === (decision === "approve" ? "APPROVED" : "DENIED")
  );
}

export function conversationEffectMatches(
  payload: PlatformDiagnosisApprovalPayload | null | undefined,
  decision: "approve" | "deny",
): boolean {
  if (payload?.status !== "recorded") {
    return false;
  }
  if (decision === "deny") {
    return payload.effect?.type === "none";
  }
  return (
    payload.effect?.type === "conversation" &&
    payload.effect.opened &&
    payload.effect.sessionKey.trim().length > 0
  );
}

export function exportEffectMatches(
  payload: PlatformDiagnosisApprovalPayload | null | undefined,
  decision: "approve" | "deny",
): boolean {
  if (payload?.status !== "recorded") {
    return false;
  }
  if (decision === "deny") {
    return payload.effect?.type === "none" && !("body" in (payload.effect ?? {}));
  }
  return payload.effect?.type === "export" && payload.effect.body.trim().length > 0;
}

export async function callPlatformDiagnosisApproval(
  client: GatewayBrowserClient,
  params: {
    subject:
      | { kind: "authorization"; grantId: string }
      | {
          kind: "conversation";
          signalId?: string;
          caseId?: string;
          targetRef?: { targetType: string; targetId: string; tenantId: string | null };
        }
      | { kind: "report-export"; reportId: string; redactionProfile: "administrator" | "user" };
    decision: "approve" | "deny";
    reason?: string | null;
  },
): Promise<PlatformDiagnosisApprovalPayload> {
  return client.request<PlatformDiagnosisApprovalPayload>(
    PLATFORM_DIAGNOSIS_APPROVAL_DECIDE_METHOD,
    {
      schemaVersion: 1,
      idempotencyKey: generateUUID(),
      subject: params.subject,
      decision: params.decision,
      reason: params.reason ?? null,
    },
  );
}

export function approvalFailureText(
  payload: PlatformDiagnosisApprovalPayload | null | undefined,
): string {
  const effectReason =
    payload?.effect?.type === "none" && payload.effect.reason.trim()
      ? payload.effect.reason
      : undefined;
  const code = payload?.reason?.trim() || effectReason || "refused";
  return APPROVAL_FAILURE_COPY[code] ?? `审批没有生效（${code}）`;
}

const APPROVAL_FAILURE_COPY: Record<string, string> = {
  grant_not_found: "找不到这条授权，没有写入审批。",
  grant_not_pending: "这条授权不在待审批状态，没有改变。",
  approver_role_mismatch: "这条授权不是平台审批，没有改变。",
  tenant_mismatch: "租户不匹配，没有写入审批。",
  idempotency_conflict: "重复提交的内容不一致，没有写入第二次。",
  conversation_not_found: "找不到对应的诊断会话，没有打开大白。",
  session_key_unavailable: "大白会话没有打开，审批没有留下。",
  subject_incomplete: "缺少信号或案例标识，没有写入审批。",
  report_not_found: "找不到这份报告，没有导出。",
  export_unavailable: "报告导出失败，审批没有留下。",
  refused: "审批没有生效。",
};
