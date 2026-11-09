import fs from "node:fs/promises";
import path from "node:path";
import type { OpenBotConfig } from "../../config/config.js";
import { resolveStateDir } from "../../config/paths.js";
import type { OutboundSendDeps } from "../../infra/outbound/deliver.js";
import { deliverOutboundPayloads } from "../../infra/outbound/deliver.js";
import {
  recoverPendingDeliveries,
  type QueuedDelivery,
  type RecoveryLogger,
  type RecoverySummary,
} from "../../infra/outbound/delivery-queue.js";
import {
  sendAcceptedArtifactBridge,
  writeAcceptedArtifactQueueFile,
} from "../delivery/accepted-artifact-send.js";
import {
  deriveAcceptedArtifactIssuanceBasis,
  establishTrustedDeliveryIssuer,
  issueOutboundArtifactGrant,
  normalizeDeliveryTarget,
  type AcceptedArtifactIssuanceBasis,
  type AcceptedArtifactIssuanceFacts,
  type MemberArtifactDeliveryIdentity,
  type TrustedDeliveryIssuer,
} from "../policy/accepted-artifact-delivery.js";
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
  type MemberArtifactDeliveryIntent,
} from "../state/collaboration/accepted-artifact-delivery-txn.js";

export type AcceptedArtifactDeliveryDirs = {
  rootDir: string;
  authDir: string;
  queueStateDir: string;
};

export type AcceptedArtifactDeliveryView = {
  phase: string;
  authorization: string | null;
  queueId: string | null;
  receiptMessageIds: string[] | null;
  keyHash: string | null;
};

const silentLog: RecoveryLogger = { info() {}, warn() {}, error() {} };

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
    scope: "member_artifact",
    boardStatus: "accepted",
    acceptedSubmissionId: basis.acceptedSubmissionId,
    acceptedArtifactVersion: basis.acceptedArtifactVersion,
    linkedDeliverableId: basis.linkedDeliverableId,
    linkedDeliverableVersion: basis.linkedDeliverableVersion,
    linkedContentSha256: basis.linkedContentSha256,
    target,
  };
}

function viewOf(intent: MemberArtifactDeliveryIntent | null): AcceptedArtifactDeliveryView {
  if (!intent) {
    return {
      phase: "missing",
      authorization: null,
      queueId: null,
      receiptMessageIds: null,
      keyHash: null,
    };
  }
  return {
    phase: intent.phase,
    authorization: intent.authorization,
    queueId: intent.queueId,
    receiptMessageIds: intent.receiptMessageIds,
    keyHash: intent.keyHash,
  };
}

async function findIntent(params: {
  rootDir: string;
  tenantId: string;
  groupId: string;
  taskId: string;
  itemId: string;
  target: { channel: string; accountId?: string | null; to: string };
}): Promise<MemberArtifactDeliveryIntent | null> {
  const target = normalizeDeliveryTarget(params.target);
  if (!target) {
    return null;
  }
  let names: string[] = [];
  try {
    names = await fs.readdir(path.join(params.rootDir, "intents"));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    throw error;
  }
  for (const name of names) {
    if (!name.endsWith(".intent.json")) {
      continue;
    }
    const intent = await readMemberArtifactDeliveryIntent(
      params.rootDir,
      name.slice(0, -".intent.json".length),
    );
    if (!intent) {
      continue;
    }
    const same =
      intent.tenantId === params.tenantId &&
      intent.groupId === params.groupId &&
      intent.taskId === params.taskId &&
      intent.itemId === params.itemId &&
      intent.normalizedTarget.channel === target.channel &&
      intent.normalizedTarget.accountId === target.accountId &&
      intent.normalizedTarget.to === target.to;
    if (same) {
      return intent;
    }
  }
  return null;
}

