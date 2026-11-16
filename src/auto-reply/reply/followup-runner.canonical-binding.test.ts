import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  findBlockedFollowupDelivery,
  listBlockedFollowupDeliveries,
  listRecoverableFollowupDeliveries,
  planFollowupRecoveryRetry,
} from "../../agent-runtime/state/repository/blocked-followup-delivery.js";
import { drainNextQueueItem } from "../../utils/queue-helpers.js";
import type { VerifiedMigrationReceiptEvidence } from "./followup-workspace-change.js";
import type { FollowupRun } from "./queue.js";
import { createMockTypingController } from "./test-helpers.js";

const resolveExecutionWorkspace = vi.fn();
const confirmPendingTurnDelivery = vi.fn();
const peekAwaitingDelivery = vi.fn();
const deliverQueuedReply = vi.fn();
const loadFollowupRevalidationEvidence = vi.fn();
const runQueuedCandidate = vi.fn();

vi.mock("../../gateway/workspace-resolver/execution-workspace.js", () => ({
  resolveExecutionWorkspace: (...args: unknown[]) => resolveExecutionWorkspace(...args),
}));

vi.mock("../../agent-runtime/wiring/delivery-confirm.js", () => ({
  confirmPendingTurnDelivery: (...args: unknown[]) => confirmPendingTurnDelivery(...args),
}));

vi.mock("../../task-outcome/pending-delivery.js", () => ({
  peekAwaitingDelivery: (...args: unknown[]) => peekAwaitingDelivery(...args),
}));

vi.mock("../../agent-runtime/delivery/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../agent-runtime/delivery/index.js")>();
  return {
    ...actual,
    deliverQueuedReply: (...args: unknown[]) => deliverQueuedReply(...args),
  };
});

vi.mock("../../agent-runtime/execution/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../agent-runtime/execution/index.js")>();
  return {
    ...actual,
    runQueuedCandidate: (...args: unknown[]) => runQueuedCandidate(...args),
  };
});

vi.mock("./followup-workspace-change.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./followup-workspace-change.js")>();
  return {
    ...actual,
    loadFollowupRevalidationEvidence: (...args: unknown[]) =>
      loadFollowupRevalidationEvidence(...args),
  };
});

const { createFollowupRunner } = await import("./followup-runner.js");

const ROOT_ALIAS = path.resolve("/tmp/canonical-followup-root");
fs.mkdirSync(ROOT_ALIAS, { recursive: true });
const ROOT = fs.realpathSync(ROOT_ALIAS);
const BINDING = {
  resourceId: "ws:tenant:seat:seat:asset:asset",
  bindingId: "binding",
  contentVersion: "2",
  rootPath: ROOT,
  tenantId: "tenant",
  owner: { kind: "position" as const, seatId: "seat" },
  lifecycleState: "active",
  bindingState: "active" as const,
};

const tempRoots: string[] = [];

function makeSessionFile(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "t170-followup-"));
  tempRoots.push(root);
  return path.join(root, "session.jsonl");
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function queuedRun(
  workspaceDir: string,
  overrides: Partial<Omit<FollowupRun, "run">> & { run?: Partial<FollowupRun["run"]> } = {},
): FollowupRun {
  const base = {
    prompt: "hello",
    summaryLine: "hello",
    enqueuedAt: Date.now(),
    originatingTo: "channel:C1",
    run: {
      sessionId: "session",
      sessionKey: "main",
      agentId: "robot",
      messageProvider: "whatsapp",
      agentAccountId: "primary",
      sessionFile: makeSessionFile(),
      workspaceDir,
      config: {},
      skillsSnapshot: {},
      provider: "anthropic",
      model: "claude",
      thinkLevel: "low",
      verboseLevel: "off",
      elevatedLevel: "off",
      bashElevated: {
        enabled: false,
        allowed: false,
        defaultLevel: "off",
      },
      timeoutMs: 1_000,
      blockReplyBreak: "message_end",
    },
  } as FollowupRun;
  return {
    ...base,
    ...overrides,
    run: {
      ...base.run,
      ...overrides.run,
    },
  };
}

function createRunner() {
  const typing = createMockTypingController();
  return {
    typing,
    runner: createFollowupRunner({
      typing,
      typingMode: "instant",
      defaultModel: "anthropic/claude-opus-4-5",
    }),
  };
}

function queuedBinding() {
  return {
    resourceId: BINDING.resourceId,
    bindingId: BINDING.bindingId,
    contentVersion: BINDING.contentVersion,
    tenantId: BINDING.tenantId,
    owner: BINDING.owner,
    lifecycleState: BINDING.lifecycleState,
    bindingState: BINDING.bindingState,
  };
}

