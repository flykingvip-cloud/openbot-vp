import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FollowupWorkspaceSnapshot } from "../../../auto-reply/reply/followup-workspace-change.js";
import {
  clearFollowupDrainCallback,
  clearFollowupQueue,
  getFollowupQueueDepth,
  kickFollowupDrainIfIdle,
  registerFollowupDrainCallback,
  resetRecentQueuedMessageIdDedupe,
} from "../../../auto-reply/reply/queue.js";
import { createMockTypingController } from "../../../auto-reply/reply/test-helpers.js";
import type { OpenBotConfig } from "../../../config/config.js";
import { confirmAccessReauthorization } from "../../../gateway/access-control/followup-workspace-reauthorization.js";
import {
  claimFollowupRecoveryForResume,
  markFollowupRecoveryDeliveryStarted,
  followupRecoveryClaimBlocksEnqueue,
  findBlockedFollowupDelivery,
  followupDeliveryIdempotencyKey,
  listBlockedFollowupDeliveries,
  listRecoverableFollowupDeliveries,
  markFollowupRecoveryClaimEnqueued,
  recordBlockedFollowupDelivery,
} from "./blocked-followup-delivery.js";

const resolveExecutionWorkspace = vi.fn();
const confirmPendingTurnDelivery = vi.fn();
const peekAwaitingDelivery = vi.fn();
const deliverQueuedReply = vi.fn();
const runQueuedCandidate = vi.fn();

vi.mock("../../../gateway/workspace-resolver/execution-workspace.js", () => ({
  resolveExecutionWorkspace: (...args: unknown[]) => resolveExecutionWorkspace(...args),
}));

vi.mock("../../wiring/delivery-confirm.js", () => ({
  confirmPendingTurnDelivery: (...args: unknown[]) => confirmPendingTurnDelivery(...args),
}));

vi.mock("../../../task-outcome/pending-delivery.js", () => ({
  peekAwaitingDelivery: (...args: unknown[]) => peekAwaitingDelivery(...args),
}));

vi.mock("../../delivery/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../delivery/index.js")>();
  return {
    ...actual,
    deliverQueuedReply: (...args: unknown[]) => deliverQueuedReply(...args),
  };
});

vi.mock("../../execution/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../execution/index.js")>();
  return {
    ...actual,
    runQueuedCandidate: (...args: unknown[]) => runQueuedCandidate(...args),
  };
});

const { createFollowupRunner } = await import("../../../auto-reply/reply/followup-runner.js");
const { recoverFollowupWorkspaceWaitsAtGatewayBoot, resumeFollowupDeliveryAfterReauthorization } =
  await import("./blocked-followup-delivery-recovery.js");

const RESOURCE = "ws:tenant:seat:seat:asset:asset";
const tempRoots: string[] = [];
const sessionKeys: string[] = [];

function makePersistRoot(): {
  persistRoot: string;
  sessionFile: string;
  workspaceDir: string;
  sessionKey: string;
} {
  const persistRoot = fs.mkdtempSync(path.join(os.tmpdir(), "t171-followup-wait-"));
  tempRoots.push(persistRoot);
  const workspaceDir = fs.realpathSync(persistRoot);
  const sessionFile = path.join(persistRoot, "session.jsonl");
  fs.writeFileSync(sessionFile, "");
  const sessionKey = `t172-followup-wait-recovery:${randomUUID()}`;
  sessionKeys.push(sessionKey);
  return { persistRoot, sessionFile, workspaceDir, sessionKey };
}

function binding(workspaceDir: string, overrides: Partial<FollowupWorkspaceSnapshot> = {}) {
  return {
    resourceId: RESOURCE,
    bindingId: "binding",
    contentVersion: "2",
    workspaceDir,
    tenantId: "tenant",
    owner: { kind: "position" as const, seatId: "seat" },
    lifecycleState: "active",
    bindingState: "active",
    ...overrides,
  };
}

