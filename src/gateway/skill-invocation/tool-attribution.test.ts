import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-skill-tool-attr-${Date.now()}`);
vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const { saveSkillAsset, listRobotSkillAssets } = await import("../skill-lifecycle-store.js");
const {
  recordLifecycleSkillsLoadedOnRun,
  recordLifecycleSkillToolResult,
  recordLifecycleSkillToolStart,
  readSkillInvocationEvents,
  resolveSelectedSkillForToolCall,
} = await import("./index.js");
const { skillExecutionSkillName } = await import("../skill-execution-binding/paths.js");
const { ensureSkillExecutionBindingHooksRegistered, resetSkillExecutionBindingHooksForTests } =
  await import("../skill-execution-binding/index.js");

function clean() {
  resetSkillExecutionBindingHooksForTests();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  ensureSkillExecutionBindingHooksRegistered();
}

describe("tool-level lifecycle skill attribution", () => {
  beforeEach(clean);
  afterEach(() => {
    resetSkillExecutionBindingHooksForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("records per-tool invocations when skill uniquely owns the tool", () => {
    const saved = saveSkillAsset({
      sourceAgentId: "robot-tools",
      lifecycle: "private",
      profile: {
        name: "Notes skill",
        summary: "Uses notes tool",
        assetType: "capability",
        visibility: "private",
      },
      runtimeDefinition: {
        prompts: ["use notes"],
        tools: ["notes", "read"],
      },
    });
    const bindingName = skillExecutionSkillName(saved.skillId);
    const events = recordLifecycleSkillsLoadedOnRun({
      agentId: "robot-tools",
      runId: "run-tool-1",
      skillNames: [bindingName],
      outcome: "success",
      toolsUsed: [
        { toolName: "notes", success: true, toolCallId: "c1" },
        { toolName: "notes", success: false, toolCallId: "c2" },
        { toolName: "unrelated", success: true, toolCallId: "c3" },
      ],
    });
    expect(events.length).toBe(2);
    expect(events.every((e) => e.skillId === saved.skillId)).toBe(true);
    expect(events[0]?.outcome).toBe("success");
    expect(events[1]?.outcome).toBe("failure");
    expect(listRobotSkillAssets("robot-tools")[0]?.usageCount).toBe(2);
  });

  it("does not count tool-declared skills when no matching unique owner", () => {
    const saved = saveSkillAsset({
      sourceAgentId: "robot-tools",
      lifecycle: "private",
      profile: {
        name: "Notes skill",
        summary: "Uses notes tool",
        assetType: "capability",
        visibility: "private",
      },
      runtimeDefinition: { prompts: ["use notes"], tools: ["notes"] },
    });
    const events = recordLifecycleSkillsLoadedOnRun({
      agentId: "robot-tools",
      runId: "run-tool-2",
      skillNames: [skillExecutionSkillName(saved.skillId)],
      outcome: "success",
      toolsUsed: [{ toolName: "web_search", success: true, toolCallId: "c1" }],
    });
    expect(events).toHaveLength(0);
    expect(listRobotSkillAssets("robot-tools")[0]?.usageCount).toBe(0);
  });

  it("does NOT fan out shared tools to every skill that declares them", () => {
    const a = saveSkillAsset({
      sourceAgentId: "robot-tools",
      lifecycle: "private",
      profile: {
        name: "Skill A",
        summary: "A",
        assetType: "capability",
        visibility: "private",
      },
      runtimeDefinition: { prompts: ["a"], tools: ["read"] },
    });
    const b = saveSkillAsset({
      sourceAgentId: "robot-tools",
      lifecycle: "private",
      profile: {
        name: "Skill B",
        summary: "B",
        assetType: "capability",
        visibility: "private",
      },
      runtimeDefinition: { prompts: ["b"], tools: ["read"] },
    });
    const names = [skillExecutionSkillName(a.skillId), skillExecutionSkillName(b.skillId)];
    const events = recordLifecycleSkillsLoadedOnRun({
      agentId: "robot-tools",
      runId: "run-shared",
      skillNames: names,
      outcome: "success",
      toolsUsed: [{ toolName: "read", success: true, toolCallId: "shared-1" }],
    });
    // Ambiguous shared tool → no attribution
    expect(events).toHaveLength(0);
    expect(listRobotSkillAssets("robot-tools").every((r) => r.usageCount === 0)).toBe(true);
  });

  it("attributes shared tools when openbotSkillId is explicit", () => {
    const a = saveSkillAsset({
      sourceAgentId: "robot-tools",
      lifecycle: "private",
      profile: {
        name: "Skill A",
        summary: "A",
        assetType: "capability",
        visibility: "private",
      },
      runtimeDefinition: { prompts: ["a"], tools: ["read"] },
    });
    saveSkillAsset({
      sourceAgentId: "robot-tools",
      lifecycle: "private",
      profile: {
        name: "Skill B",
        summary: "B",
        assetType: "capability",
        visibility: "private",
      },
      runtimeDefinition: { prompts: ["b"], tools: ["read"] },
    });
    const names = listRobotSkillAssets("robot-tools").map((e) => skillExecutionSkillName(e.id));
    const events = recordLifecycleSkillToolResult({
      agentId: "robot-tools",
      runId: "run-explicit",
      toolName: "read",
      success: true,
      toolCallId: "call-x",
      loadedSkillNames: names,
      toolArgs: { openbotSkillId: a.skillId, path: "/tmp/x" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.skillId).toBe(a.skillId);
    expect(events[0]?.businessOutcome).toBe("tool_args");
  });

  it("records started at tool start and completed at result with same toolCallId", () => {
    const saved = saveSkillAsset({
      sourceAgentId: "robot-tools",
      lifecycle: "private",
      profile: {
        name: "Notes skill",
        summary: "Uses notes tool",
        assetType: "capability",
        visibility: "private",
      },
      runtimeDefinition: { prompts: ["use notes"], tools: ["notes"] },
    });
    const bindingName = skillExecutionSkillName(saved.skillId);
    const t0 = Date.now() - 50;
    recordLifecycleSkillToolStart({
      agentId: "robot-tools",
      runId: "run-latency",
      toolName: "notes",
      toolCallId: "call-lat",
      loadedSkillNames: [bindingName],
      startedAt: t0,
    });
    const completed = recordLifecycleSkillToolResult({
      agentId: "robot-tools",
      runId: "run-latency",
      toolName: "notes",
      success: true,
      toolCallId: "call-lat",
      loadedSkillNames: [bindingName],
      startedAt: t0,
    });
    expect(completed).toHaveLength(1);
    expect(completed[0]?.latencyMs).toBeGreaterThanOrEqual(40);
    const events = readSkillInvocationEvents({ skillId: saved.skillId });
    expect(events.filter((e) => e.type === "skill_invocation_started")).toHaveLength(1);
    expect(events.filter((e) => e.type === "skill_invocation_completed")).toHaveLength(1);
  });

  it("does not count prompt-only skills as invocations when only loaded (loaded ≠ used)", () => {
    const saved = saveSkillAsset({
      sourceAgentId: "robot-tools",
      lifecycle: "private",
      profile: {
        name: "Prompt skill",
        summary: "No tools",
        assetType: "capability",
        visibility: "private",
      },
      runtimeDefinition: { prompts: ["be helpful"], tools: [] },
    });
    const events = recordLifecycleSkillsLoadedOnRun({
      agentId: "robot-tools",
      runId: "run-prompt-1",
      skillNames: [skillExecutionSkillName(saved.skillId)],
      outcome: "success",
      toolsUsed: [{ toolName: "web_search", success: true, toolCallId: "c1" }],
      assistantTexts: ["I searched the web for you."],
    });
    expect(events).toHaveLength(0);
    expect(listRobotSkillAssets("robot-tools")[0]?.usageCount).toBe(0);
  });

  it("does not count prompt-only named-use unless opt-in env is set", () => {
    const saved = saveSkillAsset({
      sourceAgentId: "robot-tools",
      lifecycle: "private",
      profile: {
        name: "Weekly Brief Template",
        summary: "No tools",
        assetType: "capability",
        visibility: "private",
      },
      runtimeDefinition: { prompts: ["be helpful"], tools: [] },
    });
    const bindingName = skillExecutionSkillName(saved.skillId);
    const prev = process.env.OPENBOT_PROMPT_NAMED_USE_ATTRIBUTION;
    delete process.env.OPENBOT_PROMPT_NAMED_USE_ATTRIBUTION;
    try {
      const off = recordLifecycleSkillsLoadedOnRun({
        agentId: "robot-tools",
        runId: "run-prompt-named-off",
        skillNames: [bindingName],
        outcome: "success",
        toolsUsed: [],
        assistantTexts: [`Using Weekly Brief Template to draft your summary.`],
      });
      expect(off).toHaveLength(0);

      process.env.OPENBOT_PROMPT_NAMED_USE_ATTRIBUTION = "1";
      const on = recordLifecycleSkillsLoadedOnRun({
        agentId: "robot-tools",
        runId: "run-prompt-named-on",
        skillNames: [bindingName],
        outcome: "success",
        toolsUsed: [],
        assistantTexts: [`Using Weekly Brief Template to draft your summary.`],
      });
      expect(on).toHaveLength(1);
      expect(on[0]?.businessOutcome).toBe("prompt_named_use");
    } finally {
      if (prev === undefined) {
        delete process.env.OPENBOT_PROMPT_NAMED_USE_ATTRIBUTION;
      } else {
        process.env.OPENBOT_PROMPT_NAMED_USE_ATTRIBUTION = prev;
      }
    }
  });

  it("is idempotent for the same toolCallId", () => {
    const saved = saveSkillAsset({
      sourceAgentId: "robot-tools",
      lifecycle: "private",
      profile: {
        name: "Notes skill",
        summary: "Uses notes tool",
        assetType: "capability",
        visibility: "private",
      },
      runtimeDefinition: { prompts: ["use notes"], tools: ["notes"] },
    });
    const names = [skillExecutionSkillName(saved.skillId)];
    recordLifecycleSkillToolResult({
      agentId: "robot-tools",
      runId: "run-idem",
      toolName: "notes",
      success: true,
      toolCallId: "same-call",
      loadedSkillNames: names,
    });
    recordLifecycleSkillToolResult({
      agentId: "robot-tools",
      runId: "run-idem",
      toolName: "notes",
      success: true,
      toolCallId: "same-call",
      loadedSkillNames: names,
    });
    expect(listRobotSkillAssets("robot-tools")[0]?.usageCount).toBe(1);
    const events = readSkillInvocationEvents({ skillId: saved.skillId });
    expect(events.filter((e) => e.type === "skill_invocation_completed")).toHaveLength(1);
  });

  it("resolveSelectedSkillForToolCall prefers unique owner among loaded skills", () => {
    const only = saveSkillAsset({
      sourceAgentId: "robot-tools",
      lifecycle: "private",
      profile: {
        name: "Only notes",
        summary: "x",
        assetType: "capability",
        visibility: "private",
      },
      runtimeDefinition: { prompts: ["x"], tools: ["notes"] },
    });
    const resolved = resolveSelectedSkillForToolCall({
      agentId: "robot-tools",
      toolName: "notes",
      loadedSkillNames: [skillExecutionSkillName(only.skillId)],
    });
    expect(resolved?.skillId).toBe(only.skillId);
    expect(resolved?.resolution).toBe("unique_owner");
  });
});
