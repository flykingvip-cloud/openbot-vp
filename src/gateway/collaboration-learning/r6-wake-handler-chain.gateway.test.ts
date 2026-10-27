/**
 * R6 — wake trusted SoT + continuous handler + real ACL + chat.send confirm.
 *
 * Proof scope (honest):
 * - mock identity/tenant resolution at the client boundary where noted;
 * - REAL assertGroupMemberAccess / members.json (not always-ok ACL mock);
 * - REAL consumeWakeForRoundDispatch after stop;
 * - REAL chatHandlers["chat.send"] for plan-confirm early-return path
 *   (agent dispatch mocked so confirm failure cannot start execution).
 *
 * Not claimed: full browser UI E2E, autoAdvanceWired, readiness/agent tools.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CollaborationMember, Task } from "@openbot/collaboration-core";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { makeOperatingState } from "../collaboration-dispatch/__fixtures__/policy-source-matrix.js";
import { episodeIdForClientRun } from "../collaboration-dispatch/collaboration-event-key.js";
import { resolveGroupPolicyInput } from "../collaboration-dispatch/resolve-effective-policy.js";
import {
  createRoundPolicySnapshot,
  generatePolicySnapshotId,
} from "../collaboration-dispatch/round-policy-snapshot.js";
import { createRuntimeAuthority } from "../collaboration-dispatch/runtime-authority.js";
import { recheckCurrentDispatchAuthorization } from "../collaboration-dispatch/task-dispatch-auth-recheck.js";
import { consumeWakeForRoundDispatch } from "../collaboration-dispatch/wake-round-dispatch.js";
import { persistAuthoritativeGroupMembers } from "../workspace/group-acl.js";
import { resolveTrustedGroupLocator } from "../workspace/group-locator.js";
import {
  createWorkspaceCollaborationStores,
  readGroupOperatingState,
  writeGroupOperatingState,
} from "./shared.js";
import {
  createTrustedGroupStores,
  resolveHandlerTrustedTeamContext,
} from "./team-resource-auth.js";
import { resolveAuthorityTenantForEntry } from "./trusted-tenant.js";

const resolveTenantMock = vi.fn(async (client: { platformUserId?: string } | null) => {
  const uid = client?.platformUserId?.trim() ?? "";
  const tenantId = uid.includes("/") ? uid.split("/")[0] : null;
  return tenantId
    ? { tenantId, trust: "membership" as const }
    : { tenantId: null, trust: "none" as const };
});

vi.mock("./trusted-tenant.js", async () => {
  const actual = await vi.importActual<typeof import("./trusted-tenant.js")>("./trusted-tenant.js");
  return {
    ...actual,
    resolveCollaborationTenantResolution: (client: unknown) =>
      resolveTenantMock(client as { platformUserId?: string } | null),
    resolveMembershipTenantIdForAcl: async (client: { platformUserId?: string } | null) => {
      const uid = client?.platformUserId?.trim() ?? "";
      return uid.includes("/") ? uid.split("/")[0] : null;
    },
  };
});

vi.mock("./delivery-actor-binding.js", async () => {
  const actual = await vi.importActual<typeof import("./delivery-actor-binding.js")>(
    "./delivery-actor-binding.js",
  );
  return {
    ...actual,
    resolveDeliveryAclActor: async (
      client: { platformUserId?: string; user?: string } | null,
      _groupId: string,
    ) => {
      const uid = client?.platformUserId?.trim() || client?.user?.trim() || "";
      return uid || null;
    },
  };
});

// NOTE: do NOT mock assertGroupMemberAccess — real ACL from members.json.

const listSpacesMock = vi.hoisted(() => vi.fn());
const decideParticipantsMock = vi.hoisted(() => vi.fn());
const dispatchInboundMock = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
const chatTranscriptState = vi.hoisted(() => ({
  transcriptPath: "",
  sessionId: "sess-r6-plan-confirm",
}));

vi.mock("../session-utils.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../session-utils.js")>();
  return {
    ...original,
    loadSessionEntry: (rawKey: string) => ({
      cfg: { session: { mainKey: "main" } },
      storePath: path.join(
        path.dirname(chatTranscriptState.transcriptPath || os.tmpdir()),
        "sessions.json",
      ),
      entry: {
        sessionId: chatTranscriptState.sessionId,
        sessionFile: chatTranscriptState.transcriptPath,
      },
      canonicalKey: rawKey || "main",
    }),
  };
});

vi.mock("../../auto-reply/dispatch.js", () => ({
  dispatchInboundMessage: (...args: unknown[]) =>
    (dispatchInboundMock as (...a: unknown[]) => unknown)(...args),
}));

const learningSnapshotMock = vi.hoisted(() =>
  vi.fn(async (params: { groupId: string }) => ({
    groupId: params.groupId,
    operatingState: null,
    bots: [],
    humans: [],
  })),
);

vi.mock("../collaboration-learning.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../collaboration-learning.js")>();
  return {
    ...original,
    listGatewayCollaborationSpaces: listSpacesMock,
    loadGatewayCollaborationLearningSnapshot: learningSnapshotMock,
    ensureGatewayCollaborationGroupSessions: vi.fn(async () => undefined),
  };
});

vi.mock("../collaboration-dispatch/decision-engine.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../collaboration-dispatch/decision-engine.js")>();
  return {
    ...original,
    decideParticipants: decideParticipantsMock,
  };
});

const resolveActorMock = vi.hoisted(() => vi.fn());
const buildVisibilityMock = vi.hoisted(() => vi.fn());

vi.mock("../employee-workbench-scope.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../employee-workbench-scope.js")>();
  return {
    ...original,
    resolveEmployeeWorkbenchActor: resolveActorMock,
    buildEmployeeSessionVisibilityContext: buildVisibilityMock,
    requiresEmployeeAssetScope: (client: { sessionDomain?: string | null } | null | undefined) =>
      client?.sessionDomain === "employee" || client?.sessionDomain === "enterprise",
  };
});

vi.mock("../tenant-context.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../tenant-context.js")>();
  return {
    ...original,
    resolveTenantContext: vi.fn(
      async (client?: { sessionEnterpriseId?: string; platformUserId?: string } | null) => {
        const tenantId =
          client?.sessionEnterpriseId?.trim() ||
          (client?.platformUserId?.includes("/") ? client.platformUserId.split("/")[0] : null);
        if (!tenantId) {
          return null;
        }
        return { tenantId, userId: client?.platformUserId ?? "unknown" };
      },
    ),
  };
});

const { collaborationTaskActivationHandlers } =
  await import("../server-methods/collaboration-task-activation.js");
const { collaborationLearningHandlers } =
  await import("../server-methods/collaboration-learning.js");
const { chatHandlers } = await import("../server-methods/chat.js");
const { authorizeTeamGroupResourceAccess } = await import("./team-resource-auth.js");

const SHARED_GROUP = "grp-r6-shared-local";
const SHARED_TASK = "task-r6-shared-local";

const TENANTS = [
  {
    tenantId: "tenant-r6-a",
    owner: "tenant-r6-a/emp-owner",
    bot: "tenant-r6-a/bot-analyst",
  },
  {
    tenantId: "tenant-r6-b",
    owner: "tenant-r6-b/emp-owner",
    bot: "tenant-r6-b/bot-analyst",
  },
] as const;

const tempDirs: string[] = [];
const savedEnv = {
  OPENBOT_STATE_DIR: process.env.OPENBOT_STATE_DIR,
  OPENBOT_CONFIG_PATH: process.env.OPENBOT_CONFIG_PATH,
  OPENCLAW_CONFIG_PATH: process.env.OPENCLAW_CONFIG_PATH,
  OPENBOT_SECURITY_PROFILE: process.env.OPENBOT_SECURITY_PROFILE,
  OPENCLAW_SECURITY_PROFILE: process.env.OPENCLAW_SECURITY_PROFILE,
  OPENBOT_TENANTS_ROOT: process.env.OPENBOT_TENANTS_ROOT,
};

afterEach(async () => {
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  await Promise.all(tempDirs.splice(0).map((dir) => fsp.rm(dir, { recursive: true, force: true })));
  dispatchInboundMock.mockClear();
  decideParticipantsMock.mockReset();
  listSpacesMock.mockReset();
});

async function useManagedRoot() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "openbot-r6-handlers-"));
  tempDirs.push(root);
  const tenantsRoot = path.join(root, "tenants");
  process.env.OPENBOT_STATE_DIR = root;
  process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
  const configPath = path.join(root, "openbot.json");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  process.env.OPENBOT_SECURITY_PROFILE = "enterprise";
  process.env.OPENCLAW_SECURITY_PROFILE = "enterprise";
  const cfg = {
    gateway: { security: { profile: "managed_enterprise" } },
    collaboration: {
      runtimeNamespace: true,
      task: {
        claimContract: true,
        wakeContract: true,
      },
    },
  } as OpenBotConfig;
  await fsp.writeFile(configPath, JSON.stringify(cfg, null, 2), "utf8");
  setRuntimeConfigSnapshot(cfg);
  clearConfigCache();
  return { root, tenantsRoot, cfg };
}

function clientFor(owner: string) {
  return {
    platformUserId: owner,
    user: owner,
    connect: { platformUserId: owner },
  };
}

async function invoke(
  handlers: Record<string, Function>,
  method: string,
  params: Record<string, unknown>,
  client: ReturnType<typeof clientFor>,
) {
  let payload: unknown;
  let error: unknown;
  let ok = false;
  await handlers[method]({
    params,
    client,
    respond: (success: boolean, result?: unknown, err?: unknown) => {
      ok = success;
      payload = result;
      error = err;
    },
  } as never);
  return { ok, payload, error };
}

function rosterMembers(owner: string, bot: string): CollaborationMember[] {
  return [
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
      agentId: bot,
      userId: bot,
      governanceRole: "member",
      status: "active",
      updatedAtMs: 1,
    },
  ];
}

/** Seed authoritative members.json + groupStorage roster once (no mid-stream OS patch). */
async function seedTrustedRoster(params: {
  tenantId: string;
  owner: string;
  bot: string;
  cfg: OpenBotConfig;
  groupId?: string;
}) {
  const groupId = params.groupId ?? SHARED_GROUP;
  const groupLocator = resolveTrustedGroupLocator({
    groupId,
    tenantId: params.tenantId,
    profile: "managed_enterprise",
    cfg: params.cfg,
  });
  const groupsRoot = path.dirname(groupLocator);
  const stores = createTrustedGroupStores({ groupsRoot, groupLocator });
  await persistAuthoritativeGroupMembers({
    groupId,
    tenantId: params.tenantId,
    profile: "managed_enterprise",
    cfg: params.cfg,
    members: rosterMembers(params.owner, params.bot),
  });
  await stores.groupStorage.writeProfile({
    groupId,
    groupCode: groupId,
    displayName: `r6-${params.tenantId}`,
    ownerUserId: params.owner,
    coordinatorBotId: params.owner,
    createdAtMs: 1,
    updatedAtMs: 1,
  });
  await stores.groupStorage.writeMembers(groupId, rosterMembers(params.owner, params.bot));
  return { groupLocator, groupsRoot, stores };
}

