/**
 * Pre-dispatch readiness gate helper (R2 包1).
 *
 * 缩小范围 / 基础接口待接入：本 helper 与 RPC checkDispatchReadiness 可供派工前调用，
 * 但 claimBoardItem / 实际派工链尚未强制接入 — 不得标为「派工前已强制检查」。
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