function deliveryOnlyQueued(
  sessionFile: string,
  overrides: Partial<FollowupRun> = {},
): FollowupRun {
  return queuedRun(ROOT, {
    asyncWaitDeliveryOnly: true,
    asyncWaitDeliveryPayloads: [{ text: "original visible reply" }],
    asyncWaitRecoveryBind: {
      jobId: "job-1",
      claimToken: "token-1",
      boundRunId: "run-1",
      boundDeliveryId: "delivery:run-1:visible",
    },
    ...overrides,
    run: {
      sessionFile,
      executionWorkspaceBinding: queuedBinding(),
      ...overrides.run,
    },
  });
}

function mockUnverifiedBindingChange() {
  resolveExecutionWorkspace.mockResolvedValue({
    ...BINDING,
    bindingId: "binding-rotated",
    contentVersion: "9",
  });
}

function readBlockedRecordsFromDisk(persistRoot: string) {
  const dir = path.join(persistRoot, "blocked-followup-deliveries");
  if (!fs.existsSync(dir)) {
    return [];
  }
  const records = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    records.push(JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")));
  }
  return records;
}

beforeEach(() => {
  fs.mkdirSync(ROOT_ALIAS, { recursive: true });
  resolveExecutionWorkspace.mockReset();
  confirmPendingTurnDelivery.mockReset();
  confirmPendingTurnDelivery.mockResolvedValue(undefined);
  peekAwaitingDelivery.mockReset();
  deliverQueuedReply.mockReset();
  deliverQueuedReply.mockResolvedValue("delivered");
  loadFollowupRevalidationEvidence.mockReset();
  loadFollowupRevalidationEvidence.mockResolvedValue({});
  runQueuedCandidate.mockReset();
});

it("puts a path change without a migration receipt into recoverable wait and does not run the followup", async () => {
  resolveExecutionWorkspace.mockResolvedValue(BINDING);
  const sessionFile = makeSessionFile();
  const { runner } = createRunner();
  const queued = queuedRun("/tmp/old-queued-workspace", {
    run: { sessionFile, executionWorkspaceBinding: queuedBinding() },
  });
  const items = [queued];
  await expect(drainNextQueueItem(items, runner)).resolves.toBe(true);
  expect(items).toHaveLength(0);
  expect(runQueuedCandidate).not.toHaveBeenCalled();
  expect(deliverQueuedReply).not.toHaveBeenCalled();
  const found = findBlockedFollowupDelivery(path.dirname(sessionFile), { sessionKey: "main" });
  expect(found).toMatchObject({
    status: "recoverable_wait",
    destination: "recoverable_wait",
  });
  expect(found?.missingItems?.length).toBeGreaterThan(0);
});

it("does not continue or send when the path is unchanged but bindingId changed without a verified migration receipt", async () => {
  mockUnverifiedBindingChange();
  peekAwaitingDelivery.mockReturnValue({
    runId: "run-1",
    deliveryId: "delivery:run-1:visible",
    taskId: "task-1",
  });
  const sessionFile = makeSessionFile();
  const { runner } = createRunner();
  const items = [deliveryOnlyQueued(sessionFile)];
  await expect(drainNextQueueItem(items, runner)).resolves.toBe(true);
  expect(items).toHaveLength(0);
  expect(deliverQueuedReply).not.toHaveBeenCalled();
  expect(runQueuedCandidate).not.toHaveBeenCalled();
  expect(confirmPendingTurnDelivery).not.toHaveBeenCalled();
  const found = findBlockedFollowupDelivery(path.dirname(sessionFile), {
    runId: "run-1",
    jobId: "job-1",
  });
  expect(found).toMatchObject({
    status: "recoverable_wait",
    destination: "recoverable_wait",
    reason: expect.stringMatching(/unverified_binding_change/),
  });
  expect(found?.missingItems).toEqual(expect.arrayContaining(["verified_migration_receipt"]));
});

