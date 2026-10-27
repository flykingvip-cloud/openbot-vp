/**
 * Reverify P1: contribution-key idempotent counts, off-tip contribution meta,
 * pre-model-call budget gate (next call must not happen when exhausted).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentLearningAsset } from "@openbot/collaboration-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OutcomeConsumerRuntime } from "./consumers.js";
import { ChatTaskOutcomeAdapter } from "./entrypoints/chat.js";
import {
  applyOutcomeVerifiedContributionKey,
  OUTCOME_VERIFIED_CONTRIBUTION_KEYS_FILENAME,
  revokeOutcomeVerifiedContributionKey,
} from "./experience-verified-counts.js";
import {
  buildExperienceVerifiedContributionKey,
  createExperienceVerifiedHandler,
  loadExperienceVerifiedContribution,
  saveExperienceVerifiedContribution,
} from "./experience-verified-handler.js";
import { TaskOutcomeResultService } from "./result-service.js";
import {
  assessRunnerTurnBudgetGate,
  chargeRunnerTurnBudgetSpend,
  TaskBudgetExceededError,
} from "./runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "./store.js";
import type { TrustedScope } from "./types.js";

const scope: TrustedScope = {
  kind: "personal",
  personalDomainId: "personal:reverify-p1",
  subjectRef: "u",
  authzScopeRef: "s",
};

const assetsByScope = new Map<string, AgentLearningAsset[]>();
let groupRootDir = "";

vi.mock("../gateway/collaboration-learning/shared.js", () => ({
  createWorkspaceCollaborationStores: () => ({
    groupRootDir,
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
    assetId: "a1",
    botId: "bot-1",
    sourceGroupId: "grp-p1",
    sourceCapsuleId: "cap-1",
    assetType: "lesson",
    status: "active",
    abstractedContent: { lesson: "先核对权限再执行" },
    ...overrides,
  };
}

async function closeSuccessWithAdopted(params: {
  store: DurableTaskOutcomeStore;
  taskId: string;
  assetIds: string[];
  adoptedAssetIds: string[];
}): Promise<{ eventId: string }> {
  const service = new TaskOutcomeResultService({ store: params.store, submittedBy: "p1" });
  const chat = new ChatTaskOutcomeAdapter(service);
  const opened = chat.createOrRestore({
    taskId: params.taskId,
    scope,
    taskContractVersion: "1.0.0",
  });
  expect(opened.ok).toBe(true);
  if (!opened.ok) {
    throw new Error("open failed");
  }
  const fencing = opened.fencingToken;
  let res = service.submit(
    params.taskId,
    {
      type: "set_experience_exposure",
      experienceExposure: {
        scopes: [{ scopeId: "grp-p1", botId: "bot-1", assetIds: params.assetIds }],
        attachedAt: new Date().toISOString(),
        adoptedAssetIds: params.adoptedAssetIds,
      },
      expectedVersion: opened.record.outcomeVersion,
      fencingToken: fencing,
    },
    { requiredScope: scope },
  );
  expect(res.ok).toBe(true);
  if (!res.ok) {
    throw new Error("exposure failed");
  }
  for (const step of [
    {
      type: "record_attempt" as const,
      attempt: {
        attemptId: "att-1",
        runId: "run-1",
        status: "succeeded" as const,
        observedAt: new Date().toISOString(),
      },
      run: {
        runId: "run-1",
        attemptIds: ["att-1"],
        effectiveAttemptId: "att-1",
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
      deliveryId: "d1",
    },
  ]) {
    res = service.submit(
      params.taskId,
      {
        ...step,
        expectedVersion: res.record.outcomeVersion,
        fencingToken: fencing,
      } as never,
      { requiredScope: scope },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) {
      throw new Error("step failed");
    }
  }
  const pending = params.store.listPendingOutbox();
  const closed = pending.find(
    (e) => e.eventType === "task.closed" || e.eventType === "task.corrected",
  );
  expect(closed).toBeTruthy();
  return { eventId: closed!.eventId };
}

describe("reverify P1: contribution-key idempotent counts + off-tip meta", () => {
  let agentDir = "";

  beforeEach(() => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "reverify-p1-"));
    groupRootDir = fs.mkdtempSync(path.join(os.tmpdir(), "reverify-p1-learn-"));
    assetsByScope.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(agentDir, { recursive: true, force: true });
    fs.rmSync(groupRootDir, { recursive: true, force: true });
  });

  it("crash: counts written, contribution file missing → replay keeps exact count=1", async () => {
    assetsByScope.set("grp-p1", [makeAsset({ injectedCount: 1 })]);
    const store = new DurableTaskOutcomeStore(path.join(agentDir, "task-outcomes"));
    const { eventId } = await closeSuccessWithAdopted({
      store,
      taskId: "t-crash-count",
      assetIds: ["a1"],
      adoptedAssetIds: ["a1"],
    });

    const contributionKey = buildExperienceVerifiedContributionKey({
      taskId: "t-crash-count",
      eventId,
    });
    // Simulate: keyed count applied, contribution file NOT saved yet
    await applyOutcomeVerifiedContributionKey({
      contributionKey: `${contributionKey}:grp-p1`,
      scopeId: "grp-p1",
      assetIds: ["a1"],
    });
    expect(assetsByScope.get("grp-p1")?.[0]?.outcomeVerifiedCount).toBe(1);
    expect(
      loadExperienceVerifiedContribution(store, "personal:reverify-p1", "t-crash-count"),
    ).toBeUndefined();

    // Tip must not carry verifiedContribution
    const tip = store.loadTask("t-crash-count");
    expect(tip?.experienceExposure && "verifiedContribution" in tip.experienceExposure).toBe(false);

    const runtime = new OutcomeConsumerRuntime(store, {
      handlers: [createExperienceVerifiedHandler(store)],
    });
    await runtime.drain((id) => store.loadTask(id));

    expect(assetsByScope.get("grp-p1")?.[0]?.outcomeVerifiedCount).toBe(1);
    const contrib = loadExperienceVerifiedContribution(
      store,
      "personal:reverify-p1",
      "t-crash-count",
    );
    expect(contrib?.status).toBe("applied");
    expect(contrib?.eventId).toBe(eventId);
  });

  it("crash: revoke written, contribution mark not cleared → replay keeps exact count=0", async () => {
    assetsByScope.set("grp-p1", [makeAsset({ injectedCount: 1, outcomeVerifiedCount: 0 })]);
    const store = new DurableTaskOutcomeStore(path.join(agentDir, "task-outcomes"));
    const { eventId } = await closeSuccessWithAdopted({
      store,
      taskId: "t-crash-revoke",
      assetIds: ["a1"],
      adoptedAssetIds: ["a1"],
    });
    const contributionKey = buildExperienceVerifiedContributionKey({
      taskId: "t-crash-revoke",
      eventId,
    });
    await applyOutcomeVerifiedContributionKey({
      contributionKey: `${contributionKey}:grp-p1`,
      scopeId: "grp-p1",
      assetIds: ["a1"],
    });
    expect(assetsByScope.get("grp-p1")?.[0]?.outcomeVerifiedCount).toBe(1);

    // Save applied contribution, then revoke counts but leave contribution as applied (crash gap)
    saveExperienceVerifiedContribution(store, "personal:reverify-p1", {
      contributionKey,
      eventId,
      outcomeVersion: store.loadTask("t-crash-revoke")!.outcomeVersion,
      taskId: "t-crash-revoke",
      status: "applied",
      scopes: [{ scopeId: "grp-p1", botId: "bot-1", assetIds: ["a1"] }],
      assetIds: ["a1"],
      updatedAt: new Date().toISOString(),
    });
    await revokeOutcomeVerifiedContributionKey({
      contributionKey: `${contributionKey}:grp-p1`,
      scopeId: "grp-p1",
      assetIds: ["a1"],
    });
    expect(assetsByScope.get("grp-p1")?.[0]?.outcomeVerifiedCount).toBe(0);

    // Contribution file still says applied, but counts already revoked; replay must stay 0
    const again = await revokeOutcomeVerifiedContributionKey({
      contributionKey: `${contributionKey}:grp-p1`,
      scopeId: "grp-p1",
      assetIds: ["a1"],
    });
    expect(again.revoked).toBe(false);
    expect(assetsByScope.get("grp-p1")?.[0]?.outcomeVerifiedCount).toBe(0);

    // Keys file exists (durable)
    const keysPath = path.join(
      groupRootDir,
      encodeURIComponent("grp-p1"),
      OUTCOME_VERIFIED_CONTRIBUTION_KEYS_FILENAME,
    );
    expect(fs.existsSync(keysPath)).toBe(true);
  });

  it("handler never calls store.saveTask (contribution stays off-tip)", async () => {
    assetsByScope.set("grp-p1", [makeAsset()]);
    const store = new DurableTaskOutcomeStore(path.join(agentDir, "task-outcomes"));
    const spy = vi.spyOn(store, "saveTask");
    await closeSuccessWithAdopted({
      store,
      taskId: "t-no-savetask",
      assetIds: ["a1"],
      adoptedAssetIds: ["a1"],
    });
    spy.mockClear();
    const runtime = new OutcomeConsumerRuntime(store, {
      handlers: [createExperienceVerifiedHandler(store)],
    });
    await runtime.drain((id) => store.loadTask(id));
    expect(spy).not.toHaveBeenCalled();
    expect(assetsByScope.get("grp-p1")?.[0]?.outcomeVerifiedCount).toBe(1);
    expect(
      loadExperienceVerifiedContribution(store, "personal:reverify-p1", "t-no-savetask")?.status,
    ).toBe("applied");
  });
});

describe("reverify P1: pre-model budget gate blocks next call", () => {
  let agentDir = "";

  beforeEach(() => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "reverify-budget-"));
  });
  afterEach(() => {
    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  it("after exhaustion, assessRunnerTurnBudgetGate.allowed=false (no next model call)", () => {
    const cfg = {
      agents: { list: [{ id: "bot", workspace: agentDir }] },
    } as never;
    const taskId = "chat:bot:sess:gate";
    const startedAtMs = Date.now();

    const g0 = assessRunnerTurnBudgetGate(cfg, "bot", {
      taskId,
      scope,
      startedAtMs,
      budgetLimits: { maxIterations: 2, maxCostUsd: 10, maxDurationMinutes: 30 },
    });
    expect(g0.allowed).toBe(true);

    chargeRunnerTurnBudgetSpend(cfg, "bot", {
      taskId,
      scope,
      runId: "r1",
      callSeq: 1,
      iterations: 1,
      costUsd: 0.5,
    });
    const g1 = assessRunnerTurnBudgetGate(cfg, "bot", { taskId, scope, startedAtMs });
    expect(g1.allowed).toBe(true);

    const charged = chargeRunnerTurnBudgetSpend(cfg, "bot", {
      taskId,
      scope,
      runId: "r1",
      callSeq: 2,
      iterations: 1,
      costUsd: 0.5,
    });
    expect(charged.exhaustion?.dimension).toBe("iterations");
    expect(charged.closedForBudget).toBe(true);
    expect(charged.record.reasonCode).toBe("budget_exceeded");

    const g2 = assessRunnerTurnBudgetGate(cfg, "bot", { taskId, scope, startedAtMs });
    expect(g2.allowed).toBe(false);
    let modelCalls = 0;
    const attemptNextModelCall = (): void => {
      // Mirrors agent-runner-execution assertTipBudgetAllowsModelCall → throw before invoke.
      if (!g2.allowed) {
        expect(g2.exhaustion.dimension).toBe("iterations");
        throw new TaskBudgetExceededError(taskId, g2.exhaustion);
      }
      modelCalls += 1;
    };
    expect(() => attemptNextModelCall()).toThrow(/budget exceeded/);
    expect(modelCalls).toBe(0);

    // startedAtMs preserved from first ensure (task actual start)
    expect(g0.allowed && g0.record.budget?.startedAtMs).toBe(startedAtMs);
    expect(charged.record.budget?.spentCostUsd).toBeCloseTo(1.0, 5);
  });
});