function buildAuthority(params: {
  cfg: OpenBotConfig;
  groupId: string;
  tenantId: string;
  taskId: string;
  operatingState: ReturnType<typeof makeOperatingState>;
}) {
  const now = Date.now();
  const snapshot = createRoundPolicySnapshot(
    resolveGroupPolicyInput({ operatingState: params.operatingState }),
    { now, idGen: () => generatePolicySnapshotId(now) },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: episodeIdForClientRun(`task-wake:${params.groupId}:${params.taskId}`),
    tenant: resolveAuthorityTenantForEntry({
      preferred: { tenantId: params.tenantId, trust: "membership" },
      groupTenantId: params.tenantId,
    }),
    groupId: params.groupId,
    profile: "managed_enterprise",
    cfg: params.cfg,
  });
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
}

describe("R6 wake auth recheck uses authority-aligned stores (dual-root conflict)", () => {
  test("tenant revoked + legacy still authorized → wake refuses, dispatcher=0", async () => {
    const { cfg, root } = await useManagedRoot();
    const tenantId = "tenant-r6-wake";
    const owner = `${tenantId}/emp-owner`;
    const bot = `${tenantId}/bot-analyst`;
    const groupId = "grp-wake-conflict";
    const taskId = "task-wake-conflict";

    const seeded = await seedTrustedRoster({ tenantId, owner, bot, cfg, groupId });
    // Task with duty binding so recheck enforces membership.
    await seeded.stores.objectStorage.writeObject(groupId, "task", taskId, {
      taskId,
      groupId,
      title: "wake-conflict",
      status: "ready",
      ownerMemberId: owner,
      assignedMemberIds: [bot],
      responsibility: { owner, executors: [bot], reviewers: [], approvers: [owner] },
      controlEpoch: 0,
      createdAtMs: 1,
      updatedAtMs: 1,
    } as Task);

    // Tenant OS: owner present (membership surface) but bot REVOKED from map.
    const tenantOs = makeOperatingState({
      groupId,
      governance: { ownerUserId: owner, adminUserIds: [owner], coordinatorBotId: owner },
    });
    tenantOs.memberRoleMap = [
      {
        memberId: owner,
        memberKind: "human",
        governanceRole: "owner",
        collaborationRole: "contributor",
        status: "active",
      },
      // bot intentionally omitted = revoked on trusted root
    ];
    await writeGroupOperatingState({
      fileStore: seeded.stores.fileStore,
      groupId,
      state: { ...tenantOs, authEpoch: 2, updatedAtMs: Date.now() } as typeof tenantOs & {
        authEpoch: number;
      },
      groupRootDir: seeded.groupsRoot,
      cfg,
      writeKind: "auth",
    });

    // Legacy host root: bot STILL authorized (poison dual-root).
    const legacy = createWorkspaceCollaborationStores(cfg);
    const legacyOs = makeOperatingState({
      groupId,
      governance: { ownerUserId: owner, adminUserIds: [owner], coordinatorBotId: owner },
    });
    legacyOs.memberRoleMap = [
      {
        memberId: owner,
        memberKind: "human",
        governanceRole: "owner",
        collaborationRole: "contributor",
        status: "active",
      },
      {
        memberId: bot,
        memberKind: "bot",
        governanceRole: "member",
        collaborationRole: "contributor",
        status: "active",
      },
    ];
    await writeGroupOperatingState({
      fileStore: legacy.fileStore,
      groupId,
      state: { ...legacyOs, authEpoch: 9, updatedAtMs: Date.now() } as typeof legacyOs & {
        authEpoch: number;
      },
      cfg,
      writeKind: "auth",
    });
    // Also plant a legacy task so a mistaken legacy read would find duty+auth.
    await legacy.objectStorage.writeObject(groupId, "task", taskId, {
      taskId,
      groupId,
      title: "legacy-poison",
      status: "ready",
      ownerMemberId: owner,
      responsibility: { owner, executors: [bot], reviewers: [], approvers: [owner] },
      controlEpoch: 0,
      createdAtMs: 1,
      updatedAtMs: 1,
    } as Task);

    const direct = await recheckCurrentDispatchAuthorization({
      groupId,
      taskId,
      targetActorIds: [bot],
      cfg,
      fileStore: seeded.stores.fileStore,
      objectStorage: seeded.stores.objectStorage,
    });
    expect(direct.ok).toBe(false);
    if (!direct.ok) {
      expect(direct.reason).toBe("auth_revoked");
      expect(direct.revokedActorIds).toContain(bot);
    }

    // Legacy-only recheck would incorrectly authorize — proves the poison exists.
    const legacyRecheck = await recheckCurrentDispatchAuthorization({
      groupId,
      taskId,
      targetActorIds: [bot],
      cfg,
      fileStore: legacy.fileStore,
      objectStorage: legacy.objectStorage,
    });
    expect(legacyRecheck.ok).toBe(true);

    const authority = buildAuthority({
      cfg,
      groupId,
      tenantId,
      taskId,
      operatingState: tenantOs,
    });
    expect(authority.namespace.groupLocator).toContain(path.join(tenantId, "collaboration"));
    expect(authority.namespace.groupLocator).not.toBe(
      path.join(root, "collaboration", "groups", groupId),
    );

    let dispatchedCalls = 0;
    const consume = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      roundDispatcher: async () => {
        dispatchedCalls += 1;
        return { ok: true, roundId: "round-must-not" };
      },
      request: {
        groupId,
        fromAgentId: "system:group_task_heartbeat",
        toAgentIds: [bot],
        source: "nudge",
        taskId,
        itemId: "item-1",
        reason: "r6-conflict-revoke",
      },
    });
    expect(consume.dispatched).toBe(false);
    expect(consume.reason).toBe("auth_revoked");
    expect(dispatchedCalls).toBe(0);
  });

  test("tenant authorized + legacy revoked → wake does not mis-reject on legacy", async () => {
    const { cfg } = await useManagedRoot();
    const tenantId = "tenant-r6-wake-ok";
    const owner = `${tenantId}/emp-owner`;
    const bot = `${tenantId}/bot-analyst`;
    const groupId = "grp-wake-ok";
    const taskId = "task-wake-ok";

    const seeded = await seedTrustedRoster({ tenantId, owner, bot, cfg, groupId });
    await seeded.stores.objectStorage.writeObject(groupId, "task", taskId, {
      taskId,
      groupId,
      title: "wake-ok",
      status: "ready",
      ownerMemberId: owner,
      responsibility: { owner, executors: [bot], reviewers: [], approvers: [owner] },
      controlEpoch: 0,
      createdAtMs: 1,
      updatedAtMs: 1,
    } as Task);

    const tenantOs = makeOperatingState({
      groupId,
      governance: { ownerUserId: owner, adminUserIds: [owner], coordinatorBotId: owner },
    });
    tenantOs.memberRoleMap = [
      {
        memberId: owner,
        memberKind: "human",
        governanceRole: "owner",
        collaborationRole: "contributor",
        status: "active",
      },
      {
        memberId: bot,
        memberKind: "bot",
        governanceRole: "member",
        collaborationRole: "contributor",
        status: "active",
      },
    ];
    await writeGroupOperatingState({
      fileStore: seeded.stores.fileStore,
      groupId,
      state: { ...tenantOs, authEpoch: 3, updatedAtMs: Date.now() } as typeof tenantOs & {
        authEpoch: number;
      },
      groupRootDir: seeded.groupsRoot,
      cfg,
      writeKind: "auth",
    });

    const legacy = createWorkspaceCollaborationStores(cfg);
    const legacyOs = makeOperatingState({
      groupId,
      governance: { ownerUserId: owner, adminUserIds: [owner], coordinatorBotId: owner },
    });
    legacyOs.memberRoleMap = [
      {
        memberId: owner,
        memberKind: "human",
        governanceRole: "owner",
        collaborationRole: "contributor",
        status: "active",
      },
      // bot omitted on legacy — would false-revoke if wake read legacy
    ];
    await writeGroupOperatingState({
      fileStore: legacy.fileStore,
      groupId,
      state: { ...legacyOs, authEpoch: 1, updatedAtMs: Date.now() } as typeof legacyOs & {
        authEpoch: number;
      },
      cfg,
      writeKind: "auth",
    });

    const direct = await recheckCurrentDispatchAuthorization({
      groupId,
      taskId,
      targetActorIds: [bot],
      cfg,
      fileStore: seeded.stores.fileStore,
      objectStorage: seeded.stores.objectStorage,
    });
    expect(direct.ok).toBe(true);

    const authority = buildAuthority({
      cfg,
      groupId,
      tenantId,
      taskId,
      operatingState: tenantOs,
    });
    let dispatchedCalls = 0;
    const consume = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      roundDispatcher: async () => {
        dispatchedCalls += 1;
        return { ok: true, roundId: "round-auth-ok" };
      },
      request: {
        groupId,
        fromAgentId: "system:group_task_heartbeat",
        toAgentIds: [bot],
        source: "nudge",
        taskId,
        itemId: "item-1",
        reason: "r6-conflict-reverse",
      },
    });
    // Strong positive: must actually dispatch once (not "any non-auth failure").
    expect(consume.reason).not.toBe("auth_revoked");
    expect(consume.dispatched).toBe(true);
    expect(dispatchedCalls).toBe(1);
    expect(consume.roundId).toBe("round-auth-ok");

    const afterFirst = (await seeded.stores.objectStorage.readObject(
      groupId,
      "task",
      taskId,
    )) as Task & { dispatchClaim?: unknown };
    expect(afterFirst?.dispatchClaim).toBeFalsy();

    // Second distinct op must also succeed (claim cleared on tenant root, not stuck claim_held).
    let dispatchedCalls2 = 0;
    const consume2 = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      roundDispatcher: async () => {
        dispatchedCalls2 += 1;
        return { ok: true, roundId: "round-auth-ok-op-b" };
      },
      request: {
        groupId,
        fromAgentId: "system:group_task_heartbeat",
        toAgentIds: [bot],
        source: "nudge",
        taskId,
        itemId: "item-2",
        reason: "r6-conflict-reverse-op-b",
      },
    });
    expect(consume2.reason).not.toBe("auth_revoked");
    expect(consume2.reason).not.toBe("eligibility_cas_rejected");
    expect(consume2.dispatched).toBe(true);
    expect(dispatchedCalls2).toBe(1);
    expect(consume2.roundId).toBe("round-auth-ok-op-b");

    // Legacy root must not receive the tenant task claim lifecycle writes.
    const legacyTask = await legacy.objectStorage.readObject(groupId, "task", taskId);
    expect(legacyTask).toBeNull();
  });
});