it("continues a safe-equivalent contentVersion change, records old and new versions, and resends only original payloads", async () => {
  resolveExecutionWorkspace.mockResolvedValue({
    ...BINDING,
    contentVersion: "3",
  });
  peekAwaitingDelivery.mockReturnValue({
    runId: "run-1",
    deliveryId: "delivery:run-1:visible",
    taskId: "task-1",
  });
  const sessionFile = makeSessionFile();
  const persistRoot = path.dirname(sessionFile);
  const { runner } = createRunner();
  const items = [deliveryOnlyQueued(sessionFile)];
  await expect(drainNextQueueItem(items, runner)).resolves.toBe(true);
  expect(items).toHaveLength(0);
  expect(deliverQueuedReply).toHaveBeenCalledTimes(1);
  const delivered = deliverQueuedReply.mock.calls[0]?.[0] as { payloads: Array<{ text?: string }> };
  expect(delivered.payloads).toEqual([{ text: "original visible reply" }]);
  expect(runQueuedCandidate).not.toHaveBeenCalled();
  expect(confirmPendingTurnDelivery).toHaveBeenCalledWith(
    expect.objectContaining({
      runId: "run-1",
      deliveryId: "delivery:run-1:visible",
      status: "delivered",
    }),
  );
  const found = findBlockedFollowupDelivery(persistRoot, { runId: "run-1", jobId: "job-1" });
  expect(found).toMatchObject({
    status: "continued",
    destination: "continue",
    contentVersionChange: { from: "2", to: "3" },
  });
});

it("delivery-only revalidates with read permission and still delivers on a read_only workspace", async () => {
  resolveExecutionWorkspace.mockImplementation(async (params: { operation: "read" | "write" }) => {
    if (params.operation === "write") {
      throw new Error("workspace_binding_required:binding_read_only");
    }
    return { ...BINDING, bindingState: "read_only", lifecycleState: "read_only" };
  });
  peekAwaitingDelivery.mockReturnValue({
    runId: "run-1",
    deliveryId: "delivery:run-1:visible",
    taskId: "task-1",
  });
  const { runner, typing } = createRunner();
  const queued = deliveryOnlyQueued(makeSessionFile());
  await expect(runner(queued)).resolves.toBeUndefined();
  expect(resolveExecutionWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({ operation: "read" }),
  );
  expect(deliverQueuedReply).toHaveBeenCalledTimes(1);
  expect(runQueuedCandidate).not.toHaveBeenCalled();
  expect(confirmPendingTurnDelivery).toHaveBeenCalledWith(
    expect.objectContaining({
      runId: "run-1",
      deliveryId: "delivery:run-1:visible",
      status: "delivered",
    }),
  );
  expect(typing.markRunComplete).toHaveBeenCalled();
  expect(typing.markDispatchIdle).toHaveBeenCalled();
});

it("delivery-only does not demand write permission when an unverified binding change is recorded", async () => {
  resolveExecutionWorkspace.mockImplementation(async (params: { operation: "read" | "write" }) => {
    if (params.operation === "write") {
      throw new Error("workspace_binding_required:binding_read_only");
    }
    return {
      ...BINDING,
      bindingId: "binding-rotated",
      bindingState: "read_only",
    };
  });
  peekAwaitingDelivery.mockReturnValue({
    runId: "run-1",
    deliveryId: "delivery:run-1:visible",
    taskId: "task-1",
  });
  const sessionFile = makeSessionFile();
  const { runner } = createRunner();
  const items = [deliveryOnlyQueued(sessionFile)];
  await expect(drainNextQueueItem(items, runner)).resolves.toBe(true);
  expect(resolveExecutionWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({ operation: "read" }),
  );
  expect(resolveExecutionWorkspace).not.toHaveBeenCalledWith(
    expect.objectContaining({ operation: "write" }),
  );
  expect(deliverQueuedReply).not.toHaveBeenCalled();
  expect(confirmPendingTurnDelivery).not.toHaveBeenCalled();
  expect(findBlockedFollowupDelivery(path.dirname(sessionFile), { runId: "run-1" })).toMatchObject({
    status: "recoverable_wait",
  });
});

