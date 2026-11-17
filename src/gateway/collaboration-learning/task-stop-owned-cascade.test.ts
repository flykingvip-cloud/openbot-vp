import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  clearActiveEmbeddedRun,
  setActiveEmbeddedRun,
} from "../../agent-runtime/execution/runner/run-registry.js";
import {
  clearAsyncWaitJobsForTests,
  listAsyncWaitJobRefsForTask,
  readAsyncWaitJobIntent,
  recordAsyncWaitJobIntent,
  resetAsyncWaitJobIndexForTests,
} from "../../agent-runtime/state/index.js";
import {
  listOwnedChildExecutions,
  registerOwnedChildExecution,
  registerOwnedRemoteJob,
  resetOwnedStopAffiliationsForTests,
} from "../../agent-runtime/state/owned-stop-affiliation.js";
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
  unregisterSupervisorRun,
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
    resetOwnedStopAffiliationsForTests();
    resetAsyncWaitJobIndexForTests();
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
          unregisterSupervisorRun("task-a");
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
          unregisterSupervisorRun("task-b");
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

  test("default adapter cancels only owned child executions by explicit taskId", async () => {
    const aborted: string[] = [];
    const handleA = {
      queueMessage: async () => {},
      isStreaming: () => false,
      isCompacting: () => false,
      abort: () => {
        aborted.push("child-a1");
        clearActiveEmbeddedRun("session-child-a", handleA);
      },
    };
    const handleB = {
      queueMessage: async () => {},
      isStreaming: () => false,
      isCompacting: () => false,
      abort: () => {
        aborted.push("child-b1");
        clearActiveEmbeddedRun("session-child-b", handleB);
      },
    };
    setActiveEmbeddedRun("session-child-a", handleA, undefined, "child-a1");
    setActiveEmbeddedRun("session-child-b", handleB, undefined, "child-b1");
    registerOwnedChildExecution({
      taskId: "task-a",
      id: "child-a1",
      sessionId: "session-child-a",
    });
    registerOwnedChildExecution({
      taskId: "task-b",
      id: "child-b1",
      sessionId: "session-child-b",
    });
    const facts = await cancelOwnedWorkAfterAcceptedStop({
      taskId: "task-a",
      stopAccepted: true,
      ports: createDefaultOwnedStopPorts(),
    });
    expect(facts).toEqual([
      expect.objectContaining({
        kind: "child_execution",
        id: "child-a1",
        taskId: "task-a",
        status: "confirmed_stopped",
      }),
    ]);
    expect(aborted).toEqual(["child-a1"]);
    expect(listOwnedChildExecutions("task-a")).toEqual([]);
    expect(listOwnedChildExecutions("task-b").map((row) => row.id)).toEqual(["child-b1"]);
    clearActiveEmbeddedRun("session-child-a", handleA);
    clearActiveEmbeddedRun("session-child-b", handleB);
  });

  test("default adapter does not cancel a child registered after the list snapshot", async () => {
    const facts = await cancelOwnedWorkAfterAcceptedStop({
      taskId: "task-a",
      stopAccepted: true,
      ports: {
        ...createDefaultOwnedStopPorts(),
        listOwnedTargets: (taskId) => {
          const listed = createDefaultOwnedStopPorts().listOwnedTargets(taskId);
          registerOwnedChildExecution({
            taskId: "task-a",
            id: "child-late",
            sessionId: "session-late",
          });
          return listed;
        },
      },
    });
    expect(facts).toEqual([]);
    expect(listOwnedChildExecutions("task-a").map((row) => row.id)).toEqual(["child-late"]);
  });

  test("default adapter cancels owned remotes with job+lease+authorization only", async () => {
    const cancelled: string[] = [];
    registerOwnedRemoteJob({
      taskId: "task-a",
      jobId: "job-incomplete",
      leaseId: "lease-missing-auth",
      authorized: false,
      cancel: async () => {
        cancelled.push("job-incomplete");
        return true;
      },
    });
    registerOwnedRemoteJob({
      taskId: "task-a",
      jobId: "job-owned",
      leaseId: "lease-owned",
      authorized: true,
      cancel: async () => {
        cancelled.push("job-owned");
        return true;
      },
    });
    registerOwnedRemoteJob({
      taskId: "task-b",
      jobId: "job-other",
      leaseId: "lease-other",
      authorized: true,
      cancel: async () => {
        cancelled.push("job-other");
        return true;
      },
    });
    const facts = await cancelOwnedWorkAfterAcceptedStop({
      taskId: "task-a",
      stopAccepted: true,
      ports: createDefaultOwnedStopPorts(),
    });
    expect(facts).toEqual([
      expect.objectContaining({
        kind: "remote_job",
        id: "job-incomplete",
        taskId: "task-a",
        status: "unsupported",
      }),
      expect.objectContaining({
        kind: "remote_job",
        id: "job-owned",
        taskId: "task-a",
        status: "confirmed_stopped",
      }),
    ]);
    expect(cancelled).toEqual(["job-owned"]);
  });

  test("default adapter clears only owned async-wait jobs by explicit taskId", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "owned-stop-async-wait-"));
    const sessionA = path.join(root, "session-a.jsonl");
    const sessionB = path.join(root, "session-b.jsonl");
    fs.writeFileSync(sessionA, "");
    fs.writeFileSync(sessionB, "");
    try {
      recordAsyncWaitJobIntent({
        jobId: "wait-a",
        sessionKey: "session-a",
        sessionFile: sessionA,
        taskId: "task-a",
        executionAttempt: "attempt-a",
        deliverableVersion: "v1",
        startedAt: Date.now(),
      });
      recordAsyncWaitJobIntent({
        jobId: "wait-b",
        sessionKey: "session-b",
        sessionFile: sessionB,
        taskId: "task-b",
        executionAttempt: "attempt-b",
        deliverableVersion: "v1",
        startedAt: Date.now(),
      });
      expect(listAsyncWaitJobRefsForTask("task-a").map((row) => row.jobId)).toEqual(["wait-a"]);
      const facts = await cancelOwnedWorkAfterAcceptedStop({
        taskId: "task-a",
        stopAccepted: true,
        ports: createDefaultOwnedStopPorts(),
      });
      expect(facts).toEqual([
        expect.objectContaining({
          kind: "async_wait_job",
          id: "wait-a",
          taskId: "task-a",
          status: "confirmed_stopped",
        }),
      ]);
      expect(readAsyncWaitJobIntent(sessionA, "wait-a")?.status).toBe("cleared");
      expect(readAsyncWaitJobIntent(sessionB, "wait-b")?.status).toBe("waiting");
    } finally {
      clearAsyncWaitJobsForTests(sessionA);
      clearAsyncWaitJobsForTests(sessionB);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("probe 1: default adapter does not invoke cancel after list-time revoke or lease replace", async () => {
    const cancelled: string[] = [];
    const cancel = async () => {
      cancelled.push("job-owned");
      return true;
    };
    const registerLive = (overrides?: { leaseId?: string; authorized?: boolean }) => {
      registerOwnedRemoteJob({
        taskId: "task-a",
        jobId: "job-owned",
        leaseId: overrides?.leaseId ?? "lease-1",
        authorized: overrides?.authorized ?? true,
        cancel,
      });
    };

    registerLive();
    const revokePorts = createDefaultOwnedStopPorts();
    const revoked = await cancelOwnedWorkAfterAcceptedStop({
      taskId: "task-a",
      stopAccepted: true,
      ports: {
        ...revokePorts,
        listOwnedTargets: (taskId) => {
          const listed = revokePorts.listOwnedTargets(taskId);
          registerLive({ authorized: false });
          return listed;
        },
      },
    });
    expect(cancelled).toEqual([]);
    expect(revoked).toEqual([
      expect.objectContaining({
        kind: "remote_job",
        id: "job-owned",
        taskId: "task-a",
        status: "unsupported",
      }),
    ]);

    registerLive();
    const replacePorts = createDefaultOwnedStopPorts();
    const replaced = await cancelOwnedWorkAfterAcceptedStop({
      taskId: "task-a",
      stopAccepted: true,
      ports: {
        ...replacePorts,
        listOwnedTargets: (taskId) => {
          const listed = replacePorts.listOwnedTargets(taskId);
          registerLive({ leaseId: "lease-2", authorized: true });
          return listed;
        },
      },
    });
    expect(cancelled).toEqual([]);
    expect(replaced).toEqual([
      expect.objectContaining({
        kind: "remote_job",
        id: "job-owned",
        taskId: "task-a",
        status: "unsupported",
      }),
    ]);
  });

  test("probe 2: leftover session affiliation does not stop a replacement run", async () => {
    const aborted: string[] = [];
    const leftoverHandle = {
      queueMessage: async () => {},
      isStreaming: () => false,
      isCompacting: () => false,
      abort: () => {
        aborted.push("leftover");
      },
    };
    const replacementHandle = {
      queueMessage: async () => {},
      isStreaming: () => false,
      isCompacting: () => false,
      abort: () => {
        aborted.push("replacement");
      },
    };
    setActiveEmbeddedRun("session-shared", leftoverHandle, undefined, "child-old");
    registerOwnedChildExecution({
      taskId: "task-a",
      id: "child-old",
      sessionId: "session-shared",
    });
    setActiveEmbeddedRun("session-shared", replacementHandle, undefined, "child-new");
    registerOwnedChildExecution({
      taskId: "task-b",
      id: "child-new",
      sessionId: "session-shared",
    });
    const facts = await cancelOwnedWorkAfterAcceptedStop({
      taskId: "task-a",
      stopAccepted: true,
      ports: createDefaultOwnedStopPorts(),
    });
    expect(facts).toEqual([
      expect.objectContaining({
        kind: "child_execution",
        id: "child-old",
        taskId: "task-a",
        status: "unsupported",
      }),
    ]);
    expect(aborted).toEqual([]);
    expect(listOwnedChildExecutions("task-b").map((row) => row.id)).toEqual(["child-new"]);
    clearActiveEmbeddedRun("session-shared", replacementHandle);
  });

  test("default adapter confirms stopped only after the child actually exits", async () => {
    const requested: string[] = [];
    const liveHandle = {
      queueMessage: async () => {},
      isStreaming: () => false,
      isCompacting: () => false,
      abort: () => {
        requested.push("child-live");
      },
    };
    setActiveEmbeddedRun("session-confirm", liveHandle, undefined, "child-live");
    registerOwnedChildExecution({
      taskId: "task-a",
      id: "child-live",
      sessionId: "session-confirm",
    });
    const pendingFacts = await cancelOwnedWorkAfterAcceptedStop({
      taskId: "task-a",
      stopAccepted: true,
      ports: createDefaultOwnedStopPorts(),
    });
    expect(requested).toEqual(["child-live"]);
    expect(pendingFacts).toEqual([
      expect.objectContaining({
        kind: "child_execution",
        id: "child-live",
        taskId: "task-a",
        status: "pending",
      }),
    ]);

    const exitingHandle = {
      queueMessage: async () => {},
      isStreaming: () => false,
      isCompacting: () => false,
      abort: () => {
        requested.push("child-exited");
        clearActiveEmbeddedRun("session-confirm", exitingHandle);
      },
    };
    setActiveEmbeddedRun("session-confirm", exitingHandle, undefined, "child-exited");
    registerOwnedChildExecution({
      taskId: "task-a",
      id: "child-exited",
      sessionId: "session-confirm",
    });
    const confirmedFacts = await cancelOwnedWorkAfterAcceptedStop({
      taskId: "task-a",
      stopAccepted: true,
      ports: createDefaultOwnedStopPorts(),
    });
    expect(requested).toEqual(["child-live", "child-exited"]);
    expect(confirmedFacts).toEqual([
      expect.objectContaining({
        kind: "child_execution",
        id: "child-exited",
        taskId: "task-a",
        status: "confirmed_stopped",
      }),
    ]);
  });
});
