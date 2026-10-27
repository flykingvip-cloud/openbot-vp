/**
 * Wake-round dispatcher boot — bind/unbind + R4/R5 managed boot composition root.
 * Mocks model reply + space listing + ownership SoT; does NOT replace boot runBot;
 * ACL stays on. Ownership mock is required: space snapshot alone must not authorize.
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
import {
  buildExecutionDeliverableBinding,
  runIdFromWakeOpAttempt,
} from "./collaboration-learning/execution-deliverable-binding.js";
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
const findActiveOwnershipRecord = vi.hoisted(() => vi.fn());
const readWakeOpRecord = vi.hoisted(() => vi.fn());

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

vi.mock("./ownership-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ownership-store.js")>();
  return {
    ...actual,
    findActiveOwnershipRecord: (...args: unknown[]) => findActiveOwnershipRecord(...args),
  };
});

vi.mock("./collaboration-dispatch/wake-op-ledger.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./collaboration-dispatch/wake-op-ledger.js")>();
  return {
    ...actual,
    readWakeOpRecord: (...args: unknown[]) => readWakeOpRecord(...args),
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
    findActiveOwnershipRecord.mockReturnValue(null);
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

describe("R4/R5 managed boot composition root — ACL on, production runBot", () => {
  async function useManagedRoot() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-pr129-r5-boot-"));
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

  function seedActiveOwnership(params: { tenantId: string; groupId: string }) {
    findActiveOwnershipRecord.mockImplementation(
      (query: { tenantId: string; subjectKind: string; subjectId: string }) => {
        if (
          query.subjectKind === "group" &&
          query.subjectId === params.groupId &&
          query.tenantId === params.tenantId
        ) {
          return {
            id: `${params.tenantId}:group:${params.groupId}`,
            tenantId: params.tenantId,
            subjectKind: "group",
            subjectId: params.groupId,
            bindingStatus: "active",
          };
        }
        return null;
      },
    );
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

  function wakeBinding(params: {
    tenantId: string;
    groupId: string;
    taskId: string;
    boardItemId: string;
    todolistId?: string;
    planVersion?: number;
    stepId?: string;
    opKey: string;
    attemptId: string;
    agentId: string;
  }) {
    const runId = runIdFromWakeOpAttempt({
      opKey: params.opKey,
      attemptId: params.attemptId,
    });
    return buildExecutionDeliverableBinding({
      tenantId: params.tenantId,
      groupId: params.groupId,
      taskId: params.taskId,
      boardItemId: params.boardItemId,
      todolistId: params.todolistId ?? "todo-boot",
      planVersion: params.planVersion ?? 3,
      stepId: params.stepId ?? "step-1",
      runId,
      attemptId: params.attemptId,
      opKey: params.opKey,
      agentId: params.agentId,
      source: "wake_dispatch",
    });
  }

  it("legal service principal writes deliverable via production boot runBot (ACL on)", async () => {
    const { cfg } = await useManagedRoot();
    const groupId = "grp_shared_boot";
    const tenantId = "tenant-a";
    const agentId = "bot-exec";
    const taskId = "task-boot";
    const boardItemId = "board-boot";
    const peerId = "human-a";
    const opKey = "op_boot_ok";
    const attemptId = "attempt_boot_ok";

    await seedTenantGroup({ cfg, tenantId, groupId, agentId, taskId, peerId });
    await seedTenantGroup({
      cfg,
      tenantId: "tenant-b",
      groupId,
      agentId,
      taskId,
      peerId: "human-b",
    });
    seedActiveOwnership({ tenantId, groupId });
    readWakeOpRecord.mockResolvedValue({
      opKey,
      executionAttemptId: attemptId,
      status: "running",
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

    const binding = wakeBinding({
      tenantId,
      groupId,
      taskId,
      boardItemId,
      opKey,
      attemptId,
      agentId,
    });
    expect(binding).toBeTruthy();

    const preview = await resolveModeBWakeRoundContext(
      {
        groupId,
        tenantId,
        fromAgentId: "human:owner",
        toAgentIds: [agentId],
        source: "nudge",
        taskId,
        itemId: boardItemId,
        reason: "r5_managed_boot",
        wakeOpKey: opKey,
        wakeExecutionAttemptId: attemptId,
        planConfirmBinding: {
          todolistId: "todo-boot",
          confirmedVersion: 3,
          stepId: "step-1",
        },
        executionDeliverableBinding: binding,
        dispatchPrompt: "请提交文本成果",
      },
      cfg,
    );
    expect(preview, "context must resolve for matching tenant+group+ownership").toBeTruthy();
    expect(preview?.leadBot.agentId).toBe(agentId);

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
      reason: "r5_managed_boot",
      wakeOpKey: opKey,
      wakeExecutionAttemptId: attemptId,
      planConfirmBinding: {
        todolistId: "todo-boot",
        confirmedVersion: 3,
        stepId: "step-1",
      },
      executionDeliverableBinding: binding,
      dispatchPrompt: "请提交文本成果",
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.ok && result.roundId).toBe(binding!.runId);
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

  it("space snapshot present but ownership revoked → no model call, no deliverable write", async () => {
    const { cfg } = await useManagedRoot();
    const groupId = "grp_own_revoked";
    const tenantId = "tenant-a";
    const agentId = "bot-exec";
    const taskId = "task-rev-own";
    const boardItemId = "board-rev-own";
    await seedTenantGroup({ cfg, tenantId, groupId, agentId, taskId });
    // Space still lists the group+tenant, but ownership SoT is revoked/missing.
    findActiveOwnershipRecord.mockReturnValue(null);
    listGatewayCollaborationSpaces.mockResolvedValue({
      spaces: [spaceSnapshot({ groupId, tenantId, bots: [{ agentId }] })],
    });
    const binding = wakeBinding({
      tenantId,
      groupId,
      taskId,
      boardItemId,
      opKey: "op_revoked",
      attemptId: "attempt_revoked",
      agentId,
    });
    const context = await resolveModeBWakeRoundContext(
      {
        groupId,
        tenantId,
        fromAgentId: "human:owner",
        toAgentIds: [agentId],
        source: "nudge",
        taskId,
        itemId: boardItemId,
        wakeOpKey: "op_revoked",
        wakeExecutionAttemptId: "attempt_revoked",
        planConfirmBinding: {
          todolistId: "todo-boot",
          confirmedVersion: 3,
          stepId: "step-1",
        },
        executionDeliverableBinding: binding,
        reason: "ownership_revoked",
      },
      cfg,
    );
    expect(context).toBeNull();

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
      wakeOpKey: "op_revoked",
      wakeExecutionAttemptId: "attempt_revoked",
      planConfirmBinding: {
        todolistId: "todo-boot",
        confirmedVersion: 3,
        stepId: "step-1",
      },
      executionDeliverableBinding: binding,
      reason: "ownership_revoked",
    });
    expect(result.ok).toBe(false);
    expect(getReplyFromConfig).not.toHaveBeenCalled();
    const groupLocator = resolveTrustedGroupLocator({
      groupId,
      tenantId,
      profile: "managed_enterprise",
      cfg,
    });
    const listing = await fs
      .readdir(path.join(groupLocator, "deliverables"))
      .catch(() => [] as string[]);
    expect(listing).toEqual([]);
  });

  it("ownership for another tenant / unreadable → must not mint service_execution context", async () => {
    const { cfg } = await useManagedRoot();
    const groupId = "grp_own_other";
    const agentId = "bot-exec";
    await seedTenantGroup({
      cfg,
      tenantId: "tenant-a",
      groupId,
      agentId,
      taskId: "task-a",
    });
    // Ownership only exists for tenant-b; request is tenant-a with space snapshot for tenant-a.
    findActiveOwnershipRecord.mockImplementation(
      (query: { tenantId: string; subjectKind: string; subjectId: string }) => {
        if (
          query.subjectKind === "group" &&
          query.subjectId === groupId &&
          query.tenantId === "tenant-b"
        ) {
          return {
            id: `tenant-b:group:${groupId}`,
            tenantId: "tenant-b",
            subjectKind: "group",
            subjectId: groupId,
            bindingStatus: "active",
          };
        }
        return null;
      },
    );
    listGatewayCollaborationSpaces.mockResolvedValue({
      spaces: [spaceSnapshot({ groupId, tenantId: "tenant-a", bots: [{ agentId }] })],
    });
    const binding = wakeBinding({
      tenantId: "tenant-a",
      groupId,
      taskId: "task-a",
      boardItemId: "board-a",
      opKey: "op_other",
      attemptId: "attempt_other",
      agentId,
    });
    const context = await resolveModeBWakeRoundContext(
      {
        groupId,
        tenantId: "tenant-a",
        fromAgentId: "human:owner",
        toAgentIds: [agentId],
        source: "nudge",
        taskId: "task-a",
        itemId: "board-a",
        wakeOpKey: "op_other",
        wakeExecutionAttemptId: "attempt_other",
        planConfirmBinding: {
          todolistId: "todo-boot",
          confirmedVersion: 3,
          stepId: "step-1",
        },
        executionDeliverableBinding: binding,
        reason: "ownership_other_tenant",
      },
      cfg,
    );
    expect(context).toBeNull();
    expect(getReplyFromConfig).not.toHaveBeenCalled();
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
    seedActiveOwnership({ tenantId: "tenant-b", groupId });
    // Only tenant-a space is listed — request for tenant-b must not fall back.
    listGatewayCollaborationSpaces.mockResolvedValue({
      spaces: [spaceSnapshot({ groupId, tenantId: "tenant-a", bots: [{ agentId }] })],
    });

    const binding = wakeBinding({
      tenantId: "tenant-b",
      groupId,
      taskId: "task-b",
      boardItemId: "board-b",
      todolistId: "todo-b",
      planVersion: 1,
      stepId: "s1",
      opKey: "op_cross",
      attemptId: "attempt_cross",
      agentId,
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
        wakeOpKey: "op_cross",
        wakeExecutionAttemptId: "attempt_cross",
        planConfirmBinding: {
          todolistId: "todo-b",
          confirmedVersion: 1,
          stepId: "s1",
        },
        executionDeliverableBinding: binding,
      },
      cfg,
    );
    expect(context).toBeNull();
  });

  it("request task/board mismatch vs binding refuses context", async () => {
    const { cfg } = await useManagedRoot();
    const groupId = "grp_scope";
    const tenantId = "tenant-a";
    const agentId = "bot-exec";
    await seedTenantGroup({ cfg, tenantId, groupId, agentId, taskId: "task-a" });
    seedActiveOwnership({ tenantId, groupId });
    listGatewayCollaborationSpaces.mockResolvedValue({
      spaces: [spaceSnapshot({ groupId, tenantId, bots: [{ agentId }] })],
    });
    const binding = wakeBinding({
      tenantId,
      groupId,
      taskId: "task-a",
      boardItemId: "board-a",
      opKey: "op_scope",
      attemptId: "attempt_scope",
      agentId,
    });
    const context = await resolveModeBWakeRoundContext(
      {
        groupId,
        tenantId,
        fromAgentId: "human:owner",
        toAgentIds: [agentId],
        source: "nudge",
        taskId: "task-OTHER",
        itemId: "board-a",
        wakeOpKey: "op_scope",
        wakeExecutionAttemptId: "attempt_scope",
        planConfirmBinding: {
          todolistId: "todo-boot",
          confirmedVersion: 3,
          stepId: "step-1",
        },
        executionDeliverableBinding: binding,
        reason: "task_mismatch",
      },
      cfg,
    );
    expect(context).toBeNull();
  });

  it("stale wake attempt (late final) refuses deliverable write", async () => {
    const { cfg } = await useManagedRoot();
    const groupId = "grp_stale_attempt";
    const tenantId = "tenant-a";
    const agentId = "bot-exec";
    const taskId = "task-stale";
    const boardItemId = "board-stale";
    const opKey = "op_stale";
    const oldAttempt = "attempt_old";
    const newAttempt = "attempt_new";
    await seedTenantGroup({ cfg, tenantId, groupId, agentId, taskId });
    seedActiveOwnership({ tenantId, groupId });
    // Current wake-op attempt has moved on (retry) — old binding must not write.
    readWakeOpRecord.mockResolvedValue({
      opKey,
      executionAttemptId: newAttempt,
      status: "running",
    });
    listGatewayCollaborationSpaces.mockResolvedValue({
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
      todolistId: "todo-boot",
      status: "confirmed",
      version: 3,
    });
    getReplyFromConfig.mockResolvedValue({
      text: '<<DELIVERABLE title="Late" file="late.md">>\nlate-should-not-land\n<</DELIVERABLE>>',
    });
    const binding = wakeBinding({
      tenantId,
      groupId,
      taskId,
      boardItemId,
      opKey,
      attemptId: oldAttempt,
      agentId,
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
      wakeOpKey: opKey,
      wakeExecutionAttemptId: oldAttempt,
      planConfirmBinding: {
        todolistId: "todo-boot",
        confirmedVersion: 3,
        stepId: "step-1",
      },
      executionDeliverableBinding: binding,
      reason: "late_attempt",
    });
    void result;
    expect(getReplyFromConfig).toHaveBeenCalled();
    const groupLocator = resolveTrustedGroupLocator({
      groupId,
      tenantId,
      profile: "managed_enterprise",
      cfg,
    });
    const listing = await fs
      .readdir(path.join(groupLocator, "deliverables"))
      .catch(() => [] as string[]);
    expect(listing).toEqual([]);
  });

  it("revoked / non-member write is refused with no deliverable files", async () => {
    const { cfg } = await useManagedRoot();
    const groupId = "grp_revoke_boot";
    const tenantId = "tenant-a";
    const agentId = "bot-exec";
    const taskId = "task-rev";
    const boardItemId = "board-rev";
    const opKey = "op_rev_member";
    const attemptId = "attempt_rev_member";

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
    seedActiveOwnership({ tenantId, groupId });
    readWakeOpRecord.mockResolvedValue({
      opKey,
      executionAttemptId: attemptId,
      status: "running",
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

    const binding = wakeBinding({
      tenantId,
      groupId,
      taskId,
      boardItemId,
      todolistId: "todo-rev",
      planVersion: 1,
      stepId: "s1",
      opKey,
      attemptId,
      agentId,
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
      wakeOpKey: opKey,
      wakeExecutionAttemptId: attemptId,
      planConfirmBinding: {
        todolistId: "todo-rev",
        confirmedVersion: 1,
        stepId: "s1",
      },
      executionDeliverableBinding: binding,
    });
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

  it("incomplete wake_dispatch binding (missing plan/op fields) refuses context", async () => {
    const { cfg } = await useManagedRoot();
    const groupId = "grp_incomplete";
    const tenantId = "tenant-a";
    const agentId = "bot-exec";
    await seedTenantGroup({ cfg, tenantId, groupId, agentId, taskId: "t1" });
    seedActiveOwnership({ tenantId, groupId });
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