it("continues an authorized migration when a complete verify receipt is present, without resending to an unverified binding", async () => {
  const migrated = {
    ...BINDING,
    bindingId: "binding-migrated",
    rootPath: ROOT,
    contentVersion: "4",
  };
  resolveExecutionWorkspace.mockResolvedValue(migrated);
  const verifiedMigration: VerifiedMigrationReceiptEvidence = {
    receiptId: "receipt-1",
    resourceId: BINDING.resourceId,
    tenantId: "tenant",
    passed: true,
    fromBindingId: "binding",
    toBindingId: "binding-migrated",
    fromContentVersion: BINDING.contentVersion,
    toContentVersion: "4",
    fromDirectoryRealpath: ROOT,
    toDirectoryRealpath: ROOT,
    authorizationIdentity: "tenant:tenant:grant:migration-batch-b1",
    operationIdentity: "tenant:tenant:operator:candidate-c1",
    catalogBindingVerified: true,
    ownershipTenantVerified: true,
    artifactSet: [
      { artifactId: BINDING.resourceId, checksum: "sha256:abcd1234abcd1234abcd1234abcd1234" },
    ],
    artifactIdentityVerified: true,
    integrityVerified: true,
  };
  loadFollowupRevalidationEvidence.mockResolvedValue({ verifiedMigration });
  peekAwaitingDelivery.mockReturnValue({
    runId: "run-1",
    deliveryId: "delivery:run-1:visible",
    taskId: "task-1",
  });
  const sessionFile = makeSessionFile();
  const { runner } = createRunner();
  const items = [deliveryOnlyQueued(sessionFile)];
  await expect(drainNextQueueItem(items, runner)).resolves.toBe(true);
  expect(deliverQueuedReply).toHaveBeenCalledTimes(1);
  expect(runQueuedCandidate).not.toHaveBeenCalled();
  expect(findBlockedFollowupDelivery(path.dirname(sessionFile), { runId: "run-1" })).toMatchObject({
    status: "continued",
    destination: "continue",
  });
});

it("denies a cross-tenant current workspace, records the denial, and does not send", async () => {
  resolveExecutionWorkspace.mockResolvedValue({
    ...BINDING,
    resourceId: "ws:other-tenant:seat:seat:asset:asset",
    tenantId: "other-tenant",
  });
  peekAwaitingDelivery.mockReturnValue({
    runId: "run-1",
    deliveryId: "delivery:run-1:visible",
    taskId: "task-1",
  });
  const sessionFile = makeSessionFile();
  const { runner } = createRunner();
  const items = [deliveryOnlyQueued(sessionFile)];
  await expect(drainNextQueueItem(items, runner)).resolves.toBe(true);
  expect(items).toHaveLength(0);
  expect(deliverQueuedReply).not.toHaveBeenCalled();
  expect(runQueuedCandidate).not.toHaveBeenCalled();
  expect(confirmPendingTurnDelivery).toHaveBeenCalledWith(
    expect.objectContaining({
      status: "failed",
      error: expect.stringMatching(/cross_tenant/),
    }),
  );
  expect(findBlockedFollowupDelivery(path.dirname(sessionFile), { runId: "run-1" })).toMatchObject({
    status: "denied",
    destination: "denied",
    reason: expect.stringMatching(/cross_tenant/),
  });
});

it("keeps a recoverable durable record when the failure receipt write throws, and does not send", async () => {
  resolveExecutionWorkspace.mockResolvedValue({
    ...BINDING,
    resourceId: "ws:other-tenant:seat:seat:asset:asset",
    tenantId: "other-tenant",
  });
  peekAwaitingDelivery.mockReturnValue({
    runId: "run-1",
    deliveryId: "delivery:run-1:visible",
    taskId: "task-1",
  });
  confirmPendingTurnDelivery.mockRejectedValue(new Error("receipt write failed"));
  const sessionFile = makeSessionFile();
  const persistRoot = path.dirname(sessionFile);
  const { runner, typing } = createRunner();
  const items = [deliveryOnlyQueued(sessionFile)];
  await expect(drainNextQueueItem(items, runner)).resolves.toBe(true);
  expect(items).toHaveLength(0);
  expect(deliverQueuedReply).not.toHaveBeenCalled();
  expect(confirmPendingTurnDelivery).toHaveBeenCalledTimes(1);
  const found = findBlockedFollowupDelivery(persistRoot, {
    runId: "run-1",
    deliveryId: "delivery:run-1:visible",
  });
  expect(found).toMatchObject({
    kind: "blocked_followup_delivery",
    status: "recoverable_wait",
    destination: "recoverable_wait",
    pendingDestination: "denied",
    reason: "failure_receipt_write_failed",
    runId: "run-1",
    deliveryId: "delivery:run-1:visible",
    taskId: "task-1",
    jobId: "job-1",
    sessionKey: "main",
    error: expect.stringMatching(/cross_tenant/),
    workspaceBinding: expect.objectContaining({
      resourceId: BINDING.resourceId,
      bindingId: BINDING.bindingId,
      contentVersion: BINDING.contentVersion,
      workspaceDir: ROOT,
    }),
  });
  expect(planFollowupRecoveryRetry(found!)).toMatchObject({ action: "revalidate" });
  expect(typing.markRunComplete).toHaveBeenCalled();
  expect(typing.markDispatchIdle).toHaveBeenCalled();
});

