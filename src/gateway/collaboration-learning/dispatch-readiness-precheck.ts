/**
 * Pre-dispatch readiness gate helper (R2 包1).
 *
 * Read-only helper / RPC surface: never creates sessions.
 * Product wiring: wake→round external dispatch forces checkMemberDispatchReadiness
 * (with session ensure) before dispatcher() — see wake-round-dispatch.ts.
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
