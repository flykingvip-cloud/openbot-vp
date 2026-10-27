/**
 * askOutcome wrap-up: W4 P1 fixes + W3 tip budget production path + matrix states.
 *
 * 口径（Option A）：无 adopted → 「成功任务中的曝光」；不 outcome_verified / 不策展。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentLearningAsset } from "@openbot/collaboration-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingLearningInjectionsForTests,
  learningExperienceRunKey,
  peekPendingLearningInjection,
  rememberPendingLearningInjection,
} from "../auto-reply/reply/learning-experience-pending.js";
import { curateLearningSkillDraftsSafely } from "../auto-reply/reply/learning-skill-curation.js";
import { ensureChatTurnTaskOutcome } from "./chat-entry.js";
import { OutcomeConsumerRuntime } from "./consumers.js";
import { ChatTaskOutcomeAdapter } from "./entrypoints/chat.js";
import {
  applyExperienceVerification,
  createExperienceVerifiedHandler,
  resolveExperienceVerificationPlan,
} from "./experience-verified-handler.js";
import { TaskOutcomeResultService } from "./result-service.js";
import { recordRunnerTurnOutcome } from "./runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "./store.js";
import type { TaskOutcomeRecord, TrustedScope } from "./types.js";

const scope: TrustedScope = {
  kind: "personal",
  personalDomainId: "personal:wrapup",
  subjectRef: "u",
  authzScopeRef: "s",
};

const assetsByScope = new Map<string, AgentLearningAsset[]>();

vi.mock("../gateway/collaboration-learning/shared.js", () => ({
  createWorkspaceCollaborationStores: () => ({
    groupRootDir: os.tmpdir(),
    learningStorage: {
      readLearningAssets: async (groupId: string, botId?: string) => {
        const all = assetsByScope.get(groupId) ?? [];
        return botId ? all.filter((asset) => asset.botId === botId) : all;
      },
      writeLearningAssets: async (groupId: string, assets: AgentLearningAsset[]) => {
        assetsByScope.set(groupId, assets);
      },
    },
  }),
  resolveGroupStoreFilePath: (params: {
    groupRootDir: string;
    groupId: string;
    filename: string;
  }) => path.join(params.groupRootDir, encodeURIComponent(params.groupId), params.filename),
}));

vi.mock("../auto-reply/reply/learning-skill-curation.js", () => ({
  curateLearningSkillDraftsSafely: vi.fn(),
}));

function makeAsset(overrides: Partial<AgentLearningAsset> = {}): AgentLearningAsset {
  return {
    assetId: "asset-1",
    botId: "bot-1",
    sourceGroupId: "grp-wrap",
    sourceCapsuleId: "cap-1",
    assetType: "lesson",
    status: "active",
    abstractedContent: { lesson: "先核对权限再执行" },
    ...overrides,
  };
}

function baseRecord(overrides: Partial<TaskOutcomeRecord> = {}): TaskOutcomeRecord {
  const now = new Date().toISOString();
  return {
    schemaVersion: "1.0.0",
    taskContractVersion: "1.0.0",
    judgementPolicyVersion: "1.0.0",
    scope,
    taskId: "task-wrap",
    entrypoint: "chat",
    lifecycle: "closed",
    decisiveRunStatus: "succeeded",
    acceptance: { status: "passed" },
    delivery: { status: "delivered" },
    attempts: [],
    runs: [],
    reasonCode: "accepted_and_delivered",
    outcomeVersion: 2,
    submittedBy: "test",
    taskJudgement: "success",
    decidedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("wrap-up W4 P1: task-bound exposure + adopted validity", () => {
  beforeEach(() => {
    assetsByScope.clear();
    clearPendingLearningInjectionsForTests();
    vi.clearAllMocks();
  });
  afterEach(() => {
    clearPendingLearningInjectionsForTests();
  });

  it("same agent two runs: pending keyed by runId does not clobber", () => {
    const keyA = learningExperienceRunKey("run-a")!;
    const keyB = learningExperienceRunKey("run-b")!;
    rememberPendingLearningInjection({
      key: keyA,
      scopes: [{ scopeId: "grp-wrap", botId: "bot-1", assetIds: ["a"] }],
    });
    rememberPendingLearningInjection({
      key: keyB,
      scopes: [{ scopeId: "grp-wrap", botId: "bot-1", assetIds: ["b"] }],
    });
    expect(peekPendingLearningInjection(keyA)?.scopes[0]?.assetIds).toEqual(["a"]);
    expect(peekPendingLearningInjection(keyB)?.scopes[0]?.assetIds).toEqual(["b"]);
    // agentId-looking keys are refused
    rememberPendingLearningInjection({
      key: "agent-shared",
      scopes: [{ scopeId: "grp-wrap", botId: "bot-1", assetIds: ["x"] }],
    });
    expect(peekPendingLearningInjection("agent-shared")).toBeUndefined();
  });

  it("ensureChatTurn attaches by run key; never agentId", () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "wrap-chat-"));
    try {
      const cfg = {
        agents: { list: [{ id: "bot", workspace: agentDir }] },
      } as never;
      const runKey = learningExperienceRunKey("run-attach")!;
      rememberPendingLearningInjection({
        key: runKey,
        scopes: [{ scopeId: "grp-wrap", botId: "bot-1", assetIds: ["exp-1"] }],
      });
      // Poison agentId key — must be ignored even if somehow present
      rememberPendingLearningInjection({
        key: "run:other",
        scopes: [{ scopeId: "grp-wrap", botId: "bot-1", assetIds: ["poison"] }],
      });
      const opened = ensureChatTurnTaskOutcome(cfg, {
        agentId: "bot",
        runId: "run-attach",
        subjectRef: "subject:u",
      });
      expect(opened.ok).toBe(true);
      if (!opened.ok) {
        return;
      }
      expect(opened.record.experienceExposure?.scopes[0]?.assetIds).toEqual(["exp-1"]);
      expect(peekPendingLearningInjection(runKey)).toBeUndefined();
    } finally {
      fs.rmSync(agentDir, { recursive: true, force: true });
    }
  });

  it("success+exposure without adopted = 成功任务中的曝光; no verify / no curation", async () => {
    assetsByScope.set("grp-wrap", [makeAsset({ assetId: "exp", injectedCount: 2 })]);
    const plan = resolveExperienceVerificationPlan(
      baseRecord({
        experienceExposure: {
          scopes: [{ scopeId: "grp-wrap", botId: "bot-1", assetIds: ["exp"] }],
          attachedAt: new Date().toISOString(),
        },
      }),
    );
    expect(plan.shouldVerify).toBe(false);
    expect(plan.reason).toBe("exposure_on_success_not_verified");
    const applied = await applyExperienceVerification(plan);
    expect(applied.verifiedAssetIds).toEqual([]);
    expect(assetsByScope.get("grp-wrap")?.[0]?.outcomeVerifiedCount ?? 0).toBe(0);
    expect(curateLearningSkillDraftsSafely).not.toHaveBeenCalled();
  });

  it("adopted ∩ exposure → outcome_verified; await durable before consume ack", async () => {
    assetsByScope.set("grp-wrap", [
      makeAsset({ assetId: "a1", injectedCount: 1 }),
      makeAsset({ assetId: "a2", injectedCount: 1 }),
    ]);
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "wrap-verify-"));
    try {
      const store = new DurableTaskOutcomeStore(path.join(agentDir, "task-outcomes"));
      const service = new TaskOutcomeResultService({ store, submittedBy: "wrap" });
      const chat = new ChatTaskOutcomeAdapter(service);
      const opened = chat.createOrRestore({
        taskId: "t-adopt",
        scope,
        taskContractVersion: "1.0.0",
      });
      expect(opened.ok).toBe(true);
      if (!opened.ok) {
        return;
      }
      const fencing = opened.fencingToken;
      let res = service.submit(
        "t-adopt",
        {
          type: "set_experience_exposure",
          experienceExposure: {
            scopes: [{ scopeId: "grp-wrap", botId: "bot-1", assetIds: ["a1", "a2"] }],
            attachedAt: new Date().toISOString(),
            adoptedAssetIds: ["a1"],
          },
          expectedVersion: opened.record.outcomeVersion,
          fencingToken: fencing,
        },
        { requiredScope: scope },
      );
      expect(res.ok).toBe(true);
      if (!res.ok) {
        return;
      }
      res = service.submit(
        "t-adopt",
        {
          type: "record_attempt",
          attempt: {
            attemptId: "att-1",
            runId: "run-1",
            status: "succeeded",
            observedAt: new Date().toISOString(),
          },
          run: {
            runId: "run-1",
            attemptIds: ["att-1"],
            effectiveAttemptId: "att-1",
            fencingToken: fencing,
            status: "succeeded",
          },
          expectedVersion: res.record.outcomeVersion,
          fencingToken: fencing,
        },
        { requiredScope: scope },
      );
      expect(res.ok).toBe(true);
      if (!res.ok) {
        return;
      }
      res = service.submit(
        "t-adopt",
        {
          type: "set_acceptance",
          acceptance: { status: "passed" },
          expectedVersion: res.record.outcomeVersion,
          fencingToken: fencing,
          allowRetry: true,
        },
        { requiredScope: scope },
      );
      expect(res.ok).toBe(true);
      if (!res.ok) {
        return;
      }
      res = service.submit(
        "t-adopt",
        {
          type: "set_delivery",
          delivery: { status: "delivered" },
          deliveryId: "d1",
          expectedVersion: res.record.outcomeVersion,
          fencingToken: fencing,
        },
        { requiredScope: scope },
      );
      expect(res.ok).toBe(true);
      if (!res.ok) {
        return;
      }

      const runtime = new OutcomeConsumerRuntime(store, {
        handlers: [createExperienceVerifiedHandler(store)],
      });
      const drained = await runtime.drain((id) => store.loadTask(id));
      expect(drained.processed).toBeGreaterThanOrEqual(1);

      const a1 = assetsByScope.get("grp-wrap")?.find((a) => a.assetId === "a1");
      const a2 = assetsByScope.get("grp-wrap")?.find((a) => a.assetId === "a2");
      expect(a1?.outcomeVerifiedCount).toBe(1);
      expect(a2?.outcomeVerifiedCount ?? 0).toBe(0);
      expect(curateLearningSkillDraftsSafely).toHaveBeenCalled();

      // Replay: same event already consumed — count stays 1
      const drained2 = await runtime.drain((id) => store.loadTask(id));
      expect(
        a1 && assetsByScope.get("grp-wrap")?.find((a) => a.assetId === "a1")?.outcomeVerifiedCount,
      ).toBe(1);
      void drained2;
    } finally {
      fs.rmSync(agentDir, { recursive: true, force: true });
    }
  });

  it("handler throw defers consume ack; retry after fix applies once", async () => {
    assetsByScope.set("grp-wrap", [makeAsset({ assetId: "z1", injectedCount: 1 })]);
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "wrap-fail-"));
    try {
      const store = new DurableTaskOutcomeStore(path.join(agentDir, "task-outcomes"));
      const service = new TaskOutcomeResultService({ store, submittedBy: "wrap" });
      const chat = new ChatTaskOutcomeAdapter(service);
      const opened = chat.createOrRestore({
        taskId: "t-failwrite",
        scope,
        taskContractVersion: "1.0.0",
      });
      expect(opened.ok).toBe(true);
      if (!opened.ok) {
        return;
      }
      const fencing = opened.fencingToken;
      let res = service.submit(
        "t-failwrite",
        {
          type: "set_experience_exposure",
          experienceExposure: {
            scopes: [{ scopeId: "grp-wrap", botId: "bot-1", assetIds: ["z1"] }],
            attachedAt: new Date().toISOString(),
            adoptedAssetIds: ["z1"],
          },
          expectedVersion: opened.record.outcomeVersion,
          fencingToken: fencing,
        },
        { requiredScope: scope },
      );
      expect(res.ok).toBe(true);
      if (!res.ok) {
        return;
      }
      for (const step of [
        {
          type: "record_attempt" as const,
          attempt: {
            attemptId: "att-z",
            runId: "run-z",
            status: "succeeded" as const,
            observedAt: new Date().toISOString(),
          },
          run: {
            runId: "run-z",
            attemptIds: ["att-z"],
            effectiveAttemptId: "att-z",
            fencingToken: fencing,
            status: "succeeded" as const,
          },
        },
        {
          type: "set_acceptance" as const,
          acceptance: { status: "passed" as const },
          allowRetry: true,
        },
        {
          type: "set_delivery" as const,
          delivery: { status: "delivered" as const },
          deliveryId: "dz",
        },
      ]) {
        res = service.submit(
          "t-failwrite",
          {
            ...step,
            expectedVersion: res.record.outcomeVersion,
            fencingToken: fencing,
          } as never,
          { requiredScope: scope },
        );
        expect(res.ok).toBe(true);
        if (!res.ok) {
          return;
        }
      }

      const pending = store.listPendingOutbox();
      const closedEvent = pending.find(
        (e) => e.eventType === "task.closed" || e.eventType === "task.corrected",
      );
      expect(closedEvent).toBeTruthy();

      let blows = 0;
      const flaky = {
        consumerId: "experience-verified",
        onEvent: async (
          event: Parameters<ReturnType<typeof createExperienceVerifiedHandler>["onEvent"]>[0],
          record: Parameters<ReturnType<typeof createExperienceVerifiedHandler>["onEvent"]>[1],
        ) => {
          if (event.eventType === "task.closed" || event.eventType === "task.corrected") {
            if (blows === 0) {
              blows += 1;
              throw new Error("simulated durable write failure");
            }
          }
          const real = createExperienceVerifiedHandler(store);
          await Promise.resolve(real.onEvent(event, record));
        },
      };

      const runtime = new OutcomeConsumerRuntime(store, { handlers: [flaky] });
      const first = await runtime.drain((id) => store.loadTask(id));
      expect(first.deferred).toBeGreaterThanOrEqual(1);
      expect(store.hasConsumed("experience-verified", closedEvent!.eventId)).toBe(false);

      const second = await runtime.drain((id) => store.loadTask(id));
      expect(second.processed).toBeGreaterThanOrEqual(1);
      expect(store.hasConsumed("experience-verified", closedEvent!.eventId)).toBe(true);
      expect(assetsByScope.get("grp-wrap")?.[0]?.outcomeVerifiedCount).toBe(1);
    } finally {
      fs.rmSync(agentDir, { recursive: true, force: true });
    }
  });
});

describe("wrap-up W3: tip budget on recordRunnerTurnOutcome path", () => {
  let agentDir = "";
  beforeEach(() => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "wrap-budget-"));
  });
  afterEach(() => {
    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  it("retries accumulate on same taskId; exhaust stops further success close", async () => {
    const cfg = {
      agents: { list: [{ id: "bot", workspace: agentDir }] },
    } as never;
    const taskId = "chat:bot:sess:budget-run";
    const scopeLocal: TrustedScope = {
      kind: "personal",
      personalDomainId: "personal:wrap-budget",
      subjectRef: "subject:u",
      authzScopeRef: "chat-entry",
    };

    // Attempt 1: leave gates pending so tip stays open for retry accumulation
    const a1 = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "r1",
      taskId,
      scope: scopeLocal,
      budgetLimits: { maxIterations: 2, maxCostUsd: 10, maxDurationMinutes: 30 },
    });
    expect(a1.record.budget?.iterationCount).toBe(1);
    expect(a1.record.lifecycle).not.toBe("closed");
    expect(a1.record.reasonCode).not.toBe("budget_exceeded");

    // Attempt 2 → iterationCount hits maxIterations → budget_exceeded (no further success path)
    const a2 = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "r2",
      taskId,
      scope: scopeLocal,
    });
    expect(a2.record.budget?.iterationCount).toBeGreaterThanOrEqual(2);
    expect(a2.record.reasonCode).toBe("budget_exceeded");
    expect(a2.record.lifecycle).toBe("closed");
    expect(a2.record.taskJudgement).toBe("failure");
  });
});

describe("wrap-up W5 matrix four-state wording", () => {
  it("call-chain matrix distinguishes 接口可用/生产接通/行为已验证/未完成", () => {
    const root = path.join(path.dirname(new URL(import.meta.url).pathname), "../..");
    // macOS URL path may need decode
    const callChainPath = path.join(
      process.cwd(),
      "docs/design/task-outcome/call-chain-and-replacements.md",
    );
    const callChain = fs.readFileSync(callChainPath, "utf8");
    expect(callChain).toMatch(/接口可用/);
    expect(callChain).toMatch(/生产接通/);
    expect(callChain).toMatch(/行为已验证/);
    expect(callChain).toMatch(/未完成/);
    expect(callChain.includes("四态")).toBe(true);
    expect(callChain.includes("不宣布") || callChain.includes("**不**宣布")).toBe(true);
    expect(callChain.includes("禁止")).toBe(true);
    void root;
  });
});
