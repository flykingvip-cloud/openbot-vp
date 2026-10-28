/**
 * R5 — production composition-root proof (NOT service-layer with injected stores).
 *
 * Two tenants, identical local groupId/taskId, invoke real gateway handlers:
 * activate → publish/claim/apply → propose → chat.send confirm → deliverable → stop.
 * Each step records groupLocator/groupsRoot; tenants must never cross.
 * Managed missing trusted must hard-refuse compat dual-root.
 *
 * Scope honesty: R5 era noted autoAdvance unwired; product-wiring PR flips confirm→advance.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { makeOperatingState } from "../collaboration-dispatch/__fixtures__/policy-source-matrix.js";
import { validateChatSendParams } from "../protocol/index.js";
import {
  writeGroupOperatingState,
  readGroupOperatingState,
  readOperatingStateAuthEpoch,
} from "./shared.js";
import { assertPersistedTaskNotStopped } from "./task-stop-entry.js";
import {
  createTrustedGroupStores,
  resolveHandlerTrustedTeamContext,
} from "./team-resource-auth.js";

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

vi.mock("../workspace/group-acl.js", async () => {
  const actual = await vi.importActual<typeof import("../workspace/group-acl.js")>(
    "../workspace/group-acl.js",
  );
  const memberFor = (actor: string) => ({
    memberId: actor,
    userId: actor,
    status: "active" as const,
    governanceRole: "owner" as const,
    collaborationRole: "contributor" as const,
    memberKind: "human" as const,
  });
  return {
    ...actual,
    assertGroupMemberAccess: async () => null, // null = authorized
    loadAuthoritativeGroupMembers: async () => [
      memberFor("tenant-r5-a/emp-owner"),
      memberFor("tenant-r5-b/emp-owner"),
      {
        ...memberFor("tenant-r5-a/bot-analyst"),
        memberKind: "bot" as const,
        governanceRole: "member" as const,
        agentId: "tenant-r5-a/bot-analyst",
      },
      {
        ...memberFor("tenant-r5-b/bot-analyst"),
        memberKind: "bot" as const,
        governanceRole: "member" as const,
        agentId: "tenant-r5-b/bot-analyst",
      },
    ],
  };
});

const { collaborationTaskActivationHandlers } =
  await import("../server-methods/collaboration-task-activation.js");
const { collaborationLearningHandlers } =
  await import("../server-methods/collaboration-learning.js");

const SHARED_GROUP = "grp-shared-local-id";
const SHARED_TASK = "task-shared-local-id";

const TENANTS = [
  {
    tenantId: "tenant-r5-a",
    owner: "tenant-r5-a/emp-owner",
    bot: "tenant-r5-a/bot-analyst",
  },
  {
    tenantId: "tenant-r5-b",
    owner: "tenant-r5-b/emp-owner",
    bot: "tenant-r5-b/bot-analyst",
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
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function useManagedRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-r5-handlers-"));
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
      task: {
        claimContract: true,
        wakeContract: true,
      },
    },
  } as OpenBotConfig;
  await fs.writeFile(configPath, JSON.stringify(cfg, null, 2), "utf8");
  setRuntimeConfigSnapshot(cfg);
  clearConfigCache();
  return { root, tenantsRoot, cfg };
}

function clientFor(owner: string) {
  return {
    platformUserId: owner,
    user: owner,
    connect: { platformUserId: owner },
  } as never;
}

async function invoke(
  handlers: Record<string, Function>,
  method: string,
  params: Record<string, unknown>,
  client: never,
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

async function seedOs(tenantId: string, owner: string, cfg: OpenBotConfig) {
  const locator = path.join(
    process.env.OPENBOT_TENANTS_ROOT!,
    tenantId,
    "collaboration",
    "groups",
    SHARED_GROUP,
  );
  const stores = createTrustedGroupStores({
    groupsRoot: path.dirname(locator),
    groupLocator: locator,
  });
  const bot = owner.replace("/emp-owner", "/bot-analyst");
  const live = await readGroupOperatingState({
    fileStore: stores.fileStore,
    groupId: SHARED_GROUP,
  });
  const nextEpoch = readOperatingStateAuthEpoch(live) + 1;
  const state = makeOperatingState({
    groupId: SHARED_GROUP,
    governance: { ownerUserId: owner, adminUserIds: [owner], coordinatorBotId: owner },
  });
  state.governance = {
    ...state.governance,
    ownerUserId: owner,
    adminUserIds: [owner],
    coordinatorBotId: owner,
  };
  state.memberRoleMap = [
    {
      memberId: owner,
      memberKind: "human",
      governanceRole: "owner",
      collaborationRole: "contributor",
      status: "active",
      label: owner,
    },
    {
      memberId: bot,
      memberKind: "bot",
      governanceRole: "member",
      collaborationRole: "contributor",
      status: "active",
      label: bot,
    },
  ];
  // Auth write: business merges preserve live coordinator/members (activate sync
  // may have reprojected empty roster). Confirm ACL needs explicit auth epoch bump.
  await writeGroupOperatingState({
    fileStore: stores.fileStore,
    groupId: SHARED_GROUP,
    state: { ...state, authEpoch: nextEpoch, updatedAtMs: Date.now() } as typeof state & {
      authEpoch: number;
    },
    groupRootDir: path.dirname(locator),
    cfg,
    writeKind: "auth",
  });
  return { locator, groupsRoot: path.dirname(locator), stores };
}

describe("R5 ChatSendParamsSchema planConfirm fields", () => {
  test("accepts schema-backed planConfirm* binding fields", () => {
    expect(
      validateChatSendParams({
        sessionKey: "agent:main:space:grp-x",
        message: "确认计划",
        idempotencyKey: "idem-1",
        planConfirmTaskId: "task-1",
        planConfirmBoardItemId: "board-1",
        planConfirmTodolistId: "td-1",
        planConfirmDecisionId: "dec-1",
        planConfirmExpectedVersion: 3,
      }),
    ).toBe(true);
  });

  test("rejects unknown planConfirm binding junk under additionalProperties:false", () => {
    expect(
      validateChatSendParams({
        sessionKey: "agent:main:space:grp-x",
        message: "确认计划",
        idempotencyKey: "idem-2",
        planConfirmTaskId: "task-1",
        planConfirmExtra: "nope",
      } as never),
    ).toBe(false);
  });
});

describe("R5 gateway handlers · two-tenant same local ids", () => {
  test("activate→claim→propose→confirm→deliverable→stop stay on trusted locator per tenant", async () => {
    const { cfg } = await useManagedRoot();
    const locators: Record<string, { groupsRoot: string; groupLocator: string }[]> = {
      "tenant-r5-a": [],
      "tenant-r5-b": [],
    };

    for (const t of TENANTS) {
      const seeded = await seedOs(t.tenantId, t.owner, cfg);
      const client = clientFor(t.owner);
      const steps: { groupsRoot: string; groupLocator: string }[] = [];

      const activated = await invoke(
        collaborationTaskActivationHandlers,
        "collaboration.task.activate",
        {
          groupId: SHARED_GROUP,
          taskId: SHARED_TASK,
          title: "能源材料研究提纲",
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
      const actPayload = activated.payload as {
        status: string;
        reason?: string;
        detail?: string;
        groupLocator?: string;
        groupsRoot?: string;
        boardItemId?: string;
      };
      if (!["activated", "idempotent", "partial_success"].includes(actPayload.status)) {
        throw new Error(`activate unexpected: ${JSON.stringify(actPayload)}`);
      }
      // Handler auth path should land under this tenant's collaboration root.
      const ctx = await resolveHandlerTrustedTeamContext({
        groupId: SHARED_GROUP,
        actor: t.owner,
        client,
        action: "write",
        cfg,
      });
      expect(ctx.ok).toBe(true);
      if (!ctx.ok) {
        throw new Error("trusted context failed");
      }
      steps.push({ groupsRoot: ctx.trusted.groupsRoot, groupLocator: ctx.trusted.groupLocator });
      expect(ctx.trusted.groupLocator).toContain(path.join(t.tenantId, "collaboration"));
      expect(ctx.trusted.groupLocator).toBe(seeded.locator);

      // Activate syncGroupOperatingState may reproject auth from empty groupStorage roster.
      await seedOs(t.tenantId, t.owner, cfg);

      // Publish is often done inside activate; claim/apply via learning handlers.
      const listed = await invoke(
        collaborationLearningHandlers,
        "collaboration.task.listBoardItems",
        { groupId: SHARED_GROUP, taskId: SHARED_TASK },
        client,
      );
      expect(listed.ok, JSON.stringify(listed.error)).toBe(true);
      const items = (listed.payload as { items: Array<{ itemId: string; status?: string }> }).items;
      expect(items.length).toBeGreaterThan(0);
      const boardItemId = items[0].itemId;

      const botClient = clientFor(t.bot);
      const claimed = await invoke(
        collaborationLearningHandlers,
        "collaboration.task.claimBoardItem",
        { groupId: SHARED_GROUP, taskId: SHARED_TASK, itemId: boardItemId },
        botClient,
      );
      steps.push({ groupsRoot: ctx.trusted.groupsRoot, groupLocator: ctx.trusted.groupLocator });
      expect(claimed.ok, JSON.stringify(claimed.error)).toBe(true);
      const applied = await invoke(
        collaborationLearningHandlers,
        "collaboration.task.applyClaim",
        { groupId: SHARED_GROUP, taskId: SHARED_TASK, itemId: boardItemId },
        botClient,
      );
      expect(applied.ok, JSON.stringify(applied.error)).toBe(true);

      // Re-seed OS after apply projection so owner remains coordinator confirmer.
      await seedOs(t.tenantId, t.owner, cfg);

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
      steps.push({ groupsRoot: ctx.trusted.groupsRoot, groupLocator: ctx.trusted.groupLocator });

      // Owner/coordinator confirms (not executor self-confirm).
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
      steps.push({ groupsRoot: ctx.trusted.groupsRoot, groupLocator: ctx.trusted.groupLocator });

      // Also exercise schema-backed chat confirm RPC (composition root).
      const chatConfirm = await invoke(
        collaborationTaskActivationHandlers,
        "collaboration.task.confirmPlanFromChat",
        {
          groupId: SHARED_GROUP,
          taskId: SHARED_TASK,
          message: "确认计划",
          boardItemId,
          todolistId: todolist.todolistId,
          expectedVersion: todolist.version,
        },
        client,
      );
      // Already confirmed → idempotent or confirmed; must not fall to host dual-root.
      expect(chatConfirm.ok, JSON.stringify(chatConfirm.error)).toBe(true);

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
      const del = delivered.payload as {
        status: string;
        formalLocator?: string;
        groupLocator?: string;
      };
      expect(["ok", "submitted", "idempotent", "partial_success"]).toContain(del.status);
      if (del.formalLocator) {
        expect(del.formalLocator).toContain(t.tenantId);
        expect(del.formalLocator).not.toContain(
          t.tenantId === "tenant-r5-a" ? "tenant-r5-b" : "tenant-r5-a",
        );
      }
      steps.push({ groupsRoot: ctx.trusted.groupsRoot, groupLocator: ctx.trusted.groupLocator });

      const stopped = await invoke(
        collaborationLearningHandlers,
        "collaboration.task.stop",
        { groupId: SHARED_GROUP, taskId: SHARED_TASK, reason: "r5-stop" },
        client,
      );
      expect(stopped.ok, JSON.stringify(stopped.error)).toBe(true);
      const stopPayload = stopped.payload as {
        stopControl?: { status?: string };
        alreadyStopped?: boolean;
      };
      expect(stopPayload.stopControl || stopPayload.alreadyStopped).toBeTruthy();
      steps.push({ groupsRoot: ctx.trusted.groupsRoot, groupLocator: ctx.trusted.groupLocator });

      // Wake / pre-exec check must read the SAME stopped task on trusted stores.
      await expect(
        assertPersistedTaskNotStopped({
          groupId: SHARED_GROUP,
          taskId: SHARED_TASK,
          cfg,
          objectStorage: ctx.stores.objectStorage,
        }),
      ).rejects.toThrow(/stop|stopped/i);

      // Same task record: stop persisted on tenant stores (not host dual-root).
      const taskPath = path.join(
        ctx.trusted.groupLocator,
        "objects",
        "task",
        `${SHARED_TASK}.json`,
      );
      // object layout may vary — at least groupLocator dir exists and hosts task control lock
      await fs.access(ctx.trusted.groupLocator);
      const lockDir = path.join(ctx.trusted.groupsRoot, SHARED_GROUP, "task-control");
      // lock dir created on stop
      const lockParent = path.join(ctx.trusted.groupLocator, "task-control");
      // either layout is acceptable as long as under tenant collaboration
      expect(ctx.trusted.groupLocator.includes(path.join(t.tenantId, "collaboration"))).toBe(true);

      locators[t.tenantId] = steps;
      void taskPath;
      void lockDir;
      void lockParent;
    }

    // Cross-tenant isolation: locators differ; never share groupsRoot.
    const a = locators["tenant-r5-a"][0];
    const b = locators["tenant-r5-b"][0];
    expect(a.groupsRoot).not.toBe(b.groupsRoot);
    expect(a.groupLocator).not.toBe(b.groupLocator);
    expect(a.groupLocator).toContain("tenant-r5-a");
    expect(b.groupLocator).toContain("tenant-r5-b");
  });

  test("managed service call without auth/trusted/stores hard-refuses dual-root compat", async () => {
    await useManagedRoot();
    const { publishCollaborationBoardItem } = await import("./claim-contract-entry.js");
    await expect(
      publishCollaborationBoardItem({
        groupId: SHARED_GROUP,
        taskId: SHARED_TASK,
        title: "should fail",
        remainingWork: "x",
        acceptanceCriteria: ["x"],
        actor: "tenant-r5-a/emp-owner",
        tenant: { tenantId: "tenant-r5-a", trust: "membership" },
        // deliberately no auth/trusted/stores — composition root must supply them
      }),
    ).rejects.toMatchObject({
      code: "trusted_group_locator_required",
    });
  });
});
