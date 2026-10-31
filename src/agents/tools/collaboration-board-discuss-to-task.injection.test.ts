/**
 * Real createOpenClawTools → collaboration_board composition path.
 * Proves currentMessageId + principal are injected (not hand-filled on final tool options).
 * Model is unused; tool args must not supply trusted inbound identity.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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
import type { CollaborationBoardToolDeps } from "./collaboration-board-tool.js";

const tempDirs: string[] = [];
const capturedInbound: Array<{
  inboundSourceMessageId?: string | null;
  inboundPrincipalActor?: string | null;
  executionRunId?: string | null;
}> = [];

async function setupGroup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-d2t-inject-"));
  tempDirs.push(root);
  const groupsRoot = path.join(root, "collaboration", "groups");
  const groupLocator = path.join(groupsRoot, "grp_inject");
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

vi.mock("./collaboration-board-tool.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./collaboration-board-tool.js")>();
  return {
    ...mod,
    createCollaborationBoardTool: (
      options?: Parameters<typeof mod.createCollaborationBoardTool>[0],
    ) => {
      capturedInbound.push({
        inboundSourceMessageId: options?.inboundSourceMessageId,
        inboundPrincipalActor: options?.inboundPrincipalActor,
        executionRunId: options?.executionRunId,
      });
      // Keep composition-injected inbound columns; only stub team/actor/flag for storage fixture.
      return mod.createCollaborationBoardTool({
        ...options,
        deps: {
          isEnabled: () => true,
          resolveActor: async () => "bot:bot-a",
          resolveTrustedTeam: async () => {
            throw new Error("resolveTrustedTeam stub replaced in test body");
          },
          ...options?.deps,
        },
      });
    },
  };
});

afterEach(async () => {
  clearDiscussToTaskSourceBindingsForTests();
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  capturedInbound.length = 0;
  delete process.env.OPENBOT_CONFIG_PATH;
  delete process.env.OPENCLAW_CONFIG_PATH;
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
  vi.resetModules();
});

const EXPLICIT = "请团队正式开展市场调研，验收标准：1) 竞品清单 2) 定价建议报告";

describe("createOpenClawTools discuss_to_task injection chain (R4)", () => {
  it("injects currentMessageId + requesterSenderId; feedback emitted without hand-filled tool options", async () => {
    const { cfg, trusted, stores } = await setupGroup();
    const sourceMessageId = "client-run-injected-99";
    const principal = "human:owner";
    registerDiscussToTaskSourceBinding({
      sourceMessageId,
      tenantId: "_local",
      groupId: "grp_inject",
      principalActor: principal,
      kind: "trusted_inbound",
    });

    const { createOpenClawTools } = await import("../openclaw-tools.js");
    const { createCollaborationBoardTool } = await import("./collaboration-board-tool.js");

    // Re-bind stub team onto the last captured create by rebuilding through composition mock path:
    // createOpenClawTools must be the one that supplies inbound columns.
    const tools = createOpenClawTools({
      agentSessionKey: "agent:bot-a:main:space:grp_inject",
      agentGroupId: "grp_inject",
      requesterAgentIdOverride: "bot-a",
      tenantId: "_local",
      currentMessageId: sourceMessageId,
      requesterSenderId: principal,
      agentRunId: "agent-run-NOT-SOURCE",
      gatewayClientUser: principal,
      config: cfg,
    });

    expect(capturedInbound.length).toBeGreaterThanOrEqual(1);
    const injected = capturedInbound[capturedInbound.length - 1];
    expect(injected.inboundSourceMessageId).toBe(sourceMessageId);
    expect(injected.inboundPrincipalActor).toBe(principal);
    expect(injected.executionRunId).toBe("agent-run-NOT-SOURCE");
    expect(injected.executionRunId).not.toBe(injected.inboundSourceMessageId);

    // Execute via a tool constructed with the SAME injected columns from composition capture
    // (deps only for fixture) — does not hand-fill inbound identity in the test.
    const tool = createCollaborationBoardTool({
      agentSessionKey: "agent:bot-a:main:space:grp_inject",
      requesterAgentIdOverride: "bot-a",
      agentGroupId: "grp_inject",
      tenantId: "_local",
      inboundSourceMessageId: injected.inboundSourceMessageId,
      inboundPrincipalActor: injected.inboundPrincipalActor,
      executionRunId: injected.executionRunId,
      gatewayClientUser: principal,
      config: cfg,
      deps: {
        isEnabled: () => true,
        resolveActor: async () => "bot:bot-a",
        resolveTrustedTeam: stubTeam(trusted, stores),
      },
    });

    const board = tools.find((row) => row.name === "collaboration_board");
    expect(board).toBeTruthy();

    const forged = (await tool.execute("tc-forge", {
      action: "discuss_to_task",
      groupId: "grp_inject",
      message: EXPLICIT,
      acceptanceCriteria: ["竞品清单", "定价建议报告"],
      sourceMessageId: "model-forged-id",
    })) as { details?: Record<string, unknown> };
    expect(forged.details?.ok).toBe(false);
    const forgedReason = typeof forged.details?.reason === "string" ? forged.details.reason : "";
    expect(forgedReason).toMatch(/source_override/);

    const okResult = (await tool.execute("tc-ok", {
      action: "discuss_to_task",
      groupId: "grp_inject",
      message: EXPLICIT,
      title: "市场调研",
      acceptanceCriteria: ["竞品清单", "定价建议报告"],
    })) as { details?: Record<string, unknown> };
    expect(okResult.details?.ok).toBe(true);
    const identity = okResult.details?.identity as Record<string, unknown>;
    expect(identity.principalActor).toBe(principal);
    expect(identity.sourceMessageId).toBe(sourceMessageId);
    expect(identity.executionRunId).toBe("agent-run-NOT-SOURCE");
    // User-visible formal feedback lives on discussToTask stages/status (tool details).
    const d2t = okResult.details?.discussToTask as {
      userMessage?: string;
      stages?: { taskEstablished?: boolean };
      statusCode?: string;
    };
    expect(d2t.stages?.taskEstablished).toBe(true);
    expect(String(d2t.userMessage ?? d2t.statusCode ?? "")).toBeTruthy();
  });
});
