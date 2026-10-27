/**
 * Pre-dispatch readiness gate (review D). Call before claiming "已派工/已送达".
 * Read-only: never creates sessions.
 */
import {
  checkMemberDispatchReadiness,
  type CheckMemberDispatchReadinessResult,
  type TrustedMemberResolution,
} from "./member-dispatch-readiness.js";

export async function precheckDispatchReadiness(params: {
  memberIds: readonly string[];
  resolveMember: (
    memberId: string,
  ) => TrustedMemberResolution | Promise<TrustedMemberResolution | null> | null;
}): Promise<CheckMemberDispatchReadinessResult> {
  return checkMemberDispatchReadiness({
    members: params.memberIds.map((memberId) => ({ memberId })),
    resolveMember: params.resolveMember,
    autoEnsureSession: false,
  });
}
