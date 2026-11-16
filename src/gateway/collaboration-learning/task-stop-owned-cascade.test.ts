import { afterEach, describe, expect, test } from "vitest";
import {
  clearFollowupQueue,
  clearFollowupQueueItemsForTask,
  getFollowupQueue,
  listFollowupQueueItemsForTask,
  type FollowupRun,
} from "../../auto-reply/reply/queue.js";
import {
  cancelOwnedWorkAfterAcceptedStop,
  type OwnedStopPorts,
  type OwnedStopTarget,
} from "../collaboration-dispatch/task-stop-control.js";
import {
  cancelSupervisorRun,
  clearSupervisorRunsForTest,
  hasSupervisorRun,
  registerSupervisorRun,
} from "../supervisor/run-registry.js";
import { createDefaultOwnedStopPorts } from "./task-stop-entry.js";

function memoryPorts(params: {
  owned: OwnedStopTarget[];
  cancelled: string[];
  refused: string[];
  uncancelable?: Set<string>;
}): OwnedStopPorts {
  return {
    listOwnedTargets: (taskId) => params.owned.filter((row) => row.taskId === taskId),
    cancelTarget: async (target) => {
      if (params.uncancelable?.has(target.id)) {
        return {
          kind: target.kind,
          id: target.id,
          taskId: target.taskId,
          status: "failed",
          detail: "external effect already happened; not rolled back",
        };
      }
      params.cancelled.push(`${target.taskId}:${target.id}`);
      return {
        kind: target.kind,
        id: target.id,
        taskId: target.taskId,
        status: "confirmed_stopped",
      };
    },
    refuseUnstartedAdmission: (taskId) => {
      params.refused.push(taskId);
    },
  };
}

