import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  executeClaimedToolOperation,
  readToolOperation,
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
