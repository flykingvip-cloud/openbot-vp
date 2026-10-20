import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolvePrimaryGuidance } from "../resolve.js";
import type { GuidanceSnapshot } from "../types.js";
import { GUIDANCE_NONE_ACTION } from "../types.js";
import {
  applyGuidanceLlmCopyRefine,
  createFileGuidanceSuppressionStore,
  evaluateGuidanceSuppression,
  GUIDANCE_SIGNAL_PRIORITY,
  guidanceSnapshotStructuralFields,
  markGuidanceSuppressionOutcome,
  rankGuidanceCandidates,
  recordGuidanceAutoPrompt,
  scoreGuidanceCandidate,
  selectTopPermittedCandidateId,
  setGuidanceGlobalSuppression,
  type GuidanceRankableCandidate,
} from "./index.js";

function candidate(
  partial: Partial<GuidanceRankableCandidate> &
    Pick<GuidanceRankableCandidate, "id" | "nextAction">,
): GuidanceRankableCandidate {
  return {
    scope: "user",
    scenario: "generic",
    degrade: "none",
    generatedAt: 1_000,
    ...partial,
  };
}

describe("guidance personalization P2.1 signal priority", () => {
  it("exposes stable signal priority order", () => {
    expect([...GUIDANCE_SIGNAL_PRIORITY]).toEqual([
      "permission_and_risk",
      "current_blockers",
      "org_role",
      "workspace_or_robot_role",
      "recent_task_type",
      "installed_capabilities",
      "failure_or_abandonment",
      "pace_preference",
    ]);
  });

  it("is deterministic for identical inputs", () => {
    const list = [
      candidate({
        id: "a",
        nextAction: { kind: "install_capabilities", risk: "low", tags: ["ops"] },
        generatedAt: 10,
      }),
      candidate({
        id: "b",
        nextAction: { kind: "start_work", risk: "low", tags: ["ops"], addressesTaskGap: true },
        actionableBlockerCodes: ["skill:mail"],
        generatedAt: 11,
      }),
    ];
    const signals = { orgRole: "ops", recentTaskType: "mail" };
    const r1 = rankGuidanceCandidates(list, signals).map((r) => r.id);
    const r2 = rankGuidanceCandidates(list, signals).map((r) => r.id);
    expect(r1).toEqual(r2);
    expect(r1[0]).toBe("b");
  });

  it("missing signals degrade to zero boosts without invention", () => {
    const scored = scoreGuidanceCandidate(
      candidate({
        id: "x",
        nextAction: { kind: "open_settings", risk: "low" },
      }),
      {},
    );
    expect(scored.breakdown.orgRole).toBe(0);
    expect(scored.breakdown.workspaceOrRobotRole).toBe(0);
    expect(scored.breakdown.recentTaskType).toBe(0);
    expect(scored.permissionDenied).toBe(false);
  });
});

