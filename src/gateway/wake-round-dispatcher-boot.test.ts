/**
 * Wake-round dispatcher boot — bind/unbind + R4 managed boot composition root.
 * Mocks model reply + space listing; does NOT replace boot runBot; ACL stays on.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Task } from "@openbot/collaboration-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../config/config.js";
import type { OpenBotConfig } from "../config/types.js";
import { createModeBWakeRoundDispatcher } from "./collaboration-dispatch/mode-b-wake-round-dispatcher.js";
import {
  getWakeRoundDispatcher,
  setWakeRoundDispatcher,
} from "./collaboration-dispatch/wake-round-dispatch.js";
import { buildExecutionDeliverableBinding } from "./collaboration-learning/execution-deliverable-binding.js";
import { readTeamDeliverable } from "./collaboration-learning/team-deliverable-submit.js";
import {
  bindGatewayWakeRoundDispatcher,
  resolveModeBWakeRoundContext,
  unbindGatewayWakeRoundDispatcher,
} from "./wake-round-dispatcher-boot.js";
import { persistAuthoritativeGroupMembers } from "./workspace/group-acl.js";
import { resolveTrustedGroupLocator } from "./workspace/group-locator.js";

const getReplyFromConfig = vi.hoisted(() => vi.fn());
const listGatewayCollaborationSpaces = vi.hoisted(() => vi.fn());
const listCollaborationBoardItems = vi.hoisted(() => vi.fn());
const getCollaborationTodolist = vi.hoisted(() => vi.fn());

vi.mock("../auto-reply/reply.js", () => ({
  getReplyFromConfig: (...args: unknown[]) => getReplyFromConfig(...args),
}));

vi.mock("./collaboration-learning/space-store.js", () => ({
  listGatewayCollaborationSpaces: (...args: unknown[]) => listGatewayCollaborationSpaces(...args),
}));

vi.mock("./collaboration-learning/claim-contract-entry.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./collaboration-learning/claim-contract-entry.js")>();
  return {
    ...actual,
    listCollaborationBoardItems: (...args: unknown[]) => listCollaborationBoardItems(...args),
    getCollaborationTodolist: (...args: unknown[]) => getCollaborationTodolist(...args),
  };
});

const tempDirs: string[] = [];
const saved = {
  stateDir: process.env.OPENBOT_STATE_DIR,
  tenantsRoot: process.env.OPENBOT_TENANTS_ROOT,
  securityProfile: process.env.OPENBOT_SECURITY_PROFILE,
  configPath: process.env.OPENBOT_CONFIG_PATH,
  openclawConfigPath: process.env.OPENCLAW_CONFIG_PATH,
};

afterEach(async () => {
  setWakeRoundDispatcher(null);
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  vi.clearAllMocks();
  for (const [key, value] of Object.entries(saved)) {
    const envKey =
      key === "stateDir"
        ? "OPENBOT_STATE_DIR"
        : key === "tenantsRoot"
          ? "OPENBOT_TENANTS_ROOT"
          : key === "securityProfile"
            ? "OPENBOT_SECURITY_PROFILE"
            : key === "configPath"
              ? "OPENBOT_CONFIG_PATH"
              : "OPENCLAW_CONFIG_PATH";
    if (value === undefined) {
      delete process.env[envKey];
    } else {
      process.env[envKey] = value;
    }
  }
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe("wake-round-dispatcher-boot bind/unbind", () => {
  beforeEach(() => {
    listGatewayCollaborationSpaces.mockResolvedValue({ spaces: [] });
  });

  it("bindGatewayWakeRoundDispatcher registers process dispatcher", () => {
    expect(getWakeRoundDispatcher()).toBeNull();
    bindGatewayWakeRoundDispatcher({ cfg: {} as never });
    expect(getWakeRoundDispatcher()).toEqual(expect.any(Function));
  });

  it("unbindGatewayWakeRoundDispatcher clears registry", () => {
    bindGatewayWakeRoundDispatcher({ cfg: {} as never });
    unbindGatewayWakeRoundDispatcher();
    expect(getWakeRoundDispatcher()).toBeNull();
  });
});

describe("R4 managed boot composition root — ACL on, production runBot", () => {
  async function useManagedRoot() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-pr129-r4-boot-"));
    tempDirs.push(root);
    process.env.OPENBOT_STATE_DIR = path.join(root, "state");
    process.env.OPENBOT_TENANTS_ROOT = path.join(root, "tenants");
    process.env.OPENBOT_SECURITY_PROFILE = "managed_enterprise";
    const cfg = {
      agents: { defaults: { workspace: path.join(root, "agent-ws") } },
      gateway: { security: { profile: "managed_enterprise" } },
      collaboration: {
        defaults: { workspace: path.join(root, "collaboration") },
        runtimeNamespace: true,
        task: {
          claimContract: true,
          wakeContract: true,
          wakeContractGroupAllowlist: ["*"],
          selfAdvance: { mode: "execute", executeGroupAllowlist: ["*"] },
        },
      },
    } as OpenBotConfig;
    const configPath = path.join(root, "openbot.json");
    await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
    process.env.OPENBOT_CONFIG_PATH = configPath;
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    setRuntimeConfigSnapshot(cfg, cfg);
    clearConfigCache();
    return { root, cfg };
  }

  function spaceSnapshot(params: {
    groupId: string;
    tenantId: string;
    bots: Array<{ agentId: string; status?: string }>;
  }) {
    return {
      id: params.groupId,
      groupId: params.groupId,
      title: params.groupId,
      tenantId: params.tenantId,
      members: {
        humans: [],
        bots: params.bots.map((b) => ({
          agentId: b.agentId,
          name: b.agentId,
          status: b.status ?? "active",
        })),
      },
      operatingState: null,
      coordinatorBotId: params.bots[0]?.agentId ?? null,
    };
  }

  async function seedTenantGroup(params: {
    cfg: OpenBotConfig;
    tenantId: string;
    groupId: string;
    agentId: string;
    taskId: string;
    peerId?: string;
  }) {
    const members = [
      {
        memberId: `m-${params.agentId}`,
        memberKind: "bot" as const,
        agentId: params.agentId,
        userId: params.agentId,
        governanceRole: "member" as const,
        status: "active" as const,
        updatedAtMs: Date.now(),
      },
      {
        memberId: `m-owner-${params.tenantId}`,
        memberKind: "human" as const,
        userId: params.peerId ?? `human-${params.tenantId}`,
        governanceRole: "owner" as const,
        status: "active" as const,
        updatedAtMs: Date.now(),
      },
    ];
    await persistAuthoritativeGroupMembers({
      groupId: params.groupId,
      tenantId: params.tenantId,
      profile: "managed_enterprise",
      cfg: params.cfg,
      members,
    });
    const groupLocator = resolveTrustedGroupLocator({
      groupId: params.groupId,
      tenantId: params.tenantId,
      profile: "managed_enterprise",
      cfg: params.cfg,
    });
    const { createTrustedGroupStores } =
      await import("./collaboration-learning/team-resource-auth.js");
    const stores = createTrustedGroupStores({
      groupsRoot: path.dirname(groupLocator),
      groupLocator,
    });
    const now = Date.now();
    await stores.objectStorage.writeObject(params.groupId, "task", params.taskId, {
      taskId: params.taskId,
      groupId: params.groupId,
      title: params.taskId,
      status: "ready",
      createdAtMs: now,
      updatedAtMs: now,
    } satisfies Task);
    return { groupLocator, stores };
  }

  it("legal service principal writes deliverable via production boot runBot (ACL on)", async () => {
    const { cfg } = await useManagedRoot();
    const groupId = "grp_shared_boot";
    const tenantId = "tenant-a";
    const agentId = "bot-exec";
    const taskId = "task-boot";
    const boardItemId = "board-boot";
    const peerId = "human-a";

    await seedTenantGroup({ cfg, tenantId, groupId, agentId, taskId, peerId });
    // Decoy space for another tenant with same local ids — must not be selected.
    await seedTenantGroup({
      cfg,
      tenantId: "tenant-b",
      groupId,
      agentId,
      taskId,
      peerId: "human-b",
    });

    listGatewayCollaborationSpaces.mockResolvedValue({
      spaces: [
        spaceSnapshot({ groupId, tenantId: "tenant-b", bots: [{ agentId }] }),
        spaceSnapshot({ groupId, tenantId, bots: [{ agentId }] }),
      ],
    });
    listCollaborationBoardItems.mockResolvedValue([
      {
        itemId: boardItemId,
        taskId,
        groupId,
        status: "applied",
        claimantId: agentId,
        title: "boot step",
        remainingWork: "write",
      },
    ]);
    getCollaborationTodolist.mockResolvedValue({
      todolistId: "todo-boot",
      status: "confirmed",
      version: 3,
    });
    getReplyFromConfig.mockResolvedValue({
      text: '完成。\n<<DELIVERABLE title="BootOut" file="boot-out.md">>\nboot-body-managed-v1\n<</DELIVERABLE>>',
    });

    const binding = buildExecutionDeliverableBinding({
      tenantId,
      groupId,
      taskId,
      boardItemId,
      todolistId: "todo-boot",
      planVersion: 3,
      stepId: "step-1",
      runId: "wake_run_boot_r4",
      attemptId: "wake_attempt_boot_r4",
      source: "wake_dispatch",
    });
    expect(binding).toBeTruthy();

    // Sanity: resolver alone picks the matching tenant+group lead (no bots[0] cross-tenant).
    const preview = await resolveModeBWakeRoundContext(
      {
        groupId,
        tenantId,
        fromAgentId: "human:owner",
        toAgentIds: [agentId],
        source: "nudge",
        taskId,
        itemId: boardItemId,
        reason: "r4_managed_boot",
        executionDeliverableBinding: binding,
        dispatchPrompt: "请提交文本成果",
      },
      cfg,
    );
    expect(preview, "context must resolve for matching tenant+group").toBeTruthy();
    expect(preview?.leadBot.agentId).toBe(agentId);

    // Production wiring: Mode B dispatcher → resolveModeBWakeRoundContext → boot runBot.
    const dispatcher = createModeBWakeRoundDispatcher(async (request) =>
      resolveModeBWakeRoundContext(request, cfg),
    );
    const result = await dispatcher({
      groupId,
      tenantId,
      fromAgentId: "human:owner",
      toAgentIds: [agentId],
      source: "nudge",
      taskId,
      itemId: boardItemId,
      reason: "r4_managed_boot",
      executionDeliverableBinding: binding,
      dispatchPrompt: "请提交文本成果",
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(getReplyFromConfig).toHaveBeenCalled();

    const groupLocator = resolveTrustedGroupLocator({
      groupId,
      tenantId,
      profile: "managed_enterprise",
      cfg,
    });
    const deliverablesDir = path.join(groupLocator, "deliverables");
    const files = await fs.readdir(deliverablesDir);
    expect(files.length).toBeGreaterThan(0);
    const body = await fs.readFile(path.join(deliverablesDir, files[0]), "utf8");
    expect(body).toContain("boot-body-managed-v1");

    const { createTrustedGroupStores } =
      await import("./collaboration-learning/team-resource-auth.js");
    const stores = createTrustedGroupStores({
      groupsRoot: path.dirname(groupLocator),
      groupLocator,
    });
    const rows = await stores.objectStorage.listObjects<{ deliverableId: string }>(
      groupId,
      "deliverable",
    );
    expect(rows.length).toBeGreaterThan(0);
    const deliverableId = rows[0].deliverableId;

    // Same-tenant peer reads with ACL on.
    const peerRead = await readTeamDeliverable({
      groupId,
      deliverableId,
      actor: peerId,
      cfg,
      enforceAcl: true,
      tenant: { tenantId, trust: "membership" },
    });
    expect(peerRead.ok, JSON.stringify(peerRead)).toBe(true);
    if (peerRead.ok) {
      expect(peerRead.content).toContain("boot-body-managed-v1");
    }

    // Cross-tenant peer cannot read via ACL.
    const cross = await readTeamDeliverable({
      groupId,
      deliverableId,
      actor: "human-b",
      cfg,
      enforceAcl: true,
      tenant: { tenantId: "tenant-b", trust: "membership" },
    });
    expect(cross.ok).toBe(false);
  });

  it("same groupId+agentId under wrong tenant refuses context (no bots[0] cross-tenant)", async () => {
    const { cfg } = await useManagedRoot();
    const groupId = "grp_shared_boot";
    const agentId = "bot-exec";
    await seedTenantGroup({
      cfg,
      tenantId: "tenant-a",
      groupId,
      agentId,
      taskId: "task-a",
    });
    await seedTenantGroup({
      cfg,
      tenantId: "tenant-b",
      groupId,
      agentId,
      taskId: "task-b",
    });
    // Only tenant-a space is listed — request for tenant-b must not fall back.
    listGatewayCollaborationSpaces.mockResolvedValue({
      spaces: [spaceSnapshot({ groupId, tenantId: "tenant-a", bots: [{ agentId }] })],
    });

    const binding = buildExecutionDeliverableBinding({
      tenantId: "tenant-b",
      groupId,
      taskId: "task-b",
      boardItemId: "board-b",
      todolistId: "todo-b",
      planVersion: 1,
      stepId: "s1",
      runId: "wake_run_cross",
      attemptId: "wake_attempt_cross",
      source: "wake_dispatch",
    });

    const context = await resolveModeBWakeRoundContext(
      {
        groupId,
        tenantId: "tenant-b",
        fromAgentId: "human:owner",
        toAgentIds: [agentId],
        source: "nudge",
        taskId: "task-b",
        itemId: "board-b",
        reason: "cross_tenant_should_fail",
        executionDeliverableBinding: binding,
      },
      cfg,
    );
    expect(context).toBeNull();
  });

  it("revoked / non-member write is refused with no deliverable files", async () => {
    const { cfg } = await useManagedRoot();
    const groupId = "grp_revoke_boot";
    const tenantId = "tenant-a";
    const agentId = "bot-exec";
    const taskId = "task-rev";
    const boardItemId = "board-rev";

    // Seed owner only — executing bot NOT in authoritative members.
    await persistAuthoritativeGroupMembers({
      groupId,
      tenantId,
      profile: "managed_enterprise",
      cfg,
      members: [
        {
          memberId: "m-owner",
          memberKind: "human",
          userId: "human-a",
          governanceRole: "owner",
          status: "active",
          updatedAtMs: Date.now(),
        },
      ],
    });
    const groupLocator = resolveTrustedGroupLocator({
      groupId,
      tenantId,
      profile: "managed_enterprise",
      cfg,
    });
    const { createTrustedGroupStores } =
      await import("./collaboration-learning/team-resource-auth.js");
    const stores = createTrustedGroupStores({
      groupsRoot: path.dirname(groupLocator),
      groupLocator,
    });
    const now = Date.now();
    await stores.objectStorage.writeObject(groupId, "task", taskId, {
      taskId,
      groupId,
      title: taskId,
      status: "ready",
      createdAtMs: now,
      updatedAtMs: now,
    } satisfies Task);

    listGatewayCollaborationSpaces.mockResolvedValue({
      // Space still lists the bot (stale catalog) — ACL must still deny write.
      spaces: [spaceSnapshot({ groupId, tenantId, bots: [{ agentId }] })],
    });
    listCollaborationBoardItems.mockResolvedValue([
      {
        itemId: boardItemId,
        taskId,
        groupId,
        status: "applied",
        claimantId: agentId,
        title: "x",
        remainingWork: "y",
      },
    ]);
    getCollaborationTodolist.mockResolvedValue({
      todolistId: "todo-rev",
      status: "confirmed",
      version: 1,
    });
    getReplyFromConfig.mockResolvedValue({
      text: '<<DELIVERABLE title="No" file="no-out.md">>\nshould-not-land\n<</DELIVERABLE>>',
    });

    const binding = buildExecutionDeliverableBinding({
      tenantId,
      groupId,
      taskId,
      boardItemId,
      todolistId: "todo-rev",
      planVersion: 1,
      stepId: "s1",
      runId: "wake_run_rev",
      attemptId: "wake_attempt_rev",
      source: "wake_dispatch",
    });

    const dispatcher = createModeBWakeRoundDispatcher(async (request) =>
      resolveModeBWakeRoundContext(request, cfg),
    );
    const result = await dispatcher({
      groupId,
      tenantId,
      fromAgentId: "human:owner",
      toAgentIds: [agentId],
      source: "nudge",
      taskId,
      itemId: boardItemId,
      reason: "revoked_member",
      executionDeliverableBinding: binding,
    });
    // Round may still settle at Mode B layer; formal write must not land.
    void result;
    const deliverablesDir = path.join(groupLocator, "deliverables");
    const listing = await fs.readdir(deliverablesDir).catch(() => [] as string[]);
    expect(listing).toEqual([]);
  });

  it("managed without request.tenantId refuses context", async () => {
    const { cfg } = await useManagedRoot();
    listGatewayCollaborationSpaces.mockResolvedValue({
      spaces: [
        spaceSnapshot({ groupId: "grp_x", tenantId: "tenant-a", bots: [{ agentId: "bot" }] }),
      ],
    });
    const context = await resolveModeBWakeRoundContext(
      {
        groupId: "grp_x",
        fromAgentId: "human:owner",
        toAgentIds: ["bot"],
        source: "nudge",
        reason: "missing_tenant",
      },
      cfg,
    );
    expect(context).toBeNull();
  });

  it("incomplete wake_dispatch binding (missing plan fields) refuses context", async () => {
    const { cfg } = await useManagedRoot();
    const groupId = "grp_incomplete";
    const tenantId = "tenant-a";
    const agentId = "bot-exec";
    await seedTenantGroup({ cfg, tenantId, groupId, agentId, taskId: "t1" });
    listGatewayCollaborationSpaces.mockResolvedValue({
      spaces: [spaceSnapshot({ groupId, tenantId, bots: [{ agentId }] })],
    });
    const context = await resolveModeBWakeRoundContext(
      {
        groupId,
        tenantId,
        fromAgentId: "human:owner",
        toAgentIds: [agentId],
        source: "nudge",
        reason: "incomplete_binding",
        // Cast: deliberately incomplete production wake binding.
        executionDeliverableBinding: {
          groupId,
          taskId: "t1",
          boardItemId: "b1",
          runId: "run-1",
          source: "wake_dispatch",
        } as never,
      },
      cfg,
    );
    expect(context).toBeNull();
  });
});
