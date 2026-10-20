import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectCollabRuntimeCapabilityViolations,
  findCollabRuntimeCapabilityViolations,
} from "../../scripts/check-collab-runtime-capabilities.mjs";

const rules = (source: string, isChat = false) =>
  findCollabRuntimeCapabilityViolations(source, "x.ts", { isChat }).map(
    (v: { rule: string }) => v.rule,
  );

describe("check-collab-runtime-capabilities (Floor v2.1 §2.2 (a))", () => {
  it("flags every forbidden capability in collaboration-dispatch", () => {
    expect(rules("const q = new KeyedAsyncQueue();")).toEqual(["no-new-keyed-async-queue"]);
    expect(rules("setInterval(() => {}, 10); globalThis.setInterval(f, 1);")).toEqual([
      "no-set-interval",
      "no-set-interval",
    ]);
    expect(
      rules(`
        import { Worker } from "node:worker_threads";
        import { spawn } from "child_process";
        export { fork } from "node:child_process";
        const cp = require("child_process");
        const wt = await import("worker_threads");
        import x = require("node:child_process");
      `),
    ).toEqual(Array(6).fill("no-process-or-thread"));
    expect(rules("const w = new Worker(url);")).toEqual(["no-worker"]);
    expect(rules("const abortController = new AbortController();")).toEqual([
      "no-new-abort-controller",
    ]);
  });

  it("chat.ts keeps only its existing queues and abort controllers", () => {
    const baseline = `
      const groupDiscussionQueue = new KeyedAsyncQueue();
      const groupBotQueue = new KeyedAsyncQueue();
      function a() { const abortController = new AbortController(); }
      function b() { const parentAbortController = new AbortController(); }
      function c() { const abortController = new AbortController(); }
    `;
    expect(rules(baseline, true)).toEqual([]);
    expect(rules(`${baseline}\nconst floorQueue = new KeyedAsyncQueue();`, true)).toEqual([
      "no-new-keyed-async-queue",
    ]);
    expect(
      rules(`${baseline}\nfunction d() { const groupBotQueue = new KeyedAsyncQueue(); }`, true),
    ).toEqual(["no-new-keyed-async-queue"]);
    expect(
      rules(`${baseline}\nfunction e() { const abortController = new AbortController(); }`, true),
    ).toEqual(["no-new-abort-controller"]);
    expect(rules(`${baseline}\nconst beatAbort = new AbortController();`, true)).toEqual([
      "no-new-abort-controller",
    ]);
  });

  it("ignores mentions in comments and strings", () => {
    expect(rules('// setInterval(x)\nconst s = "new KeyedAsyncQueue()";')).toEqual([]);
  });

  it("the repository is currently clean", async () => {
    const result = await collectCollabRuntimeCapabilityViolations(path.resolve(__dirname, "../.."));
    expect(result.violations).toEqual([]);
    expect(result.files).toBeGreaterThan(10);
  });
});
