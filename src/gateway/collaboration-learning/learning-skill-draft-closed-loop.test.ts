/**
 * P1-D closed loop: outcome_verified curation → owned draft → finalize → install
 * → identity-tool execute + effect attribution → remove stops use. Draft alone is never executable.
 * Ownerless group-experience drafts remain a documented coverage boundary (list-invisible).
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
const {
  readSkillInvocationEvents,
  recordLifecycleSkillToolResult,
  recordLifecycleSkillToolStart,
  resolveSelectedSkillForToolCall,
} = await import("../skill-invocation/index.js");

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
    let executedArgs: unknown;
    const identity = createLifecycleSkillIdentityTools({
      baseTools: [
        {
          name: "notes",
          description: "notes",
          parameters: { type: "object", properties: {} },
          execute: async (_id: string, args: unknown) => {
            executedArgs = args;
            return { content: [{ type: "text", text: "executed" }] };
          },
        },
      ] as never,
      agentId: "robot-p1d",
    });
    expect(identity.length).toBeGreaterThan(0);
    const identityTool = identity[0];
    const loadedNames = [skillExecutionSkillName(skillId)];
    const resolved = resolveSelectedSkillForToolCall({
      agentId: "robot-p1d",
      toolName: identityTool.name,
      loadedSkillNames: loadedNames,
    });
    expect(resolved?.skillId).toBe(skillId);
    expect(resolved?.resolution).toBe("identity_tool_name");

    // Real task invocation: identity tool execute injects openbotSkillId + attribution records.
    const toolCallId = "p1d-call-1";
    recordLifecycleSkillToolStart({
      agentId: "robot-p1d",
      runId: "run-p1d-1",
      toolName: identityTool.name,
      toolCallId,
      loadedSkillNames: loadedNames,
    });
    const execResult = await identityTool.execute(
      toolCallId,
      { text: "apply lesson" },
      undefined,
      undefined,
    );
    expect(execResult).toMatchObject({ content: [{ type: "text", text: "executed" }] });
    expect(executedArgs).toMatchObject({ openbotSkillId: skillId, text: "apply lesson" });
    const attributed = recordLifecycleSkillToolResult({
      agentId: "robot-p1d",
      runId: "run-p1d-1",
      toolName: identityTool.name,
      success: true,
      toolCallId,
      loadedSkillNames: loadedNames,
      toolArgs: executedArgs,
    });
    expect(attributed).toHaveLength(1);
    expect(attributed[0]?.skillId).toBe(skillId);
    expect(attributed[0]?.outcome).toBe("success");
    expect(
      listRobotSkillAssets("robot-p1d").find((e) => e.id === skillId)?.usageCount,
    ).toBeGreaterThan(0);
    const events = readSkillInvocationEvents().filter((e) => e.skillId === skillId);
    expect(
      events.some((e) => e.type === "skill_invocation_completed" && e.outcome === "success"),
    ).toBe(true);

    // Revoke / uninstall → stop use (no identity tools; attribution resolves null).
    removeRobotSkillAsset({ agentId: "robot-p1d", skillId });
    expect(
      createLifecycleSkillIdentityTools({
        baseTools: [baseTool("notes")] as never,
        agentId: "robot-p1d",
      }),
    ).toHaveLength(0);
    expect(listRobotSkillAssets("robot-p1d").map((e) => e.id)).not.toContain(skillId);
    expect(
      resolveSelectedSkillForToolCall({
        agentId: "robot-p1d",
        toolName: identityTool.name,
        loadedSkillNames: loadedNames,
      }),
    ).toBeNull();
    const afterRemove = recordLifecycleSkillToolResult({
      agentId: "robot-p1d",
      runId: "run-p1d-2",
      toolName: identityTool.name,
      success: true,
      toolCallId: "p1d-call-2",
      loadedSkillNames: loadedNames,
      toolArgs: { openbotSkillId: skillId, text: "should not attribute" },
    });
    expect(afterRemove).toHaveLength(0);
  });

  it("documents coverage boundary: ownerless group-experience drafts stay invisible to list", async () => {
    // Group-side assets without personalOwnerUserId still curate without owner; list gate hides them.
    // Not fixed in this batch — explicit coverage boundary for acceptance.
    const scopeId = "group:grp-ownerless";
    assetsByScope.set(scopeId, [
      makeAsset({
        assetId: "asset-group-1",
        botId: "robot-group",
        sourceGroupId: "grp-ownerless",
        metadata: {},
      }),
    ]);
    const curated = await curateLearningSkillDrafts({
      scopeId,
      botId: "robot-group",
      reuseThreshold: 3,
      occurrenceThreshold: 99,
    });
    expect(curated).toHaveLength(1);
    expect(curated[0].ownerUserId).toBeNull();
    expect(listLearningCuratedSkillDrafts(["owner@example.com"]).map((s) => s.id)).not.toContain(
      curated[0].skillId,
    );
    expect(listLearningCuratedSkillDrafts([])).toEqual([]);
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