describe("guidance personalization P2.2 ranking regressions", () => {
  it("different org roles change recommendation order", () => {
    const list = [
      candidate({
        id: "sales",
        nextAction: { kind: "bind_identity", risk: "low", tags: ["sales"] },
      }),
      candidate({
        id: "eng",
        nextAction: { kind: "install_capabilities", risk: "low", tags: ["engineering"] },
      }),
    ];
    expect(selectTopPermittedCandidateId(list, { orgRole: "sales" })).toBe("sales");
    expect(selectTopPermittedCandidateId(list, { orgRole: "engineering" })).toBe("eng");
  });

  it("current task gap outranks general capability tips", () => {
    const list = [
      candidate({
        id: "general",
        nextAction: {
          kind: "install_capabilities",
          risk: "low",
          tags: ["mail"],
          capabilityKeys: ["weather"],
        },
      }),
      candidate({
        id: "gap",
        nextAction: {
          kind: "install_capabilities",
          risk: "low",
          tags: ["mail"],
          capabilityKeys: ["mail"],
          addressesTaskGap: true,
        },
        actionableBlockerCodes: ["skill:mail"],
      }),
    ];
    expect(
      selectTopPermittedCandidateId(list, {
        recentTaskType: "mail",
        installedCapabilityKeys: [],
      }),
    ).toBe("gap");
  });

  it("preserves high risk and prefers it over ordinary low-risk tips", () => {
    const high = scoreGuidanceCandidate(
      candidate({
        id: "high",
        nextAction: { kind: "bind_oauth", risk: "high", tags: ["oauth"] },
      }),
    );
    const low = scoreGuidanceCandidate(
      candidate({
        id: "low",
        nextAction: { kind: "open_settings", risk: "low", tags: ["settings"] },
      }),
    );
    expect(high.breakdown.permissionAndRisk).toBeGreaterThan(low.breakdown.permissionAndRisk);
    expect(high.score).toBeGreaterThan(low.score);
  });

  it("permission_denied degrade outranks ordinary recommendations", () => {
    const denied = scoreGuidanceCandidate(
      candidate({
        id: "denied",
        degrade: "permission_denied",
        nextAction: { kind: "none", risk: "low" },
      }),
    );
    const tip = scoreGuidanceCandidate(
      candidate({
        id: "tip",
        nextAction: { kind: "open_settings", risk: "low" },
      }),
    );
    expect(denied.score).toBeGreaterThan(tip.score);
  });

  it("does not recommend actions outside allowedActionKinds", () => {
    const list = [
      candidate({
        id: "forbidden",
        nextAction: { kind: "admin_delete", risk: "high" },
      }),
      candidate({
        id: "allowed",
        nextAction: { kind: "open_settings", risk: "low" },
      }),
    ];
    const ranked = rankGuidanceCandidates(list, {
      permission: { allowedActionKinds: ["open_settings"] },
    });
    expect(ranked.find((r) => r.id === "forbidden")?.permissionDenied).toBe(true);
    expect(
      selectTopPermittedCandidateId(list, {
        permission: { allowedActionKinds: ["open_settings"] },
      }),
    ).toBe("allowed");
  });

  it("failure/abandonment demotes without fabricating lifecycle state", () => {
    const base = candidate({
      id: "repeat",
      nextAction: { kind: "open_settings", risk: "low" },
    });
    const calm = scoreGuidanceCandidate(base, {});
    const noisy = scoreGuidanceCandidate(base, { failureCount: 4, abandonedRecently: true });
    expect(noisy.score).toBeLessThan(calm.score);
    expect((noisy as { lifecycleState?: unknown }).lifecycleState).toBeUndefined();
  });

  it("non-actionable blockers do not add blocking score", () => {
    const withNoise = scoreGuidanceCandidate(
      candidate({
        id: "n",
        nextAction: { kind: "start_work", risk: "low" },
        nonActionableBlockerCodes: ["oauth:missing", "knowledge:unbound"],
      }),
    );
    const clean = scoreGuidanceCandidate(
      candidate({
        id: "c",
        nextAction: { kind: "start_work", risk: "low" },
      }),
    );
    expect(withNoise.breakdown.currentBlockers).toBe(clean.breakdown.currentBlockers);
  });

  it("LLM refine may only change label/reason copy", () => {
    const snapshot: GuidanceSnapshot = {
      scope: "robot",
      scenario: "growth.onboarding",
      confidence: "high",
      currentStage: "install",
      nextAction: {
        kind: "install_capabilities",
        label: "Install skills",
        reason: "Missing skills",
        canSkip: true,
        risk: "medium",
        target: { recommendedSkillKeys: ["mail"] },
      },
      optionalActions: [
        {
          kind: "start_work",
          label: "Start",
          reason: "Ready",
          canSkip: true,
          risk: "low",
        },
      ],
      blockers: [{ code: "skill:mail", kind: "skill", label: "Mail", actionable: true }],
      degrade: "none",
      tenantId: "t1",
      userId: "u1",
      entityId: "bot-1",
      source: "growth",
      generatedAt: 42,
    };

    const refined = applyGuidanceLlmCopyRefine(snapshot, {
      label: "建议安装邮件技能",
      reason: "当前任务缺邮件能力",
      kind: "hacked",
      risk: "low",
      canSkip: false,
      blockers: [],
      target: { module: "evil" },
      optionalActionCopy: [{ index: 0, label: "开始工作", reason: "可以开工" }],
      lifecycleState: "ready",
    });

    expect(refined.nextAction.label).toBe("建议安装邮件技能");
    expect(refined.nextAction.reason).toBe("当前任务缺邮件能力");
    expect(refined.optionalActions[0]?.label).toBe("开始工作");
    expect(guidanceSnapshotStructuralFields(refined)).toEqual(
      guidanceSnapshotStructuralFields(snapshot),
    );
  });

  it("resolvePrimaryGuidance uses personalization when provided", () => {
    const sales: GuidanceSnapshot = {
      scope: "user",
      scenario: "sales_tip",
      confidence: "medium",
      currentStage: "tip",
      nextAction: {
        kind: "open_settings",
        label: "Sales",
        reason: "role",
        canSkip: true,
        risk: "low",
        target: {},
      },
      optionalActions: [],
      blockers: [],
      degrade: "none",
      entityId: "steward",
      source: "daibai",
      generatedAt: 1,
    };
    const eng: GuidanceSnapshot = {
      ...sales,
      scenario: "eng_tip",
      nextAction: {
        kind: "install_capabilities",
        label: "Eng",
        reason: "role",
        canSkip: true,
        risk: "low",
        target: { recommendedSkillKeys: ["engineering"] },
      },
      generatedAt: 2,
    };
    const winner = resolvePrimaryGuidance([sales, eng], {
      personalization: { orgRole: "sales", preferredScenarioTags: ["sales"] },
    });
    // sales scenario tag match via scenario name in tags
    expect(winner.scenario).toBe("sales_tip");
  });
});

