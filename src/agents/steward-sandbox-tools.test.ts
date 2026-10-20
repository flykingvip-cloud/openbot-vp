import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { createOpenClawCodingTools } from "./pi-tools.js";
import { DEFAULT_TOOL_ALLOW } from "./sandbox/constants.js";
import { isToolAllowed, resolveSandboxToolPolicyForAgent } from "./sandbox/tool-policy.js";
import { createHostSandboxFsBridge } from "./test-helpers/host-sandbox-fs-bridge.js";
import { createPiToolsSandboxContext } from "./test-helpers/pi-tools-sandbox-context.js";
import { resolveToolProfilePolicy } from "./tool-policy.js";

describe("steward meeting/knowledge under sandbox.mode=all", () => {
  it("DEFAULT_TOOL_ALLOW includes knowledge consume and steward meeting/schedule", () => {
    expect(DEFAULT_TOOL_ALLOW).toContain("knowledge_search");
    expect(DEFAULT_TOOL_ALLOW).toContain("knowledge_get");
    expect(DEFAULT_TOOL_ALLOW).toContain("meeting");
    expect(DEFAULT_TOOL_ALLOW).toContain("schedule");
    expect(DEFAULT_TOOL_ALLOW).toContain("knowledge_source");
    expect(DEFAULT_TOOL_ALLOW).toContain("user_operational_identity");
  });

  it("keeps personal-email send available for every sandboxed coding agent", () => {
    const coding = resolveToolProfilePolicy("coding");
    expect(coding?.allow).toContain("user_operational_identity");
    expect(resolveToolProfilePolicy("messaging")?.allow).toContain("user_operational_identity");
    const cfg = {
      tools: { profile: "coding" },
      agents: { list: [{ id: "field-bot" }, { id: "bot-skill" }] },
    } as unknown as OpenBotConfig;
    for (const agentId of ["field-bot", "bot-skill"]) {
      const resolved = resolveSandboxToolPolicyForAgent(cfg, agentId);
      expect(resolved.allow).toContain("user_operational_identity");
      const sandbox = createPiToolsSandboxContext({
        workspaceDir: path.join(os.tmpdir(), `openbot-pe-sandbox-${agentId}`),
        fsBridge: createHostSandboxFsBridge(
          path.join(os.tmpdir(), `openbot-pe-sandbox-${agentId}`),
        ),
        tools: { allow: resolved.allow, deny: resolved.deny },
      });
      const names = createOpenClawCodingTools({
        config: cfg,
        agentId,
        sessionKey: `agent:${agentId}:employee:test`,
        senderIsOwner: true,
        sandbox,
      }).map((tool) => tool.name);
      expect(names).toContain("user_operational_identity");
    }
  });

  it("coding profile allows knowledge_search; meeting stays alsoAllow-only", () => {
    const coding = resolveToolProfilePolicy("coding");
    expect(coding?.allow).toContain("knowledge_search");
    expect(coding?.allow).toContain("knowledge_get");
    expect(coding?.allow ?? []).not.toContain("meeting");
  });

  it("sandbox default allow keeps knowledge_search and meeting", () => {
    const resolved = resolveSandboxToolPolicyForAgent(undefined, "main");
    expect(resolved.allow).toContain("knowledge_search");
    expect(resolved.allow).toContain("knowledge_get");
    expect(resolved.allow).toContain("meeting");
    const policy = { allow: resolved.allow, deny: resolved.deny };
    expect(isToolAllowed(policy, "knowledge_search")).toBe(true);
    expect(isToolAllowed(policy, "meeting")).toBe(true);
  });

  it("merges agent tools.alsoAllow into sandbox allow when allow is explicit", () => {
    const cfg = {
      agents: {
        list: [
          {
            id: "main",
            tools: {
              alsoAllow: ["meeting", "conversation_send"],
              sandbox: { tools: { allow: ["read", "exec"] } },
            },
          },
        ],
      },
    } as unknown as OpenBotConfig;
    const resolved = resolveSandboxToolPolicyForAgent(cfg, "main");
    expect(resolved.allow).toEqual(
      expect.arrayContaining([
        "read",
        "exec",
        "image",
        "meeting",
        "conversation_send",
        "user_operational_identity",
      ]),
    );
  });

  it("sandboxed steward constructedTools keep meeting and knowledge_*", () => {
    const sandboxDir = path.join(os.tmpdir(), "openbot-steward-sandbox-tools");
    const cfg = {
      agents: {
        list: [
          {
            id: "main",
            default: true,
            tools: {
              profile: "coding",
              alsoAllow: [
                "meeting",
                "schedule",
                "knowledge_source",
                "diagnose",
                "evolution_perception",
                "conversation_send",
              ],
            },
          },
        ],
      },
    } as unknown as OpenBotConfig;

    const sandbox = createPiToolsSandboxContext({
      workspaceDir: sandboxDir,
      agentWorkspaceDir: path.join(os.tmpdir(), "openbot-steward-workspace"),
      workspaceAccess: "rw",
      fsBridge: createHostSandboxFsBridge(sandboxDir),
      // Simulate LIVE default sandbox allow (post-fix includes knowledge/meeting).
      tools: {
        allow: [...DEFAULT_TOOL_ALLOW],
        deny: [],
      },
    });

    const tools = createOpenClawCodingTools({
      config: cfg,
      agentId: "main",
      sessionKey: "agent:main:employee:test",
      senderIsOwner: true,
      gatewayClientUser: "u@example.com",
      sandbox,
    });
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("meeting");
    expect(names).toContain("knowledge_search");
    expect(names).toContain("knowledge_get");
    expect(names).toContain("schedule");
    expect(names).toContain("knowledge_source");
  });

  it("regression: pre-fix sandbox allow without knowledge/meeting strips them", () => {
    const sandboxDir = path.join(os.tmpdir(), "openbot-steward-sandbox-legacy");
    const cfg = {
      agents: {
        list: [
          {
            id: "main",
            default: true,
            tools: {
              profile: "coding",
              alsoAllow: ["meeting", "schedule", "knowledge_source"],
            },
          },
        ],
      },
    } as unknown as OpenBotConfig;

    const legacyAllow = [
      "exec",
      "process",
      "read",
      "write",
      "edit",
      "apply_patch",
      "image",
      "sessions_list",
      "sessions_history",
      "sessions_send",
      "sessions_spawn",
      "subagents",
      "session_status",
      "scheduled_task",
    ];

    const sandbox = createPiToolsSandboxContext({
      workspaceDir: sandboxDir,
      fsBridge: createHostSandboxFsBridge(sandboxDir),
      tools: { allow: legacyAllow, deny: [] },
    });

    const tools = createOpenClawCodingTools({
      config: cfg,
      agentId: "main",
      sessionKey: "agent:main:employee:test",
      senderIsOwner: true,
      gatewayClientUser: "u@example.com",
      sandbox,
    });
    const names = tools.map((tool) => tool.name);
    // Legacy explicit sandbox allow (no alsoAllow merge into this fixture) strips them.
    // resolveSandboxToolPolicyForAgent would merge alsoAllow when building from cfg;
    // here we pass a frozen allow list to prove the LIVE failure mode.
    expect(names).not.toContain("meeting");
    expect(names).not.toContain("knowledge_search");
  });

  it("LIVE path: resolveSandboxToolPolicyForAgent + alsoAllow keeps meeting/knowledge in constructedTools", () => {
    const sandboxDir = path.join(os.tmpdir(), "openbot-steward-sandbox-live-path");
    const cfg = {
      agents: {
        defaults: { sandbox: { mode: "all", scope: "agent" } },
        list: [
          {
            id: "main",
            default: true,
            tools: {
              profile: "coding",
              alsoAllow: ["meeting", "schedule", "knowledge_source"],
            },
          },
        ],
      },
    } as unknown as OpenBotConfig;

    const resolved = resolveSandboxToolPolicyForAgent(cfg, "main");
    const sandbox = createPiToolsSandboxContext({
      workspaceDir: sandboxDir,
      fsBridge: createHostSandboxFsBridge(sandboxDir),
      tools: { allow: resolved.allow, deny: resolved.deny },
    });

    const tools = createOpenClawCodingTools({
      config: cfg,
      agentId: "main",
      sessionKey: "agent:main:employee:e8666db5-f43d-4d98-883e-536a6808a8c0",
      senderIsOwner: true,
      gatewayClientUser: "zhangxs@royaltech.cn",
      sandbox,
    });
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("meeting");
    expect(names).toContain("knowledge_search");
    expect(names).toContain("knowledge_get");
    expect(names).toContain("schedule");
    expect(names).toContain("knowledge_source");
  });
});
