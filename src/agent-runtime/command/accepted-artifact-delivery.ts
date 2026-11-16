import path from "node:path";
import type { OpenBotConfig } from "../../config/config.js";
import { resolveStateDir } from "../../config/paths.js";
import { resolveOutboundChannelPlugin } from "../../infra/outbound/channel-resolution.js";
import type { OutboundSendDeps } from "../../infra/outbound/deliver.js";
import type { RecoveryLogger } from "../../infra/outbound/delivery-queue.js";
import { recoverAcceptedArtifactDeliveries } from "../delivery/accepted-artifact-recover.js";
import { writeAcceptedArtifactQueueFile } from "../delivery/accepted-artifact-send.js";
import {
  deriveAcceptedArtifactIssuanceBasis,
  establishTrustedDeliveryIssuer,
  evaluateChannelAccountOutboundScope,
  evaluateGroupFinalDeliveryEligibility,
  evaluateGroupFinalOverallAcceptance,
  issueOutboundArtifactGrant,
  normalizeDeliveryTarget,
  type AcceptedArtifactIssuanceBasis,
  type AcceptedArtifactIssuanceFacts,
  type ChannelAccountOutboundScopeFacts,
  type MemberArtifactDeliveryIdentity,
  type NormalizedDeliveryTarget,
  type TrustedDeliveryIssuer,
} from "../policy/index.js";
import {
  findMemberArtifactDeliveryIntent,
  viewAcceptedArtifactDelivery,
  type AcceptedArtifactDeliveryView,
} from "../state/index.js";
import {
  claimMemberArtifactSendUnknown,
  commitMemberArtifactDeliveryAssociation,
  deliveryKeyHash,
  markMemberArtifactQueued,
  noteAssociationRenamedAwayFromStaged,
  prepareMemberArtifactQueuePublication,
  readMemberArtifactDeliveryIntent,
  readServerOutboundArtifactGrant,
  recordMemberArtifactReceipt,
  writeIssuedOutboundArtifactGrant,
} from "../state/index.js";

export type AcceptedArtifactDeliveryDirs = {
  rootDir: string;
  authDir: string;
  queueStateDir: string;
};

export type { AcceptedArtifactDeliveryView };

export function acceptedArtifactDeliveryDirs(stateDir?: string): AcceptedArtifactDeliveryDirs {
  const base = stateDir ?? resolveStateDir();
  const rootDir = path.join(base, "accepted-artifact-delivery");
  return { rootDir, authDir: path.join(rootDir, "grants"), queueStateDir: base };
}

export function issuanceFactsFromBoard(params: {
  groupId: string;
  taskId: string;
  itemId: string;
  item: {
    status?: string;
    acceptedSubmissionId?: string | null;
    acceptedArtifactVersion?: string | null;
    linkedDeliverableId?: string | null;
    linkedDeliverableVersion?: number | null;
    linkedContentSha256?: string | null;
  } | null;
  deliverable: {
    deliverableId: string;
    version: number;
    contentSha256: string;
    content: string;
  } | null;
}): AcceptedArtifactIssuanceFacts {
  return {
    groupId: params.groupId,
    taskId: params.taskId,
    itemId: params.itemId,
    scope: "member_artifact",
    boardStatus: params.item?.status ?? "missing",
    acceptedSubmissionId: params.item?.acceptedSubmissionId,
    acceptedArtifactVersion: params.item?.acceptedArtifactVersion,
    linkedDeliverableId: params.item?.linkedDeliverableId,
    linkedDeliverableVersion: params.item?.linkedDeliverableVersion,
    linkedContentSha256: params.item?.linkedContentSha256,
    deliverableId: params.deliverable?.deliverableId,
    deliverableVersion: params.deliverable?.version,
    deliverableContentSha256: params.deliverable?.contentSha256,
    plainText: params.deliverable?.content,
  };
}

/**
 * Builds ChannelAccountOutboundScopeFacts from OpenBotConfig using channel dock
 * `resolveDefaultTo` only. Does NOT read inbound allowFrom.
 *
 * When defaultTo is present, accountEnabled is treated as true unless a cheap
 * cfg.channels[channel].enabled / accounts[id].enabled === false is visible.
 * Unsupported channel or missing defaultTo → null (authorization_pending).
 */
