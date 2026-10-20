import { afterEach, describe, expect, it, vi } from "vitest";
import { resetDeliveryLaneActiveModeForTests } from "../../../gateway/delivery-lane/index.js";
import { createOpenClawTools } from "../../openclaw-tools.js";
import { composeSkillPolicy } from "../../skills/skill-policy.js";
import {
  embeddedToolSetContainsKnowledgeSource,
  resolveEmbeddedAttemptToolsRaw,
} from "./resolve-embedded-tools.js";

describe("resolveEmbeddedAttemptToolsRaw inbound depth construction", () => {
  it("chat disableTools yields an empty tool set and never constructs knowledge_source", () => {
    const createTools = vi.fn(() => createOpenClawTools({ gatewayClientUser: "user@example.com" }));
    const tools = resolveEmbeddedAttemptToolsRaw({
      disableTools: true,
      createTools,
    });
    expect(createTools).not.toHaveBeenCalled();
    expect(tools).toEqual([]);
    expect(tools).toHaveLength(0);
    expect(embeddedToolSetContainsKnowledgeSource(tools)).toBe(false);
  });

  it("retrieve and act construct a non-empty tool set that includes knowledge_source", () => {
    const retrieveTools = resolveEmbeddedAttemptToolsRaw({
      disableTools: false,
      createTools: () => createOpenClawTools({ gatewayClientUser: "user@example.com" }),
    });
    const actTools = resolveEmbeddedAttemptToolsRaw({
      createTools: () => createOpenClawTools({ gatewayClientUser: "user@example.com" }),
    });
    expect(retrieveTools.length).toBeGreaterThan(0);
    expect(actTools.length).toBeGreaterThan(0);
    expect(embeddedToolSetContainsKnowledgeSource(retrieveTools)).toBe(true);
    expect(embeddedToolSetContainsKnowledgeSource(actTools)).toBe(true);
    expect(retrieveTools.map((tool) => tool.name)).toContain("knowledge_source");
    expect(actTools.map((tool) => tool.name)).toContain("knowledge_source");
  });

  it("keeps chat empty even if a retrieve ceiling is passed alongside disableTools", () => {
    const createTools = vi.fn(() => createOpenClawTools({ gatewayClientUser: "user@example.com" }));
    const tools = resolveEmbeddedAttemptToolsRaw({
      disableTools: true,
      inboundToolCeiling: {
        depth: "retrieve",
        maxToolMode: "read",
        maxSideEffectLevel: "none",
      },
      createTools,
    });
    expect(createTools).not.toHaveBeenCalled();
    expect(tools).toEqual([]);
  });

  it("retrieve ceiling drops knowledge_source and write tools at construction", () => {
    const tools = resolveEmbeddedAttemptToolsRaw({
      inboundToolCeiling: {
        depth: "retrieve",
        maxToolMode: "read",
        maxSideEffectLevel: "none",
      },
      createTools: () => createOpenClawTools({ gatewayClientUser: "user@example.com" }),
    });
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("agents_list");
    expect(names).not.toContain("knowledge_source");
    expect(names).not.toContain("message");
    expect(names).not.toContain("browser");
    expect(embeddedToolSetContainsKnowledgeSource(tools)).toBe(false);
  });

  it("drops web_search from the constructed tools array when the group blocks search", () => {
    const policy = composeSkillPolicy({
      groupProfile: { blockedSkills: ["search"] },
    });
    const unfiltered = resolveEmbeddedAttemptToolsRaw({
      createTools: () => createOpenClawTools({ gatewayClientUser: "user@example.com" }),
    });
    const tools = resolveEmbeddedAttemptToolsRaw({
      skillPolicy: policy,
      createTools: () => createOpenClawTools({ gatewayClientUser: "user@example.com" }),
    });
    expect(unfiltered.map((tool) => tool.name)).toContain("web_search");
    expect(tools.map((tool) => tool.name)).not.toContain("web_search");
    expect(tools.map((tool) => tool.name)).not.toContain("ob_sk_search__web_search");
    expect(tools.map((tool) => tool.name)).toContain("knowledge_source");
  });
});

