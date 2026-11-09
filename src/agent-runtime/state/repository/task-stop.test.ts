import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { createTaskStopRepository } from "./task-stop.js";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "task-stop-store-"));
  roots.push(root);
  return { root, store: createTaskStopRepository(root) };
}
const record = {
  kind: "managed" as const,
  tenantId: "tenant",
  userId: "user",
  sessionKey: "session",
  taskId: "task",
  stoppedAtMs: 1,
};
it("isolates every identity dimension and refuses stale clear tokens", () => {
  const { store } = fixture();
  const old = store.record(record);
  for (const scope of [
    { ...record, tenantId: "other" },
    { ...record, userId: "other" },
    { ...record, sessionKey: "other" },
  ]) {
    expect(store.read(scope, record.taskId)).toBeUndefined();
  }
  const latest = store.record({ ...record, stoppedAtMs: 2 });
  expect(store.clear(record, record.taskId, { token: old.token })).toBe(false);
  expect(store.clear(record, record.taskId, { token: null })).toBe(false);
  expect(store.read(record, record.taskId)?.token).toBe(latest.token);
  expect(store.clear(record, record.taskId, { token: latest.token })).toBe(true);
  expect(store.read(record, record.taskId)).toBeUndefined();
});
it("reports corrupt storage instead of treating a recorded stop as absent", () => {
  const { root, store } = fixture();
  store.record(record);
  const file = fs.readdirSync(root).find((name) => name.endsWith(".json"))!;
  fs.writeFileSync(path.join(root, file), "invalid");
  expect(() => store.read(record, record.taskId)).toThrow();
  expect(() => store.clear(record, record.taskId)).toThrow();
});
