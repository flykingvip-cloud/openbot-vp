import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-skill-invocation-${Date.now()}`);
vi.mock("../../utils.js", () => ({ CONFIG_DIR: tmpDir }));

const {
  getPersonalSkillAssetDetail,
  listRobotSkillAssets,
  resetSkillHealthWindowsCacheForTests,
  saveSkillAsset,
} = await import("../skill-lifecycle-store.js");
const {
  readSkillInvocationEvents,
  recordSkillInvocationCompleted,
  resolveSkillInvocationEventsPath,
} = await import("./index.js");

function clean() {
  resetSkillHealthWindowsCacheForTests();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
}

describe("skill-invocation", () => {
  beforeEach(clean);
  afterEach(() => {
    resetSkillHealthWindowsCacheForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("records durable events and updates usage + lastInvokedAt", () => {
    const saved = saveSkillAsset({
      sourceAgentId: "robot-alpha",
      lifecycle: "private",
      profile: {
        name: "Brief",
        summary: "Make a brief",
        assetType: "capability",
        visibility: "private",
      },
      runtimeDefinition: { prompts: ["be brief"] },
    });

    recordSkillInvocationCompleted({
      skillId: saved.skillId,
      agentId: "robot-alpha",
      skillVersion: "1.0.0",
      outcome: "success",
      latencyMs: 120,
      runId: "run-1",
      businessOutcome: null,
    });

    const relations = listRobotSkillAssets("robot-alpha");
    expect(relations[0]?.usageCount).toBe(1);
    expect(relations[0]?.lastInvokedAt).toBeTypeOf("number");

    const detail = getPersonalSkillAssetDetail(saved.skillId);
    expect(detail.usageCount).toBe(1);
    expect(detail.health.successRate).toBe(1);

    const events = readSkillInvocationEvents({ skillId: saved.skillId });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("skill_invocation_completed");
    expect(fs.existsSync(resolveSkillInvocationEventsPath())).toBe(true);
  });

  it("folds failures into health and keeps businessOutcome nullable", () => {
    const saved = saveSkillAsset({
      sourceAgentId: "robot-alpha",
      lifecycle: "private",
      profile: {
        name: "Brief",
        summary: "Make a brief",
        assetType: "capability",
        visibility: "private",
      },
    });
    recordSkillInvocationCompleted({
      skillId: saved.skillId,
      agentId: "robot-alpha",
      outcome: "failure",
      failureCategory: "tool_error",
      latencyMs: 50,
    });
    const detail = getPersonalSkillAssetDetail(saved.skillId);
    expect(detail.health.status).not.toBe("healthy");
    expect(detail.health.failureReasons.length).toBeGreaterThan(0);

    const events = readSkillInvocationEvents({ skillId: saved.skillId });
    expect(events[0] && "businessOutcome" in events[0] ? events[0].businessOutcome : "x").toBe(
      null,
    );
  });

  it("restores health window samples after process cache reset (restart simulation)", () => {
    const saved = saveSkillAsset({
      sourceAgentId: "robot-alpha",
      lifecycle: "private",
      profile: {
        name: "Brief",
        summary: "Make a brief",
        assetType: "capability",
        visibility: "private",
      },
    });
    recordSkillInvocationCompleted({
      skillId: saved.skillId,
      agentId: "robot-alpha",
      outcome: "success",
      latencyMs: 10,
    });
    recordSkillInvocationCompleted({
      skillId: saved.skillId,
      agentId: "robot-alpha",
      outcome: "failure",
      failureCategory: "timeout",
      latencyMs: 20,
    });

    // Simulate process restart: clear in-memory cache, keep disk files.
    resetSkillHealthWindowsCacheForTests();
    recordSkillInvocationCompleted({
      skillId: saved.skillId,
      agentId: "robot-alpha",
      outcome: "success",
      latencyMs: 15,
    });
    const detail = getPersonalSkillAssetDetail(saved.skillId);
    // 2 success + 1 failure across restored window
    expect(detail.health.successRate).toBeCloseTo(2 / 3, 5);
  });
});
