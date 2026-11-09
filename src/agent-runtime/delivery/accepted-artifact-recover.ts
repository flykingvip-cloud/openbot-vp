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
import type { MemberArtifactDeliveryIdentity } from "../policy/accepted-artifact-delivery.js";
import {
  claimMemberArtifactSendUnknown,
  readMemberArtifactDeliveryIntent,
  recordMemberArtifactReceipt,
} from "../state/collaboration/accepted-artifact-delivery-txn.js";
import { sendAcceptedArtifactBridge } from "./accepted-artifact-send.js";

const silentLog: RecoveryLogger = { info() {}, warn() {}, error() {} };

function deliveryDirs(stateDir?: string) {
  const base = stateDir ?? resolveStateDir();
  const rootDir = path.join(base, "accepted-artifact-delivery");
  return { rootDir, authDir: path.join(rootDir, "grants"), queueStateDir: base };
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
  const dirs = deliveryDirs(params.stateDir);
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
