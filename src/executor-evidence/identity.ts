/**
 * Full trusted-scope equality and the immutable snapshot identity checked on replay.
 * Domain id alone is not enough: tenant and authorization scope are part of the identity.
 */
import { createHash } from "node:crypto";
import type { TrustedScope } from "../task-outcome/types.js";

export function fullScopeEqual(left: TrustedScope, right: TrustedScope): boolean {
  if (left.kind !== right.kind || left.subjectRef !== right.subjectRef) {
    return false;
  }
  if (left.authzScopeRef !== right.authzScopeRef) {
    return false;
  }
  if (left.kind === "personal" && right.kind === "personal") {
    return left.personalDomainId === right.personalDomainId;
  }
  if (left.kind === "enterprise" && right.kind === "enterprise") {
    return left.enterpriseDomainId === right.enterpriseDomainId && left.tenantId === right.tenantId;
  }
  return false;
}

export function snapshotIdentityFingerprint(record: {
  taskId: string;
  outcomeVersion: number;
  scope: TrustedScope;
  lifecycle: string;
  taskJudgement: string;
  revisionKind?: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        taskId: record.taskId,
        outcomeVersion: record.outcomeVersion,
        scope: record.scope,
        lifecycle: record.lifecycle,
        taskJudgement: record.taskJudgement,
        revisionKind: record.revisionKind ?? null,
      }),
    )
    .digest("hex");
}
