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
import type { MemberArtifactDeliveryIdentity } from "../policy/index.js";
import { sendAcceptedArtifactBridge } from "./accepted-artifact-send.js";

/** State-backed recovery ports. Delivery must not import state internals. */
export type AcceptedArtifactRecoveryStore = {
  readIntent(rootDir: string, keyHash: string): Promise<unknown>;
  claimUnknown(params: {
    rootDir: string;
    authDir: string;
    identity: MemberArtifactDeliveryIdentity;
    recheck?: (intent: unknown) => Promise<"proceed" | "stop" | "block">;
  }): Promise<{ ok: boolean; send?: boolean; blocked?: boolean }>;
  recordReceipt(params: {
    rootDir: string;
    identity: MemberArtifactDeliveryIdentity;
    receiptMessageIds: string[];
  }): Promise<{ ok: true } | { ok: false; reason: string }>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringOrNull(value: unknown): string | null | undefined {
  if (value == null) {
    return value;
  }
  return typeof value === "string" ? value : undefined;
}

function asNumberOrNull(value: unknown): number | null | undefined {
  if (value == null) {
    return value;
  }
  return typeof value === "number" ? value : undefined;
}

function identityFromIntent(intent: unknown): MemberArtifactDeliveryIdentity | null {
  const rec = asRecord(intent);
  if (!rec) {
    return null;
  }
  const tenantId = asString(rec.tenantId);
  const groupId = asString(rec.groupId);
  const taskId = asString(rec.taskId);
  const itemId = asString(rec.itemId);
  const actorId = asString(rec.actorId);
  const target = asRecord(rec.normalizedTarget);
  const channel = target ? asString(target.channel) : undefined;
  const to = target ? asString(target.to) : undefined;
  if (!tenantId || !groupId || !taskId || !itemId || !actorId || !channel || !to) {
    return null;
  }
  const accountId = target ? asStringOrNull(target.accountId) : undefined;
  return {
    tenantId,
    groupId,
    taskId,
    itemId,
    actorId,
    scope: rec.scope === "group_final" ? "group_final" : "member_artifact",
    boardStatus: "accepted",
    acceptedSubmissionId: asStringOrNull(rec.acceptedSubmissionId),
    acceptedArtifactVersion: asStringOrNull(rec.acceptedArtifactVersion),
    linkedDeliverableId: asStringOrNull(rec.linkedDeliverableId),
    linkedDeliverableVersion: asNumberOrNull(rec.linkedDeliverableVersion),
    linkedContentSha256: asStringOrNull(rec.linkedContentSha256),
    target: { channel, accountId, to },
  };
}

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
  store: AcceptedArtifactRecoveryStore;
  deps?: OutboundSendDeps;
}): Promise<"recovered" | "failed" | "deferred"> {
  const keyHash = params.entry.bridgeKeyHash;
  if (!keyHash) {
    return "deferred";
  }
  const identity = identityFromIntent(await params.store.readIntent(params.rootDir, keyHash));
  if (!identity) {
    return "deferred";
  }
  return sendAcceptedArtifactBridge({
    snapshot: params.entry,
    queueStateDir: params.queueStateDir,
    cfg: params.cfg,
    deps: params.deps,
    claim: (recheck) =>
      params.store.claimUnknown({
        rootDir: params.rootDir,
        authDir: params.authDir,
        identity,
        recheck: async (intent) => {
          const rec = asRecord(intent);
          const target = rec ? asRecord(rec.normalizedTarget) : null;
          const channel = target ? asString(target.channel) : undefined;
          const to = target ? asString(target.to) : undefined;
          const digest = rec ? asString(rec.linkedContentSha256) : undefined;
          if (!channel || !to || !digest) {
            return "block";
          }
          return recheck({
            normalizedTarget: {
              channel,
              accountId: (target ? asStringOrNull(target.accountId) : undefined) ?? null,
              to,
            },
            linkedContentSha256: digest,
          });
        },
      }),
    recordReceipt: async (ids) => {
      const recorded = await params.store.recordReceipt({
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
  store: AcceptedArtifactRecoveryStore;
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
        store: params.store,
        deps: params.deps,
      }),
  });
}