describe("resolveEmbeddedAttemptToolsRaw Tip B LaneMode live hook", () => {
  afterEach(() => {
    resetDeliveryLaneActiveModeForTests();
  });

  it("flag OFF → write still present (zero behavior change)", () => {
    const tools = resolveEmbeddedAttemptToolsRaw({
      deliveryLaneEnabled: false,
      laneMode: "accept",
      createTools: () =>
        [
          { name: "read", execute: async () => ({ content: [] }) },
          { name: "write", execute: async () => ({ content: [] }) },
          { name: "edit", execute: async () => ({ content: [] }) },
        ] as Array<{ name: string; execute: () => Promise<{ content: unknown[] }> }>,
    });
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["read", "write", "edit"]));
  });

  it("flag ON + laneMode=accept → write/edit dropped at live construction gate", () => {
    const tools = resolveEmbeddedAttemptToolsRaw({
      deliveryLaneEnabled: true,
      laneMode: "accept",
      createTools: () =>
        [
          { name: "read", execute: async () => ({ content: [] }) },
          { name: "write", execute: async () => ({ content: [] }) },
          { name: "edit", execute: async () => ({ content: [] }) },
          { name: "apply_patch", execute: async () => ({ content: [] }) },
          { name: "exec", execute: async () => ({ content: [] }) },
        ] as Array<{ name: string; execute: () => Promise<{ content: unknown[] }> }>,
    });
    const names = tools.map((t) => t.name);
    expect(names).toContain("read");
    expect(names).toContain("exec");
    expect(names).not.toContain("write");
    expect(names).not.toContain("edit");
    expect(names).not.toContain("apply_patch");
  });

  it("flag ON + setLaneMode(accept) via agentId registry → write denied at execute", async () => {
    const { attachLane, setLaneMode } = await import("../../../gateway/delivery-lane/service.js");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const laneDir = mkdtempSync(path.join(tmpdir(), "dl-hook-"));
    try {
      const { lane } = await attachLane({
        templateId: "default",
        agentId: "hook-bot-a",
        storeDir: laneDir,
      });
      await setLaneMode({ laneId: lane.laneId, mode: "accept", storeDir: laneDir });

      const writeExec = vi.fn(async () => ({ content: [{ type: "text", text: "wrote" }] }));
      const tools = resolveEmbeddedAttemptToolsRaw({
        deliveryLaneEnabled: true,
        agentId: "hook-bot-a",
        createTools: () =>
          [
            { name: "write", execute: writeExec },
            { name: "read", execute: async () => ({ content: [] }) },
          ] as Array<{ name: string; execute: (...args: unknown[]) => Promise<unknown> }>,
      });
      // write filtered from catalog
      expect(tools.map((t) => t.name)).not.toContain("write");
      expect(tools.map((t) => t.name)).toContain("read");

      // Stale write tool still wrapped if reintroduced — execute denies.
      const stale = resolveEmbeddedAttemptToolsRaw({
        deliveryLaneEnabled: true,
        agentId: "hook-bot-a",
        // Force keep write by applying policy wrap path: use apply via mode + wrap test
        laneMode: "accept",
        createTools: () =>
          [{ name: "exec", execute: writeExec }] as Array<{
            name: string;
            execute: (id: string, params: unknown) => Promise<unknown>;
          }>,
      });
      const execTool = stale.find((t) => t.name === "exec");
      expect(execTool?.execute).toBeTypeOf("function");
      await expect(
        execTool!.execute("call-1", { command: "git push origin HEAD" }),
      ).rejects.toThrow(/denied|lane_mode_accept_denies_merge_argv/);
      expect(writeExec).not.toHaveBeenCalled();
    } finally {
      rmSync(laneDir, { recursive: true, force: true });
    }
  });
});
