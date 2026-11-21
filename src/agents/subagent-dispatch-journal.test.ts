import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { dispatchChildOnce } from "./subagent-dispatch-journal.js";
it("returns persisted child receipt across retries and refuses changed requests", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "child-dispatch-"));
  const dispatch = vi.fn(async () => ({
    childSessionKey: "original-child",
    runId: "original-run",
  }));
  const input = {
    root,
    identity: {
      tenantId: "tenant",
      taskId: "task",
      executionId: "execution",
      stepId: "step",
      operationId: "child-1",
    },
    requesterSessionKey: "parent",
    request: { task: "research" },
    dispatch,
  };
  try {
    const first = await dispatchChildOnce(input);
    expect(await dispatchChildOnce(input)).toEqual(first);
    expect(dispatch).toHaveBeenCalledTimes(1);
    await expect(dispatchChildOnce({ ...input, request: { task: "different" } })).rejects.toThrow(
      "conflicts",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
it("does not redispatch after an uncertain child creation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "child-unknown-"));
  const dispatch = vi.fn(async () => {
    throw new Error("response lost");
  });
  const input = {
    root,
    identity: {
      tenantId: "tenant",
      taskId: "task",
      executionId: "execution",
      stepId: "step",
      operationId: "child",
    },
    requesterSessionKey: "parent",
    request: { task: "research" },
    dispatch,
  };
  try {
    await expect(dispatchChildOnce(input)).rejects.toThrow("response lost");
    await expect(dispatchChildOnce(input)).rejects.toMatchObject({
      name: "ToolOperationOutcomeUnknownError",
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it("concurrent admission publishes complete claim and never dispatches twice", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "child-concurrent-"));
  let finish!: (value: { child: string }) => void;
  const dispatch = vi.fn(
    () =>
      new Promise<{ child: string }>((resolve) => {
        finish = resolve;
      }),
  );
  const input = {
    root,
    identity: {
      tenantId: "tenant",
      taskId: "task",
      executionId: "execution",
      stepId: "step",
      operationId: "child",
    },
    requesterSessionKey: "parent",
    request: { task: "research" },
    dispatch,
  };
  try {
    const attempts = Array.from({ length: 12 }, () => dispatchChildOnce(input));
    const settled = attempts.map((work) =>
      work.then(
        (value) => ({ ok: true as const, value }),
        (error) => ({ ok: false as const, error }),
      ),
    );
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    finish({ child: "original" });
    const outcomes = await Promise.all(settled);
    for (const outcome of outcomes) {
      if (!outcome.ok) {
        expect(outcome.error).toMatchObject({ name: "ToolOperationOutcomeUnknownError" });
      }
    }
    expect(await dispatchChildOnce(input)).toEqual({ child: "original" });
    expect(dispatch).toHaveBeenCalledTimes(1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
