/**
 * F4 locator wiring: managed agent tools must pass a trusted group locator.
 * Compat createWorkspaceCollaborationStores stays refused.
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
import { ClaimContractEntryError } from "../../gateway/collaboration-learning/claim-contract-entry.js";
import { proposeCollaborationTodolist } from "../../gateway/collaboration-learning/claim-contract-entry.js";
import { TRUSTED_GROUP_LOCATOR_REQUIRED } from "../../gateway/collaboration-learning/team-resource-auth.js";
import { persistAuthoritativeGroupMembers } from "../../gateway/workspace/group-acl.js";
import { resolveTrustedGroupLocator } from "../../gateway/workspace/group-locator.js";
import { createCollaborationBoardTool } from "./collaboration-board-tool.js";

const tempDirs: string[] = [];
const saved = {
  state: process.env.OPENBOT_STATE_DIR,
  tenants: process.env.OPENBOT_TENANTS_ROOT,
  config: process.env.OPENBOT_CONFIG_PATH,
  legacyConfig: process.env.OPENCLAW_CONFIG_PATH,
  profile: process.env.OPENBOT_SECURITY_PROFILE,
};

afterEach(async () => {
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  if (saved.state === undefined) delete process.env.OPENBOT_STATE_DIR;
  else process.env.OPENBOT_STATE_DIR = saved.state;
  if (saved.tenants === undefined) delete process.env.OPENBOT_TENANTS_ROOT;
  else process.env.OPENBOT_TENANTS_ROOT = saved.tenants;
  if (saved.config === undefined) delete process.env.OPENBOT_CONFIG_PATH;
  else process.env.OPENBOT_CONFIG_PATH = saved.config;
  if (saved.legacyConfig === undefined) delete process.env.OPENCLAW_CONFIG_PATH;
  else process.env.OPENCLAW_CONFIG_PATH = saved.legacyConfig;
  if (saved.profile === undefined) delete process.env.OPENBOT_SECURITY_PROFILE;
  else process.env.OPENBOT_SECURITY_PROFILE = saved.profile;
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function useManagedRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-f4-locator-"));
  tempDirs.push(root);
  const tenantsRoot = path.join(root, "tenants");
  const stateDir = path.join(root, "state");
  process.env.OPENBOT_STATE_DIR = stateDir;
  process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
  process.env.OPENBOT_SECURITY_PROFILE = "managed_enterprise";
  const cfg = {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "managed_enterprise" } },
    collaboration: {
      defaults: { workspace: path.join(root, "host-collaboration") },
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
  return { root, tenantsRoot, stateDir, cfg };
}

function detailsOf(result: { details?: unknown }) {
  return result.details as Record<string, unknown>;
}

describe("collaboration_board trusted locator", () => {
  it("managed session with stamped enterprise id activates and proposes on the tenant SoT", async () => {
    const { stateDir, cfg } = await useManagedRoot();
    const groupId = "grp-f4-locator";
    const taskId = "F4-locator";
    const tenantId = "001";
    const owner = "user-owner";
    const bot = "bot";
    await persistAuthoritativeGroupMembers({
      groupId,
      tenantId,
      profile: "managed_enterprise",
      cfg,
      members: [
        {
          memberId: owner,
          memberKind: "human",
          userId: owner,
          governanceRole: "owner",
          status: "active",
          updatedAtMs: 1,
        },
        {
          memberId: bot,
          memberKind: "bot",
          userId: bot,
          agentId: bot,
          governanceRole: "member",
          status: "active",
          updatedAtMs: 1,
        },
      ],
    });
    const groupLocator = resolveTrustedGroupLocator({
      groupId,
      tenantId,
      profile: "managed_enterprise",
      cfg,
    });
    const tool = createCollaborationBoardTool({
      requesterAgentIdOverride: bot,
      agentSessionKey: `agent:${bot}:main:space:${groupId}`,
      agentGroupId: groupId,
      tenantId,
      stampedEnterpriseId: tenantId,
      gatewayClientUser: "owner@example.com",
      gatewayClientPlatformUserId: owner,
      gatewayClientSessionDomain: "employee",
      gatewayClientSessionEnterpriseId: tenantId,
      config: cfg,
      deps: { isEnabled: () => true },
    });

    const activated = detailsOf(
      await tool.execute("activate", {
        action: "activate_task",
        taskId,
        title: "F4 连通性交付说明",
        message: "请完成 F4 连通性交付报告并提交团队成果，本周前认领执行。",
        goal: "产出可验收的 F4 连通性交付报告",
        acceptanceCriteria: ["charter.md 已写入团队成果目录"],
        constraints: ["仅本租户 locator", "禁止外发"],
        suggestedClaimantIds: [bot],
        humanConfirmed: true,
        dueAtMs: Date.now() + 86_400_000,
      }),
    );
    expect(activated.ok, JSON.stringify(activated)).toBe(true);
    expect(activated.locatorBound).toBe(true);
    const activation = activated.activation as { status?: string; boardItemId?: string };
    expect(["activated", "partial_success"]).toContain(activation.status);
    const boardItemId = activation.boardItemId ?? "";
    expect(boardItemId).not.toBe("");

    const claimed = detailsOf(
      await tool.execute("claim", {
        action: "claim_item",
        taskId,
        itemId: boardItemId,
        claimantId: bot,
      }),
    );
    expect(claimed.ok).toBe(true);

    const applied = detailsOf(
      await tool.execute("apply", {
        action: "apply_claim",
        taskId,
        itemId: boardItemId,
      }),
    );
    expect(applied.ok).toBe(true);

    const proposed = detailsOf(
      await tool.execute("propose", {
        action: "propose_todolist",
        taskId,
        boardItemId,
        steps: [{ title: "写入 charter.md" }],
      }),
    );
    expect(proposed.ok).toBe(true);
    expect(proposed.locatorBound).toBe(true);
    const todolist = proposed.todolist as { status?: string; todolistId?: string };
    expect(todolist.status).toBe("proposed");

    const listed = detailsOf(
      await tool.execute("list", {
        action: "list_todolists",
        taskId,
      }),
    );
    expect(listed.ok).toBe(true);
    const rows = listed.todolists as Array<{ todolistId?: string }>;
    expect(rows.some((row) => row.todolistId === todolist.todolistId)).toBe(true);

    const taskFile = path.join(groupLocator, "tasks.json");
    const taskRaw = await fs.readFile(taskFile, "utf8");
    expect(taskRaw).toContain(taskId);
    const hostGroup = path.join(
      stateDir,
      "collaboration",
      "groups",
      encodeURIComponent(groupId),
    );
    await expect(fs.stat(hostGroup)).rejects.toThrow();
  });

  it("managed session without stamped locator hard-refuses and does not touch host collaboration", async () => {
    const { stateDir, cfg } = await useManagedRoot();
    const groupId = "grp-f4-nolocator";
    const tool = createCollaborationBoardTool({
      requesterAgentIdOverride: "bot",
      agentSessionKey: `agent:bot:main:space:${groupId}`,
      agentGroupId: groupId,
      config: cfg,
      deps: { isEnabled: () => true },
    });
    const denied = detailsOf(
      await tool.execute("activate-denied", {
        action: "activate_task",
        taskId: "F4-no-locator",
        title: "应拒绝",
        message: "没有可信 locator",
        humanConfirmed: true,
      }),
    );
    expect(denied.ok).toBe(false);
    expect(["trusted_tenant_required", TRUSTED_GROUP_LOCATOR_REQUIRED]).toContain(denied.reason);

    await expect(
      proposeCollaborationTodolist({
        groupId,
        taskId: "F4-no-locator",
        boardItemId: "item-1",
        steps: [{ title: "不应写入" }],
        actor: "bot:bot",
        ownerMemberId: "bot:bot",
        cfg,
      }),
    ).rejects.toMatchObject({
      code: TRUSTED_GROUP_LOCATOR_REQUIRED,
    });

    const hostGroup = path.join(
      stateDir,
      "collaboration",
      "groups",
      encodeURIComponent(groupId),
    );
    await expect(fs.stat(hostGroup)).rejects.toThrow();
  });

  it("direct managed propose without auth is ClaimContractEntryError", async () => {
    const { cfg } = await useManagedRoot();
    try {
      await proposeCollaborationTodolist({
        groupId: "grp-direct",
        taskId: "task-direct",
        boardItemId: "item-direct",
        steps: [{ title: "x" }],
        actor: "bot:bot",
        cfg,
      });
      throw new Error("expected refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(ClaimContractEntryError);
      expect((error as ClaimContractEntryError).code).toBe(TRUSTED_GROUP_LOCATOR_REQUIRED);
      expect((error as Error).message).toContain("createWorkspaceCollaborationStores is refused");
    }
  });
});
