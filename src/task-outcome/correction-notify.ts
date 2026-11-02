/**
 * Correction notice for one already-landed correction version.
 * Automatic delivery is off. This is not a queue and does not use
 * pending-delivery or the TaskOutcome outbox.
 * mappingVerified is not authorization. The recipient must be the subject
 * stored on that correction version. A wrong mapping fails closed.
 * Dedup is a locked file scoped by tenant, agent, task, and version.
 * There is no production outbound channel here; send stays injected.
 */
import path from "node:path";
import type { OpenBotConfig } from "../config/config.js";
import {
  readDurableJson,
  withDurableJsonLock,
  writeDurableJsonAtomic,
} from "./durable-json-file.js";
import { callerOwnsTaskOutcome, resolveConfiguredTaskOutcomeRoot } from "./reject-result.js";
import { DurableTaskOutcomeStore, boundedOutcomePathSegment } from "./store.js";
import { normalizeTaskOutcomeSubjectRef } from "./subject-ref.js";
import type { TaskOutcomeRecord, TrustedScope } from "./types.js";

export const CORRECTION_NOTIFY_ENABLED = false;

const FORBIDDEN_RECIPIENTS = new Set(["agent:main:main", "diagnosis:canary:daibai"]);

export type CorrectionNotifySend = (input: {
  platformUserId: string;
  text: string;
}) => { accepted: boolean } | Promise<{ accepted: boolean }>;

export type CorrectionNotifyResult =
  | {
      ok: true;
      replayed: boolean;
      accepted: boolean;
      read: false;
      text: string;
    }
  | {
      ok: false;
      code:
        | "not_enabled"
        | "not_a_correction"
        | "recipient_unresolved"
        | "delivery_failed"
        | "storage_failed";
    };

type Receipt = {
  tenantScope: string;
  agentId: string;
  taskId: string;
  outcomeVersion: number;
  platformUserId: string;
};

type ReceiptFile = {
  schemaVersion: 1;
  receipts: Receipt[];
};

export function correctionNotifyText(input: {
  taskId: string;
  negatedOutcomeVersion: number;
  correctionOutcomeVersion: number;
  judgement: string;
}): string {
  return [
    `任务 ${input.taskId}`,
    `被否定版本 ${input.negatedOutcomeVersion}`,
    `纠正版本 ${input.correctionOutcomeVersion}`,
    `判定 ${input.judgement}`,
    "这是纠正记录，不是重新执行。",
  ].join("\n");
}

function tenantScopeOf(scope: TrustedScope): string {
  if (scope.kind === "enterprise") {
    return `tenant:${scope.tenantId}`;
  }
  return scope.personalDomainId;
}

function receiptPath(rootDir: string, agentId: string): string {
  return path.join(rootDir, "correction-notify", `${boundedOutcomePathSegment(agentId)}.json`);
}

function sameReceipt(row: Receipt, next: Receipt): boolean {
  return (
    row.tenantScope === next.tenantScope &&
    row.agentId === next.agentId &&
    row.taskId === next.taskId &&
    row.outcomeVersion === next.outcomeVersion &&
    row.platformUserId === next.platformUserId
  );
}

function parseReceipts(value: unknown): Receipt[] | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || !Array.isArray(record.receipts)) {
    return null;
  }
  const receipts: Receipt[] = [];
  for (const row of record.receipts) {
    if (!row || typeof row !== "object") {
      return null;
    }
    const item = row as Record<string, unknown>;
    const tenantScope = typeof item.tenantScope === "string" ? item.tenantScope.trim() : "";
    const agentId = typeof item.agentId === "string" ? item.agentId.trim() : "";
    const taskId = typeof item.taskId === "string" ? item.taskId.trim() : "";
    const platformUserId =
      typeof item.platformUserId === "string" ? item.platformUserId.trim() : "";
    const outcomeVersion = item.outcomeVersion;
    if (!tenantScope || !agentId || !taskId || !platformUserId) {
      return null;
    }
    if (
      typeof outcomeVersion !== "number" ||
      !Number.isInteger(outcomeVersion) ||
      outcomeVersion < 1
    ) {
      return null;
    }
    receipts.push({ tenantScope, agentId, taskId, outcomeVersion, platformUserId });
  }
  return receipts;
}

async function invokeSend(
  send: CorrectionNotifySend | undefined,
  input: { platformUserId: string; text: string },
): Promise<{ ok: true; accepted: boolean } | { ok: false }> {
  if (!send) {
    return { ok: true, accepted: false };
  }
  try {
    const result = await send(input);
    return { ok: true, accepted: result.accepted };
  } catch {
    return { ok: false };
  }
}

function correctionFactsMatch(
  snap: TaskOutcomeRecord,
  input: {
    taskId: string;
    negatedOutcomeVersion: number;
    correctionOutcomeVersion: number;
    judgement: string;
    revisionKind?: string;
  },
): boolean {
  if (snap.revisionKind !== "correction") {
    return false;
  }
  if (input.revisionKind !== undefined && input.revisionKind !== "correction") {
    return false;
  }
  if (snap.taskId !== input.taskId) {
    return false;
  }
  if (snap.outcomeVersion !== input.correctionOutcomeVersion) {
    return false;
  }
  if (snap.previousOutcomeVersion !== input.negatedOutcomeVersion) {
    return false;
  }
  if (snap.taskJudgement !== input.judgement) {
    return false;
  }
  return true;
}