describe("R6 continuous handlers · real ACL · stop→wake (no mid seedOs)", () => {
  test("two-tenant activate→claim→propose→confirm→deliverable→stop→wake stay isolated", async () => {
    const { cfg } = await useManagedRoot();

    for (const t of TENANTS) {
      const seeded = await seedTrustedRoster({
        tenantId: t.tenantId,
        owner: t.owner,
        bot: t.bot,
        cfg,
      });
      const client = clientFor(t.owner);

      const activated = await invoke(
        collaborationTaskActivationHandlers,
        "collaboration.task.activate",
        {
          groupId: SHARED_GROUP,
          taskId: SHARED_TASK,
          title: "R6能源材料研究提纲",
          message: "请为能源材料研究提纲发布看板并分工认领，验收交付报告与计划确认闭环",
          goal: "产出有来源的研究提纲",
          acceptanceCriteria: ["两成员各写一段", "汇总为 Markdown"],
          constraints: ["仅本租户 locator"],
          suggestedClaimantIds: [t.bot],
          humanConfirmed: true,
          requireHumanConfirm: true,
        },
        client,
      );
      expect(activated.ok, JSON.stringify(activated.error)).toBe(true);
      const actPayload = activated.payload as { status: string };
      expect(["activated", "idempotent", "partial_success"]).toContain(actPayload.status);

      // Sync may reproject from groupStorage — roster was seeded there; NO mid seedOs.
      const osAfterActivate = await readGroupOperatingState({
        fileStore: seeded.stores.fileStore,
        groupId: SHARED_GROUP,
      });
      expect(
        osAfterActivate?.governance?.ownerUserId || osAfterActivate?.memberRoleMap?.length,
      ).toBeTruthy();

      const listed = await invoke(
        collaborationLearningHandlers,
        "collaboration.task.listBoardItems",
        { groupId: SHARED_GROUP, taskId: SHARED_TASK },
        client,
      );
      expect(listed.ok, JSON.stringify(listed.error)).toBe(true);
      const items = (listed.payload as { items: Array<{ itemId: string }> }).items;
      expect(items.length).toBeGreaterThan(0);
      const boardItemId = items[0].itemId;

      const botClient = clientFor(t.bot);
      const claimed = await invoke(
        collaborationLearningHandlers,
        "collaboration.task.claimBoardItem",
        { groupId: SHARED_GROUP, taskId: SHARED_TASK, itemId: boardItemId },
        botClient,
      );
      expect(claimed.ok, JSON.stringify(claimed.error)).toBe(true);
      const applied = await invoke(
        collaborationLearningHandlers,
        "collaboration.task.applyClaim",
        { groupId: SHARED_GROUP, taskId: SHARED_TASK, itemId: boardItemId },
        botClient,
      );
      expect(applied.ok, JSON.stringify(applied.error)).toBe(true);

      const proposed = await invoke(
        collaborationLearningHandlers,
        "collaboration.task.proposeTodolist",
        {
          groupId: SHARED_GROUP,
          taskId: SHARED_TASK,
          boardItemId,
          steps: [{ title: "写成果" }, { title: "自检" }],
        },
        botClient,
      );
      expect(proposed.ok, JSON.stringify(proposed.error)).toBe(true);
      const todolist = (proposed.payload as { todolist: { todolistId: string; version: number } })
        .todolist;

      const confirmed = await invoke(
        collaborationLearningHandlers,
        "collaboration.task.confirmTodolist",
        {
          groupId: SHARED_GROUP,
          taskId: SHARED_TASK,
          todolistId: todolist.todolistId,
          expectedVersion: todolist.version,
        },
        client,
      );
      expect(confirmed.ok, JSON.stringify(confirmed.error)).toBe(true);

      const delivered = await invoke(
        collaborationTaskActivationHandlers,
        "collaboration.task.submitTeamDeliverable",
        {
          groupId: SHARED_GROUP,
          taskId: SHARED_TASK,
          title: `deliverable-${t.tenantId}`,
          content: `body-for-${t.tenantId}`,
          logicalId: "shared-logical-id",
        },
        client,
      );
      expect(delivered.ok, JSON.stringify(delivered.error ?? delivered.payload)).toBe(true);

      const lockDir = path.join(seeded.groupLocator, "task-control");
      const stopped = await invoke(
        collaborationLearningHandlers,
        "collaboration.task.stop",
        { groupId: SHARED_GROUP, taskId: SHARED_TASK, reason: "r6-stop" },
        client,
      );
      expect(stopped.ok, JSON.stringify(stopped.error)).toBe(true);
      // Same lock root as task writes (tenant locator).
      const lockExists =
        fs.existsSync(lockDir) ||
        fs.existsSync(path.join(seeded.groupsRoot, SHARED_GROUP, "task-control"));
      expect(lockExists).toBe(true);

      const liveOs =
        (await readGroupOperatingState({
          fileStore: seeded.stores.fileStore,
          groupId: SHARED_GROUP,
        })) ?? makeOperatingState({ groupId: SHARED_GROUP });
      const authority = buildAuthority({
        cfg,
        groupId: SHARED_GROUP,
        tenantId: t.tenantId,
        taskId: SHARED_TASK,
        operatingState: liveOs,
      });
      expect(authority.namespace.groupLocator).toBe(seeded.groupLocator);

      let wakeDispatches = 0;
      const wake = await consumeWakeForRoundDispatch({
        authority,
        cfg,
        writeMode: "execute",
        roundDispatcher: async () => {
          wakeDispatches += 1;
          return { ok: true, roundId: "must-not-after-stop" };
        },
        request: {
          groupId: SHARED_GROUP,
          fromAgentId: "system:group_task_heartbeat",
          toAgentIds: [t.bot],
          source: "nudge",
          taskId: SHARED_TASK,
          itemId: boardItemId,
          reason: "r6-after-stop",
        },
      });
      expect(wake.dispatched).toBe(false);
      expect(wake.reason).toBe("task_stopped");
      expect(wakeDispatches).toBe(0);
    }
  });

  test("real ACL rejects cross-tenant actor; task state unchanged", async () => {
    const { cfg } = await useManagedRoot();
    const t = TENANTS[0];
    await seedTrustedRoster({
      tenantId: t.tenantId,
      owner: t.owner,
      bot: t.bot,
      cfg,
    });
    // Victim tenant B has NO membership in A's members.json.
    const stranger = TENANTS[1].owner;
    const denied = await authorizeTeamGroupResourceAccess({
      groupId: SHARED_GROUP,
      actor: stranger,
      client: clientFor(stranger) as never,
      action: "write",
      cfg,
    });
    expect(denied.ok).toBe(false);

    const before = await resolveHandlerTrustedTeamContext({
      groupId: SHARED_GROUP,
      actor: t.owner,
      client: clientFor(t.owner) as never,
      action: "write",
      cfg,
    });
    expect(before.ok).toBe(true);
    if (!before.ok) {
      throw new Error("owner context failed");
    }
    const taskBefore = await before.stores.objectStorage.readObject<Task>(
      SHARED_GROUP,
      "task",
      SHARED_TASK,
    );

    const stopped = await invoke(
      collaborationLearningHandlers,
      "collaboration.task.stop",
      { groupId: SHARED_GROUP, taskId: SHARED_TASK, reason: "should-deny" },
      clientFor(stranger),
    );
    expect(stopped.ok).toBe(false);

    const taskAfter = await before.stores.objectStorage.readObject<Task>(
      SHARED_GROUP,
      "task",
      SHARED_TASK,
    );
    expect(taskAfter).toEqual(taskBefore);
  });
});