it("records a recoverable delivery when runId and deliveryId are missing, and does not send", async () => {
  mockUnverifiedBindingChange();
  peekAwaitingDelivery.mockReturnValue(undefined);
  const sessionFile = makeSessionFile();
  const persistRoot = path.dirname(sessionFile);
  const { runner } = createRunner();
  const items = [
    queuedRun(ROOT, {
      asyncWaitDeliveryOnly: true,
      asyncWaitDeliveryPayloads: [{ text: "original visible reply" }],
      run: {
        sessionFile,
        executionWorkspaceBinding: queuedBinding(),
      },
    }),
  ];
  await expect(drainNextQueueItem(items, runner)).resolves.toBe(true);
  expect(items).toHaveLength(0);
  expect(deliverQueuedReply).not.toHaveBeenCalled();
  expect(confirmPendingTurnDelivery).not.toHaveBeenCalled();
  const found = findBlockedFollowupDelivery(persistRoot, { sessionKey: "main" });
  expect(found).toMatchObject({
    kind: "blocked_followup_delivery",
    status: "recoverable_wait",
    destination: "recoverable_wait",
    reason: expect.stringMatching(/unverified_binding_change/),
    sessionKey: "main",
  });
  expect(found?.runId).toBeUndefined();
  expect(found?.deliveryId).toBeUndefined();
  expect(planFollowupRecoveryRetry(found!)).toMatchObject({ action: "revalidate" });
});

it("can still find a recoverable delivery from disk after a simulated process restart", async () => {
  resolveExecutionWorkspace.mockResolvedValue({
    ...BINDING,
    resourceId: "ws:other-tenant:seat:seat:asset:asset",
    tenantId: "other-tenant",
  });
  peekAwaitingDelivery.mockReturnValue({
    runId: "run-1",
    deliveryId: "delivery:run-1:visible",
    taskId: "task-1",
  });
  confirmPendingTurnDelivery.mockRejectedValue(new Error("receipt write failed"));
  const sessionFile = makeSessionFile();
  const persistRoot = path.dirname(sessionFile);
  const { runner } = createRunner();
  const items = [deliveryOnlyQueued(sessionFile)];
  await expect(drainNextQueueItem(items, runner)).resolves.toBe(true);
  expect(items).toHaveLength(0);
  expect(deliverQueuedReply).not.toHaveBeenCalled();

  const rawDiskRows = readBlockedRecordsFromDisk(persistRoot);
  expect(rawDiskRows).toHaveLength(1);
  expect(rawDiskRows[0]).toMatchObject({
    kind: "blocked_followup_delivery",
    status: "recoverable_wait",
    reason: "failure_receipt_write_failed",
    pendingDestination: "denied",
    runId: "run-1",
    deliveryId: "delivery:run-1:visible",
    jobId: "job-1",
  });

  const reopened = listBlockedFollowupDeliveries(persistRoot);
  expect(reopened).toHaveLength(1);
  expect(findBlockedFollowupDelivery(persistRoot, { runId: "run-1", jobId: "job-1" })).toEqual(
    reopened[0],
  );
  expect(reopened[0]?.id).toBe(rawDiskRows[0]?.id);
  expect(listRecoverableFollowupDeliveries(persistRoot)).toHaveLength(1);
});

it("retains the queue item when even the durable recoverable record cannot be saved, and does not send", async () => {
  resolveExecutionWorkspace.mockResolvedValue({
    ...BINDING,
    resourceId: "ws:other-tenant:seat:seat:asset:asset",
    tenantId: "other-tenant",
  });
  peekAwaitingDelivery.mockReturnValue({
    runId: "run-1",
    deliveryId: "delivery:run-1:visible",
    taskId: "task-1",
  });
  confirmPendingTurnDelivery.mockRejectedValue(new Error("receipt write failed"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "t170-followup-"));
  tempRoots.push(root);
  const notADir = path.join(root, "not-a-dir");
  fs.writeFileSync(notADir, "not a directory");
  const sessionFile = path.join(notADir, "session.jsonl");
  const { runner } = createRunner();
  const items = [deliveryOnlyQueued(sessionFile)];
  await expect(drainNextQueueItem(items, runner)).rejects.toThrow(/cross_tenant/);
  expect(items).toHaveLength(1);
  expect(deliverQueuedReply).not.toHaveBeenCalled();
  expect(listBlockedFollowupDeliveries(path.dirname(sessionFile))).toHaveLength(0);
});
