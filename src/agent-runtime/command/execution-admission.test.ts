import { expect, it, vi } from "vitest";
import {
  admitExecutionRequest,
  bindExecutionAdmissionPorts,
  type ExecutionAdmissionInput,
} from "./execution-admission.js";
const input: ExecutionAdmissionInput = {
  requestId: "message-a",
  expectedFocusRevision: 0,
  expectedWriteEpoch: 0,
  proposal: { goal: "报告", acceptance: ["来源可核验"] },
};
it("does not retry or claim no task was written after a storage failure", async () => {
  const commit = vi.fn(() => {
    throw Object.assign(new Error("after write failed"), { code: "EIO" });
  });
  const ports = bindExecutionAdmissionPorts({
    sessionFile: "/tmp/task",
    authorize: async () => true,
    commit,
  });
  expect(await admitExecutionRequest(input, ports)).toEqual({
    kind: "rejected",
    reason: "task_mutation_unconfirmed",
  });
  expect(commit).toHaveBeenCalledOnce();
});
it("denies before task creation", async () => {
  const commit = vi.fn();
  expect(await admitExecutionRequest(input, { authorize: async () => false, commit })).toEqual({
    kind: "rejected",
    reason: "unauthorized",
  });
  expect(commit).not.toHaveBeenCalled();
});
it("commits once only after authorization", async () => {
  const commit = vi.fn(() => ({
    kind: "accepted" as const,
    binding: { taskId: "a" },
    acceptance: input.proposal.acceptance,
  }));
  expect((await admitExecutionRequest(input, { authorize: async () => true, commit })).kind).toBe(
    "accepted",
  );
  expect(commit).toHaveBeenCalledExactlyOnceWith(input);
});
it("refuses cancellation during authorization", async () => {
  const controller = new AbortController();
  const commit = vi.fn();
  await expect(
    admitExecutionRequest(
      { ...input, abortSignal: controller.signal },
      {
        authorize: async () => {
          controller.abort();
          return true;
        },
        commit,
      },
    ),
  ).rejects.toThrow();
  expect(commit).not.toHaveBeenCalled();
});
it("does not authorize malformed goals or budgets", async () => {
  const authorize = vi.fn();
  const commit = vi.fn();
  expect(
    (await admitExecutionRequest({ ...input, expectedWriteEpoch: -1 }, { authorize, commit })).kind,
  ).toBe("rejected");
  expect(authorize).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
});