/**
 * Public request chain: trusted issuance, association, then queue publication.
 * Does not send. A request body cannot supply the grant.
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
  nowMs?: number;
}): Promise<{ ok: true; delivery: AcceptedArtifactDeliveryView } | { ok: false; reason: string }> {
  const issuer = establishTrustedDeliveryIssuer(params.issuerInput);
  const basis = deriveAcceptedArtifactIssuanceBasis(params.facts);
  const grant = issueOutboundArtifactGrant({ issuer, basis, target: params.target });
  if (!issuer || !basis || !grant) {
    return { ok: false, reason: "trusted_issuance_required" };
  }
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
    return { ok: true, delivery: viewOf(noted.intent) };
  }
  await writeIssuedOutboundArtifactGrant({
    authDir: params.dirs.authDir,
    keyHash,
    grant,
  });
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
  return { ok: true, delivery: viewOf(marked.intent) };
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
  const intent = await findIntent({
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
  await writeIssuedOutboundArtifactGrant({
    authDir: params.dirs.authDir,
    keyHash: intent.keyHash,
    grant: { ...current, revokedAtMs: current.revokedAtMs ?? params.nowMs ?? Date.now() },
  });
  return { ok: true };
}

export async function readAcceptedArtifactDelivery(params: {
  tenantId: string;
  actorId: string;
  groupId: string;
  taskId: string;
  itemId: string;
  target: { channel: string; accountId?: string | null; to: string };
  rootDir: string;
}): Promise<{ ok: true; delivery: AcceptedArtifactDeliveryView } | { ok: false; reason: string }> {
  if (!params.tenantId.trim() || !params.actorId.trim() || !params.groupId.trim()) {
    return { ok: false, reason: "trusted_issuance_required" };
  }
  const intent = await findIntent({
    rootDir: params.rootDir,
    tenantId: params.tenantId,
    groupId: params.groupId,
    taskId: params.taskId,
    itemId: params.itemId,
    target: params.target,
  });
  return { ok: true, delivery: viewOf(intent) };
}

export async function recoverAcceptedArtifactBridgeEntry(params: {
  entry: QueuedDelivery;
  rootDir: string;
  authDir: string;
  queueStateDir: string;
  cfg: OpenBotConfig;
  deps?: OutboundSendDeps;
}): Promise<"recovered" | "failed" | "deferred"> {
  const keyHash = params.entry.bridgeKeyHash;
  if (!keyHash) {
    return "deferred";
  }
  const intent = await readMemberArtifactDeliveryIntent(params.rootDir, keyHash);
  if (!intent) {
    return "deferred";
  }
  const identity: MemberArtifactDeliveryIdentity = {
    tenantId: intent.tenantId,
    groupId: intent.groupId,
    taskId: intent.taskId,
    itemId: intent.itemId,
    actorId: intent.actorId,
    scope: "member_artifact",
    boardStatus: "accepted",
    acceptedSubmissionId: intent.acceptedSubmissionId,
    acceptedArtifactVersion: intent.acceptedArtifactVersion,
    linkedDeliverableId: intent.linkedDeliverableId,
    linkedDeliverableVersion: intent.linkedDeliverableVersion,
    linkedContentSha256: intent.linkedContentSha256,
    target: intent.normalizedTarget,
  };
  return sendAcceptedArtifactBridge({
    snapshot: params.entry,
    queueStateDir: params.queueStateDir,
    cfg: params.cfg,
    deps: params.deps,
    claim: (recheck) =>
      claimMemberArtifactSendUnknown({
        rootDir: params.rootDir,
        authDir: params.authDir,
        identity,
        recheck,
      }),
    recordReceipt: async (ids) => {
      const recorded = await recordMemberArtifactReceipt({
        rootDir: params.rootDir,
        identity,
        receiptMessageIds: ids,
      });
      if (!recorded.ok) {
        throw new Error(recorded.reason);
      }
    },
    recordUnknown: async () => {
      // Claim already persisted externalEffect unknown before the channel call.
    },
  });
}

/** Same recovery entry the gateway boot uses. Ordinary rows stay on `deliver`. */
export async function recoverAcceptedArtifactDeliveries(params: {
  cfg: OpenBotConfig;
  stateDir?: string;
  deps?: OutboundSendDeps;
  deliver?: Parameters<typeof recoverPendingDeliveries>[0]["deliver"];
  log?: RecoveryLogger;
}): Promise<RecoverySummary> {
  const dirs = acceptedArtifactDeliveryDirs(params.stateDir);
  return recoverPendingDeliveries({
    cfg: params.cfg,
    stateDir: params.stateDir,
    log: params.log ?? silentLog,
    deliver: params.deliver ?? deliverOutboundPayloads,
    recoverBridge: (entry) =>
      recoverAcceptedArtifactBridgeEntry({
        entry,
        rootDir: dirs.rootDir,
        authDir: dirs.authDir,
        queueStateDir: dirs.queueStateDir,
        cfg: params.cfg,
        deps: params.deps,
      }),
  });
}
