/**
 * W4: experience validity — retrieved/injected/adopted/outcome_verified separation;
 * exposure ≠ verified; curation only after tip success+eligible.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentLearningAsset } from "@openbot/collaboration-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingLearningInjectionsForTests,
  peekPendingLearningInjection,
  rememberPendingLearningInjection,
  takePendingLearningInjection,
} from "../auto-reply/reply/learning-experience-pending.js";
import { deriveSkillDraftCandidates } from "../gateway/agent-growth/skill-draft-curation.js";
import { ChatTaskOutcomeAdapter } from "./entrypoints/chat.js";
import {
  applyExperienceVerification,
  resolveExperienceVerificationPlan,
} from "./experience-verified-handler.js";
import { TaskOutcomeResultService } from "./result-service.js";
import { DurableTaskOutcomeStore } from "./store.js";
import type { TaskOutcomeRecord, TrustedScope } from "./types.js";

const scope: TrustedScope = {
  kind: "personal",
  personalDomainId: "personal:w4",
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
    sourceGroupId: "grp-w4",
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
    taskId: "task-w4",
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

describe("W4 experience evolution A–C", () => {
  let agentDir = "";

  beforeEach(() => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "w4-agent-"));
    assetsByScope.clear();
    clearPendingLearningInjectionsForTests();
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(agentDir, { recursive: true, force: true });
    clearPendingLearningInjectionsForTests();
  });

  it("A: tip success+eligible with exposure verifies; injection alone does not curate metric", () => {
    const exposureOnly = makeAsset({
      assetId: "exp",
      reuseCount: 5,
      injectedCount: 5,
      outcomeVerifiedCount: 0,
    });
    expect(
      deriveSkillDraftCandidates([exposureOnly], {
        reuseThreshold: 3,
        occurrenceThreshold: 99,
      }),
    ).toEqual([]);

    const record = baseRecord({
      experienceExposure: {
        scopes: [{ scopeId: "grp-w4", botId: "bot-1", assetIds: ["exp"] }],
        attachedAt: new Date().toISOString(),
      },
    });
    const plan = resolveExperienceVerificationPlan(record);
    expect(plan.shouldVerify).toBe(true);
    expect(plan.reason).toBe("tip_success_eligible");
    expect(plan.scopes[0]?.assetIds).toEqual(["exp"]);
  });

  it("B: cancelled / failure never outcome_verify exposure", () => {
    const exposure = {
      scopes: [{ scopeId: "grp-w4", botId: "bot-1", assetIds: ["a1"] }],
      attachedAt: new Date().toISOString(),
    };
    expect(
      resolveExperienceVerificationPlan(
        baseRecord({
          taskJudgement: "cancelled",
          reasonCode: "user_cancelled",
          experienceExposure: exposure,
        }),
      ).shouldVerify,
    ).toBe(false);
    expect(
      resolveExperienceVerificationPlan(
        baseRecord({
          taskJudgement: "failure",
          reasonCode: "run_failed",
          decisiveRunStatus: "failed",
          experienceExposure: exposure,
        }),
      ).shouldVerify,
    ).toBe(false);
  });

  it("C: applyExperienceVerification bumps outcome_verified (not merely injected)", async () => {
    assetsByScope.set("grp-w4", [makeAsset({ assetId: "a1", injectedCount: 2, reuseCount: 2 })]);
    const plan = resolveExperienceVerificationPlan(
      baseRecord({
        experienceExposure: {
          scopes: [{ scopeId: "grp-w4", botId: "bot-1", assetIds: ["a1"] }],
          attachedAt: new Date().toISOString(),
        },
      }),
    );
    const applied = applyExperienceVerification(plan);
    expect(applied.verifiedAssetIds).toEqual(["a1"]);

    // stage write is async via safely; wait a tick
    await new Promise((r) => setTimeout(r, 50));
    const stored = assetsByScope.get("grp-w4")?.[0];
    expect(stored?.outcomeVerifiedCount).toBe(1);
    expect(stored?.injectedCount).toBe(2);
  });

  it("pending ledger remember/take is keyed and consumable", () => {
    rememberPendingLearningInjection({
      key: "agent-x",
      scopes: [{ scopeId: "grp-w4", botId: "bot-1", assetIds: ["a1", "a2"] }],
    });
    expect(peekPendingLearningInjection("agent-x")?.scopes[0]?.assetIds).toEqual(["a1", "a2"]);
    const taken = takePendingLearningInjection("agent-x");
    expect(taken?.scopes[0]?.assetIds).toEqual(["a1", "a2"]);
    expect(peekPendingLearningInjection("agent-x")).toBeUndefined();
  });

  it("set_experience_exposure persists on tip via result service", () => {
    const store = new DurableTaskOutcomeStore(path.join(agentDir, "task-outcomes"));
    const service = new TaskOutcomeResultService({ store, submittedBy: "w4-test" });
    const chat = new ChatTaskOutcomeAdapter(service);
    const opened = chat.createOrRestore({
      taskId: "task-w4-exp",
      scope,
      taskContractVersion: "1.0.0",
      commandId: "create:task-w4-exp",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) {
      return;
    }
    const fencing = opened.fencingToken || "fence-w4";
    const attached = service.submit(
      "task-w4-exp",
      {
        type: "set_experience_exposure",
        experienceExposure: {
          scopes: [{ scopeId: "grp-w4", botId: "bot-1", assetIds: ["a1"] }],
          attachedAt: new Date().toISOString(),
        },
        expectedVersion: opened.record.outcomeVersion,
        fencingToken: fencing,
      },
      { requiredScope: scope, commandId: "exp:task-w4-exp" },
    );
    expect(attached.ok).toBe(true);
    if (!attached.ok) {
      return;
    }
    expect(attached.record.experienceExposure?.scopes[0]?.assetIds).toEqual(["a1"]);
    const reloaded = store.loadTask("task-w4-exp");
    expect(reloaded?.experienceExposure?.scopes[0]?.assetIds).toEqual(["a1"]);
  });
});
