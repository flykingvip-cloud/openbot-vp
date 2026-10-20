import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-skill-tool-wrap-${Date.now()}`);
vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const { saveSkillAsset, installSkillToRobotAsset, toggleRobotSkillAsset } =
  await import("../skill-lifecycle-store.js");
const {
  buildSkillIdentityToolName,
  createLifecycleSkillIdentityTools,
  isLifecycleSkillToolEligible,
  parseSkillIdentityToolName,
  wrapToolsWithUniqueOwnerSkillInjection,
} = await import("./skill-tool-wrappers.js");
const { resolveSelectedSkillForToolCall } = await import("../skill-invocation/index.js");
const { skillExecutionSkillName } = await import("./paths.js");
const runtime = await import("../agent-runtime-store.js");
const { applyGovernanceRuntimeAction } = await import("../evolution-governance/runtime-actions.js");
const { setGovernanceKillSwitch } = await import("../evolution-governance/index.js");

function clean() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  setGovernanceKillSwitch(false);
}

function baseTool(name: string) {
  return {
    name,
    description: name,
    parameters: { type: "object", properties: {} },
    execute: async (_id: string, args: unknown) => {
      return { content: [{ type: "text", text: JSON.stringify(args) }] };
    },
  };
}

function seedAgent(id: string) {
  const now = Date.now();
  runtime.upsertAgent({
    runtimeAgentId: id,
    name: id,
    runtimeVersion: "1",
    lifecycle: "deployed",
    health: "healthy",
    tenantCoverage: ["tenant-a"],
    boundCapabilityCount: 1,
    activeSessionCount: 0,
    resourceUsage: { cpuPercent: 0, memoryPercent: 0, tokenBudgetUsedPercent: 0 },
    deployedAt: now,
    lastActiveAt: now,
  });
}

describe("skill identity tool wrappers", () => {
  beforeEach(clean);
  afterEach(() => {
    setGovernanceKillSwitch(false);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("builds and parses identity tool names", () => {
    const name = buildSkillIdentityToolName("skill_abc", "notes");
    expect(name).toBe("ob_sk_skill_abc__notes");
    expect(parseSkillIdentityToolName(name)).toEqual({
      skillId: "skill_abc",
      baseTool: "notes",
    });
  });

  it("injects openbotSkillId on unique-owner base tool execute", async () => {
    const saved = saveSkillAsset({
      sourceAgentId: "robot-wrap",
      lifecycle: "private",
      profile: {
        name: "Notes only",
        summary: "x",
        assetType: "capability",
        visibility: "private",
      },
      runtimeDefinition: { prompts: ["x"], tools: ["notes"] },
    });
    let seenArgs: unknown;
    const baseTools = [
      {
        name: "notes",
        description: "notes",
        parameters: { type: "object", properties: {} },
        execute: async (_id: string, args: unknown) => {
          seenArgs = args;
          return { content: [{ type: "text", text: "ok" }] };
        },
      },
    ];
    const wrapped = wrapToolsWithUniqueOwnerSkillInjection({
      tools: baseTools as never,
      agentId: "robot-wrap",
    });
    await wrapped[0].execute("call-1", { text: "hi" }, undefined, undefined);
    expect(seenArgs).toMatchObject({ text: "hi", openbotSkillId: saved.skillId });
  });

  it("creates identity tools that force skill id and resolve correctly", async () => {
    const a = saveSkillAsset({
      sourceAgentId: "robot-wrap",
      lifecycle: "private",
      profile: {
        name: "A",
        summary: "a",
        assetType: "capability",
        visibility: "private",
      },
      runtimeDefinition: { prompts: ["a"], tools: ["read"] },
    });
    saveSkillAsset({
      sourceAgentId: "robot-wrap",
      lifecycle: "private",
      profile: {
        name: "B",
        summary: "b",
        assetType: "capability",
        visibility: "private",
      },
      runtimeDefinition: { prompts: ["b"], tools: ["read"] },
    });
    let seen: unknown;
    const baseTools = [
      {
        name: "read",
        description: "read",
        parameters: { type: "object", properties: {} },
        execute: async (_id: string, args: unknown) => {
          seen = args;
          return { content: [{ type: "text", text: "ok" }] };
        },
      },
    ];
    const identity = createLifecycleSkillIdentityTools({
      baseTools: baseTools as never,
      agentId: "robot-wrap",
    });
    expect(identity.length).toBeGreaterThanOrEqual(2);
    const target = identity.find((t) => t.name.includes(a.skillId.replace(/[^a-zA-Z0-9_]/g, "_")));
    expect(target).toBeTruthy();
    await target!.execute("c1", { path: "/x" }, undefined, undefined);
    expect(seen).toMatchObject({ openbotSkillId: a.skillId });

    const resolved = resolveSelectedSkillForToolCall({
      agentId: "robot-wrap",
      toolName: target!.name,
      loadedSkillNames: [skillExecutionSkillName(a.skillId)],
    });
    expect(resolved?.skillId).toBe(a.skillId);
    expect(resolved?.resolution).toBe("identity_tool_name");
  });

  it("does not create identity tools for draft lifecycle skills", () => {
    const draft = saveSkillAsset({
      sourceAgentId: "robot-draft",
      lifecycle: "draft",
      // Prevent any auto-install path; force install below for leftover-relation case.
      autoInstallEnabled: false,
      profile: {
        name: "Draft skill",
        summary: "not runnable",
        assetType: "capability",
        visibility: "private",
      },
      runtimeDefinition: { prompts: ["draft"], tools: ["notes"] },
    });
    // Leftover / forced relation must still not expose tools.
    installSkillToRobotAsset({ agentId: "robot-draft", skillId: draft.skillId });
    const identity = createLifecycleSkillIdentityTools({
      baseTools: [baseTool("notes")] as never,
      agentId: "robot-draft",
    });
    expect(
      identity.some((t) => t.name.includes(draft.skillId.replace(/[^a-zA-Z0-9_]/g, "_"))),
    ).toBe(false);
    expect(identity).toHaveLength(0);
  });

  it("does not create identity tools when relation is disabled", () => {
    const saved = saveSkillAsset({
      sourceAgentId: "robot-off",
      lifecycle: "private",
      profile: {
        name: "Disabled rel",
        summary: "x",
        assetType: "capability",
        visibility: "private",
      },
      runtimeDefinition: { prompts: ["x"], tools: ["notes"] },
    });
    toggleRobotSkillAsset({ agentId: "robot-off", skillId: saved.skillId, enabled: false });
    const identity = createLifecycleSkillIdentityTools({
      baseTools: [baseTool("notes")] as never,
      agentId: "robot-off",
    });
    expect(identity).toHaveLength(0);
  });

  it("does not create identity tools when agent is governance-paused", () => {
    seedAgent("robot-gov-pause");
    const saved = saveSkillAsset({
      sourceAgentId: "robot-gov-pause",
      lifecycle: "private",
      profile: {
        name: "Paused tools",
        summary: "x",
        assetType: "capability",
        visibility: "private",
      },
      runtimeDefinition: { prompts: ["x"], tools: ["notes"] },
    });
    runtime.createBinding({
      runtimeAgentId: "robot-gov-pause",
      capabilityId: saved.skillId,
      capabilityVersion: "1",
      bindingType: "skill",
      routingPriority: 50,
      loadStrategy: "eager",
    });
    // Before pause: tools present
    expect(
      createLifecycleSkillIdentityTools({
        baseTools: [baseTool("notes")] as never,
        agentId: "robot-gov-pause",
      }).length,
    ).toBeGreaterThan(0);

    applyGovernanceRuntimeAction({ runtimeAgentId: "robot-gov-pause", action: "pause" });
    const after = createLifecycleSkillIdentityTools({
      baseTools: [baseTool("notes")] as never,
      agentId: "robot-gov-pause",
    });
    expect(after).toHaveLength(0);
  });

  it("isLifecycleSkillToolEligible rejects non-executable lifecycles", () => {
    const entry = {
      id: "s1",
      enabled: true,
      lifecycle: "draft" as const,
      installedVersion: "1.0.0",
      profile: { assetType: "capability" as const },
    };
    expect(
      isLifecycleSkillToolEligible({
        entry: entry as never,
        agentId: "x",
        pausedSkillIds: new Set(),
      }),
    ).toBe(false);
  });
});