export function resolveChannelAccountOutboundScopeFacts(params: {
  cfg: OpenBotConfig;
  target: NormalizedDeliveryTarget;
}): ChannelAccountOutboundScopeFacts | null {
  const channel = params.target.channel;
  const accountId = params.target.accountId;

  const channels = (params.cfg as { channels?: Record<string, ChannelCfgSlice> }).channels;
  const slice = channels?.[channel];
  if (slice?.enabled === false) {
    return {
      channel,
      accountId,
      accountEnabled: false,
      allowedDestinations: [],
    };
  }
  const account =
    accountId && slice?.accounts
      ? slice.accounts[
          Object.keys(slice.accounts).find(
            (key) => key.toLowerCase() === accountId.toLowerCase(),
          ) ?? ""
        ]
      : undefined;
  if (account?.enabled === false) {
    return {
      channel,
      accountId,
      accountEnabled: false,
      allowedDestinations: [],
    };
  }

  let defaultTo: string | undefined;
  try {
    const plugin = resolveOutboundChannelPlugin({ channel, cfg: params.cfg });
    if (plugin?.config?.resolveDefaultTo) {
      const resolved = plugin.config.resolveDefaultTo({
        cfg: params.cfg,
        accountId: accountId ?? undefined,
      });
      if (resolved != null && String(resolved).trim()) {
        defaultTo = String(resolved).trim();
      }
    }
  } catch {
    // Plugin registry may be unavailable in unit tests; fall through to cfg defaultTo.
  }

  if (!defaultTo) {
    const raw = account?.defaultTo ?? slice?.defaultTo;
    if (raw != null && String(raw).trim()) {
      defaultTo = String(raw).trim();
    }
  }

  if (!defaultTo) {
    return null;
  }

  // defaultTo present ⇒ treat account as enabled (inspect helpers not required here).
  // Inbound allowFrom is intentionally ignored as an outbound grant basis.
  return {
    channel,
    accountId,
    accountEnabled: true,
    allowedDestinations: [defaultTo],
  };
}

type ChannelCfgSlice = {
  enabled?: boolean;
  defaultTo?: string | number;
  accounts?: Record<string, { enabled?: boolean; defaultTo?: string | number }>;
};

function identityFrom(
  issuer: TrustedDeliveryIssuer,
  basis: AcceptedArtifactIssuanceBasis,
  target: { channel: string; accountId?: string | null; to: string },
): MemberArtifactDeliveryIdentity {
  return {
    tenantId: issuer.tenantId,
    groupId: basis.groupId,
    taskId: basis.taskId,
    itemId: basis.itemId,
    actorId: issuer.actorId,
    scope: basis.scope,
    boardStatus: "accepted",
    acceptedSubmissionId: basis.acceptedSubmissionId,
    acceptedArtifactVersion: basis.acceptedArtifactVersion,
    linkedDeliverableId: basis.linkedDeliverableId,
    linkedDeliverableVersion: basis.linkedDeliverableVersion,
    linkedContentSha256: basis.linkedContentSha256,
    target,
  };
}

/**
 * Public request chain: trusted issuance, channel-account outbound scope,
 * association, grant write, queue publication, then in-process recover.
 * A request body cannot supply the grant. Group write alone is not outbound scope.
 */
