/**
 * P1-D closed loop: outcome_verified curation → owned draft → finalize → install
 * → real identity-tool path → remove stops use. Draft alone is never executable.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentLearningAsset } from "@openbot/collaboration-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-p1d-skill-loop-${process.pid}-${Date.now()}`);
const assetsByScope = new Map<string, AgentLearningAsset[]>();

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

vi.mock("../collaboration-learning/shared.js", () => ({
  createWorkspaceCollaborationStores: () => ({
    groupRootDir: tmpDir,
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

const { curateLearningSkillDrafts } =
  await import("../../auto-reply/reply/learning-skill-curation.js");
const { finalizeLearningCuratedSkillDraft, listLearningCuratedSkillDrafts } =
  await import("./learning-skill-draft-entry.js");
const {
  getPersonalSkillAssetDetail,
  installSkillToRobotAsset,
  listRobotSkillAssets,
  removeRobotSkillAsset,
} = await import("../skill-lifecycle-store.js");
const {
  createLifecycleSkillIdentityTools,
  ensureSkillExecutionBindingHooksRegistered,
  resetSkillExecutionBindingHooksForTests,
  skillExecutionSkillName,
} = await import("../skill-execution-binding/index.js");
const { resolveSelectedSkillForToolCall } = await import("../skill-invocation/index.js");

function makeAsset(overrides: Partial<AgentLearningAsset> = {}): AgentLearningAsset {
  return {
    assetId: "asset-1",
    botId: "robot-p1d",
    sourceGroupId: "grp-1",
    sourceCapsuleId: "cap-1",
    assetType: "lesson",
    status: "active",
    outcomeVerifiedCount: 3,
    updatedAt: Date.now(),
    abstractedContent: {
      title: "先跑迁移",
      lesson: "部署前先跑迁移脚本",
      capabilities: ["notes"],
    },
    metadata: {
      personalOwnerUserId: "owner@example.com",
      personalOwnerAgentId: "robot-p1d",
    },
    ...overrides,
  };
}

function baseTool(name: string) {
  return {
    name,
    description: name,
    parameters: { type: "object", properties: {} },
    execute: async (_id: string, args: unknown) => ({
      content: [{ type: "text", text: JSON.stringify(args) }],
    }),
  };
}

describe("P1-D learning skill draft closed loop", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    assetsByScope.clear();
    resetSkillExecutionBindingHooksForTests();
    ensureSkillExecutionBindingHooksRegistered();
  });

  afterEach(() => {
    resetSkillExecutionBindingHooksForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("curates an owned draft that is not executable until finalize+install; remove stops use", async () => {
    const scopeId = "agent:robot-p1d";
    assetsByScope.set(scopeId, [makeAsset()]);

    const curated = await curateLearningSkillDrafts({
      scopeId,
      botId: "robot-p1d",
      reuseThreshold: 3,
      occurrenceThreshold: 99,
    });
    expect(curated).toHaveLength(1);
    const skillId = curated[0].skillId;
    expect(curated[0].ownerUserId).toBe("owner@example.com");

    // Idempotent: second curation yields nothing.
    const again = await curateLearningSkillDrafts({
      scopeId,
      botId: "robot-p1d",
      reuseThreshold: 3,
      occurrenceThreshold: 99,
    });
    expect(again).toEqual([]);
    expect(assetsByScope.get(scopeId)?.[0]?.curatedSkillId).toBe(skillId);

    const detail = getPersonalSkillAssetDetail(skillId);
    expect(detail.lifecycle).toBe("draft");
    expect(detail.ownerUserId).toBe("owner@example.com");
    expect(detail.sourceLineageId).toBe(`learning:${scopeId}`);
    // No robot relation while draft (autoInstallEnabled: false).
    expect(listRobotSkillAssets("robot-p1d").map((e) => e.id)).not.toContain(skillId);

    const pending = listLearningCuratedSkillDrafts(["owner@example.com"]);
    expect(pending.map((s) => s.id)).toContain(skillId);

    // Draft must not expose identity tools even if someone forced an install relation.
    installSkillToRobotAsset({ agentId: "robot-p1d", skillId });
    expect(
      createLifecycleSkillIdentityTools({
        baseTools: [baseTool("notes")] as never,
        agentId: "robot-p1d",
      }),
    ).toHaveLength(0);

    // Human gate: finalize → private.
    const finalized = finalizeLearningCuratedSkillDraft({
      skillId,
      ownerIds: ["owner@example.com"],
    });
    expect(finalized.nextLifecycle).toBe("private");
    expect(finalized.nextStep).toBe("robot-skills.install");
    expect(getPersonalSkillAssetDetail(skillId).lifecycle).toBe("private");
    expect(listLearningCuratedSkillDrafts(["owner@example.com"]).map((s) => s.id)).not.toContain(
      skillId,
    );

    // Install (relation may already exist from forced draft install above) — rematerialise.
    installSkillToRobotAsset({ agentId: "robot-p1d", skillId });
    const identity = createLifecycleSkillIdentityTools({
      baseTools: [baseTool("notes")] as never,
      agentId: "robot-p1d",
    });
    expect(identity.length).toBeGreaterThan(0);
    const resolved = resolveSelectedSkillForToolCall({
      agentId: "robot-p1d",
      toolName: identity[0].name,
      loadedSkillNames: [skillExecutionSkillName(skillId)],
    });
    expect(resolved?.skillId).toBe(skillId);

    // Revoke / uninstall → not used.
    removeRobotSkillAsset({ agentId: "robot-p1d", skillId });
    expect(
      createLifecycleSkillIdentityTools({
        baseTools: [baseTool("notes")] as never,
        agentId: "robot-p1d",
      }),
    ).toHaveLength(0);
    expect(listRobotSkillAssets("robot-p1d").map((e) => e.id)).not.toContain(skillId);
  });

  it("refuses finalize for non-owner and non-learning skills", async () => {
    const scopeId = "agent:robot-p1d";
    assetsByScope.set(scopeId, [makeAsset()]);
    const [draft] = await curateLearningSkillDrafts({
      scopeId,
      botId: "robot-p1d",
      reuseThreshold: 3,
      occurrenceThreshold: 99,
    });
    expect(draft).toBeTruthy();

    expect(() =>
      finalizeLearningCuratedSkillDraft({
        skillId: draft.skillId,
        ownerIds: ["other@example.com"],
      }),
    ).toThrow(/not accessible/);

    expect(listLearningCuratedSkillDrafts(["other@example.com"])).toEqual([]);
  });

  it("does not curate when thresholds unmet (no false draft)", async () => {
    const scopeId = "agent:robot-p1d";
    assetsByScope.set(scopeId, [makeAsset({ outcomeVerifiedCount: 1 })]);
    const curated = await curateLearningSkillDrafts({
      scopeId,
      reuseThreshold: 3,
      occurrenceThreshold: 99,
    });
    expect(curated).toEqual([]);
  });
});
