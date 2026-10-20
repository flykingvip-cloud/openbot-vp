/**
 * FINAL v3 §2.6 — Todolist ACL at the service/RPC boundary.
 * Request params must not mint confirmer or coordinator identity.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Task } from "@openbot/collaboration-core";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { makeOperatingState } from "../collaboration-dispatch/__fixtures__/policy-source-matrix.js";
import {
  validateCollaborationTaskConfirmTodolistParams,
  validateCollaborationTaskGetTodolistParams,
  validateCollaborationTaskListTodolistsParams,
  validateCollaborationTaskReviseTodolistParams,
} from "../protocol/index.js";
import {
  applyCollaborationBoardClaim,
  buildCollaborationExecutionTaskBag,
  claimCollaborationBoardItem,
  ClaimContractEntryError,
  confirmCollaborationTodolist,
  getCollaborationTodolist,
  listCollaborationTodolists,
  proposeCollaborationTodolist,
  publishCollaborationBoardItem,
} from "./claim-contract-entry.js";
import {
  createWorkspaceCollaborationStores,
  readGroupOperatingState,
  writeGroupOperatingState,
} from "./shared.js";

const tempDirs: string[] = [];
const savedStateDir = process.env.OPENBOT_STATE_DIR;
const savedOpenbotConfigPath = process.env.OPENBOT_CONFIG_PATH;
const savedOpenclawConfigPath = process.env.OPENCLAW_CONFIG_PATH;
const savedSecurityProfile = process.env.OPENBOT_SECURITY_PROFILE;
const savedLegacySecurityProfile = process.env.OPENCLAW_SECURITY_PROFILE;

afterEach(async () => {
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  if (savedStateDir === undefined) {
    delete process.env.OPENBOT_STATE_DIR;
  } else {
    process.env.OPENBOT_STATE_DIR = savedStateDir;
  }
  if (savedOpenbotConfigPath === undefined) {
    delete process.env.OPENBOT_CONFIG_PATH;
  } else {
    process.env.OPENBOT_CONFIG_PATH = savedOpenbotConfigPath;
  }
  if (savedOpenclawConfigPath === undefined) {
    delete process.env.OPENCLAW_CONFIG_PATH;
  } else {
    process.env.OPENCLAW_CONFIG_PATH = savedOpenclawConfigPath;
  }
  if (savedSecurityProfile === undefined) {
    delete process.env.OPENBOT_SECURITY_PROFILE;
  } else {
    process.env.OPENBOT_SECURITY_PROFILE = savedSecurityProfile;
  }
  if (savedLegacySecurityProfile === undefined) {
    delete process.env.OPENCLAW_SECURITY_PROFILE;
  } else {
    process.env.OPENCLAW_SECURITY_PROFILE = savedLegacySecurityProfile;
  }
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function flagConfig(root: string): OpenBotConfig {
  return {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: { claimContract: true },
    },
  } as OpenBotConfig;
}

async function useConfig(): Promise<{ root: string; cfg: OpenBotConfig }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-todolist-acl-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  delete process.env.OPENBOT_SECURITY_PROFILE;
  delete process.env.OPENCLAW_SECURITY_PROFILE;
  const cfg = flagConfig(root);
  const configPath = path.join(root, "openbot.json");
  await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  setRuntimeConfigSnapshot(cfg, cfg);
  clearConfigCache();
  return { root, cfg };
}

const groupId = "grp_acl_rpc";
const seed: Task = {
  taskId: "task-acl-1",
  groupId,
  title: "private plan",
  status: "in_progress",
  ownerMemberId: "human-ceo",
  assignedMemberIds: ["human-ceo"],
  createdBy: "human-ceo",
  updatedBy: "human-ceo",
  createdAtMs: 1,
  updatedAtMs: 1,
};

const SECRET_STEP = "机密步骤-不得泄露";

async function seedTask(): Promise<void> {
  const { objectStorage } = createWorkspaceCollaborationStores();
  await objectStorage.writeObject(groupId, "task", seed.taskId, seed);
}

async function seedBoardAndProposal(cfg: OpenBotConfig) {
  await seedTask();
  const published = await publishCollaborationBoardItem({
    groupId,
    taskId: seed.taskId,
    remainingWork: "交付私有计划",
    acceptanceCriteria: ["含来源"],
    actor: "bot-secretary",
    cfg,
  });
  await claimCollaborationBoardItem({
    groupId,
    taskId: seed.taskId,
    itemId: published.itemId,
    claimantId: "bot-analyst",
    cfg,
  });
  await applyCollaborationBoardClaim({
    groupId,
    taskId: seed.taskId,
    itemId: published.itemId,
    actor: "bot-analyst",
    cfg,
  });
  const todolist = await proposeCollaborationTodolist({
    groupId,
    taskId: seed.taskId,
    boardItemId: published.itemId,
    ownerMemberId: "bot-analyst",
    steps: [{ title: SECRET_STEP, detail: "仅执行者可见" }],
    actor: "bot-analyst",
    cfg,
  });
  return { published, todolist };
}

describe("Todolist ACL RPC boundary", () => {
  test("schema rejects caller-supplied confirmer and coordinator ids", () => {
    const extra = {
      groupId,
      taskId: seed.taskId,
      todolistId: "td-1",
      authorizedConfirmerIds: ["bot-attacker"],
      coordinatorBotId: "bot-attacker",
    };
    expect(validateCollaborationTaskConfirmTodolistParams(extra)).toBe(false);
    expect(validateCollaborationTaskReviseTodolistParams({ ...extra, reason: "x" })).toBe(false);
    expect(validateCollaborationTaskGetTodolistParams(extra)).toBe(false);
    expect(validateCollaborationTaskListTodolistsParams(extra)).toBe(false);
    expect(
      validateCollaborationTaskConfirmTodolistParams({
        groupId,
        taskId: seed.taskId,
        todolistId: "td-1",
      }),
    ).toBe(true);
  });

  test("service and RPC ignore attacker ACL and fail closed", async () => {
    const { cfg } = await useConfig();
    const { published, todolist } = await seedBoardAndProposal(cfg);

    await expect(
      confirmCollaborationTodolist({
        groupId,
        taskId: seed.taskId,
        todolistId: todolist.todolistId,
        actor: "bot-attacker",
        confirmerId: "bot-secretary",
        authorizedConfirmerIds: ["bot-attacker", "bot-secretary"],
        coordinatorBotId: "bot-attacker",
        cfg,
      }),
    ).rejects.toMatchObject({ code: "confirmer_mismatch" });

    await expect(
      confirmCollaborationTodolist({
        groupId,
        taskId: seed.taskId,
        todolistId: todolist.todolistId,
        actor: "bot-attacker",
        authorizedConfirmerIds: ["bot-attacker"],
        coordinatorBotId: "bot-attacker",
        cfg,
      }),
    ).rejects.toMatchObject({ code: "actor_not_confirmer" });

    const { collaborationLearningHandlers } =
      await import("../server-methods/collaboration-learning.js");
    const rejected = vi.fn();
    await collaborationLearningHandlers["collaboration.task.confirmTodolist"]({
      req: {} as never,
      params: {
        groupId,
        taskId: seed.taskId,
        todolistId: todolist.todolistId,
        authorizedConfirmerIds: ["bot-attacker"],
        coordinatorBotId: "bot-attacker",
      },
      respond: rejected as never,
      context: {} as never,
      client: { connect: { user: "bot-attacker" } } as never,
      isWebchatConnect: () => false,
    });
    expect(rejected).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("invalid collaboration.task.confirmTodolist params"),
      }),
    );

    const attacker = vi.fn();
    await collaborationLearningHandlers["collaboration.task.confirmTodolist"]({
      req: {} as never,
      params: {
        groupId,
        taskId: seed.taskId,
        todolistId: todolist.todolistId,
      },
      respond: attacker as never,
      context: {} as never,
      client: { connect: { user: "bot-attacker" } } as never,
      isWebchatConnect: () => false,
    });
    const attackerError = attacker.mock.calls[0]?.[2] as { message?: string } | undefined;
    expect(attacker.mock.calls[0]?.[0]).toBe(false);
    expect(attackerError?.message ?? "").not.toContain(SECRET_STEP);
    expect(attackerError?.message ?? "").toContain("主答");

    const spoofedPublisher = vi.fn();
    await collaborationLearningHandlers["collaboration.task.confirmTodolist"]({
      req: {} as never,
      params: {
        groupId,
        taskId: seed.taskId,
        todolistId: todolist.todolistId,
      },
      respond: spoofedPublisher as never,
      context: {} as never,
      client: { connect: { user: "bot-secretary" } } as never,
      isWebchatConnect: () => false,
    });
    expect(spoofedPublisher.mock.calls[0]?.[0]).toBe(false);
    const spoofError = spoofedPublisher.mock.calls[0]?.[2] as { message?: string } | undefined;
    expect(spoofError?.message ?? "").toContain("主答");
    expect(spoofError?.message ?? "").not.toContain(SECRET_STEP);

    const { fileStore: membershipStore } = createWorkspaceCollaborationStores();
    const withPublisher = makeOperatingState({
      groupId,
      governance: { coordinatorBotId: "bot-coord" },
    });
    withPublisher.memberRoleMap = [
      {
        memberId: "bot-secretary",
        memberKind: "bot",
        governanceRole: "member",
        collaborationRole: null,
        status: "active",
      },
    ];
    await writeGroupOperatingState({
      fileStore: membershipStore,
      groupId,
      state: withPublisher,
    });

    const spoofActivePublisher = vi.fn();
    await collaborationLearningHandlers["collaboration.task.confirmTodolist"]({
      req: {} as never,
      params: {
        groupId,
        taskId: seed.taskId,
        todolistId: todolist.todolistId,
      },
      respond: spoofActivePublisher as never,
      context: {} as never,
      client: { connect: { user: "bot-secretary" } } as never,
      isWebchatConnect: () => false,
    });
    expect(spoofActivePublisher.mock.calls[0]?.[0]).toBe(false);
    const spoofActiveError = spoofActivePublisher.mock.calls[0]?.[2] as
      | { message?: string }
      | undefined;
    expect(spoofActiveError?.message ?? "").toContain("actor_not_authenticated");
    expect(spoofActiveError?.message ?? "").not.toContain(SECRET_STEP);

    const mismatchedSubject = vi.fn();
    await collaborationLearningHandlers["collaboration.task.confirmTodolist"]({
      req: {} as never,
      params: {
        groupId,
        taskId: seed.taskId,
        todolistId: todolist.todolistId,
      },
      respond: mismatchedSubject as never,
      context: {} as never,
      client: {
        connect: { user: "bot-secretary", client: { displayName: "bot-secretary" } },
        platformUserId: "other-session",
        user: "other-session",
      } as never,
      isWebchatConnect: () => false,
    });
    expect(mismatchedSubject.mock.calls[0]?.[0]).toBe(false);
    const mismatchedError = mismatchedSubject.mock.calls[0]?.[2] as
      | { message?: string }
      | undefined;
    expect(mismatchedError?.message ?? "").toContain("actor_not_authenticated");
    expect(mismatchedError?.message ?? "").not.toContain(SECRET_STEP);

    const spoofRevise = vi.fn();
    await collaborationLearningHandlers["collaboration.task.reviseTodolist"]({
      req: {} as never,
      params: {
        groupId,
        taskId: seed.taskId,
        todolistId: todolist.todolistId,
        reason: "spoofed revise",
      },
      respond: spoofRevise as never,
      context: {} as never,
      client: { connect: { user: "bot-secretary" } } as never,
      isWebchatConnect: () => false,
    });
    expect(spoofRevise.mock.calls[0]?.[0]).toBe(false);
    const spoofReviseError = spoofRevise.mock.calls[0]?.[2] as { message?: string } | undefined;
    expect(spoofReviseError?.message ?? "").toContain("actor_not_authenticated");
    expect(spoofReviseError?.message ?? "").not.toContain(SECRET_STEP);

    const spoofList = vi.fn();
    await collaborationLearningHandlers["collaboration.task.listTodolists"]({
      req: {} as never,
      params: { groupId, taskId: seed.taskId },
      respond: spoofList as never,
      context: {} as never,
      client: { connect: { client: { displayName: "bot-secretary" } } } as never,
      isWebchatConnect: () => false,
    });
    expect(spoofList.mock.calls[0]?.[0]).toBe(false);
    const spoofListError = spoofList.mock.calls[0]?.[2] as { message?: string } | undefined;
    expect(spoofListError?.message ?? "").toContain("actor_not_authenticated");
    expect(JSON.stringify(spoofList.mock.calls[0] ?? [])).not.toContain(SECRET_STEP);

    const lead = vi.fn();
    await collaborationLearningHandlers["collaboration.task.confirmTodolist"]({
      req: {} as never,
      params: {
        groupId,
        taskId: seed.taskId,
        todolistId: todolist.todolistId,
      },
      respond: lead as never,
      context: {} as never,
      client: {
        connect: { user: "bot-secretary" },
        platformUserId: "bot-secretary",
      } as never,
      isWebchatConnect: () => false,
    });
    expect(lead).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        todolist: expect.objectContaining({
          status: "confirmed",
          confirmedBy: "bot-secretary",
        }),
      }),
      undefined,
    );

    await expect(
      getCollaborationTodolist({
        groupId,
        taskId: seed.taskId,
        todolistId: todolist.todolistId,
        actor: "bot-other",
        authorizedConfirmerIds: ["bot-other"],
        coordinatorBotId: "bot-other",
        cfg,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });

    const listed = await listCollaborationTodolists({
      groupId,
      taskId: seed.taskId,
      actor: "bot-other",
      authorizedConfirmerIds: ["bot-other"],
      coordinatorBotId: "bot-other",
      cfg,
    });
    expect(listed).toEqual([]);

    await expect(
      buildCollaborationExecutionTaskBag({
        groupId,
        taskId: seed.taskId,
        boardItemId: published.itemId,
        ownerMemberId: "bot-analyst",
        actor: "bot-attacker",
        authorizedConfirmerIds: ["bot-attacker"],
        coordinatorBotId: "bot-attacker",
        cfg,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ClaimContractEntryError);
      expect((error as ClaimContractEntryError).code).toBe("forbidden");
      expect((error as Error).message).not.toContain(SECRET_STEP);
      return true;
    });

    const ownerBag = await buildCollaborationExecutionTaskBag({
      groupId,
      taskId: seed.taskId,
      boardItemId: published.itemId,
      ownerMemberId: "bot-analyst",
      actor: "bot-analyst",
      cfg,
    });
    expect(ownerBag.todolistCurrentStep?.title).toBe(SECRET_STEP);

    const { fileStore } = createWorkspaceCollaborationStores();
    const active = makeOperatingState({
      groupId,
      governance: { coordinatorBotId: "bot-coord" },
    });
    active.memberRoleMap = [
      {
        memberId: "bot-coord",
        memberKind: "bot",
        governanceRole: "member",
        collaborationRole: null,
        status: "active",
      },
    ];
    await writeGroupOperatingState({ fileStore, groupId, state: active });

    const spoofCoord = vi.fn();
    await collaborationLearningHandlers["collaboration.task.getTodolist"]({
      req: {} as never,
      params: {
        groupId,
        taskId: seed.taskId,
        todolistId: todolist.todolistId,
      },
      respond: spoofCoord as never,
      context: {} as never,
      client: { connect: { user: "bot-coord" } } as never,
      isWebchatConnect: () => false,
    });
    expect(spoofCoord.mock.calls[0]?.[0]).toBe(false);
    const spoofCoordError = spoofCoord.mock.calls[0]?.[2] as { message?: string } | undefined;
    expect(spoofCoordError?.message ?? "").toContain("actor_not_authenticated");
    expect(spoofCoordError?.message ?? "").not.toContain(SECRET_STEP);

    const realCoord = vi.fn();
    await collaborationLearningHandlers["collaboration.task.getTodolist"]({
      req: {} as never,
      params: {
        groupId,
        taskId: seed.taskId,
        todolistId: todolist.todolistId,
      },
      respond: realCoord as never,
      context: {} as never,
      client: { connect: { user: "bot-coord" }, user: "bot-coord" } as never,
      isWebchatConnect: () => false,
    });
    expect(realCoord).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        todolist: expect.objectContaining({ todolistId: todolist.todolistId }),
      }),
      undefined,
    );

    const asCoord = await getCollaborationTodolist({
      groupId,
      taskId: seed.taskId,
      todolistId: todolist.todolistId,
      actor: "bot-coord",
      cfg,
    });
    expect(asCoord.todolistId).toBe(todolist.todolistId);

    const removed = await readGroupOperatingState({ fileStore, groupId });
    expect(removed).toBeTruthy();
    removed!.memberRoleMap = removed!.memberRoleMap.map((row) =>
      row.memberId === "bot-coord" ? { ...row, status: "removed" } : row,
    );
    await writeGroupOperatingState({ fileStore, groupId, state: removed! });
    await expect(
      getCollaborationTodolist({
        groupId,
        taskId: seed.taskId,
        todolistId: todolist.todolistId,
        actor: "bot-coord",
        coordinatorBotId: "bot-coord",
        cfg,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