export async function requestAcceptedArtifactDelivery(params: {
  issuerInput: {
    source: string;
    tenantId: string;
    actorId: string;
    groupId: string;
    groupAction: string;
  } | null;
  facts: AcceptedArtifactIssuanceFacts | null;
  target: { channel: string; accountId?: string | null; to: string };
  dirs: AcceptedArtifactDeliveryDirs;
  cfg: OpenBotConfig;
  deps?: OutboundSendDeps;
  log?: RecoveryLogger;
  /** Optional override for tests; otherwise resolved from cfg via defaultTo only. */
  scopeFacts?: ChannelAccountOutboundScopeFacts | null;
  nowMs?: number;
}): Promise<{ ok: true; delivery: AcceptedArtifactDeliveryView } | { ok: false; reason: string }> {
  const issuer = establishTrustedDeliveryIssuer(params.issuerInput);
  const basis = deriveAcceptedArtifactIssuanceBasis(params.facts);
  if (!issuer || !basis) {
    return { ok: false, reason: "trusted_issuance_required" };
  }
  if (basis.scope === "group_final") {
    return { ok: false, reason: "group_final_not_member_artifact" };
  }
  const normalized = normalizeDeliveryTarget(params.target);
  if (!normalized) {
    return { ok: false, reason: "target_required" };
  }

  const scopeFacts =
    params.scopeFacts !== undefined
      ? params.scopeFacts
      : resolveChannelAccountOutboundScopeFacts({ cfg: params.cfg, target: normalized });
  const scope = evaluateChannelAccountOutboundScope({
    target: normalized,
    facts: scopeFacts,
  });

  const identity = identityFrom(issuer, basis, params.target);
  const keyHash = deliveryKeyHash(identity);
  if (!keyHash) {
    return { ok: false, reason: "target_required" };
  }
  const nowMs = params.nowMs ?? Date.now();
  const existingGrant = await readServerOutboundArtifactGrant(params.dirs.authDir, keyHash);
  if (existingGrant?.revokedAtMs != null) {
    return { ok: false, reason: "outbound_authorization_revoked" };
  }

  // Association may proceed for eligibility even when outbound scope is not yet allow.
  const committed = await commitMemberArtifactDeliveryAssociation({
    rootDir: params.dirs.rootDir,
    identity,
    nowMs,
  });
  if (!committed.ok) {
    return committed;
  }
  const noted = await noteAssociationRenamedAwayFromStaged({
    rootDir: params.dirs.rootDir,
    identity,
    nowMs,
  });
  if (!noted.ok) {
    return noted;
  }
  if (
    noted.intent.phase === "unknown" ||
    noted.intent.phase === "delivered" ||
    noted.intent.phase === "blocked"
  ) {
    return { ok: true, delivery: viewAcceptedArtifactDelivery(noted.intent) };
  }

  if (scope.outcome === "authorization_pending") {
    return { ok: false, reason: "outbound_scope_basis_missing" };
  }
  if (scope.outcome === "deny") {
    return { ok: false, reason: scope.reason };
  }

  const grant = issueOutboundArtifactGrant({ issuer, basis, target: params.target });
  if (!grant) {
    return { ok: false, reason: "trusted_issuance_required" };
  }

  const written = await writeIssuedOutboundArtifactGrant({
    authDir: params.dirs.authDir,
    keyHash,
    grant,
  });
  if (!written.ok) {
    return written;
  }

  const prepared = await prepareMemberArtifactQueuePublication({
    rootDir: params.dirs.rootDir,
    authDir: params.dirs.authDir,
    identity,
    payloadText: basis.plainText,
    nowMs,
  });
  if (!prepared.ok) {
    return prepared;
  }
  await writeAcceptedArtifactQueueFile({
    queueStateDir: params.dirs.queueStateDir,
    queueId: prepared.queueId,
    keyHash: prepared.keyHash,
    channel: prepared.channel,
    to: prepared.to,
    accountId: prepared.accountId,
    payloadText: basis.plainText,
    contentSha256: prepared.contentSha256,
    nowMs,
  });
  const marked = await markMemberArtifactQueued({
    rootDir: params.dirs.rootDir,
    identity,
    queueId: prepared.queueId,
    nowMs,
  });
  if (!marked.ok) {
    return marked;
  }

  // Live recover in-process so delivery advances without a Gateway restart.
  try {
    await recoverAcceptedArtifactDeliveries({
      cfg: params.cfg,
      stateDir: params.dirs.queueStateDir,
      deps: params.deps,
      log: params.log,
      store: {
        readIntent: readMemberArtifactDeliveryIntent,
        claimUnknown: claimMemberArtifactSendUnknown,
        recordReceipt: recordMemberArtifactReceipt,
      },
    });
  } catch {
    // Queue is durable; boot or a later recover can finish after a crash here.
  }

  const latest = await findMemberArtifactDeliveryIntent({
    rootDir: params.dirs.rootDir,
    tenantId: issuer.tenantId,
    groupId: basis.groupId,
    taskId: basis.taskId,
    itemId: basis.itemId,
    target: params.target,
  });
  return { ok: true, delivery: viewAcceptedArtifactDelivery(latest ?? marked.intent) };
}

