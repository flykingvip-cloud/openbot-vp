export type DiagnosisApprovalBody = {
  status?: string;
  reason?: string;
  subjectKind?: string;
  decision?: string;
  grantId?: string | null;
  approvalId?: string;
  effect?: {
    type?: string;
    grantId?: string;
    grantStatus?: string;
    opened?: boolean;
    sessionKey?: string;
    reason?: string;
  };
};

const REFUSAL_COPY: Record<string, string> = {
  grant_not_found: "没有这条授权，未批准也未拒绝。",
  grant_not_pending: "这条授权不在待审批状态，未改动。",
  approver_role_mismatch: "这条授权不是企业审批，未改动。",
  tenant_mismatch: "租户不一致，未改动。",
  idempotency_conflict: "同一幂等键对应了不同的请求，未改动。",
  conversation_not_found: "没有这条诊断会话，未打开。",
  session_key_unavailable: "会话打不开，未打开大白。",
  subject_incomplete: "缺少信号或案例编号，未打开。",
};

export function diagnosisApprovalRefusalCopy(reason: string | undefined): string {
  if (!reason) {
    return "审批没有生效。";
  }
  return REFUSAL_COPY[reason] ?? "审批没有生效。";
}

export function readDiagnosisApprovalOutcome(input: {
  purpose: "grant" | "conversation";
  decision: "approve" | "deny";
  grantId?: string;
  body: DiagnosisApprovalBody | null;
}): { ok: true; text: string; sessionKey?: string } | { ok: false; text: string } {
  const body = input.body;
  if (!body || body.status !== "recorded" || !body.effect) {
    return { ok: false, text: diagnosisApprovalRefusalCopy(body?.reason) };
  }
  if (input.purpose === "grant") {
    const expected = input.decision === "approve" ? "APPROVED" : "DENIED";
    if (
      body.effect.type !== "grant" ||
      body.effect.grantId !== input.grantId ||
      body.effect.grantStatus !== expected
    ) {
      return { ok: false, text: "审批结果与请求不一致，未记为成功。" };
    }
    return {
      ok: true,
      text: input.decision === "approve" ? "已批准该授权。" : "已拒绝该授权。",
    };
  }
  if (input.decision === "deny") {
    if (body.effect.type !== "none" || body.effect.sessionKey) {
      return { ok: false, text: "审批结果与请求不一致，未记为成功。" };
    }
    return { ok: true, text: "已拒绝打开大白会话。" };
  }
  if (body.effect.type !== "conversation" || body.effect.opened !== true) {
    return { ok: false, text: "审批结果与请求不一致，未记为成功。" };
  }
  const sessionKey = body.effect.sessionKey?.trim();
  if (!sessionKey) {
    return { ok: false, text: "审批结果与请求不一致，未记为成功。" };
  }
  return { ok: true, text: "已打开大白会话。", sessionKey };
}
