/**
 * Real tool construction path for discuss_to_task (not binding-helper-only).
 * Columns: principal ≠ executing agent ≠ source message ≠ execution run.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import {
  clearDiscussToTaskSourceBindingsForTests,
  registerDiscussToTaskSourceBinding,
} from "../../gateway/collaboration-learning/discuss-to-task-source-binding.js";
import { createTrustedGroupStores } from "../../gateway/collaboration-learning/team-resource-auth.js";
import {
  createCollaborationBoardTool,
  type CollaborationBoardToolDeps,
} from "./collaboration-board-tool.js";

const tempDirs: string[] = [];

afterEach(async () => {
  clearDiscussToTaskSourceBindingsForTests();
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  delete process.env.OPENBOT_CONFIG_PATH;
  delete process.env.OPENCLAW_CONFIG_PATH;
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

function detailsOf(result: { details?: unknown }) {
  return result.details as Record<string, unknown>;
}

async function setupGroup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-d2t-tool-"));
  tempDirs.push(root);
  const groupsRoot = path.join(root, "collaboration", "groups");
  const groupLocator = path.join(groupsRoot, "grp_tool");
  await fs.mkdir(groupLocator, { recursive: true });
  const cfg = {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: { claimContract: true },
    },
  } as OpenBotConfig;
  const configPath = path.join(root, "openbot.json");
  await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  setRuntimeConfigSnapshot(cfg, cfg);
  clearConfigCache();
  const trusted = { groupsRoot, groupLocator };
  const stores = createTrustedGroupStores(trusted);
  return { cfg, trusted, stores, root };
}

function stubTeam(
  trusted: { groupsRoot: string; groupLocator: string },
  stores: ReturnType<typeof createTrustedGroupStores>,
): CollaborationBoardToolDeps["resolveTrustedTeam"] {
  return async () =>
    ({
      ok: true as const,
      auth: {
        ok: true as const,
        profile: "personal_local" as const,
        tenantId: "_local",
        actor: "bot:bot-a",
        groupLocator: trusted.groupLocator,
        groupsRoot: trusted.groupsRoot,
        governanceRole: "member" as const,
        memberStatus: "active" as const,
      },
      stores,
      trusted,
      tenant: { tenantId: "_local", trust: "local" },
      groupsRoot: trusted.groupsRoot,
      groupLocator: trusted.groupLocator,
    }) as never;
}

const EXPLICIT = "请团队正式开展市场调研，验收标准：1) 竞品清单 2) 定价建议报告";

describe("collaboration_board discuss_to_task real tool path", () => {
  it("rejects model sourceMessageId override", async () => {
    const { cfg, trusted, stores } = await setupGroup();
    const sourceMessageId = "client-run-inbound-1";
    const principal = "human:owner";
    registerDiscussToTaskSourceBinding({
      sourceMessageId,
      tenantId: "_local",
      groupId: "grp_tool",
      principalActor: principal,
      kind: "trusted_inbound",
    });
    const tool = createCollaborationBoardTool({
      agentSessionKey: "agent:bot-a:main",
      requesterAgentIdOverride: "bot-a",
      agentGroupId: "grp_tool",
      tenantId: "_local",
      inboundSourceMessageId: sourceMessageId,
      inboundPrincipalActor: principal,
      executionRunId: "agent-run-SHOULD-NOT-BE-SOURCE",
      gatewayClientUser: principal,
      config: cfg,
      deps: {
        isEnabled: () => true,
        resolveActor: async () => "bot:bot-a",
        resolveTrustedTeam: stubTeam(trusted, stores),
      },
    });
    const result = detailsOf(
      await tool.execute("tc1", {
        action: "discuss_to_task",
        groupId: "grp_tool",
        message: EXPLICIT,
        acceptanceCriteria: ["竞品清单", "定价建议报告"],
        sourceMessageId: "model-forged-id",
      }),
    );
    expect(result.ok).toBe(false);
    expect(String(result.reason)).toMatch(/source_override/);
  });

  it("legal turn succeeds with distinct identity columns", async () => {
    const { cfg, trusted, stores } = await setupGroup();
    const sourceMessageId = "client-run-inbound-2";
    const principal = "human:owner";
    registerDiscussToTaskSourceBinding({
      sourceMessageId,
      tenantId: "_local",
      groupId: "grp_tool",
      principalActor: principal,
      kind: "trusted_inbound",
    });
    const tool = createCollaborationBoardTool({
      agentSessionKey: "agent:bot-a:main",
      requesterAgentIdOverride: "bot-a",
      agentGroupId: "grp_tool",
      tenantId: "_local",
      inboundSourceMessageId: sourceMessageId,
      inboundPrincipalActor: principal,
      executionRunId: "agent-run-xyz",
      gatewayClientUser: principal,
      config: cfg,
      deps: {
        isEnabled: () => true,
        resolveActor: async () => "bot:bot-a",
        resolveTrustedTeam: stubTeam(trusted, stores),
      },
    });
    const result = detailsOf(
      await tool.execute("tc2", {
        action: "discuss_to_task",
        groupId: "grp_tool",
        message: EXPLICIT,
        title: "市场调研",
        acceptanceCriteria: ["竞品清单", "定价建议报告"],
      }),
    );
    expect(result.ok).toBe(true);
    const identity = result.identity as Record<string, unknown>;
    expect(identity.principalActor).toBe(principal);
    expect(identity.sourceMessageId).toBe(sourceMessageId);
    expect(identity.executionRunId).toBe("agent-run-xyz");
    expect(String(identity.executingAgent)).toMatch(/bot/);
    expect(identity.executionRunId).not.toBe(sourceMessageId);
    const d2t = result.discussToTask as { taskId?: string };
    expect(d2t.taskId).toBeTruthy();
  });

  it("rejects when inboundSourceMessageId missing (agentRunId must not fill)", async () => {
    const { cfg, trusted, stores } = await setupGroup();
    const tool = createCollaborationBoardTool({
      agentSessionKey: "agent:bot-a:main",
      requesterAgentIdOverride: "bot-a",
      agentGroupId: "grp_tool",
      tenantId: "_local",
      executionRunId: "agent-run-only",
      inboundPrincipalActor: "human:owner",
      gatewayClientUser: "human:owner",
      config: cfg,
      deps: {
        isEnabled: () => true,
        resolveActor: async () => "bot:bot-a",
        resolveTrustedTeam: stubTeam(trusted, stores),
      },
    });
    const result = detailsOf(
      await tool.execute("tc3", {
        action: "discuss_to_task",
        groupId: "grp_tool",
        message: EXPLICIT,
        acceptanceCriteria: ["a", "b"],
      }),
    );
    expect(result.ok).toBe(false);
    expect(String(result.reason)).toMatch(/source_unbound/);
  });

  it("rejects principal mismatch (冒用)", async () => {
    const { cfg, trusted, stores } = await setupGroup();
    const sourceMessageId = "client-run-inbound-3";
    registerDiscussToTaskSourceBinding({
      sourceMessageId,
      tenantId: "_local",
      groupId: "grp_tool",
      principalActor: "human:alice",
      kind: "trusted_inbound",
    });
    const tool = createCollaborationBoardTool({
      agentSessionKey: "agent:bot-a:main",
      requesterAgentIdOverride: "bot-a",
      agentGroupId: "grp_tool",
      tenantId: "_local",
      inboundSourceMessageId: sourceMessageId,
      inboundPrincipalActor: "human:bob",
      executionRunId: "run-1",
      gatewayClientUser: "human:bob",
      config: cfg,
      deps: {
        isEnabled: () => true,
        resolveActor: async () => "bot:bot-a",
        resolveTrustedTeam: stubTeam(trusted, stores),
      },
    });
    const result = detailsOf(
      await tool.execute("tc4", {
        action: "discuss_to_task",
        groupId: "grp_tool",
        message: EXPLICIT,
        acceptanceCriteria: ["a", "b"],
      }),
    );
    expect(result.ok).toBe(false);
    expect(String(result.reason)).toMatch(/actor_mismatch/);
  });
});