describe("R6 chatHandlers chat.send plan confirm (visible result, no execution)", () => {
  function ensureTranscript() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-r6-chat-"));
    tempDirs.push(dir);
    const transcriptPath = path.join(dir, "sess.jsonl");
    fs.writeFileSync(
      transcriptPath,
      `${JSON.stringify({
        type: "session",
        version: 3,
        id: chatTranscriptState.sessionId,
        timestamp: new Date(0).toISOString(),
        cwd: dir,
      })}\n`,
      "utf-8",
    );
    chatTranscriptState.transcriptPath = transcriptPath;
    return transcriptPath;
  }

  function chatContext() {
    return {
      broadcast: vi.fn(),
      broadcastChat: vi.fn(),
      nodeSendToSession: vi.fn(),
      agentRunSeq: new Map(),
      chatAbortControllers: new Map(),
      chatRunBuffers: new Map(),
      chatDeltaSentAt: new Map(),
      chatAbortedRuns: new Map(),
      removeChatRun: vi.fn(),
      dedupe: new Map(),
      registerToolEventRecipient: vi.fn(),
      logGateway: { warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
    } as never;
  }

  test("unique card binding succeeds via chat.send; message visible; no agent dispatch", async () => {
    const { cfg } = await useManagedRoot();
    const t = TENANTS[0];
    const groupId = "grp-r6-chat-ok";
    const taskId = "task-r6-chat-ok";
    await seedTrustedRoster({
      tenantId: t.tenantId,
      owner: t.owner,
      bot: t.bot,
      cfg,
      groupId,
    });
    const client = clientFor(t.owner);

    // Activate + propose a real plan so confirm has something to bind.
    const activated = await invoke(
      collaborationTaskActivationHandlers,
      "collaboration.task.activate",
      {
        groupId,
        taskId,
        title: "R6 chat confirm",
        message: "请为能源材料研究提纲发布看板并分工认领，验收交付报告与计划确认闭环",
        goal: "确认",
        acceptanceCriteria: ["确认计划"],
        constraints: ["仅本租户"],
        humanConfirmed: true,
        requireHumanConfirm: true,
        suggestedClaimantIds: [t.bot],
      },
      client,
    );
    expect(activated.ok, JSON.stringify(activated.error ?? activated.payload)).toBe(true);
    const listed = await invoke(
      collaborationLearningHandlers,
      "collaboration.task.listBoardItems",
      { groupId, taskId },
      client,
    );
    expect(listed.ok, JSON.stringify(listed.error ?? listed.payload)).toBe(true);
    const boardItemId = (listed.payload as { items: Array<{ itemId: string }> }).items[0]?.itemId;
    expect(boardItemId, JSON.stringify(listed.payload)).toBeTruthy();
    await invoke(
      collaborationLearningHandlers,
      "collaboration.task.claimBoardItem",
      { groupId, taskId, itemId: boardItemId },
      clientFor(t.bot),
    );
    await invoke(
      collaborationLearningHandlers,
      "collaboration.task.applyClaim",
      { groupId, taskId, itemId: boardItemId },
      clientFor(t.bot),
    );
    const proposed = await invoke(
      collaborationLearningHandlers,
      "collaboration.task.proposeTodolist",
      {
        groupId,
        taskId,
        boardItemId,
        steps: [{ title: "一步" }],
      },
      clientFor(t.bot),
    );
    expect(proposed.ok, JSON.stringify(proposed.error ?? proposed.payload)).toBe(true);
    const todolist = (proposed.payload as { todolist: { todolistId: string; version: number } })
      .todolist;

    const transcriptPath = ensureTranscript();
    resolveActorMock.mockResolvedValue({
      userId: t.owner,
      userEmail: t.owner,
      tenantId: t.tenantId,
      seatAgentIds: ["main", t.bot],
      seatSpaceIds: [groupId],
    });
    buildVisibilityMock.mockResolvedValue({
      actor: {
        userId: t.owner,
        userEmail: t.owner,
        tenantId: t.tenantId,
        seatAgentIds: ["main", t.bot],
        seatSpaceIds: [groupId],
      },
      visibleAgentIds: new Set(["main", t.bot]),
      visibleSpaceIds: new Set([groupId]),
      auditableGroupBotSessions: new Set(),
      archivedGroupIds: new Set(),
    });
    listSpacesMock.mockResolvedValue({
      spaces: [
        {
          id: `space:${groupId}`,
          groupId,
          ownerUserId: t.owner,
          tenantId: t.tenantId,
          members: {
            humans: [{ userId: t.owner, name: "owner", status: "active" }],
            bots: [{ agentId: t.bot, name: "bot", status: "active" }],
          },
        },
      ],
    });
    // decideParticipants runs before the confirm early-return; return empty
    // participation so we can still prove no agent dispatchInbound afterward.
    decideParticipantsMock.mockReturnValue({
      roundId: "r6-no-dispatch",
      speakers: [],
      bots: [],
      humans: [],
    });

    const respond = vi.fn();
    await chatHandlers["chat.send"]({
      params: {
        sessionKey: `space:${groupId}`,
        message: "确认计划",
        idempotencyKey: "r6-confirm-ok",
        planConfirmTaskId: taskId,
        planConfirmBoardItemId: boardItemId,
        planConfirmTodolistId: todolist.todolistId,
        planConfirmExpectedVersion: todolist.version,
      },
      respond: respond as never,
      req: {} as never,
      client: { ...client, sessionDomain: "employee", sessionEnterpriseId: t.tenantId } as never,
      isWebchatConnect: () => false,
      context: chatContext(),
    });

    expect(respond).toHaveBeenCalled();
    const [ok, payload, err] = respond.mock.calls[0] as [
      boolean,
      Record<string, unknown>,
      Record<string, unknown> | undefined,
    ];
    expect(ok, JSON.stringify({ payload, err })).toBe(true);
    expect(asText(payload.message)).toMatch(/确认|计划|尚未/);
    expect(payload.autoAdvanceWired).toBe(false);
    expect(payload.planConfirm).toBeTruthy();
    const plan = payload.planConfirm as { confirmed?: boolean; status?: string };
    expect(
      plan.confirmed === true || plan.status === "confirmed" || plan.status === "idempotent",
    ).toBe(true);
    expect(dispatchInboundMock).not.toHaveBeenCalled();
    // Respond message is the UI-visible channel; transcriptPersist reports write honesty.
    expect(payload.transcriptPersist).toBeTruthy();
    void transcriptPath;
  });

  test("stale expectedVersion refuses via chat.send; no execution", async () => {
    const { cfg } = await useManagedRoot();
    const t = TENANTS[0];
    const groupId = "grp-r6-chat-stale";
    const taskId = "task-r6-chat-stale";
    await seedTrustedRoster({
      tenantId: t.tenantId,
      owner: t.owner,
      bot: t.bot,
      cfg,
      groupId,
    });
    const client = clientFor(t.owner);
    const activated = await invoke(
      collaborationTaskActivationHandlers,
      "collaboration.task.activate",
      {
        groupId,
        taskId,
        title: "R6 stale version",
        message: "请为能源材料研究提纲发布看板并分工认领，验收交付报告与计划确认闭环",
        goal: "确认",
        acceptanceCriteria: ["确认计划"],
        constraints: ["仅本租户"],
        humanConfirmed: true,
        requireHumanConfirm: true,
        suggestedClaimantIds: [t.bot],
      },
      client,
    );
    expect(activated.ok, JSON.stringify(activated.error ?? activated.payload)).toBe(true);
    const listed = await invoke(
      collaborationLearningHandlers,
      "collaboration.task.listBoardItems",
      { groupId, taskId },
      client,
    );
    expect(listed.ok, JSON.stringify(listed.error ?? listed.payload)).toBe(true);
    const boardItemId = (listed.payload as { items: Array<{ itemId: string }> }).items[0]?.itemId;
    expect(boardItemId, JSON.stringify(listed.payload)).toBeTruthy();
    await invoke(
      collaborationLearningHandlers,
      "collaboration.task.claimBoardItem",
      { groupId, taskId, itemId: boardItemId },
      clientFor(t.bot),
    );
    await invoke(
      collaborationLearningHandlers,
      "collaboration.task.applyClaim",
      { groupId, taskId, itemId: boardItemId },
      clientFor(t.bot),
    );
    const proposed = await invoke(
      collaborationLearningHandlers,
      "collaboration.task.proposeTodolist",
      {
        groupId,
        taskId,
        boardItemId,
        steps: [{ title: "一步" }],
      },
      clientFor(t.bot),
    );
    expect(proposed.ok, JSON.stringify(proposed.error ?? proposed.payload)).toBe(true);
    const todolist = (proposed.payload as { todolist: { todolistId: string; version: number } })
      .todolist;

    ensureTranscript();
    resolveActorMock.mockResolvedValue({
      userId: t.owner,
      userEmail: t.owner,
      tenantId: t.tenantId,
      seatAgentIds: ["main", t.bot],
      seatSpaceIds: [groupId],
    });
    buildVisibilityMock.mockResolvedValue({
      actor: {
        userId: t.owner,
        userEmail: t.owner,
        tenantId: t.tenantId,
        seatAgentIds: ["main", t.bot],
        seatSpaceIds: [groupId],
      },
      visibleAgentIds: new Set(["main", t.bot]),
      visibleSpaceIds: new Set([groupId]),
      auditableGroupBotSessions: new Set(),
      archivedGroupIds: new Set(),
    });
    listSpacesMock.mockResolvedValue({
      spaces: [
        {
          id: `space:${groupId}`,
          groupId,
          ownerUserId: t.owner,
          tenantId: t.tenantId,
          members: {
            humans: [{ userId: t.owner, name: "owner", status: "active" }],
            bots: [{ agentId: t.bot, name: "bot", status: "active" }],
          },
        },
      ],
    });
    decideParticipantsMock.mockReturnValue({
      roundId: "r6-no-dispatch-stale",
      speakers: [],
      bots: [],
      humans: [],
    });

    const respond = vi.fn();
    await chatHandlers["chat.send"]({
      params: {
        sessionKey: `space:${groupId}`,
        message: "确认计划",
        idempotencyKey: "r6-confirm-stale",
        planConfirmTaskId: taskId,
        planConfirmBoardItemId: boardItemId,
        planConfirmTodolistId: todolist.todolistId,
        planConfirmExpectedVersion: todolist.version + 99,
      },
      respond: respond as never,
      req: {} as never,
      client: { ...client, sessionDomain: "employee", sessionEnterpriseId: t.tenantId } as never,
      isWebchatConnect: () => false,
      context: chatContext(),
    });
    const [ok, payload, err] = respond.mock.calls[0] as [
      boolean,
      Record<string, unknown>,
      Record<string, unknown> | undefined,
    ];
    expect(ok, JSON.stringify({ payload, err })).toBe(true);
    expect(asText(payload?.message ?? err?.message)).toMatch(
      /尚未确认|版本|version|mismatch|拒绝/i,
    );
    expect(payload.autoAdvanceWired).toBe(false);
    expect(dispatchInboundMock).not.toHaveBeenCalled();
  });

  test("ambiguous confirm message refuses via chat.send; no execution", async () => {
    const { cfg } = await useManagedRoot();
    const t = TENANTS[0];
    const groupId = "grp-r6-chat-ambig";
    const taskId = "task-r6-chat-ambig";
    await seedTrustedRoster({
      tenantId: t.tenantId,
      owner: t.owner,
      bot: t.bot,
      cfg,
      groupId,
    });
    const client = clientFor(t.owner);
    const activated = await invoke(
      collaborationTaskActivationHandlers,
      "collaboration.task.activate",
      {
        groupId,
        taskId,
        title: "R6 ambiguous confirm",
        message: "请为能源材料研究提纲发布看板并分工认领，验收交付报告与计划确认闭环",
        goal: "确认",
        acceptanceCriteria: ["确认计划"],
        constraints: ["仅本租户"],
        humanConfirmed: true,
        requireHumanConfirm: true,
        suggestedClaimantIds: [t.bot],
      },
      client,
    );
    expect(activated.ok, JSON.stringify(activated.error ?? activated.payload)).toBe(true);

    ensureTranscript();
    resolveActorMock.mockResolvedValue({
      userId: t.owner,
      userEmail: t.owner,
      tenantId: t.tenantId,
      seatAgentIds: ["main", t.bot],
      seatSpaceIds: [groupId],
    });
    buildVisibilityMock.mockResolvedValue({
      actor: {
        userId: t.owner,
        userEmail: t.owner,
        tenantId: t.tenantId,
        seatAgentIds: ["main", t.bot],
        seatSpaceIds: [groupId],
      },
      visibleAgentIds: new Set(["main", t.bot]),
      visibleSpaceIds: new Set([groupId]),
      auditableGroupBotSessions: new Set(),
      archivedGroupIds: new Set(),
    });
    listSpacesMock.mockResolvedValue({
      spaces: [
        {
          id: `space:${groupId}`,
          groupId,
          ownerUserId: t.owner,
          tenantId: t.tenantId,
          members: {
            humans: [{ userId: t.owner, name: "owner", status: "active" }],
            bots: [{ agentId: t.bot, name: "bot", status: "active" }],
          },
        },
      ],
    });
    decideParticipantsMock.mockReturnValue({
      roundId: "r6-no-dispatch-ambig",
      speakers: [],
      bots: [],
      humans: [],
    });

    const respond = vi.fn();
    await chatHandlers["chat.send"]({
      params: {
        sessionKey: `space:${groupId}`,
        // Mixed content → parseChatPlanConfirmIntent ambiguous (refuse guess).
        message: "确认计划，另外把范围改成商业化",
        idempotencyKey: "r6-confirm-ambig",
        planConfirmTaskId: taskId,
      },
      respond: respond as never,
      req: {} as never,
      client: { ...client, sessionDomain: "employee", sessionEnterpriseId: t.tenantId } as never,
      isWebchatConnect: () => false,
      context: chatContext(),
    });
    const [ok, payload, err] = respond.mock.calls[0] as [
      boolean,
      Record<string, unknown>,
      Record<string, unknown> | undefined,
    ];
    expect(ok, JSON.stringify({ payload, err })).toBe(true);
    expect(asText(payload?.message ?? err?.message)).toMatch(
      /尚未确认|歧义|ambiguous|拒绝|无法|guess|mixed/i,
    );
    expect(payload.autoAdvanceWired).toBe(false);
    const plan = payload.planConfirm as { status?: string } | undefined;
    if (plan) {
      expect(plan.status).toMatch(/ambiguous|rejected|refused|not_confirmed/i);
    }
    expect(dispatchInboundMock).not.toHaveBeenCalled();
  });
});