export async function revokeAcceptedArtifactDelivery(params: {
  issuerInput: {
    source: string;
    tenantId: string;
    actorId: string;
    groupId: string;
    groupAction: string;
  } | null;
  taskId: string;
  itemId: string;
  target: { channel: string; accountId?: string | null; to: string };
  dirs: AcceptedArtifactDeliveryDirs;
  nowMs?: number;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const issuer = establishTrustedDeliveryIssuer(params.issuerInput);
  if (!issuer) {
    return { ok: false, reason: "trusted_issuance_required" };
  }
  const intent = await findMemberArtifactDeliveryIntent({
    rootDir: params.dirs.rootDir,
    tenantId: issuer.tenantId,
    groupId: issuer.groupId,
    taskId: params.taskId,
    itemId: params.itemId,
    target: params.target,
  });
  if (!intent) {
    return { ok: false, reason: "intent_missing" };
  }
  const current = await readServerOutboundArtifactGrant(params.dirs.authDir, intent.keyHash);
  if (!current) {
    return { ok: false, reason: "outbound_auth_grant_missing" };
  }
  if (
    current.tenantId !== issuer.tenantId ||
    current.groupId !== issuer.groupId ||
    current.actorId !== intent.actorId
  ) {
    return { ok: false, reason: "outbound_grant_mismatch" };
  }
  const written = await writeIssuedOutboundArtifactGrant({
    authDir: params.dirs.authDir,
    keyHash: intent.keyHash,
    grant: { ...current, revokedAtMs: current.revokedAtMs ?? params.nowMs ?? Date.now() },
  });
  if (!written.ok) {
    return written;
  }
  return { ok: true };
}

export type GroupFinalOverallAcceptanceFacts = {
  boardStatus?: string | null;
  acceptanceReason?: string | null;
  checkedAcceptanceCriteria?: readonly string[] | null;
  boardAcceptanceCriteria?: readonly string[] | null;
  acceptedArtifactVersion?: string | null;
  pinnedArtifactVersion?: string | null;
};

/**
 * Group-final delivery request (explicit). Requires overall acceptance + trusted
 * issuance, then association and optional grant. Does not send on the first slice.
 * Does not run from acceptBoardItemSubmission side effects.
 */
export async function requestGroupFinalDelivery(params: {
  issuerInput: {
    source: string;
    tenantId: string;
    actorId: string;
    groupId: string;
    groupAction: string;
  } | null;
  facts: AcceptedArtifactIssuanceFacts | null;
  overallAcceptance: GroupFinalOverallAcceptanceFacts;
  target: { channel: string; accountId?: string | null; to: string };
  dirs: AcceptedArtifactDeliveryDirs;
  cfg: OpenBotConfig;
  scopeFacts?: ChannelAccountOutboundScopeFacts | null;
  nowMs?: number;
}): Promise<{ ok: true; delivery: AcceptedArtifactDeliveryView } | { ok: false; reason: string }> {
  const overall = evaluateGroupFinalOverallAcceptance(params.overallAcceptance);
  if (overall.outcome === "deny") {
    return { ok: false, reason: overall.reason };
  }
  if (!params.facts || params.facts.scope !== "group_final") {
    return { ok: false, reason: "group_final_scope_required" };
  }
  const issuer = establishTrustedDeliveryIssuer(params.issuerInput);
  const basis = deriveAcceptedArtifactIssuanceBasis(params.facts);
  if (!issuer || !basis || basis.scope !== "group_final") {
    return { ok: false, reason: "trusted_issuance_required" };
  }
  const normalized = normalizeDeliveryTarget(params.target);
  if (!normalized) {
    return { ok: false, reason: "target_required" };
  }
  const identity = identityFrom(issuer, basis, params.target);
  const eligibility = evaluateGroupFinalDeliveryEligibility(identity);
  if (eligibility.outcome === "deny") {
    return { ok: false, reason: eligibility.reason };
  }

  const scopeFacts =
    params.scopeFacts !== undefined
      ? params.scopeFacts
      : resolveChannelAccountOutboundScopeFacts({ cfg: params.cfg, target: normalized });
  const scope = evaluateChannelAccountOutboundScope({
    target: normalized,
    facts: scopeFacts,
  });

  const keyHash = deliveryKeyHash(identity);
  if (!keyHash) {
    return { ok: false, reason: "target_required" };
  }
  const nowMs = params.nowMs ?? Date.now();
  const existingGrant = await readServerOutboundArtifactGrant(params.dirs.authDir, keyHash);
  if (existingGrant?.revokedAtMs != null) {
    return { ok: false, reason: "outbound_authorization_revoked" };
  }

  const committed = await commitMemberArtifactDeliveryAssociation({
    rootDir: params.dirs.rootDir,
    identity,
    nowMs,
  });
  if (!committed.ok) {
    return committed;
  }
  const noted = await noteAssociationRenamedAwayFromStaged({
    rootDir: params.dirs.rootDir,
    identity,
    nowMs,
  });
  if (!noted.ok) {
    return noted;
  }
  if (
    noted.intent.phase === "unknown" ||
    noted.intent.phase === "delivered" ||
    noted.intent.phase === "blocked"
  ) {
    return { ok: true, delivery: viewAcceptedArtifactDelivery(noted.intent) };
  }

  if (scope.outcome === "authorization_pending") {
    return { ok: false, reason: "outbound_scope_basis_missing" };
  }
  if (scope.outcome === "deny") {
    return { ok: false, reason: scope.reason };
  }

  const grant = issueOutboundArtifactGrant({ issuer, basis, target: params.target });
  if (!grant || grant.scope !== "group_final") {
    return { ok: false, reason: "trusted_issuance_required" };
  }
  const written = await writeIssuedOutboundArtifactGrant({
    authDir: params.dirs.authDir,
    keyHash,
    grant,
  });
  if (!written.ok) {
    return written;
  }
  // First slice: association + grant only — no channel send.
  const latest = await findMemberArtifactDeliveryIntent({
    rootDir: params.dirs.rootDir,
    tenantId: issuer.tenantId,
    groupId: issuer.groupId,
    taskId: basis.taskId,
    itemId: basis.itemId,
    target: params.target,
  });
  return { ok: true, delivery: viewAcceptedArtifactDelivery(latest ?? noted.intent) };
}
