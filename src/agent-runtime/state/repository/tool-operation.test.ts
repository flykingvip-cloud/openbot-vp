import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  executeClaimedToolOperation,
  readToolOperation,
  listDueToolOperations,
  reconcileClaimedToolOperation,
  ToolOperationOutcomeUnknownError,
} from "./tool-operation.js";
const roots: string[] = [];
afterEach(() => {
  for (const dir of roots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
function file() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "operation-"));
  roots.push(dir);
  return path.join(dir, "result.json");
}
it("persists the result before returning and replays without a second external write", async () => {
  const target = file();
  const run = vi.fn(async () => ({ receipt: "external-receipt" }));
  const params = { file: target, operationId: "logical-operation", run };
  expect(await executeClaimedToolOperation(params)).toEqual({ receipt: "external-receipt" });
  expect(await readToolOperation(target)).toMatchObject({
    state: "succeeded",
    result: { receipt: "external-receipt" },
  });
  expect(await executeClaimedToolOperation(params)).toEqual({ receipt: "external-receipt" });
  expect(run).toHaveBeenCalledTimes(1);
});
it("does not replay an interrupted external write with an unknown outcome", async () => {
  const target = file();
  const run = vi.fn(async () => {
    throw new Error("connection lost after send");
  });
  const params = { file: target, operationId: "logical-operation", run };
  await expect(executeClaimedToolOperation(params)).rejects.toThrow("connection lost");
  await expect(executeClaimedToolOperation(params)).rejects.toBeInstanceOf(
    ToolOperationOutcomeUnknownError,
  );
  expect(run).toHaveBeenCalledTimes(1);
});
it("fails closed on corrupt journals before invoking the tool", async () => {
  const target = file();
  fs.writeFileSync(target, "{");
  const run = vi.fn();
  await expect(
    executeClaimedToolOperation({ file: target, operationId: "op", run }),
  ).rejects.toThrow();
  expect(run).not.toHaveBeenCalled();
});

it("provides a standard reconciliation wait condition for uncertain writes", () => {
  const error = new ToolOperationOutcomeUnknownError("logical-op");
  expect(error.waitCondition).toEqual({
    waitId: "operation:logical-op",
    reason: "external_operation",
    wakeOn: ["operation:logical-op:reconciled"],
  });
});

it("settles uncertain operations only after a provider query supplies evidence", async () => {
  const target = file();
  await expect(
    executeClaimedToolOperation({
      file: target,
      operationId: "op",
      run: async () => {
        throw new Error("lost response");
      },
    }),
  ).rejects.toThrow();
  expect(
    await reconcileClaimedToolOperation({
      file: target,
      operationId: "op",
      query: async () => ({ kind: "unknown", reason: "provider unavailable" }),
    }),
  ).toMatchObject({ kind: "unknown" });
  expect((await readToolOperation(target))?.state).toBe("started");
  expect(
    await reconcileClaimedToolOperation({
      file: target,
      operationId: "op",
      query: async () => ({ kind: "confirmed", evidenceId: "provider-receipt", result: "sent" }),
    }),
  ).toEqual({ kind: "confirmed", result: "sent" });
  const run = vi.fn();
  expect(await executeClaimedToolOperation({ file: target, operationId: "op", run })).toBe("sent");
  expect(run).not.toHaveBeenCalled();
});

it("persists wait scheduling across scans and removes confirmed operations from the queue", async () => {
  const target = file() + ".result";
  await expect(
    executeClaimedToolOperation({
      file: target,
      operationId: "due-op",
      nowMs: 0,
      run: async () => {
        throw new Error("unknown");
      },
    }),
  ).rejects.toThrow();
  expect(await listDueToolOperations(path.dirname(target), 29_999)).toEqual([]);
  expect(await listDueToolOperations(path.dirname(target), 30_000)).toHaveLength(1);
  await reconcileClaimedToolOperation({
    file: target,
    operationId: "due-op",
    query: async () => ({ kind: "unknown", reason: "not yet known" }),
  });
  const waiting = await readToolOperation(target);
  expect(waiting?.wait?.attempts).toBe(1);
  expect(await listDueToolOperations(path.dirname(target), 30_000)).toEqual([]);
  await reconcileClaimedToolOperation({
    file: target,
    operationId: "due-op",
    query: async () => ({ kind: "confirmed", evidenceId: "receipt", result: "done" }),
  });
  expect(await listDueToolOperations(path.dirname(target), Number.MAX_SAFE_INTEGER)).toEqual([]);
});
