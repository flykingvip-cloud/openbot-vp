import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenBotConfig } from "../../config/config.js";
import { deliverOutboundPayloads, type OutboundSendDeps } from "../../infra/outbound/deliver.js";
import {
  ackDelivery,
  isEntryEligibleForRecoveryRetry,
  moveToFailed,
  resolveDeliveryQueueDir,
  type QueuedDelivery,
} from "../../infra/outbound/delivery-queue.js";
import { confirmedDeliveryMessageIds } from "../../shared/delivery-receipt.js";

/**
 * Send and outcome classification for an already associated member artifact.
 * State transitions are injected. This module does not decide group membership
 * or read channel allowFrom. A non-telegram target is sent as that channel,
 * never rewritten to telegram.
 */

export type BridgeSendOutcome = "recovered" | "failed" | "deferred";

export type BridgeSendIntent = {
  phase: string;
  queueId: string | null;
  normalizedTarget: { channel: string; accountId: string | null; to: string };
  linkedContentSha256: string;
};

async function writeQueueJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value)}\n`, "utf8");
  await fs.rename(tmp, filePath);
}

function payloadDigest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const QUEUE_EFFECT_FIELDS = [
  "mirror",
  "gifPlayback",
  "threadId",
  "replyToId",
  "bestEffort",
  "silent",
] as const;

/** M1/M2 accept one plain-text payload. Media and other effect fields are refused. */
export function unsupportedPlainTextQueueEntry(entry: QueuedDelivery): boolean {
  if (!Array.isArray(entry.payloads) || entry.payloads.length !== 1) {
    return true;
  }
  const payload = entry.payloads[0];
  if (!payload || typeof payload !== "object") {
    return true;
  }
  const keys = Object.keys(payload);
  if (
    keys.length !== 1 ||
    keys[0] !== "text" ||
    typeof payload.text !== "string" ||
    !payload.text.trim()
  ) {
    return true;
  }
  for (const field of QUEUE_EFFECT_FIELDS) {
    if (entry[field] != null && entry[field] !== false) {
      return true;
    }
  }
  return false;
}

function payloadText(entry: QueuedDelivery): string {
  return entry.payloads.map((payload) => payload.text ?? "").join("\n");
}

async function readQueueEntry(queueStateDir: string, id: string): Promise<QueuedDelivery | null> {
  try {
    const raw = await fs.readFile(
      path.join(resolveDeliveryQueueDir(queueStateDir), `${id}.json`),
      "utf8",
    );
    return JSON.parse(raw) as QueuedDelivery;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writeAcceptedArtifactQueueFile(params: {
  queueStateDir: string;
  queueId: string;
  keyHash: string;
  channel: string;
  to: string;
  accountId: string | null;
  payloadText: string;
  contentSha256: string;
  nowMs: number;
}): Promise<void> {
  const queueDir = resolveDeliveryQueueDir(params.queueStateDir);
  await fs.mkdir(queueDir, { recursive: true });
  const staged = path.join(queueDir, `bridge-${params.keyHash}.bridge-staged`);
  const hidden: QueuedDelivery = {
    id: params.queueId,
    enqueuedAt: params.nowMs,
    retryCount: 0,
    channel: params.channel as QueuedDelivery["channel"],
    to: params.to,
    accountId: params.accountId ?? undefined,
    payloads: [{ text: params.payloadText }],
    bridgeMarker: true,
    associationReady: false,
    bridgeKeyHash: params.keyHash,
    bridgeContentSha256: params.contentSha256,
  };
  await writeQueueJson(staged, hidden);
  const ready: QueuedDelivery = { ...hidden, associationReady: true };
  await writeQueueJson(path.join(queueDir, `${params.queueId}.json`), ready);
  await fs.rm(staged, { force: true });
}

export async function sendAcceptedArtifactBridge(params: {
  snapshot: QueuedDelivery;
  queueStateDir: string;
  cfg: OpenBotConfig;
  deps?: OutboundSendDeps;
  /**
   * Must run inside the intent lock, re-read the queue file, and ignore the
   * scan snapshot for channel, target, and payload.
   */
  claim: (
    recheck: (intent: {
      normalizedTarget: { channel: string; accountId: string | null; to: string };
      linkedContentSha256: string;
    }) => Promise<"proceed" | "stop" | "block">,
  ) => Promise<{ ok: boolean; send?: boolean; blocked?: boolean }>;
  recordReceipt: (messageIds: string[]) => Promise<void>;
  recordUnknown: () => Promise<void>;
}): Promise<BridgeSendOutcome> {
  const held: { entry: QueuedDelivery | null } = { entry: null };
  const claimed = await params.claim(async (intent) => {
    const fresh = await readQueueEntry(params.queueStateDir, params.snapshot.id);
    held.entry = fresh;
    if (!fresh || fresh.associationReady !== true || !fresh.bridgeMarker) {
      return "stop";
    }
    if (!isEntryEligibleForRecoveryRetry(fresh, Date.now()).eligible) {
      return "stop";
    }
    if (unsupportedPlainTextQueueEntry(fresh)) {
      return "block";
    }
    const account = fresh.accountId ?? null;
    const bound =
      fresh.channel === intent.normalizedTarget.channel &&
      fresh.to === intent.normalizedTarget.to &&
      account === intent.normalizedTarget.accountId &&
      payloadDigest(payloadText(fresh)) === intent.linkedContentSha256 &&
      fresh.bridgeContentSha256 === intent.linkedContentSha256;
    return bound ? "proceed" : "block";
  });
  const fresh = held.entry;
  if (!claimed.ok) {
    return "failed";
  }
  if (claimed.blocked && fresh) {
    await moveToFailed(fresh.id, params.queueStateDir);
    return "failed";
  }
  if (!claimed.send || !fresh) {
    return "deferred";
  }
  const sending = fresh;
  let receipts: unknown;
  try {
    receipts = await deliverOutboundPayloads({
      cfg: params.cfg,
      channel: sending.channel,
      to: sending.to,
      accountId: sending.accountId,
      payloads: sending.payloads,
      deps: params.deps,
      skipQueue: true,
    });
  } catch {
    await params.recordUnknown();
    await moveToFailed(sending.id, params.queueStateDir);
    return "failed";
  }
  const messageIds = confirmedDeliveryMessageIds(receipts);
  if (!messageIds) {
    await params.recordUnknown();
    await moveToFailed(sending.id, params.queueStateDir);
    return "failed";
  }
  try {
    await params.recordReceipt(messageIds);
  } catch {
    await params.recordUnknown();
    await moveToFailed(sending.id, params.queueStateDir);
    return "failed";
  }
  await ackDelivery(sending.id, params.queueStateDir);
  return "recovered";
}

export function bridgePayloadDigest(entry: QueuedDelivery): string {
  return payloadDigest(payloadText(entry));
}
