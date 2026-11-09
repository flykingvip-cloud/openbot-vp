/**
 * Pure eligibility for an already-accepted member artifact.
 * This is not outbound authorization and it does not send.
 *
 * Server-side outbound authority does not exist yet. These symbols are not a grant:
 * `resolveOutboundTarget` only shapes a channel target, `operator.write` is a gateway
 * scope, `checkTaskActionBoundary` is task pause/cancel, and
 * `authorizeTeamGroupResourceAccess` is group read/write ACL.
 * The missing basis is `evaluateAcceptedArtifactOutboundAuthorization`.
 * Until that function exists, a complete member-artifact identity stays
 * `authorization_pending`. A caller-supplied granted flag is not read.
 */

export type MemberArtifactDeliveryScope = "member_artifact" | "group_final";

export type NormalizedDeliveryTarget = {
  channel: string;
  accountId: string | null;
  to: string;
};

export type MemberArtifactDeliveryIdentity = {
  tenantId: string;
  groupId: string;
  taskId: string;
  itemId: string;
  actorId: string;
  scope: MemberArtifactDeliveryScope;
  boardStatus: string;
  acceptedSubmissionId?: string | null;
  acceptedArtifactVersion?: string | null;
  linkedDeliverableId?: string | null;
  linkedDeliverableVersion?: number | null;
  linkedContentSha256?: string | null;
  target: {
    channel: string;
    accountId?: string | null;
    to: string;
  };
};

export type DeliveryEligibility =
  | { outcome: "deny"; reason: string }
  | { outcome: "authorization_pending"; reason: "outbound_auth_unwired" };

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/** Channel/account/to only. Does not read allowlists or decide permission. */
export function normalizeDeliveryTarget(input: {
  channel: string;
  accountId?: string | null;
  to: string;
}): NormalizedDeliveryTarget | null {
  const channel = compact(input.channel).toLowerCase();
  const to = compact(input.to);
  const account = compact(input.accountId);
  if (!channel || !to) {
    return null;
  }
  return { channel, accountId: account.length > 0 ? account : null, to };
}

/** Fixed field array. JSON encoding keeps a separator inside one field from forming another field. */
export function memberArtifactDeliveryKeyMaterial(
  identity: MemberArtifactDeliveryIdentity,
  target: NormalizedDeliveryTarget,
): string {
  return JSON.stringify([
    compact(identity.tenantId),
    compact(identity.groupId),
    compact(identity.taskId),
    compact(identity.itemId),
    compact(identity.acceptedSubmissionId),
    compact(identity.acceptedArtifactVersion),
    compact(identity.linkedDeliverableId),
    identity.linkedDeliverableVersion ?? null,
    compact(identity.linkedContentSha256).toLowerCase(),
    target.channel,
    target.accountId,
    target.to,
  ]);
}

export function evaluateMemberArtifactDeliveryEligibility(
  identity: MemberArtifactDeliveryIdentity,
): DeliveryEligibility {
  if (identity.scope === "group_final") {
    return { outcome: "deny", reason: "group_final_not_member_artifact" };
  }
  if (identity.scope !== "member_artifact") {
    return { outcome: "deny", reason: "scope_unsupported" };
  }
  const target = normalizeDeliveryTarget(identity.target);
  if (!compact(identity.target.channel) && !compact(identity.target.to)) {
    return { outcome: "deny", reason: "target_required" };
  }
  if (!target) {
    return { outcome: "deny", reason: "target_required" };
  }
  if (compact(identity.boardStatus) !== "accepted") {
    return { outcome: "deny", reason: "not_accepted" };
  }
  const version = identity.linkedDeliverableVersion;
  if (
    !compact(identity.tenantId) ||
    !compact(identity.groupId) ||
    !compact(identity.taskId) ||
    !compact(identity.itemId) ||
    !compact(identity.actorId) ||
    !compact(identity.acceptedSubmissionId) ||
    !compact(identity.acceptedArtifactVersion) ||
    !compact(identity.linkedDeliverableId) ||
    !compact(identity.linkedContentSha256) ||
    typeof version !== "number" ||
    !Number.isFinite(version) ||
    version <= 0
  ) {
    return { outcome: "deny", reason: "artifact_identity_incomplete" };
  }
  return { outcome: "authorization_pending", reason: "outbound_auth_unwired" };
}

/**
 * Durable server grant bound to tenant, group, actor, channel, account, target,
 * and the member-artifact version plus content hash.
 * Group membership and channel allowFrom are not this decision.
 * There is no granted field. A missing record stays pending.
 */
export type OutboundArtifactGrant = {
  tenantId: string;
  groupId: string;
  actorId: string;
  channel: string;
  accountId: string | null;
  to: string;
  scope: "member_artifact";
  acceptedArtifactVersion: string;
  linkedContentSha256: string;
  revokedAtMs: number | null;
};

export type OutboundAuthDecision =
  | { outcome: "authorization_pending"; reason: "outbound_auth_grant_missing" }
  | { outcome: "deny"; reason: string }
  | { outcome: "allow"; reason: "artifact_outbound_grant" };

export function evaluateAcceptedArtifactOutboundAuthorization(params: {
  tenantId: string;
  groupId: string;
  actorId: string;
  normalizedTarget: NormalizedDeliveryTarget;
  acceptedArtifactVersion: string;
  linkedContentSha256: string;
  grant: OutboundArtifactGrant | null;
}): OutboundAuthDecision {
  const grant = params.grant;
  if (!grant) {
    return { outcome: "authorization_pending", reason: "outbound_auth_grant_missing" };
  }
  if (grant.revokedAtMs !== null) {
    return { outcome: "deny", reason: "outbound_authorization_revoked" };
  }
  if (grant.scope !== "member_artifact") {
    return { outcome: "deny", reason: "outbound_scope_mismatch" };
  }
  const same =
    grant.tenantId === compact(params.tenantId) &&
    grant.groupId === compact(params.groupId) &&
    grant.actorId === compact(params.actorId) &&
    grant.channel === params.normalizedTarget.channel &&
    grant.accountId === params.normalizedTarget.accountId &&
    grant.to === params.normalizedTarget.to &&
    grant.acceptedArtifactVersion === compact(params.acceptedArtifactVersion) &&
    grant.linkedContentSha256 === compact(params.linkedContentSha256).toLowerCase();
  if (!same) {
    return { outcome: "deny", reason: "outbound_grant_mismatch" };
  }
  return { outcome: "allow", reason: "artifact_outbound_grant" };
}