function assertJudgementUnchanged(params: {
  rootDir: string;
  taskId: string;
  outcomeVersion: number;
  judgement: string;
  tipVersion: number;
}): void {
  const store = new DurableTaskOutcomeStore(params.rootDir);
  try {
    const snap = store.loadTaskVersion(params.taskId, params.outcomeVersion);
    const tip = store.loadTask(params.taskId);
    if (
      !snap ||
      snap.taskJudgement !== params.judgement ||
      !tip ||
      tip.outcomeVersion !== params.tipVersion ||
      tip.taskJudgement !== params.judgement
    ) {
      throw new Error("correction notice changed the authoritative judgement");
    }
  } finally {
    store.close();
  }
}

export async function deliverCorrectionNotice(input: {
  enabled?: boolean;
  cfg: OpenBotConfig;
  agentId: string;
  taskId: string;
  negatedOutcomeVersion: number;
  correctionOutcomeVersion: number;
  judgement: string;
  revisionKind?: string;
  subjectRef?: string;
  callerTenantId?: string | null;
  verifiedPlatformUserId?: string;
  /** Ignored as authorization. Kept so callers cannot treat a boolean as the mapping. */
  mappingVerified?: boolean;
  send?: CorrectionNotifySend;
}): Promise<CorrectionNotifyResult> {
  const enabled = input.enabled ?? CORRECTION_NOTIFY_ENABLED;
  if (!enabled) {
    return { ok: false, code: "not_enabled" };
  }
  const agentId = input.agentId.trim();
  const taskId = input.taskId.trim();
  const located = agentId
    ? resolveConfiguredTaskOutcomeRoot(input.cfg, agentId)
    : { ok: false as const, code: "agent_unresolved" as const };
  if (!located.ok) {
    return { ok: false, code: "recipient_unresolved" };
  }
  const store = new DurableTaskOutcomeStore(located.root);
  let snap: TaskOutcomeRecord | undefined;
  let tipVersion = 0;
  try {
    snap = store.loadTaskVersion(taskId, input.correctionOutcomeVersion);
    tipVersion = store.loadTask(taskId)?.outcomeVersion ?? 0;
  } finally {
    store.close();
  }
  if (!snap || !correctionFactsMatch(snap, { ...input, taskId })) {
    return { ok: false, code: "not_a_correction" };
  }
  const callerSubjectRef = normalizeTaskOutcomeSubjectRef(input.subjectRef);
  const platformUserId = input.verifiedPlatformUserId?.trim() ?? "";
  if (
    !callerOwnsTaskOutcome({
      scope: snap.scope,
      callerSubjectRef,
      callerTenantId: input.callerTenantId,
    }) ||
    !platformUserId ||
    platformUserId !== snap.scope.subjectRef ||
    FORBIDDEN_RECIPIENTS.has(platformUserId)
  ) {
    assertJudgementUnchanged({
      rootDir: located.root,
      taskId,
      outcomeVersion: snap.outcomeVersion,
      judgement: snap.taskJudgement,
      tipVersion,
    });
    return { ok: false, code: "recipient_unresolved" };
  }
  const text = correctionNotifyText({
    taskId: snap.taskId,
    negatedOutcomeVersion: snap.previousOutcomeVersion ?? input.negatedOutcomeVersion,
    correctionOutcomeVersion: snap.outcomeVersion,
    judgement: snap.taskJudgement,
  });
  const receipt: Receipt = {
    tenantScope: tenantScopeOf(snap.scope),
    agentId,
    taskId: snap.taskId,
    outcomeVersion: snap.outcomeVersion,
    platformUserId,
  };
  const filePath = receiptPath(located.root, agentId);
  let result: CorrectionNotifyResult;
  try {
    result = await withDurableJsonLock(filePath, async () => {
      const loaded = await readDurableJson(filePath);
      if (!loaded.ok) {
        return { ok: false, code: "storage_failed" };
      }
      const existing = loaded.missing ? [] : parseReceipts(loaded.value);
      if (!existing) {
        return { ok: false, code: "storage_failed" };
      }
      if (existing.some((row) => sameReceipt(row, receipt))) {
        return { ok: true, replayed: true, accepted: true, read: false, text };
      }
      const sent = await invokeSend(input.send, { platformUserId, text });
      if (!sent.ok) {
        return { ok: false, code: "delivery_failed" };
      }
      if (!sent.accepted) {
        return { ok: true, replayed: false, accepted: false, read: false, text };
      }
      const next: ReceiptFile = {
        schemaVersion: 1,
        receipts: [...existing, receipt],
      };
      await writeDurableJsonAtomic(filePath, next);
      return { ok: true, replayed: false, accepted: true, read: false, text };
    });
  } catch {
    result = { ok: false, code: "storage_failed" };
  }
  assertJudgementUnchanged({
    rootDir: located.root,
    taskId,
    outcomeVersion: snap.outcomeVersion,
    judgement: snap.taskJudgement,
    tipVersion,
  });
  return result;
}

/** Automatic path. Stays off until CORRECTION_NOTIFY_ENABLED is changed. */
export function maybeNotifyLandedCorrection(
  input: Omit<Parameters<typeof deliverCorrectionNotice>[0], "enabled">,
): Promise<CorrectionNotifyResult> {
  return deliverCorrectionNotice({ ...input, enabled: CORRECTION_NOTIFY_ENABLED });
}
