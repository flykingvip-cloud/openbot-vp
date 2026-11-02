import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Deliverable, Task } from "@openbot/collaboration-core";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { makeOperatingState } from "../collaboration-dispatch/__fixtures__/policy-source-matrix.js";
import {
  CURRENT_TASK_NO_FORMAL_DELIVERABLE,
  createWorkspaceCollaborationStores,
  projectOperatingDeliverableBinding,
  readGroupOperatingState,
  selectActiveDeliverable,
  selectActiveTask,
  selectDeliverableForCurrentTask,
  summarizeActiveContext,
  syncGroupOperatingState,
  writeGroupOperatingState,
} from "./shared.js";

const tempDirs: string[] = [];

afterEach(async () => {
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  delete process.env.OPENBOT_CONFIG_PATH;
  delete process.env.OPENCLAW_CONFIG_PATH;
  delete process.env.OPENBOT_STATE_DIR;
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function task(patch: Partial<Task> & Pick<Task, "taskId" | "status">): Task {
  return {
    groupId: "g1",
    title: patch.taskId,
    createdAtMs: 1,
    updatedAtMs: 1,
    ...patch,
  };
}

function deliverable(
  patch: Partial<Deliverable> & Pick<Deliverable, "deliverableId" | "status">,
): Deliverable {
  return {
    groupId: "g1",
    title: patch.deliverableId,
    version: 1,
    createdAtMs: 1,
    updatedAtMs: 1,
    ...patch,
  };
}

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

async function useSyncHarness(): Promise<{
  cfg: OpenBotConfig;
  groupId: string;
  stores: ReturnType<typeof createWorkspaceCollaborationStores>;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-os-bind-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  const cfg = flagConfig(root);
  const configPath = path.join(root, "openbot.json");
  await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  setRuntimeConfigSnapshot(cfg, cfg);
  clearConfigCache();
  const groupId = "grp-os-bind";
  const stores = createWorkspaceCollaborationStores(cfg);
  await stores.groupStorage.writeProfile({
    groupId,
    groupCode: groupId,
    displayName: "os-bind",
    ownerUserId: "human:owner",
    coordinatorBotId: "bot-c",
    createdAtMs: 1,
    updatedAtMs: 1,
  });
  await stores.groupStorage.writeMembers(groupId, [
    {
      memberId: "human:owner",
      memberKind: "human",
      userId: "human:owner",
      name: "Owner",
      governanceRole: "owner",
      status: "active",
    },
    {
      memberId: "bot-c",
      memberKind: "bot",
      agentId: "bot-c",
      name: "Coordinator",
      governanceRole: "member",
      status: "active",
    },
  ]);
  return { cfg, groupId, stores };
}

describe("operating deliverable binding", () => {
  it("does not reuse a newer historical deliverable for the current task", () => {
    const historical = deliverable({
      deliverableId: "del-td-8eb334b143d72e41-f41d562f",
      taskId: "F4-20261029-uxp0",
      status: "submitted",
      updatedAtMs: 9_000,
    });
    const currentTaskId = "d2t-1a878cb6fbef8cd92109834f";
    expect(selectActiveDeliverable([historical])?.deliverableId).toBe(historical.deliverableId);
    expect(selectDeliverableForCurrentTask([historical], currentTaskId)).toBeUndefined();

    const binding = projectOperatingDeliverableBinding({
      tasks: [task({ taskId: currentTaskId, status: "ready", updatedAtMs: 10 })],
      deliverables: [historical],
    });
    expect(binding.task?.taskId).toBe(currentTaskId);
    expect(binding.currentDeliverableId).toBeNull();
    expect(binding.noFormalDeliverable).toBe(true);
    expect(binding.historicalOnly).toBe(false);
    expect(binding.phase).toBe("explore");
    const summary = summarizeActiveContext({
      phase: binding.phase,
      taskId: currentTaskId,
      deliverableId: binding.currentDeliverableId,
      noFormalDeliverableForCurrentTask: binding.noFormalDeliverable,
    });
    expect(summary).toContain(CURRENT_TASK_NO_FORMAL_DELIVERABLE);
    expect(summary).not.toContain(historical.deliverableId);
  });

  it("keeps a deliverable only when its taskId is the active task", () => {
    const currentTaskId = "d2t-current";
    const historical = deliverable({
      deliverableId: "del-old",
      taskId: "F4-old",
      status: "approved",
      updatedAtMs: 50,
    });
    const current = deliverable({
      deliverableId: "del-current",
      taskId: currentTaskId,
      status: "draft",
      updatedAtMs: 5,
    });
    const unbound = deliverable({
      deliverableId: "del-unbound",
      status: "submitted",
      updatedAtMs: 80,
    });
    const binding = projectOperatingDeliverableBinding({
      tasks: [task({ taskId: currentTaskId, status: "in_progress", updatedAtMs: 3 })],
      deliverables: [historical, unbound, current],
    });
    expect(binding.currentDeliverableId).toBe("del-current");
    expect(binding.noFormalDeliverable).toBe(false);
    expect(binding.phase).toBe("deliver");
  });

  it("ignores archived rows and a deliverable with a blank taskId", () => {
    const currentTaskId = "d2t-current";
    const binding = projectOperatingDeliverableBinding({
      tasks: [task({ taskId: currentTaskId, status: "ready" })],
      deliverables: [
        deliverable({
          deliverableId: "del-archived",
          taskId: currentTaskId,
          status: "archived",
          updatedAtMs: 20,
        }),
        deliverable({
          deliverableId: "del-blank",
          taskId: "  ",
          status: "submitted",
          updatedAtMs: 30,
        }),
      ],
    });
    expect(binding.currentDeliverableId).toBeNull();
    expect(binding.noFormalDeliverable).toBe(true);
  });

  it("without an active task keeps historical deliverables historical (not current)", () => {
    const row = deliverable({
      deliverableId: "del-only",
      taskId: "task-done",
      status: "approved",
      updatedAtMs: 4,
    });
    const binding = projectOperatingDeliverableBinding({
      tasks: [task({ taskId: "task-done", status: "completed", updatedAtMs: 4 })],
      deliverables: [row],
    });
    expect(binding.task).toBeUndefined();
    expect(binding.currentDeliverableId).toBeNull();
    expect(binding.noFormalDeliverable).toBe(false);
    expect(binding.historicalOnly).toBe(true);
    expect(binding.phase).toBe("explore");
  });

  it("preferredTaskId authority beats a newer updatedAt on another active task", () => {
    const bound = task({ taskId: "task-bound", status: "in_progress", updatedAtMs: 10 });
    const newer = task({ taskId: "task-newer", status: "ready", updatedAtMs: 99_000 });
    expect(selectActiveTask([bound, newer])?.taskId).toBe("task-newer");
    expect(selectActiveTask([bound, newer], "task-bound")?.taskId).toBe("task-bound");

    const binding = projectOperatingDeliverableBinding({
      tasks: [bound, newer],
      deliverables: [
        deliverable({
          deliverableId: "del-bound",
          taskId: "task-bound",
          status: "draft",
          updatedAtMs: 5,
        }),
        deliverable({
          deliverableId: "del-newer",
          taskId: "task-newer",
          status: "submitted",
          updatedAtMs: 80_000,
        }),
      ],
      preferredTaskId: "task-bound",
    });
    expect(binding.task?.taskId).toBe("task-bound");
    expect(binding.currentDeliverableId).toBe("del-bound");
  });
});

describe("syncGroupOperatingState real storage authority", () => {
  it("after switching tasks, does not keep the old deliverable binding", async () => {
    const { cfg, groupId, stores } = await useSyncHarness();
    const taskOld = "task-old";
    const taskNew = "task-new";
    await stores.objectStorage.writeObject(groupId, "task", taskOld, {
      taskId: taskOld,
      groupId,
      title: "old",
      status: "in_progress",
      createdAtMs: 1,
      updatedAtMs: 100,
    } satisfies Task);
    await stores.objectStorage.writeObject(groupId, "deliverable", "del-old", {
      deliverableId: "del-old",
      groupId,
      taskId: taskOld,
      title: "old del",
      status: "draft",
      version: 1,
      createdAtMs: 1,
      updatedAtMs: 100,
    } satisfies Deliverable);

    const first = await syncGroupOperatingState({
      fileStore: stores.fileStore,
      groupStorage: stores.groupStorage,
      metadataStorage: stores.metadataStorage,
      memoryStorage: stores.memoryStorage,
      learningStorage: stores.learningStorage,
      objectStorage: stores.objectStorage,
      groupId,
    });
    expect(first.activeContext.currentTaskId).toBe(taskOld);
    expect(first.activeContext.currentDeliverableId).toBe("del-old");

    // Switch: mark old completed, write new active task + deliverable.
    await stores.objectStorage.writeObject(groupId, "task", taskOld, {
      taskId: taskOld,
      groupId,
      title: "old",
      status: "completed",
      createdAtMs: 1,
      updatedAtMs: 200,
    } satisfies Task);
    await stores.objectStorage.writeObject(groupId, "task", taskNew, {
      taskId: taskNew,
      groupId,
      title: "new",
      status: "ready",
      createdAtMs: 150,
      updatedAtMs: 150,
    } satisfies Task);
    await stores.objectStorage.writeObject(groupId, "deliverable", "del-new", {
      deliverableId: "del-new",
      groupId,
      taskId: taskNew,
      title: "new del",
      status: "draft",
      version: 1,
      createdAtMs: 150,
      updatedAtMs: 150,
    } satisfies Deliverable);

    // Seed OS authority to the new task before sync (as activate would).
    const seeded = makeOperatingState({ groupId });
    seeded.activeContext = {
      ...seeded.activeContext,
      currentTaskId: taskNew,
      currentDeliverableId: null,
      summary: "switched",
      updatedAtMs: 160,
    };
    await writeGroupOperatingState({
      fileStore: stores.fileStore,
      groupId,
      state: seeded,
      cfg,
    });

    const second = await syncGroupOperatingState({
      fileStore: stores.fileStore,
      groupStorage: stores.groupStorage,
      metadataStorage: stores.metadataStorage,
      memoryStorage: stores.memoryStorage,
      learningStorage: stores.learningStorage,
      objectStorage: stores.objectStorage,
      groupId,
    });
    expect(second.activeContext.currentTaskId).toBe(taskNew);
    expect(second.activeContext.currentDeliverableId).toBe("del-new");
    expect(second.activeContext.currentDeliverableId).not.toBe("del-old");
    expect(second.activeContext.summary).not.toContain("del-old");

    const persisted = await readGroupOperatingState({
      fileStore: stores.fileStore,
      groupId,
    });
    expect(persisted?.activeContext.currentTaskId).toBe(taskNew);
    expect(persisted?.activeContext.currentDeliverableId).toBe("del-new");
    expect(persisted?.activeContext.currentOperatingPhase).toBe(
      second.activeContext.currentOperatingPhase,
    );
    expect(persisted?.activeContext.summary).toBe(second.activeContext.summary);
  });

  it("updates on an old task must not steal the current OS binding", async () => {
    const { cfg, groupId, stores } = await useSyncHarness();
    const taskCurrent = "task-current";
    const taskOld = "task-old-active";
    await stores.objectStorage.writeObject(groupId, "task", taskCurrent, {
      taskId: taskCurrent,
      groupId,
      title: "current",
      status: "in_progress",
      createdAtMs: 1,
      updatedAtMs: 10,
    } satisfies Task);
    await stores.objectStorage.writeObject(groupId, "task", taskOld, {
      taskId: taskOld,
      groupId,
      title: "old active",
      status: "ready",
      createdAtMs: 1,
      updatedAtMs: 5,
    } satisfies Task);
    await stores.objectStorage.writeObject(groupId, "deliverable", "del-current", {
      deliverableId: "del-current",
      groupId,
      taskId: taskCurrent,
      title: "current del",
      status: "draft",
      version: 1,
      createdAtMs: 1,
      updatedAtMs: 10,
    } satisfies Deliverable);
    await stores.objectStorage.writeObject(groupId, "deliverable", "del-old", {
      deliverableId: "del-old",
      groupId,
      taskId: taskOld,
      title: "old del",
      status: "submitted",
      version: 1,
      createdAtMs: 1,
      updatedAtMs: 5,
    } satisfies Deliverable);

    const seeded = makeOperatingState({ groupId });
    seeded.activeContext = {
      ...seeded.activeContext,
      currentTaskId: taskCurrent,
      currentDeliverableId: "del-current",
      summary: "bound",
      updatedAtMs: 10,
    };
    await writeGroupOperatingState({
      fileStore: stores.fileStore,
      groupId,
      state: seeded,
      cfg,
    });

    // Old task gets a much newer update — must not steal preferred binding.
    await stores.objectStorage.writeObject(groupId, "task", taskOld, {
      taskId: taskOld,
      groupId,
      title: "old active bumped",
      status: "in_progress",
      createdAtMs: 1,
      updatedAtMs: 99_000,
    } satisfies Task);
    await stores.objectStorage.writeObject(groupId, "deliverable", "del-old", {
      deliverableId: "del-old",
      groupId,
      taskId: taskOld,
      title: "old del bumped",
      status: "submitted",
      version: 2,
      createdAtMs: 1,
      updatedAtMs: 99_000,
    } satisfies Deliverable);

    const synced = await syncGroupOperatingState({
      fileStore: stores.fileStore,
      groupStorage: stores.groupStorage,
      metadataStorage: stores.metadataStorage,
      memoryStorage: stores.memoryStorage,
      learningStorage: stores.learningStorage,
      objectStorage: stores.objectStorage,
      groupId,
    });
    expect(synced.activeContext.currentTaskId).toBe(taskCurrent);
    expect(synced.activeContext.currentDeliverableId).toBe("del-current");
    expect(synced.activeContext.currentDeliverableId).not.toBe("del-old");

    const persisted = await readGroupOperatingState({
      fileStore: stores.fileStore,
      groupId,
    });
    expect(persisted?.activeContext.currentTaskId).toBe(taskCurrent);
    expect(persisted?.activeContext.currentDeliverableId).toBe("del-current");
    expect(persisted?.activeContext.currentOperatingPhase).toBe(
      synced.activeContext.currentOperatingPhase,
    );
    expect(persisted?.activeContext.summary).toBe(synced.activeContext.summary);
  });

  it("when no current task, historical deliverables do not pose as current", async () => {
    const { groupId, stores } = await useSyncHarness();
    await stores.objectStorage.writeObject(groupId, "task", "task-done", {
      taskId: "task-done",
      groupId,
      title: "done",
      status: "completed",
      createdAtMs: 1,
      updatedAtMs: 50,
    } satisfies Task);
    await stores.objectStorage.writeObject(groupId, "deliverable", "del-hist", {
      deliverableId: "del-hist",
      groupId,
      taskId: "task-done",
      title: "hist",
      status: "approved",
      version: 1,
      createdAtMs: 1,
      updatedAtMs: 50,
    } satisfies Deliverable);

    const synced = await syncGroupOperatingState({
      fileStore: stores.fileStore,
      groupStorage: stores.groupStorage,
      metadataStorage: stores.metadataStorage,
      memoryStorage: stores.memoryStorage,
      learningStorage: stores.learningStorage,
      objectStorage: stores.objectStorage,
      groupId,
    });
    expect(synced.activeContext.currentTaskId).toBeNull();
    expect(synced.activeContext.currentDeliverableId).toBeNull();
    expect(synced.activeContext.summary).not.toContain("del-hist");
    expect(synced.activeContext.currentOperatingPhase).toBe("explore");

    const persisted = await readGroupOperatingState({
      fileStore: stores.fileStore,
      groupId,
    });
    expect(persisted?.activeContext.currentTaskId).toBeNull();
    expect(persisted?.activeContext.currentDeliverableId).toBeNull();
    expect(persisted?.activeContext.currentOperatingPhase).toBe("explore");
    expect(persisted?.activeContext.summary).toBe(synced.activeContext.summary);
  });

  it("explicit preferredTaskId (activate B) switches focus while stale A stays active", async () => {
    const { cfg, groupId, stores } = await useSyncHarness();
    const taskA = "task-a-stale-focus";
    const taskB = "task-b-activated";
    await stores.objectStorage.writeObject(groupId, "task", taskA, {
      taskId: taskA,
      groupId,
      title: "A",
      status: "in_progress",
      createdAtMs: 1,
      updatedAtMs: 50,
    } satisfies Task);
    await stores.objectStorage.writeObject(groupId, "task", taskB, {
      taskId: taskB,
      groupId,
      title: "B",
      status: "ready",
      createdAtMs: 60,
      updatedAtMs: 60,
    } satisfies Task);
    await stores.objectStorage.writeObject(groupId, "deliverable", "del-a", {
      deliverableId: "del-a",
      groupId,
      taskId: taskA,
      title: "A del",
      status: "draft",
      version: 1,
      createdAtMs: 1,
      updatedAtMs: 50,
    } satisfies Deliverable);
    await stores.objectStorage.writeObject(groupId, "deliverable", "del-b", {
      deliverableId: "del-b",
      groupId,
      taskId: taskB,
      title: "B del",
      status: "draft",
      version: 1,
      createdAtMs: 60,
      updatedAtMs: 60,
    } satisfies Deliverable);

    const seeded = makeOperatingState({ groupId });
    seeded.activeContext = {
      ...seeded.activeContext,
      currentTaskId: taskA,
      currentDeliverableId: "del-a",
      summary: "stale A",
      updatedAtMs: 50,
    };
    await writeGroupOperatingState({
      fileStore: stores.fileStore,
      groupId,
      state: seeded,
      cfg,
    });

    // Background sync without override keeps A (A still active).
    const background = await syncGroupOperatingState({
      fileStore: stores.fileStore,
      groupStorage: stores.groupStorage,
      metadataStorage: stores.metadataStorage,
      memoryStorage: stores.memoryStorage,
      learningStorage: stores.learningStorage,
      objectStorage: stores.objectStorage,
      groupId,
    });
    expect(background.activeContext.currentTaskId).toBe(taskA);
    expect(background.activeContext.currentDeliverableId).toBe("del-a");

    // Explicit activate/switch preferredTaskId=B beats stale A.
    const activated = await syncGroupOperatingState({
      fileStore: stores.fileStore,
      groupStorage: stores.groupStorage,
      metadataStorage: stores.metadataStorage,
      memoryStorage: stores.memoryStorage,
      learningStorage: stores.learningStorage,
      objectStorage: stores.objectStorage,
      groupId,
      preferredTaskId: taskB,
    });
    expect(activated.activeContext.currentTaskId).toBe(taskB);
    expect(activated.activeContext.currentDeliverableId).toBe("del-b");
    expect(activated.activeContext.currentDeliverableId).not.toBe("del-a");

    const persisted = await readGroupOperatingState({
      fileStore: stores.fileStore,
      groupId,
    });
    expect(persisted?.activeContext.currentTaskId).toBe(taskB);
    expect(persisted?.activeContext.currentDeliverableId).toBe("del-b");
  });
});