describe("R1 owned-work stop cascade", () => {
  afterEach(() => {
    clearSupervisorRunsForTest();
    clearFollowupQueue("session-a");
    clearFollowupQueue("session-b");
  });

  test("1: stopping A cancels A and descendants only; B continues", async () => {
    const cancelled: string[] = [];
    const refused: string[] = [];
    const ports = memoryPorts({
      owned: [
        { kind: "current_run", id: "run-a", taskId: "task-a" },
        { kind: "child_execution", id: "child-a1", taskId: "task-a" },
        { kind: "current_run", id: "run-b", taskId: "task-b" },
        { kind: "child_execution", id: "child-b1", taskId: "task-b" },
      ],
      cancelled,
      refused,
    });
    const facts = await cancelOwnedWorkAfterAcceptedStop({
      taskId: "task-a",
      stopAccepted: true,
      ports,
    });
    expect(facts.map((row) => row.id).toSorted()).toEqual(["child-a1", "run-a"]);
    expect(cancelled).toEqual(["task-a:run-a", "task-a:child-a1"]);
    expect(cancelled.join(" ")).not.toContain("task-b");
  });

  test("2: cascade does not run until the stop fence is accepted", async () => {
    const cancelled: string[] = [];
    const facts = await cancelOwnedWorkAfterAcceptedStop({
      taskId: "task-a",
      stopAccepted: false,
      ports: memoryPorts({
        owned: [{ kind: "current_run", id: "run-a", taskId: "task-a" }],
        cancelled,
        refused: [],
      }),
    });
    expect(facts).toEqual([]);
    expect(cancelled).toEqual([]);
  });

  test("3: list/cancel only see the CAS-winning task identity", async () => {
    const cancelled: string[] = [];
    const stale: OwnedStopTarget = { kind: "current_run", id: "run-stale", taskId: "task-old" };
    const live: OwnedStopTarget = { kind: "current_run", id: "run-live", taskId: "task-a" };
    const facts = await cancelOwnedWorkAfterAcceptedStop({
      taskId: "task-a",
      stopAccepted: true,
      ports: memoryPorts({ owned: [stale, live], cancelled, refused: [] }),
    });
    expect(facts).toHaveLength(1);
    expect(facts[0]?.id).toBe("run-live");
    expect(cancelled).toEqual(["task-a:run-live"]);
  });

  test("4: registered children are cancelled; unstarted admission is refused", async () => {
    const cancelled: string[] = [];
    const refused: string[] = [];
    const facts = await cancelOwnedWorkAfterAcceptedStop({
      taskId: "task-a",
      stopAccepted: true,
      ports: memoryPorts({
        owned: [{ kind: "child_execution", id: "child-registered", taskId: "task-a" }],
        cancelled,
        refused,
      }),
    });
    expect(refused).toEqual(["task-a"]);
    expect(facts[0]?.id).toBe("child-registered");
    expect(cancelled).toEqual(["task-a:child-registered"]);
  });

  test("5: uncancelable external work is reported as fact, not rolled back", async () => {
    const cancelled: string[] = [];
    const facts = await cancelOwnedWorkAfterAcceptedStop({
      taskId: "task-a",
      stopAccepted: true,
      ports: memoryPorts({
        owned: [
          {
            kind: "remote_job",
            id: "ext-1",
            taskId: "task-a",
            remote: { jobId: "j1", leaseId: "l1", authorized: true },
          },
        ],
        cancelled,
        refused: [],
        uncancelable: new Set(["ext-1"]),
      }),
    });
    expect(cancelled).toEqual([]);
    expect(facts[0]?.status).toBe("failed");
    expect(facts[0]?.detail).toMatch(/not rolled back/);
  });

  test("6: unowned remote stays unsupported/unconfirmed and is not cancelled", async () => {
    const cancelled: string[] = [];
    const unowned: OwnedStopTarget = {
      kind: "remote_job",
      id: "remote-unknown",
      taskId: "task-a",
    };
    const owned: OwnedStopTarget = {
      kind: "remote_job",
      id: "remote-owned",
      taskId: "task-a",
      remote: { jobId: "job-1", leaseId: "lease-1", authorized: true },
    };
    const facts = await cancelOwnedWorkAfterAcceptedStop({
      taskId: "task-a",
      stopAccepted: true,
      ports: memoryPorts({ owned: [unowned, owned], cancelled, refused: [] }),
    });
    const byId = Object.fromEntries(facts.map((row) => [row.id, row]));
    expect(byId["remote-unknown"]?.status).toBe("unsupported");
    expect(byId["remote-owned"]?.status).toBe("confirmed_stopped");
    expect(cancelled).toEqual(["task-a:remote-owned"]);
  });

  test("7: repeat cascade is idempotent and still refuses unstarted admission", async () => {
    const cancelled: string[] = [];
    const refused: string[] = [];
    const seen = new Set<string>();
    const ports: OwnedStopPorts = {
      listOwnedTargets: (taskId) =>
        taskId === "task-a" ? [{ kind: "current_run", id: "run-a", taskId: "task-a" }] : [],
      cancelTarget: async (target) => {
        const key = `${target.taskId}:${target.id}`;
        if (seen.has(key)) {
          return {
            kind: target.kind,
            id: target.id,
            taskId: target.taskId,
            status: "confirmed_stopped",
            detail: "already stopped",
          };
        }
        seen.add(key);
        cancelled.push(key);
        return {
          kind: target.kind,
          id: target.id,
          taskId: target.taskId,
          status: "confirmed_stopped",
        };
      },
      refuseUnstartedAdmission: (taskId) => {
        refused.push(taskId);
      },
    };
    const first = await cancelOwnedWorkAfterAcceptedStop({
      taskId: "task-a",
      stopAccepted: true,
      ports,
    });
    const second = await cancelOwnedWorkAfterAcceptedStop({
      taskId: "task-a",
      stopAccepted: true,
      ports,
    });
    expect(first[0]?.status).toBe("confirmed_stopped");
    expect(second[0]?.status).toBe("confirmed_stopped");
    expect(second[0]?.detail).toBe("already stopped");
    expect(cancelled).toEqual(["task-a:run-a"]);
    expect(refused).toEqual(["task-a", "task-a"]);
  });

  test("default ports cancel only the supervisor run bound to this taskId", async () => {
    const cancelled: string[] = [];
    registerSupervisorRun({
      taskId: "task-a",
      runId: "run-a",
      worker: {
        cancel: async (runId) => {
          cancelled.push(`a:${runId}`);
        },
      },
      workerId: "w",
    });
    registerSupervisorRun({
      taskId: "task-b",
      runId: "run-b",
      worker: {
        cancel: async (runId) => {
          cancelled.push(`b:${runId}`);
        },
      },
      workerId: "w",
    });
    expect(hasSupervisorRun("task-a")).toBe(true);
    expect(hasSupervisorRun("task-b")).toBe(true);
    const facts = await cancelOwnedWorkAfterAcceptedStop({
      taskId: "task-a",
      stopAccepted: true,
      ports: createDefaultOwnedStopPorts(),
    });
    expect(facts).toEqual([
      expect.objectContaining({
        kind: "supervisor_run",
        id: "task-a",
        taskId: "task-a",
        status: "confirmed_stopped",
      }),
    ]);
    expect(cancelled).toEqual(["a:run-a"]);
    expect(hasSupervisorRun("task-b")).toBe(true);
    expect(await cancelSupervisorRun("task-b")).toBe(true);
  });

  test("queue drain removes only items with an explicit task binding", () => {
    const settings = { mode: "followup" as const };
    const queueA = getFollowupQueue("session-shared", settings);
    const queueB = getFollowupQueue("session-other", settings);
    const baseRun = {
      agentId: "bot",
      agentDir: "/tmp",
      sessionId: "s",
      sessionFile: "/tmp/session.jsonl",
    } as FollowupRun["run"];
    queueA.items.push(
      {
        prompt: "work a",
        enqueuedAt: 1,
        followupItemId: "item-a",
        taskBoardContinueTicket: { taskId: "task-a", focusRevision: 1 },
        run: { ...baseRun },
      },
      {
        prompt: "work b",
        enqueuedAt: 2,
        followupItemId: "item-b",
        taskBoardContinueTicket: { taskId: "task-b", focusRevision: 1 },
        run: { ...baseRun },
      },
      {
        prompt: "unbound",
        enqueuedAt: 3,
        followupItemId: "item-unbound",
        run: { ...baseRun },
      },
    );
    queueB.items.push({
      prompt: "other session a",
      enqueuedAt: 4,
      followupItemId: "item-a-other",
      parentTaskId: "task-a",
      run: { ...baseRun },
    });
    expect(
      listFollowupQueueItemsForTask("task-a")
        .map((row) => row.item.followupItemId)
        .toSorted((left, right) => (left ?? "").localeCompare(right ?? "")),
    ).toEqual(["item-a", "item-a-other"]);
    expect(clearFollowupQueueItemsForTask("task-a")).toBe(2);
    expect(queueA.items.map((item) => item.followupItemId)).toEqual(["item-b", "item-unbound"]);
    expect(queueB.items).toEqual([]);
    clearFollowupQueue("session-shared");
    clearFollowupQueue("session-other");
  });
});
