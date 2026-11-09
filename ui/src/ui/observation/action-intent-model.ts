import type {
  ActionIntent,
  ActionIntentState,
  IntentTarget,
} from "../../../../src/observation/action-intent.js";
const labels: Record<ActionIntentState, string> = {
  draft: "草案",
  needs_evidence: "待补证",
  previewed: "已预览",
  authorized: "已授权",
  accepted: "已受理",
  executing: "执行中",
  effective: "已生效",
  verified: "已验证",
  rolled_back: "已回滚",
  failed: "失败",
  blocked: "已阻断",
  conflict: "冲突",
  rejected: "已拒绝",
};
function sameTarget(a: IntentTarget, b: IntentTarget) {
  return Object.keys(b).every(
    (key) => a[key as keyof IntentTarget] === b[key as keyof IntentTarget],
  );
}
/** Read-only consistency checks, never authority to execute or a replay of mutation policy. */
export function actionIntentModel(intent: ActionIntent | null, now: number) {
  const approval = intent?.approval;
  const authorization =
    approval && approval.revokedAt === null && approval.issuedAt <= now && approval.expiresAt > now
      ? "当前授权有效"
      : "当前授权失效或缺失；历史事实保留";
  const result = (reason: string | null) => ({
    intent,
    state: reason ? null : (intent?.state ?? null),
    label: reason ? "状态未核验" : intent ? labels[intent.state] : "状态未核验",
    reason,
    authorization,
  });
  if (!intent) {
    return result("无可用记录");
  }
  if (intent.schemaVersion !== 1 || !Object.hasOwn(labels, intent.state)) {
    return result("不支持的记录版本或状态");
  }
  if (
    ["draft", "needs_evidence", "previewed", "blocked", "conflict", "rejected"].includes(
      intent.state,
    )
  ) {
    return result(null);
  }
  if (
    !approval ||
    approval.source !== "user" ||
    !approval.approvalId ||
    !approval.actorRef ||
    approval.intentRevision !== intent.authorizedRevision ||
    !sameTarget(approval.target, intent.target)
  ) {
    return result("approval_mismatch");
  }
  if (intent.state === "authorized") {
    return result(null);
  }
  const command = intent.command;
  const receipt = intent.receipts.at(-1);
  if (!command || !receipt) {
    return result("receipt_missing");
  }
  const ranks = { accepted: 0, executing: 1, succeeded: 2, failed: 2 };
  for (const [index, r] of intent.receipts.entries()) {
    const previous = intent.receipts[index - 1];
    if (
      !r.receiptId ||
      r.commandId !== command.commandId ||
      r.idempotencyKey !== command.idempotencyKey ||
      r.requestDigest !== command.requestDigest ||
      r.intentRevision !== intent.authorizedRevision ||
      !sameTarget(r.target, intent.target) ||
      !Number.isFinite(r.at) ||
      r.at > now ||
      r.at < approval.issuedAt ||
      r.at >= approval.expiresAt ||
      (approval.revokedAt !== null && r.at >= approval.revokedAt) ||
      (previous && (r.at < previous.at || ranks[r.status] < ranks[previous.status]))
    ) {
      return result("receipt_mismatch");
    }
  }
  if (intent.state === "accepted") {
    return result(receipt.status === "accepted" ? null : "receipt_state_mismatch");
  }
  if (intent.state === "failed") {
    return result(receipt.status === "failed" ? null : "failed_receipt_missing");
  }
  if (intent.state === "executing") {
    return result(
      ["executing", "succeeded"].includes(receipt.status) ? null : "receipt_state_mismatch",
    );
  }
  const read = intent.readback;
  if (
    receipt.status !== "succeeded" ||
    !receipt.actualVersion ||
    !read ||
    !read.readbackId ||
    read.actualVersion !== receipt.actualVersion ||
    read.actualDiffDigest !== intent.target.diffDigest ||
    read.controlPlane !== intent.target.controlPlane ||
    read.targetId !== intent.target.targetId ||
    read.scopeRef !== intent.target.scopeRef ||
    !Number.isFinite(read.observedAt) ||
    read.observedAt < receipt.at ||
    read.observedAt > now
  ) {
    return result("readback_mismatch");
  }
  if (intent.state === "effective") {
    return result(null);
  }
  if (intent.state === "rolled_back") {
    const rollback = intent.rollback;
    if (!rollback) {
      return result("rollback_evidence_missing");
    }
    const r = rollback.receipt,
      back = rollback.readback;
    if (
      r.status !== "succeeded" ||
      !r.receiptId ||
      !r.commandId ||
      !r.idempotencyKey ||
      !r.requestDigest ||
      r.commandId === command.commandId ||
      r.intentRevision !== intent.authorizedRevision ||
      !sameTarget(r.target, intent.target) ||
      !Number.isFinite(r.at) ||
      r.at < read.observedAt ||
      r.at > now ||
      r.at < approval.issuedAt ||
      r.at >= approval.expiresAt ||
      (approval.revokedAt !== null && r.at >= approval.revokedAt) ||
      r.actualVersion !== intent.target.rollbackExpectedVersion ||
      !back.readbackId ||
      back.controlPlane !== intent.target.controlPlane ||
      back.targetId !== intent.target.targetId ||
      back.scopeRef !== intent.target.scopeRef ||
      back.actualVersion !== intent.target.rollbackExpectedVersion ||
      back.actualDiffDigest !== intent.target.rollbackDiffDigest ||
      !Number.isFinite(back.observedAt) ||
      back.observedAt < r.at ||
      back.observedAt > now
    ) {
      return result("rollback_readback_mismatch");
    }
    return result(null);
  }
  const v = intent.verification,
    e = intent.evidence;
  if (
    !v ||
    !v.verificationId ||
    !v.eligible ||
    !v.passed ||
    v.metricDictVersion !== e.metricDictVersion ||
    v.metricId !== e.metricId ||
    v.denominatorDefinition !== e.denominatorDefinition ||
    v.cohortRef !== e.cohortRef ||
    v.baselineWindow.from !== e.window.from ||
    v.baselineWindow.to !== e.window.to ||
    v.baselineWindow.to - v.baselineWindow.from <= 0 ||
    v.baselineWindow.to - v.baselineWindow.from !== v.candidateWindow.to - v.candidateWindow.from ||
    v.candidateWindow.from < read.observedAt ||
    v.candidateWindow.to > v.observedAt ||
    !Number.isFinite(v.observedAt) ||
    v.observedAt > now ||
    ![v.baselineDenominator, v.candidateDenominator].every((n) => Number.isSafeInteger(n) && n > 0)
  ) {
    return result("verification_mismatch");
  }
  return result(null);
}