function writeWaitRecord(params: {
  persistRoot: string;
  sessionFile: string;
  workspaceDir: string;
  status?: "recoverable_wait" | "reauthorization_required";
  reason?: string;
  retryCount?: number;
  retryCap?: number;
  retryExhausted?: boolean;
  missingItems?: string[];
  ownerSeatId?: string;
  reauthorization?: { kind: "tenant" | "owner" | "permission"; detail: string };
  sessionKey: string;
}) {
  const dir = path.join(params.persistRoot, "blocked-followup-deliveries");
  fs.mkdirSync(dir, { recursive: true });
  const id = "wait-record-1";
  const status = params.status ?? "recoverable_wait";
  const sessionKey = params.sessionKey;
  const record = {
    kind: "blocked_followup_delivery",
    id,
    recordedAtMs: Date.now(),
    updatedAtMs: Date.now(),
    status,
    destination: status,
    reason: params.reason ?? "followup_workspace_recoverable_wait:missing_evidence",
    error: params.reason ?? "followup_workspace_recoverable_wait:missing_evidence",
    missingItems: params.missingItems ?? ["verified_migration_receipt"],
    retryCount: params.retryCount ?? 0,
    retryCap: params.retryCap ?? 5,
    retryExhausted: params.retryExhausted ?? false,
    sessionKey,
    sessionFile: params.sessionFile,
    jobId: "job-1",
    runId: "run-1",
    deliveryId: "delivery:run-1:visible",
    taskId: "task-1",
    workspaceBinding: binding(params.workspaceDir, {
      owner: { kind: "position", seatId: params.ownerSeatId ?? "seat" },
    }),
    ...(params.reauthorization ? { reauthorization: params.reauthorization } : {}),
    resume: {
      deliveryOnly: true,
      payloads: [{ text: "original visible reply" }],
      agentId: "robot",
      agentDir: params.persistRoot,
      sessionId: "session",
      sessionKey,
      sessionFile: params.sessionFile,
      workspaceDir: params.workspaceDir,
      prompt: "hello",
      originatingTo: "channel:C1",
      provider: "anthropic",
      model: "claude",
      asyncWaitRecoveryBind: {
        jobId: "job-1",
        claimToken: "token-1",
        boundRunId: "run-1",
        boundDeliveryId: "delivery:run-1:visible",
      },
    },
  };
  fs.writeFileSync(
    path.join(dir, `${encodeURIComponent(id)}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  return record;
}

function currentWorkspace(workspaceDir: string, overrides: Record<string, unknown> = {}) {
  return {
    resourceId: RESOURCE,
    bindingId: "binding",
    contentVersion: "2",
    rootPath: workspaceDir,
    tenantId: "tenant",
    owner: { kind: "position" as const, seatId: "seat" },
    lifecycleState: "active",
    bindingState: "active",
    ...overrides,
  };
}

function registerRunner(sessionKey: string) {
  const typing = createMockTypingController();
  const runner = createFollowupRunner({
    typing,
    typingMode: "never",
    defaultModel: "anthropic/claude-opus-4-5",
    sessionKey,
  });
  registerFollowupDrainCallback(sessionKey, runner);
  return { typing, runner };
}

async function waitFor(predicate: () => boolean, timeoutMs = 8000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timed out waiting for followup wait recovery");
}

beforeEach(() => {
  resolveExecutionWorkspace.mockReset();
  confirmPendingTurnDelivery.mockReset();
  confirmPendingTurnDelivery.mockResolvedValue(undefined);
  peekAwaitingDelivery.mockReset();
  peekAwaitingDelivery.mockReturnValue({
    runId: "run-1",
    deliveryId: "delivery:run-1:visible",
    taskId: "task-1",
  });
  deliverQueuedReply.mockReset();
  deliverQueuedReply.mockResolvedValue("delivered");
  runQueuedCandidate.mockReset();
  resetRecentQueuedMessageIdDedupe();
  for (const key of sessionKeys) {
    clearFollowupQueue(key);
    clearFollowupDrainCallback(key);
  }
});

afterEach(() => {
  resetRecentQueuedMessageIdDedupe();
  for (const key of sessionKeys.splice(0)) {
    clearFollowupQueue(key);
    clearFollowupDrainCallback(key);
  }
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it("recovers a durable wait through restart scan, revalidation, re-enqueue, original delivery, and record update", async () => {
  const { persistRoot, sessionFile, workspaceDir, sessionKey } = makePersistRoot();
  writeWaitRecord({ persistRoot, sessionFile, workspaceDir, sessionKey });
  const rawFound = JSON.parse(
    fs.readFileSync(
      path.join(persistRoot, "blocked-followup-deliveries", "wait-record-1.json"),
      "utf8",
    ),
  );
  expect(rawFound.status).toBe("recoverable_wait");
  expect(listRecoverableFollowupDeliveries(persistRoot)).toHaveLength(1);
  expect(findBlockedFollowupDelivery(persistRoot, { runId: "run-1", jobId: "job-1" })?.id).toBe(
    "wait-record-1",
  );

  resolveExecutionWorkspace.mockResolvedValue(
    currentWorkspace(workspaceDir, { contentVersion: "3" }),
  );
  registerRunner(sessionKey);
  const result = await recoverFollowupWorkspaceWaitsAtGatewayBoot({
    cfg: {} as OpenBotConfig,
    persistRoots: [persistRoot],
  });
  expect(result.recordsSeen).toBe(1);
  expect(result.enqueued).toBe(1);
  expect(resolveExecutionWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({ operation: "read", agentId: "robot" }),
  );

  await waitFor(() => deliverQueuedReply.mock.calls.length === 1);
  expect(deliverQueuedReply).toHaveBeenCalledWith(
    expect.objectContaining({
      payloads: [expect.objectContaining({ text: "original visible reply" })],
    }),
    expect.anything(),
  );
  expect(runQueuedCandidate).not.toHaveBeenCalled();
  await waitFor(() => {
    const row = findBlockedFollowupDelivery(persistRoot, { id: "wait-record-1" });
    return row?.status === "continued";
  });
  const continued = findBlockedFollowupDelivery(persistRoot, { id: "wait-record-1" });
  expect(continued).toMatchObject({
    status: "continued",
    destination: "continue",
    contentVersionChange: { from: "2", to: "3" },
  });
  expect(listRecoverableFollowupDeliveries(persistRoot)).toHaveLength(0);
});

it("keeps waiting, records pending items, and increments retry when evidence is still missing", async () => {
  const { persistRoot, sessionFile, workspaceDir, sessionKey } = makePersistRoot();
  writeWaitRecord({ persistRoot, sessionFile, workspaceDir, sessionKey, retryCount: 1 });
  resolveExecutionWorkspace.mockResolvedValue(
    currentWorkspace(workspaceDir, { bindingId: "binding-rotated", contentVersion: "9" }),
  );
  registerRunner(sessionKey);
  const result = await recoverFollowupWorkspaceWaitsAtGatewayBoot({
    cfg: {} as OpenBotConfig,
    persistRoots: [persistRoot],
  });
  expect(result.enqueued).toBe(0);
  expect(result.stillWaiting).toBe(1);
  expect(deliverQueuedReply).not.toHaveBeenCalled();
  const waiting = findBlockedFollowupDelivery(persistRoot, { id: "wait-record-1" });
  expect(waiting).toMatchObject({
    status: "recoverable_wait",
    retryCount: 2,
    retryExhausted: false,
  });
  expect(waiting?.missingItems).toEqual(expect.arrayContaining(["verified_migration_receipt"]));
  expect(listRecoverableFollowupDeliveries(persistRoot)).toHaveLength(1);
});

it("stops auto-retry at the cap and leaves the wait record queryable", async () => {
  const { persistRoot, sessionFile, workspaceDir, sessionKey } = makePersistRoot();
  writeWaitRecord({
    persistRoot,
    sessionFile,
    workspaceDir,
    sessionKey,
    retryCount: 5,
    retryCap: 5,
    retryExhausted: true,
  });
  resolveExecutionWorkspace.mockResolvedValue(
    currentWorkspace(workspaceDir, { bindingId: "binding-rotated", contentVersion: "9" }),
  );
  registerRunner(sessionKey);
  const result = await recoverFollowupWorkspaceWaitsAtGatewayBoot({
    cfg: {} as OpenBotConfig,
    persistRoots: [persistRoot],
  });
  expect(result.enqueued).toBe(0);
  expect(result.retryExhausted).toBe(1);
  expect(deliverQueuedReply).not.toHaveBeenCalled();
  const held = findBlockedFollowupDelivery(persistRoot, { id: "wait-record-1" });
  expect(held).toMatchObject({
    status: "recoverable_wait",
    retryCount: 5,
    retryCap: 5,
    retryExhausted: true,
  });
  expect(listRecoverableFollowupDeliveries(persistRoot)).toHaveLength(1);
  expect(listBlockedFollowupDeliveries(persistRoot)).toHaveLength(1);
});

it("resumes the original delivery from the reauthorization entry only when authorization evidence is present", async () => {
  const { persistRoot, sessionFile, workspaceDir, sessionKey } = makePersistRoot();
  writeWaitRecord({
    persistRoot,
    sessionFile,
    workspaceDir,
    sessionKey,
    status: "reauthorization_required",
    reason: "followup_workspace_reauthorization_required:owner",
    reauthorization: {
      kind: "owner",
      detail: "Workspace ownership changed; reauthorization is required before continuing.",
    },
    ownerSeatId: "seat",
  });
  resolveExecutionWorkspace.mockResolvedValue(
    currentWorkspace(workspaceDir, { owner: { kind: "position", seatId: "other-seat" } }),
  );

  const denied = await resumeFollowupDeliveryAfterReauthorization({
    persistRoot,
    id: "wait-record-1",
    cfg: {} as OpenBotConfig,
    authorization: null,
  });
  expect(denied).toMatchObject({
    ok: false,
    enqueued: false,
    reason: "followup_reauthorization:authorization_evidence_missing",
  });
  expect(deliverQueuedReply).not.toHaveBeenCalled();
  expect(findBlockedFollowupDelivery(persistRoot, { id: "wait-record-1" })?.status).toBe(
    "reauthorization_required",
  );

  const boot = await recoverFollowupWorkspaceWaitsAtGatewayBoot({
    cfg: {} as OpenBotConfig,
    persistRoots: [persistRoot],
  });
  expect(boot.enqueued).toBe(0);
  expect(deliverQueuedReply).not.toHaveBeenCalled();

  registerRunner(sessionKey);
  const resumed = await resumeFollowupDeliveryAfterReauthorization({
    persistRoot,
    id: "wait-record-1",
    cfg: {} as OpenBotConfig,
    authorization: {
      kind: "owner",
      actorIdentity: "user:owner:reauth-grant",
      grantedAtMs: Date.now(),
    },
  });
  expect(resumed).toMatchObject({ ok: true, enqueued: true });
  kickFollowupDrainIfIdle(sessionKey);
  await waitFor(() => deliverQueuedReply.mock.calls.length === 1);
  expect(deliverQueuedReply).toHaveBeenCalledWith(
    expect.objectContaining({
      payloads: [expect.objectContaining({ text: "original visible reply" })],
    }),
    expect.anything(),
  );
  expect(runQueuedCandidate).not.toHaveBeenCalled();
  await waitFor(() => {
    const row = findBlockedFollowupDelivery(persistRoot, { id: "wait-record-1" });
    return row?.status === "continued";
  });
  expect(findBlockedFollowupDelivery(persistRoot, { id: "wait-record-1" })).toMatchObject({
    status: "continued",
    destination: "continue",
  });
});

it("resumes through the access-control plane only when a grant is present", async () => {
  const { persistRoot, sessionFile, workspaceDir, sessionKey } = makePersistRoot();
  writeWaitRecord({
    persistRoot,
    sessionFile,
    workspaceDir,
    sessionKey,
    status: "reauthorization_required",
    reason: "followup_workspace_reauthorization_required:owner",
    reauthorization: {
      kind: "owner",
      detail: "Workspace ownership changed; reauthorization is required before continuing.",
    },
    ownerSeatId: "seat",
  });
  resolveExecutionWorkspace.mockResolvedValue(
    currentWorkspace(workspaceDir, { owner: { kind: "position", seatId: "other-seat" } }),
  );

  const denied = await confirmAccessReauthorization({
    persistRoot,
    id: "wait-record-1",
    cfg: {} as OpenBotConfig,
    authorization: null,
  });
  expect(denied).toMatchObject({
    ok: false,
    enqueued: false,
    reason: "followup_reauthorization:authorization_evidence_missing",
  });
  expect(deliverQueuedReply).not.toHaveBeenCalled();
  expect(findBlockedFollowupDelivery(persistRoot, { id: "wait-record-1" })?.status).toBe(
    "reauthorization_required",
  );

  const boot = await recoverFollowupWorkspaceWaitsAtGatewayBoot({
    cfg: {} as OpenBotConfig,
    persistRoots: [persistRoot],
  });
  expect(boot.enqueued).toBe(0);
  expect(deliverQueuedReply).not.toHaveBeenCalled();

  registerRunner(sessionKey);
  const resumed = await confirmAccessReauthorization({
    persistRoot,
    id: "wait-record-1",
    cfg: {} as OpenBotConfig,
    authorization: {
      kind: "owner",
      actorIdentity: "user:owner:reauth-grant",
      grantedAtMs: Date.now(),
    },
  });
  expect(resumed).toMatchObject({ ok: true, enqueued: true });
  kickFollowupDrainIfIdle(sessionKey);
  await waitFor(() => deliverQueuedReply.mock.calls.length === 1);
  expect(deliverQueuedReply).toHaveBeenCalledWith(
    expect.objectContaining({
      payloads: [expect.objectContaining({ text: "original visible reply" })],
    }),
    expect.anything(),
  );
  expect(runQueuedCandidate).not.toHaveBeenCalled();
  await waitFor(() => {
    const row = findBlockedFollowupDelivery(persistRoot, { id: "wait-record-1" });
    return row?.status === "continued";
  });
  expect(findBlockedFollowupDelivery(persistRoot, { id: "wait-record-1" })).toMatchObject({
    status: "continued",
    destination: "continue",
  });
});

it("does not send twice when a second scan or restart happens before the record is marked continued", async () => {
  const { persistRoot, sessionFile, workspaceDir, sessionKey } = makePersistRoot();
  writeWaitRecord({ persistRoot, sessionFile, workspaceDir, sessionKey });
  resolveExecutionWorkspace.mockResolvedValue(
    currentWorkspace(workspaceDir, { contentVersion: "3" }),
  );

  const first = await recoverFollowupWorkspaceWaitsAtGatewayBoot({
    cfg: {} as OpenBotConfig,
    persistRoots: [persistRoot],
  });
  expect(first.enqueued).toBe(1);
  expect(deliverQueuedReply).not.toHaveBeenCalled();
  const claimed = findBlockedFollowupDelivery(persistRoot, { id: "wait-record-1" });
  expect(claimed?.status).toBe("recoverable_wait");
  expect(claimed?.claim?.stage).toBe("enqueued");
  expect(claimed?.deliveryIdempotencyKey).toBe(followupDeliveryIdempotencyKey(claimed!));
  expect(claimed?.deliveryIdempotencyKey).not.toMatch(/:r\d+$/);
  expect(getFollowupQueueDepth(sessionKey)).toBe(1);

  resetRecentQueuedMessageIdDedupe();
  clearFollowupQueue(sessionKey);
  expect(getFollowupQueueDepth(sessionKey)).toBe(0);

  const second = await recoverFollowupWorkspaceWaitsAtGatewayBoot({
    cfg: {} as OpenBotConfig,
    persistRoots: [persistRoot],
  });
  expect(second.enqueued).toBe(1);
  expect(getFollowupQueueDepth(sessionKey)).toBe(0);
  expect(deliverQueuedReply).not.toHaveBeenCalled();
  expect(findBlockedFollowupDelivery(persistRoot, { id: "wait-record-1" })?.status).toBe(
    "recoverable_wait",
  );
  expect(findBlockedFollowupDelivery(persistRoot, { id: "wait-record-1" })?.retryCount).toBe(
    claimed?.retryCount,
  );
});

it("does not send again after a successful delivery and a later recovery scan", async () => {
  const { persistRoot, sessionFile, workspaceDir, sessionKey } = makePersistRoot();
  writeWaitRecord({ persistRoot, sessionFile, workspaceDir, sessionKey });
  resolveExecutionWorkspace.mockResolvedValue(
    currentWorkspace(workspaceDir, { contentVersion: "3" }),
  );
  registerRunner(sessionKey);
  const first = await recoverFollowupWorkspaceWaitsAtGatewayBoot({
    cfg: {} as OpenBotConfig,
    persistRoots: [persistRoot],
  });
  expect(first.enqueued).toBe(1);
  await waitFor(() => deliverQueuedReply.mock.calls.length === 1);
  await waitFor(() => {
    const row = findBlockedFollowupDelivery(persistRoot, { id: "wait-record-1" });
    return row?.status === "continued";
  });

  resetRecentQueuedMessageIdDedupe();
  clearFollowupQueue(sessionKey);
  const second = await recoverFollowupWorkspaceWaitsAtGatewayBoot({
    cfg: {} as OpenBotConfig,
    persistRoots: [persistRoot],
  });
  expect(second.enqueued).toBe(0);
  expect(deliverQueuedReply).toHaveBeenCalledTimes(1);
  expect(runQueuedCandidate).not.toHaveBeenCalled();
  expect(findBlockedFollowupDelivery(persistRoot, { id: "wait-record-1" })?.status).toBe(
    "continued",
  );
});

it("does not let mark-enqueued or a later wait write regress a continued delivery", async () => {
  const { persistRoot, sessionFile, workspaceDir, sessionKey } = makePersistRoot();
  writeWaitRecord({ persistRoot, sessionFile, workspaceDir, sessionKey });
  const current = findBlockedFollowupDelivery(persistRoot, { id: "wait-record-1" });
  expect(current).toBeTruthy();
  const claimed = await claimFollowupRecoveryForResume({ persistRoot, record: current! });
  expect(claimed.ok).toBe(true);
  if (!claimed.ok) {
    return;
  }

  await Promise.all([
    recordBlockedFollowupDelivery({
      persistRoot,
      id: "wait-record-1",
      reason: "followup_workspace_continue:content_version",
      error: "followup_workspace_continue:content_version",
      status: "continued",
      destination: "continue",
      sessionKey,
      sessionFile,
      contentVersionChange: { from: "2", to: "3" },
    }),
    markFollowupRecoveryClaimEnqueued({
      persistRoot,
      record: claimed.record,
      claimToken: claimed.claimToken,
    }),
  ]);
  expect(findBlockedFollowupDelivery(persistRoot, { id: "wait-record-1" })?.status).toBe(
    "continued",
  );

  await recordBlockedFollowupDelivery({
    persistRoot,
    id: "wait-record-1",
    reason: "followup_workspace_recoverable_wait:resume_enqueue_failed",
    error: "followup_workspace_recoverable_wait:resume_enqueue_failed",
    status: "recoverable_wait",
    destination: "recoverable_wait",
    sessionKey,
    sessionFile,
  });
  expect(findBlockedFollowupDelivery(persistRoot, { id: "wait-record-1" })).toMatchObject({
    status: "continued",
    destination: "continue",
  });
});

it("keeps an ambiguous pre-send fence held after process death instead of replaying", async () => {
  const { persistRoot, sessionFile, workspaceDir, sessionKey } = makePersistRoot();
  writeWaitRecord({ persistRoot, sessionFile, workspaceDir, sessionKey });
  const record = findBlockedFollowupDelivery(persistRoot, { id: "wait-record-1" })!;
  const started = await markFollowupRecoveryDeliveryStarted({ persistRoot, record });
  expect(started.status).not.toBe("continued");
  const restarted = findBlockedFollowupDelivery(persistRoot, { id: record.id })!;
  restarted.claim!.holderPid = 2147483647;
  expect(followupRecoveryClaimBlocksEnqueue(restarted, Date.now() + 86400000)).toBe(true);
  await expect(
    markFollowupRecoveryDeliveryStarted({ persistRoot, record: restarted }),
  ).rejects.toThrow("receipt_reconciliation");
});
