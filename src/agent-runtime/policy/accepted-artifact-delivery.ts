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
 * Server facts only. There is no `granted` field.
 * `memberActorIds` is the membership set behind `authorizeTeamGroupResourceAccess`.
 * `allowFrom` is the list `resolveOutboundTarget` passes to the channel plugin.
 * Missing facts stay `authorization_pending`. A caller cannot flip a boolean to allow.
 */
export type ServerOutboundAuthFacts = {
  factsLoaded: boolean;
  memberActorIds?: readonly string[];
  allowFrom?: readonly string[];
};

export type OutboundAuthDecision =
  | { outcome: "authorization_pending"; reason: "outbound_auth_facts_missing" }
  | { outcome: "deny"; reason: string }
  | { outcome: "allow"; reason: "member_and_allowlist" };

export function evaluateAcceptedArtifactOutboundAuthorization(params: {
  actorId: string;
  normalizedTarget: NormalizedDeliveryTarget;
  facts: ServerOutboundAuthFacts;
}): OutboundAuthDecision {
  if (!params.facts.factsLoaded || !params.facts.memberActorIds || !params.facts.allowFrom) {
    return { outcome: "authorization_pending", reason: "outbound_auth_facts_missing" };
  }
  const actor = compact(params.actorId);
  const members = params.facts.memberActorIds
    .map((id) => compact(id))
    .filter((id) => id.length > 0);
  if (!actor || !members.includes(actor)) {
    return { outcome: "deny", reason: "outbound_actor_not_member" };
  }
  const allowFrom = params.facts.allowFrom
    .map((entry) => compact(entry))
    .filter((entry) => entry.length > 0);
  if (allowFrom.length === 0) {
    return { outcome: "deny", reason: "outbound_allowlist_empty" };
  }
  const to = params.normalizedTarget.to;
  const allowed = allowFrom.some(
    (entry) => entry === to || entry.toLowerCase() === to.toLowerCase(),
  );
  if (!allowed) {
    return { outcome: "deny", reason: "outbound_target_not_allowed" };
  }
  return { outcome: "allow", reason: "member_and_allowlist" };
}
