/**
 * Phase C §8.3 residual — cross-process delivery-close consult/receipt persist.
 *
 * Start-order id: `phase_c_83_cross_process_consult_persist_start_order`
 * Claim ceiling: code-present only. C10 still cannot pass; merge ≠ PASS/GO.
 *
 * OUT (locked): cross-domain write authority; defer-close; closeDeferred:true;
 * enforce; live invoke; Path/Gate; Fabric-on; default-on ENV.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  armCompletionHold,
  buildExecutionPreflight,
  resetCompletionHoldsForTest,
  resetDeliveryArtifactsForTest,
  resetExecutionTraceForTest,
  resetValidationStateForTest,
} from "../agents/execution-preflight/index.js";
import { PROGRESS_LEDGER_ENABLED_ENV } from "../progress-ledger/feature.js";
import {
  CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_PERSIST_ENV,
  isConversationTaskDeliveryCloseConsultPersistEnabled,
  loadDeliveryCloseConsultsFromDisk,
  resolveDeliveryCloseConsultPersistPath,
  setDeliveryCloseConsultPersistPathForTest,
} from "./delivery-close-consult-persist.js";
import { CONVERSATION_TASK_ENV } from "./feature.js";
import {
  CONVERSATION_TASK_CLOSE_REQUIRES_EVIDENCE_ENV,
  ensureConversationTaskLedgerSeeded,
} from "./ledger-binding.js";
import {
  CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_ENV,
  observeConversationTaskCancelPathConsult,
  observeConversationTaskReplyCompleted,
  readConversationTaskDeliveryCloseConsults,
  resetConversationTaskDeliveryCloseConsultsForTest,
  simulateDeliveryCloseConsultProcessRestartForTest,
  type ConversationTaskDeliveryCloseConsultRecord,
} from "./reply-completion.js";
import * as runtimeBootstrap from "./runtime-bootstrap.js";
import { openTaskStore } from "./store.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

let root: string;

const blockingSkill = {
  name: "sample-primary",
  frontmatter: {
    aliases: "sample-alias",
    "primary-engine": "sample-engine",
    "forbidden-final-engines": "legacy-engine",
    "required-artifacts": "output.bin",
    "required-validators": "sample-validator",
    "delivery-blocked-until": "validator_passed",
    triggers: "sample-task",
    "allowed-tools": "read,write,edit,message,sessions_send",
    "generation-stage-tools": "write,edit",
    "delivery-stage-tools": "message,sessions_send",
  },
};

async function seedActiveTask(goal: string, sourceMessageId: string) {
  const store = openTaskStore({ tenantId: "local", storeRoot: root });
  const { task } = store.createTaskIfAbsent({
    conversationId: "agent:main:main",
    goal,
    activationEpoch: 1,
    requesterId: "user-1",
    ownerId: "user-1",
    sourceMessageId,
  });
  await ensureConversationTaskLedgerSeeded({ task, cronStorePath: path.join(root, "cron.json") });
  store.close();
  return task;
}

function armBlockingHold(taskId: string) {
  const preflight = buildExecutionPreflight({
    taskId,
    sessionId: "session-persist",
    message: "run sample-task",
    skills: [blockingSkill],
    policyToolNames: ["read", "write", "edit", "message", "sessions_send"],
    qualify: () => ({ kind: "short_action", reasons: ["test"] }),
  });
  armCompletionHold({
    keys: ["agent:main:main"],
    preflight,
  });
  resetExecutionTraceForTest();
  return preflight;
}

async function expectLifecycle(taskId: string, lifecycle: "active" | "closed") {
  await vi.waitFor(() => {
    const reopened = openTaskStore({ tenantId: "local", storeRoot: root });
    try {
      expect(reopened.getTaskById(Number(taskId))?.lifecycle).toBe(lifecycle);
    } finally {
      reopened.close();
    }
  });
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ct-consult-persist-"));
  vi.spyOn(runtimeBootstrap, "defaultShadowStoreRoot").mockReturnValue(root);
  setDeliveryCloseConsultPersistPathForTest(undefined);
  process.env[CONVERSATION_TASK_ENV.activation] = "1";
  process.env[PROGRESS_LEDGER_ENABLED_ENV] = "1";
  process.env[CONVERSATION_TASK_CLOSE_REQUIRES_EVIDENCE_ENV] = "0";
  delete process.env[CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_ENV];
  delete process.env[CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_PERSIST_ENV];
  resetConversationTaskDeliveryCloseConsultsForTest();
  resetCompletionHoldsForTest();
  resetExecutionTraceForTest();
  resetValidationStateForTest();
  resetDeliveryArtifactsForTest();
});

afterEach(() => {
  delete process.env[CONVERSATION_TASK_ENV.activation];
  delete process.env[PROGRESS_LEDGER_ENABLED_ENV];
  delete process.env[CONVERSATION_TASK_CLOSE_REQUIRES_EVIDENCE_ENV];
  delete process.env[CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_ENV];
  delete process.env[CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_PERSIST_ENV];
  resetConversationTaskDeliveryCloseConsultsForTest();
  setDeliveryCloseConsultPersistPathForTest(undefined);
  resetCompletionHoldsForTest();
  resetExecutionTraceForTest();
  resetValidationStateForTest();
  resetDeliveryArtifactsForTest();
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("cross-process consult persist ENV", () => {
  it("is default-off and shares truthy tokens with FC-02", () => {
    expect(CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_PERSIST_ENV).toBe(
      "OPENBOT_CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_PERSIST",
    );
    expect(isConversationTaskDeliveryCloseConsultPersistEnabled({})).toBe(false);
    expect(
      isConversationTaskDeliveryCloseConsultPersistEnabled({
        [CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_PERSIST_ENV]: "",
      }),
    ).toBe(false);
    expect(
      isConversationTaskDeliveryCloseConsultPersistEnabled({
        [CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_PERSIST_ENV]: "0",
      }),
    ).toBe(false);
    expect(
      isConversationTaskDeliveryCloseConsultPersistEnabled({
        [CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_PERSIST_ENV]: "1",
      }),
    ).toBe(true);
    expect(
      isConversationTaskDeliveryCloseConsultPersistEnabled({
        [CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_PERSIST_ENV]: "true",
      }),
    ).toBe(true);
    expect(
      isConversationTaskDeliveryCloseConsultPersistEnabled({
        [CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_PERSIST_ENV]: "yes",
      }),
    ).toBe(true);
    expect(
      isConversationTaskDeliveryCloseConsultPersistEnabled({
        [CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_PERSIST_ENV]: "on",
      }),
    ).toBe(true);
  });

  it("defaults persist path under conversation-task store root", () => {
    expect(resolveDeliveryCloseConsultPersistPath()).toBe(
      path.join(root, "delivery-close-consults.json"),
    );
  });
});

describe("persist flag off — behavior unchanged", () => {
  const goal = "分三步完成竞品监控";

  it("keeps consult records in-process only (no file) when persist is off", async () => {
    process.env[CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_ENV] = "1";
    const task = await seedActiveTask(goal, "m-persist-off");
    armBlockingHold("preflight-persist-off");

    void observeConversationTaskReplyCompleted({
      tenantId: "local",
      requesterId: "user-1",
      conversationId: "agent:main:main",
      sourceMessageId: "m-persist-off",
      text: goal,
      assistantReplyText: "任务已完成",
      cronStorePath: path.join(root, "cron.json"),
    });

    await expectLifecycle(String(task.id), "closed");
    expect(readConversationTaskDeliveryCloseConsults()).toHaveLength(1);
    expect(readConversationTaskDeliveryCloseConsults()[0]?.closeDeferred).toBe(false);
    expect(fs.existsSync(resolveDeliveryCloseConsultPersistPath())).toBe(false);

    simulateDeliveryCloseConsultProcessRestartForTest();
    // Persist off → hydrate is a no-op; ring stays empty after restart sim.
    expect(readConversationTaskDeliveryCloseConsults()).toEqual([]);
  });
});

describe("persist flag on — survives restart equivalent", () => {
  const goal = "分三步完成竞品监控";

  it("writes consult + nested receipt snapshot to disk and reloads after restart sim", async () => {
    process.env[CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_ENV] = "1";
    process.env[CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_PERSIST_ENV] = "1";
    const task = await seedActiveTask(goal, "m-persist-on");
    const preflight = armBlockingHold("preflight-persist-on");

    void observeConversationTaskReplyCompleted({
      tenantId: "local",
      requesterId: "user-1",
      conversationId: "agent:main:main",
      sourceMessageId: "m-persist-on",
      text: goal,
      assistantReplyText: "任务已完成",
      cronStorePath: path.join(root, "cron.json"),
    });

    await expectLifecycle(String(task.id), "closed");
    const before = readConversationTaskDeliveryCloseConsults();
    expect(before).toHaveLength(1);
    expect(before[0]).toEqual(
      expect.objectContaining({
        conversationTaskId: String(task.id),
        mode: "observe",
        closeDeferred: false,
        hasDeliveryContext: true,
        completionClaimBlocked: true,
        holds: [
          expect.objectContaining({
            preflightTaskId: preflight.taskId,
            latestReceiptResult: "absent",
          }),
        ],
      }),
    );

    const filePath = resolveDeliveryCloseConsultPersistPath();
    expect(fs.existsSync(filePath)).toBe(true);
    const fromDisk = loadDeliveryCloseConsultsFromDisk(filePath);
    expect(fromDisk).toHaveLength(1);
    expect(fromDisk[0]?.closeDeferred).toBe(false);
    expect(fromDisk[0]?.mode).toBe("observe");
    expect(fromDisk[0]?.holds[0]?.latestReceiptResult).toBe("absent");

    simulateDeliveryCloseConsultProcessRestartForTest();
    const after = readConversationTaskDeliveryCloseConsults();
    expect(after).toHaveLength(1);
    expect(after[0]).toEqual(
      expect.objectContaining({
        conversationTaskId: String(task.id),
        mode: "observe",
        closeDeferred: false,
        hasDeliveryContext: true,
        holds: [
          expect.objectContaining({
            preflightTaskId: preflight.taskId,
            latestReceiptResult: "absent",
          }),
        ],
      }),
    );
  });

  it("persists cancel-path consult observe and reloads; never defers cancel", () => {
    process.env[CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_ENV] = "1";
    process.env[CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_PERSIST_ENV] = "on";

    observeConversationTaskCancelPathConsult({
      sessionKey: "agent:main:main",
      text: "cancel please",
      conversationTaskId: "ct-cancel-persist",
    });

    expect(readConversationTaskDeliveryCloseConsults()).toEqual([
      expect.objectContaining({
        conversationTaskId: "ct-cancel-persist",
        mode: "observe",
        closeDeferred: false,
      }),
    ]);
    expect(fs.existsSync(resolveDeliveryCloseConsultPersistPath())).toBe(true);

    simulateDeliveryCloseConsultProcessRestartForTest();
    const reloaded = readConversationTaskDeliveryCloseConsults();
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]?.closeDeferred).toBe(false);
    expect(reloaded[0]?.mode).toBe("observe");
  });

  it("rejects closeDeferred:true rows on load (observe-only invariant)", () => {
    process.env[CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_PERSIST_ENV] = "1";
    const filePath = resolveDeliveryCloseConsultPersistPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        records: [
          {
            conversationTaskId: "bad",
            sessionKey: "s",
            mode: "observe",
            closeDeferred: true,
            hasDeliveryContext: false,
            sessionHoldAmbiguous: false,
            completionClaimBlocked: false,
            deliveryBlocksCompletionClaims: false,
            holds: [],
          },
          {
            conversationTaskId: "good",
            sessionKey: "s",
            mode: "observe",
            closeDeferred: false,
            hasDeliveryContext: false,
            sessionHoldAmbiguous: false,
            completionClaimBlocked: false,
            deliveryBlocksCompletionClaims: false,
            holds: [],
          },
        ],
      }),
      "utf8",
    );

    const loaded = loadDeliveryCloseConsultsFromDisk(filePath);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.conversationTaskId).toBe("good");
    expect(loaded[0]?.closeDeferred).toBe(false);

    const viaRing = readConversationTaskDeliveryCloseConsults();
    expect(viaRing).toHaveLength(1);
    expect(viaRing[0]?.conversationTaskId).toBe("good");
  });
});

describe("closeDeferred + OUT locks", () => {
  it("record type and remember path keep closeDeferred literal false", () => {
    const recordShape: ConversationTaskDeliveryCloseConsultRecord = {
      conversationTaskId: "lock",
      sessionKey: "agent:main:main",
      mode: "observe",
      closeDeferred: false,
      hasDeliveryContext: false,
      sessionHoldAmbiguous: false,
      completionClaimBlocked: false,
      deliveryBlocksCompletionClaims: false,
      holds: [],
    };
    expect(recordShape.closeDeferred).toBe(false);
    expect(recordShape.mode).toBe("observe");

    const replySrc = fs.readFileSync(path.join(HERE, "reply-completion.ts"), "utf8");
    expect(replySrc).toMatch(/closeDeferred:\s*false/);
    expect(replySrc).not.toMatch(/closeDeferred:\s*true/);
    expect(replySrc).not.toContain("collaboration-dispatch");

    const persistSrc = fs.readFileSync(
      path.join(HERE, "delivery-close-consult-persist.ts"),
      "utf8",
    );
    expect(persistSrc).not.toMatch(/closeDeferred:\s*true/);
    expect(persistSrc).toContain("OPENBOT_CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_PERSIST");
  });
});