describe("guidance personalization P2.3 suppression", () => {
  const tmp = path.join(os.tmpdir(), `guidance-suppress-${Date.now()}`);
  const key = {
    tenantId: "tenant-a",
    userId: "user-a",
    scope: "user" as const,
    entityId: "steward",
  };

  beforeEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("enforces frequency cap and isolates by tenant/user/scope/entity", async () => {
    const store = createFileGuidanceSuppressionStore({ rootDir: tmp });
    const v = "2026.09.03";
    await recordGuidanceAutoPrompt(store, {
      key,
      guidanceContentVersion: v,
      nowMs: 1_000,
      maxPromptsPerWindow: 2,
      windowMs: 10_000,
    });
    await recordGuidanceAutoPrompt(store, {
      key,
      guidanceContentVersion: v,
      nowMs: 2_000,
      maxPromptsPerWindow: 2,
      windowMs: 10_000,
    });
    const blocked = await recordGuidanceAutoPrompt(store, {
      key,
      guidanceContentVersion: v,
      nowMs: 3_000,
      maxPromptsPerWindow: 2,
      windowMs: 10_000,
    });
    expect(blocked.allowAutoPrompt).toBe(false);
    expect(blocked.reason).toBe("suppressed_frequency");

    const other = evaluateGuidanceSuppression(null, {
      key: { ...key, userId: "user-b" },
      guidanceContentVersion: v,
      nowMs: 3_000,
    });
    expect(other.allowAutoPrompt).toBe(true);
    expect(other.reason).toBe("allowed_first");
  });

  it("honors global suppression and versioned re-entry after complete/abandon", async () => {
    const store = createFileGuidanceSuppressionStore({ rootDir: tmp });
    await setGuidanceGlobalSuppression(store, key, {
      suppressed: true,
      guidanceContentVersion: "v1",
      nowMs: 10,
    });
    const suppressed = await recordGuidanceAutoPrompt(store, {
      key,
      guidanceContentVersion: "v1",
      nowMs: 20,
    });
    expect(suppressed.reason).toBe("suppressed_global");

    await markGuidanceSuppressionOutcome(store, key, {
      outcome: "completed",
      guidanceContentVersion: "v1",
      nowMs: 30,
    });
    // clear global for outcome path — mark doesn't clear global; set false
    await setGuidanceGlobalSuppression(store, key, {
      suppressed: false,
      guidanceContentVersion: "v1",
      nowMs: 31,
    });
    const sameVersion = evaluateGuidanceSuppression(await store.read(key), {
      key,
      guidanceContentVersion: "v1",
      nowMs: 40,
    });
    expect(sameVersion.allowAutoPrompt).toBe(false);
    expect(sameVersion.reason).toBe("suppressed_completed_same_version");

    const reentry = evaluateGuidanceSuppression(await store.read(key), {
      key,
      guidanceContentVersion: "v2",
      nowMs: 50,
    });
    expect(reentry.allowAutoPrompt).toBe(true);
    expect(reentry.reason).toBe("allowed_version_reentry");

    await markGuidanceSuppressionOutcome(store, key, {
      outcome: "abandoned",
      guidanceContentVersion: "v2",
      nowMs: 60,
      metadata: { taskBody: "secret task", api_key: "sk-abc", note: "ok" },
    });
    const abandoned = await store.read(key);
    expect(abandoned?.metadata?.taskBody).toBeUndefined();
    expect(abandoned?.metadata?.api_key).toBeUndefined();
    expect(abandoned?.metadata?.note).toBe("ok");

    const abandonedSame = evaluateGuidanceSuppression(abandoned, {
      key,
      guidanceContentVersion: "v2",
      nowMs: 70,
    });
    expect(abandonedSame.reason).toBe("suppressed_abandoned_same_version");
  });

  it("does not invent none-action snapshots when ranking empty", () => {
    const idle = resolvePrimaryGuidance([]);
    expect(idle.nextAction.kind).toBe(GUIDANCE_NONE_ACTION.kind);
    expect(idle.degrade).toBe("no_data");
  });
});
