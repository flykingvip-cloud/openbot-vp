/**
 * Pure eligibility for an already-accepted member artifact.
 * Eligibility is not outbound authorization and it does not send.
 *
 * `resolveOutboundTarget` only shapes a channel target, `operator.write` is a gateway
 * scope, `checkTaskActionBoundary` is task pause/cancel, and
 * `authorizeTeamGroupResourceAccess` is group read/write ACL.
 * A caller-supplied granted flag is not read.
 * A grant object is built only by `issueOutboundArtifactGrant` from a trusted write
 * context plus the accepted artifact and its stored plain text.
 * Writing that grant also requires `evaluateChannelAccountOutboundScope` allow.
 * Inbound channel `allowFrom` is never this outbound grant basis.
 */

import { createHash } from "node:crypto";

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
  scope: MemberArtifactDeliveryScope;
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
  /** Defaults to member_artifact for existing callers. */
  scope?: MemberArtifactDeliveryScope;
}): OutboundAuthDecision {
  const grant = params.grant;
  const expectedScope: MemberArtifactDeliveryScope =
    params.scope === "group_final" ? "group_final" : "member_artifact";
  if (!grant) {
    return { outcome: "authorization_pending", reason: "outbound_auth_grant_missing" };
  }
  if (grant.revokedAtMs !== null) {
    return { outcome: "deny", reason: "outbound_authorization_revoked" };
  }
  if (grant.scope !== expectedScope) {
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

/** Produced only after `resolveTrustedWriteContext` allows group write. */
export type TrustedDeliveryIssuer = {
  source: "resolveTrustedWriteContext";
  tenantId: string;
  actorId: string;
  groupId: string;
  groupAction: "write";
};

export type AcceptedArtifactIssuanceFacts = {
  groupId: string;
  taskId: string;
  itemId: string;
  scope: MemberArtifactDeliveryScope;
  boardStatus: string;
  acceptedSubmissionId?: string | null;
  acceptedArtifactVersion?: string | null;
  linkedDeliverableId?: string | null;
  linkedDeliverableVersion?: number | null;
  linkedContentSha256?: string | null;
  deliverableId?: string | null;
  deliverableVersion?: number | null;
  deliverableContentSha256?: string | null;
  plainText?: string | null;
  /** Present only when a caller tries to smuggle media. Issuance then refuses. */
  mediaUrl?: string | null;
  attachment?: unknown;
};

export type AcceptedArtifactIssuanceBasis = {
  groupId: string;
  taskId: string;
  itemId: string;
  scope: MemberArtifactDeliveryScope;
  acceptedSubmissionId: string;
  acceptedArtifactVersion: string;
  linkedDeliverableId: string;
  linkedDeliverableVersion: number;
  linkedContentSha256: string;
  plainText: string;
};

export function establishTrustedDeliveryIssuer(
  input: {
    source: string;
    tenantId: string;
    actorId: string;
    groupId: string;
    groupAction: string;
  } | null,
): TrustedDeliveryIssuer | null {
  if (!input || input.source !== "resolveTrustedWriteContext" || input.groupAction !== "write") {
    return null;
  }
  const tenantId = compact(input.tenantId);
  const actorId = compact(input.actorId);
  const groupId = compact(input.groupId);
  if (!tenantId || !actorId || !groupId) {
    return null;
  }
  return {
    source: "resolveTrustedWriteContext",
    tenantId,
    actorId,
    groupId,
    groupAction: "write",
  };
}

function digestText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Board plus stored deliverable. Request fields that are not these facts are ignored. */
export function deriveAcceptedArtifactIssuanceBasis(
  facts: AcceptedArtifactIssuanceFacts | null,
): AcceptedArtifactIssuanceBasis | null {
  if (
    !facts ||
    (facts.scope !== "member_artifact" && facts.scope !== "group_final") ||
    compact(facts.boardStatus) !== "accepted"
  ) {
    return null;
  }
  if (compact(facts.mediaUrl) || facts.attachment != null) {
    return null;
  }
  const acceptedSubmissionId = compact(facts.acceptedSubmissionId);
  const acceptedArtifactVersion = compact(facts.acceptedArtifactVersion);
  const linkedDeliverableId = compact(facts.linkedDeliverableId);
  const linkedContentSha256 = compact(facts.linkedContentSha256).toLowerCase();
  const version = facts.linkedDeliverableVersion;
  const plainText = facts.plainText ?? "";
  if (
    !compact(facts.groupId) ||
    !compact(facts.taskId) ||
    !compact(facts.itemId) ||
    !acceptedSubmissionId ||
    !acceptedArtifactVersion ||
    !linkedDeliverableId ||
    !linkedContentSha256 ||
    typeof version !== "number" ||
    !Number.isFinite(version) ||
    version <= 0 ||
    compact(facts.deliverableId) !== linkedDeliverableId ||
    facts.deliverableVersion !== version ||
    compact(facts.deliverableContentSha256).toLowerCase() !== linkedContentSha256 ||
    !plainText.trim() ||
    digestText(plainText) !== linkedContentSha256
  ) {
    return null;
  }
  return {
    groupId: compact(facts.groupId),
    taskId: compact(facts.taskId),
    itemId: compact(facts.itemId),
    scope: facts.scope,
    acceptedSubmissionId,
    acceptedArtifactVersion,
    linkedDeliverableId,
    linkedDeliverableVersion: version,
    linkedContentSha256,
    plainText,
  };
}

/**
 * Overall acceptance gate for a pinned group-final version.
 * Bare chat completion phrases are refused. Does not send.
 */
export function evaluateGroupFinalOverallAcceptance(facts: {
  boardStatus?: string | null;
  acceptanceReason?: string | null;
  checkedAcceptanceCriteria?: readonly string[] | null;
  boardAcceptanceCriteria?: readonly string[] | null;
  acceptedArtifactVersion?: string | null;
  pinnedArtifactVersion?: string | null;
}):
  | { outcome: "allow"; reason: "group_final_overall_accepted" }
  | { outcome: "deny"; reason: string } {
  const status = compact(facts.boardStatus);
  if (status !== "accepted") {
    return { outcome: "deny", reason: "not_accepted" };
  }
  const reason = compact(facts.acceptanceReason);
  if (!reason) {
    return { outcome: "deny", reason: "acceptance_reason_required" };
  }
  if (
    /^(?:完成|已完成|闭环完成|任务完成|任务已完成|本轮完成|本轮已完成|done|completed)[\s。.!！…]*$/iu.test(
      reason,
    )
  ) {
    return { outcome: "deny", reason: "chat_completion_is_not_acceptance" };
  }
  const pinned = compact(facts.pinnedArtifactVersion);
  const accepted = compact(facts.acceptedArtifactVersion);
  if (!pinned || !accepted || pinned !== accepted) {
    return { outcome: "deny", reason: "group_final_version_mismatch" };
  }
  const required = (facts.boardAcceptanceCriteria ?? []).map((c) => c.trim()).filter(Boolean);
  const checked = new Set(
    (facts.checkedAcceptanceCriteria ?? []).map((c) => c.trim()).filter(Boolean),
  );
  if (required.length > 0) {
    const missing = required.filter((c) => !checked.has(c));
    if (missing.length > 0) {
      return { outcome: "deny", reason: "acceptance_criteria_incomplete" };
    }
  }
  return { outcome: "allow", reason: "group_final_overall_accepted" };
}

/**
 * Pure eligibility for a pinned group-final artifact.
 * Separate from member_artifact; does not send and does not grant outbound.
 */
export function evaluateGroupFinalDeliveryEligibility(
  identity: MemberArtifactDeliveryIdentity,
): DeliveryEligibility {
  if (identity.scope === "member_artifact") {
    return { outcome: "deny", reason: "member_artifact_not_group_final" };
  }
  if (identity.scope !== "group_final") {
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
 * Builds a grant object from the trusted issuer and the accepted artifact.
 * There is no grant argument. A missing issuer or basis returns null.
 * Callers must still pass `evaluateChannelAccountOutboundScope` before writing
 * the grant; group write alone is not outbound scope for an arbitrary target.
 */
export function issueOutboundArtifactGrant(params: {
  issuer: TrustedDeliveryIssuer | null;
  basis: AcceptedArtifactIssuanceBasis | null;
  target: { channel: string; accountId?: string | null; to: string };
}): OutboundArtifactGrant | null {
  const issuer = params.issuer;
  const basis = params.basis;
  const target = normalizeDeliveryTarget(params.target);
  if (!issuer || !basis || !target || issuer.groupId !== basis.groupId) {
    return null;
  }
  const scope: MemberArtifactDeliveryScope =
    basis.scope === "group_final" ? "group_final" : "member_artifact";
  return {
    tenantId: issuer.tenantId,
    groupId: issuer.groupId,
    actorId: issuer.actorId,
    channel: target.channel,
    accountId: target.accountId,
    to: target.to,
    scope,
    acceptedArtifactVersion: basis.acceptedArtifactVersion,
    linkedContentSha256: basis.linkedContentSha256,
    revokedAtMs: null,
  };
}

/**
 * Server-configured outbound destinations for one channel account.
 * This is NOT inbound `allowFrom`. Empty/missing destinations mean there is no
 * outbound scope basis yet (authorization_pending), not an implicit allow-all.
 */
export type ChannelAccountOutboundScopeFacts = {
  channel: string;
  accountId: string | null;
  accountEnabled: boolean;
  /** Server-configured outbound destinations for this channel account (e.g. defaultTo). Empty/missing = no basis. */
  allowedDestinations: string[];
};

/**
 * Pure outbound-scope gate for a normalized delivery target.
 * Group write / trusted issuer is a separate gate; this only checks channel-account
 * outbound destinations. Never treats inbound allowFrom as permission to send.
 */
export function evaluateChannelAccountOutboundScope(params: {
  target: NormalizedDeliveryTarget;
  facts: ChannelAccountOutboundScopeFacts | null;
}):
  | { outcome: "allow"; reason: "channel_account_outbound_scope" }
  | { outcome: "authorization_pending"; reason: "outbound_scope_basis_missing" }
  | { outcome: "deny"; reason: string } {
  const facts = params.facts;
  if (!facts) {
    return { outcome: "authorization_pending", reason: "outbound_scope_basis_missing" };
  }
  const destinations = facts.allowedDestinations
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (destinations.length === 0) {
    return { outcome: "authorization_pending", reason: "outbound_scope_basis_missing" };
  }
  if (!facts.accountEnabled) {
    return { outcome: "deny", reason: "channel_account_disabled" };
  }
  const factChannel = compact(facts.channel).toLowerCase();
  if (!factChannel || factChannel !== params.target.channel) {
    return { outcome: "deny", reason: "outbound_channel_mismatch" };
  }
  const factAccount = compact(facts.accountId);
  const factAccountId = factAccount.length > 0 ? factAccount : null;
  if (factAccountId !== params.target.accountId) {
    return { outcome: "deny", reason: "outbound_account_mismatch" };
  }
  if (!destinations.includes(params.target.to)) {
    return { outcome: "deny", reason: "outbound_target_out_of_scope" };
  }
  return { outcome: "allow", reason: "channel_account_outbound_scope" };
}
