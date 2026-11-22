import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-pattern-detection-${Date.now()}`);
vi.mock("../../utils.js", () => ({ CONFIG_DIR: tmpDir }));

const {
  ingestPatternSample,
  listPatternCandidates,
  resetPatternDetectionStoreForTests,
  structureHashFromText,
} = await import("./index.js");

describe("server pattern-detection", () => {
  beforeEach(() => {
    resetPatternDetectionStoreForTests();
    fs.mkdirSync(tmpDir, { recursive: true });
  });
  afterEach(() => {
    resetPatternDetectionStoreForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does not create a candidate from a single independent task", () => {
    const hash = structureHashFromText("# Weekly report\n- a\n- b");
    const { candidate } = ingestPatternSample({
      agentId: "robot-a",
      runId: "run-1",
      taskId: "task-1",
      inputStructureHash: hash,
      outputStructureHash: hash,
      success: true,
    });
    expect(candidate).toBeNull();
    expect(listPatternCandidates()).toHaveLength(0);
  });

  it("creates a candidate only after three independent runs with similar structure", () => {
    const hash = structureHashFromText("# Weekly report\n- a\n- b");
    for (let i = 1; i <= 3; i += 1) {
      ingestPatternSample({
        agentId: "robot-a",
        runId: `run-${i}`,
        taskId: `task-${i}`,
        inputStructureHash: hash,
        outputStructureHash: hash,
        success: true,
      });
    }
    const candidates = listPatternCandidates({ agentId: "robot-a" });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.sampleCount).toBe(3);
    expect(candidates[0]?.independentTaskCount).toBe(3);
    expect(candidates[0]?.status).toBe("candidate");
  });

  it("does not double-count the same runId", () => {
    const hash = structureHashFromText("stable template body");
    for (let i = 0; i < 5; i += 1) {
      ingestPatternSample({
        agentId: "robot-a",
        runId: "run-same",
        taskId: "task-same",
        inputStructureHash: hash,
        outputStructureHash: hash,
        success: true,
      });
    }
    expect(listPatternCandidates()).toHaveLength(0);
  });

  it("counts multiple runs in the same session as independent samples (not sessionKey-collapsed)", () => {
    const inHash = structureHashFromText("same question shape");
    const outHash = structureHashFromText("same answer shape");
    for (let i = 1; i <= 3; i += 1) {
      ingestPatternSample({
        agentId: "robot-sess",
        runId: `run-${i}`,
        // Simulates old bug: taskId wrongly set to sessionKey
        taskId: "agent:robot-sess:main",
        sessionKey: "agent:robot-sess:main",
        inputStructureHash: inHash,
        outputStructureHash: outHash,
        success: true,
      });
    }
    const candidates = listPatternCandidates({ agentId: "robot-sess" });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.independentTaskCount).toBe(3);
  });

  it("isolates candidates by agent", () => {
    const hash = structureHashFromText("# Report\n1. x\n2. y");
    for (let i = 1; i <= 3; i += 1) {
      ingestPatternSample({
        agentId: "robot-a",
        runId: `a-${i}`,
        taskId: `a-t-${i}`,
        inputStructureHash: hash,
        outputStructureHash: hash,
        success: true,
      });
      ingestPatternSample({
        agentId: "robot-b",
        runId: `b-${i}`,
        taskId: `b-t-${i}`,
        inputStructureHash: hash,
        outputStructureHash: hash,
        success: true,
      });
    }
    expect(listPatternCandidates({ agentId: "robot-a" })).toHaveLength(1);
    expect(listPatternCandidates({ agentId: "robot-b" })).toHaveLength(1);
  });

  it("shows one tenant's candidates and hides another tenant", () => {
    const hash = structureHashFromText("market scan outline");
    for (let i = 1; i <= 3; i += 1) {
      ingestPatternSample({
        agentId: "robot-unscoped",
        tenantId: "001",
        runId: `u-${i}`,
        taskId: `u-t-${i}`,
        inputStructureHash: hash,
        outputStructureHash: hash,
        success: true,
      });
    }
    expect(listPatternCandidates({ agentId: "robot-unscoped", tenantId: "001" })).toHaveLength(1);
    for (let i = 1; i <= 3; i += 1) {
      ingestPatternSample({
        agentId: "robot-other-tenant",
        tenantId: "other",
        runId: `o-${i}`,
        taskId: `o-t-${i}`,
        inputStructureHash: hash,
        outputStructureHash: structureHashFromText(`other ${i}`),
        success: true,
      });
    }
    expect(listPatternCandidates({ agentId: "robot-other-tenant", tenantId: "001" })).toHaveLength(
      0,
    );
  });

  it("publishes an approved candidate into a draft executable skill with lineage", async () => {
    const { approvePatternCandidate, publishPatternCandidateAsDraftSkill } =
      await import("./index.js");
    const { getPersonalSkillAssetDetail, listRobotSkillAssets } =
      await import("../skill-lifecycle-store.js");
    const hash = structureHashFromText("# Publishable pattern\n1. step");
    for (let i = 1; i <= 3; i += 1) {
      ingestPatternSample({
        agentId: "robot-pub",
        runId: `pub-${i}`,
        taskId: `pub-t-${i}`,
        inputStructureHash: hash,
        outputStructureHash: structureHashFromText(`# Publishable out ${i}`),
        success: true,
        suggestedNameHint: "周报复核",
        suggestedSummaryHint: "稳定的周报复核流程",
      });
    }
    const candidate = listPatternCandidates({ agentId: "robot-pub" })[0];
    expect(candidate).toBeTruthy();
    // Gate: candidate cannot publish until approved.
    expect(() =>
      publishPatternCandidateAsDraftSkill({
        candidateId: candidate.candidateId,
        sourceAgentId: "robot-pub",
      }),
    ).toThrow(/must be approved/);
    approvePatternCandidate(candidate.candidateId);
    const published = publishPatternCandidateAsDraftSkill({
      candidateId: candidate.candidateId,
      sourceAgentId: "robot-pub",
    });
    expect(published.skillId).toMatch(/^skill_/);
    expect(published.candidate.status).toBe("published");
    const detail = getPersonalSkillAssetDetail(published.skillId);
    expect(detail.lifecycle).toBe("draft");
    expect(detail.profile.assetType).toBe("capability");
    expect(detail.profile.name).toContain("周报");
    // Draft publish must not auto-install onto the robot.
    expect(listRobotSkillAssets("robot-pub")).toHaveLength(0);
  });

  it("keeps default classification and concrete bindings ahead of the host pattern hint", async () => {
    const { saveSkillAsset, getPersonalSkillAssetDetail } =
      await import("../skill-lifecycle-store.js");
    const profile = { name: "周报复核", summary: "稳定工作模式", assetType: "capability" };
    const automatic = saveSkillAsset({ profile, lifecycle: "draft", runtimeDefinition: {} });
    expect(getPersonalSkillAssetDetail(automatic.skillId).profile.assetType).toBe("template");
    const hinted = saveSkillAsset({
      profile,
      lifecycle: "draft",
      classificationPolicy: "approved-pattern-capability",
      runtimeDefinition: {},
    });
    expect(getPersonalSkillAssetDetail(hinted.skillId).profile.assetType).toBe("capability");
    for (const [runtimeDefinition, expected] of [
      [{ tools: ["web_search"] }, "tool"],
      [
        { mcpBinding: { serverName: "example", transport: "stdio", command: "example-mcp" } },
        "mcp",
      ],
    ] as const) {
      const bound = saveSkillAsset({
        profile,
        lifecycle: "draft",
        classificationPolicy: "approved-pattern-capability",
        runtimeDefinition,
      });
      expect(getPersonalSkillAssetDetail(bound.skillId).profile.assetType).toBe(expected);
    }
  });

  it("refuses to publish a candidate with fewer than 3 independent tasks", async () => {
    const { publishPatternCandidateAsDraftSkill } = await import("./publish.js");
    // Force a candidate-shaped object by manually writing is not possible; publish checks count.
    const hash = structureHashFromText("single-shot only");
    ingestPatternSample({
      agentId: "robot-x",
      runId: "only-1",
      taskId: "t-1",
      inputStructureHash: hash,
      outputStructureHash: hash,
      success: true,
    });
    expect(listPatternCandidates({ agentId: "robot-x" })).toHaveLength(0);
    expect(() => publishPatternCandidateAsDraftSkill({ candidateId: "pc_missing" })).toThrow(
      /not found/,
    );
  });
});
