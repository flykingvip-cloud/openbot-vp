import { describe, expect, it } from "vitest";
import { createCliWorker, type CliRunFn, type CliRunResult } from "./cli-worker.js";
import { WorkerAdapterRegistry } from "./registry.js";
import { isTerminalStatus, supportsCancel, supportsStreaming, type Worker } from "./types.js";

function fakeRunCli(result: CliRunResult, capture?: (input: unknown) => void): CliRunFn {
  return async (input) => {
    capture?.(input);
    return result;
  };
}

async function drain(worker: Worker, runId: string) {
  const events = [];
  for await (const e of worker.logs(runId)) {
    events.push(e);
  }
  return events;
}

describe("WorkerAdapterRegistry", () => {
  const w = (id: string): Worker => createCliWorker({ id, runCli: fakeRunCli({ ok: true }) });

  it("registers and resolves by id", () => {
    const reg = new WorkerAdapterRegistry([w("kiro"), w("codex")]);
    expect(reg.resolve("kiro")?.id).toBe("kiro");
    expect(reg.ids().toSorted()).toEqual(["codex", "kiro"]);
  });

  it("returns null on miss (no silent fallback)", () => {
    expect(new WorkerAdapterRegistry().resolve("nope")).toBeNull();
  });

  it("rejects duplicate ids", () => {
    const reg = new WorkerAdapterRegistry([w("kiro")]);
    expect(() => reg.register(w("kiro"))).toThrow(/already registered/);
  });

  it("rejects a worker missing the interface", () => {
    expect(() => new WorkerAdapterRegistry().register({ id: "bad" } as unknown as Worker)).toThrow(
      /start\/status\/cancel\/logs/,
    );
  });

  it("findByCapability filters on both axes (Worker Selection seam, P1-2)", () => {
    const reg = new WorkerAdapterRegistry([
      createCliWorker({
        id: "codex",
        taskCapabilities: ["coding", "test"],
        control: ["streaming", "cancellable"],
        runCli: fakeRunCli({ ok: true }),
      }),
      createCliWorker({
        id: "kiro",
        taskCapabilities: ["coding", "edit"],
        control: ["streaming"],
        runCli: fakeRunCli({ ok: true }),
      }),
      createCliWorker({
        id: "claude-cli",
        taskCapabilities: ["coding"],
        control: [],
        runCli: fakeRunCli({ ok: true }),
      }),
    ]);
    expect(
      reg
        .findByCapability({ taskCapabilities: ["coding"] })
        .map((w) => w.id)
        .toSorted(),
    ).toEqual(["claude-cli", "codex", "kiro"]);
    expect(
      reg
        .findByCapability({ control: ["streaming"] })
        .map((w) => w.id)
        .toSorted(),
    ).toEqual(["codex", "kiro"]);
    expect(
      reg
        .findByCapability({ taskCapabilities: ["test"], control: ["cancellable"] })
        .map((w) => w.id),
    ).toEqual(["codex"]);
    expect(reg.findByCapability({}).length).toBe(3); // empty filter matches all
  });
});

describe("createCliWorker — unified Worker over a CLI (first-principles M0)", () => {
  it("start → status converges to terminal/succeeded with exitCode/usage/summary", async () => {
    const worker = createCliWorker({
      id: "codex",
      taskCapabilities: ["coding", "test"],
      control: ["streaming", "cancellable"],
      runCli: fakeRunCli({
        ok: true,
        exitCode: 0,
        summary: "done",
        usage: { input: 10, output: 5 },
      }),
    });
    const handle = await worker.start({
      task: { goal: "g", prompt: "p" },
      workspaceDir: "/ws",
      timeoutMs: 1000,
    });
    expect(handle.workerId).toBe("codex");
    await drain(worker, handle.runId);
    const status = await worker.status(handle.runId);
    expect(status).toMatchObject({
      phase: "terminal",
      outcome: "succeeded",
      exitCode: 0,
      summary: "done",
      usage: { input: 10, output: 5 },
    });
    expect(isTerminalStatus(status)).toBe(true);
  });

  it("maps a failed run to terminal/failed", async () => {
    const worker = createCliWorker({ id: "kiro", runCli: fakeRunCli({ ok: false, exitCode: 1 }) });
    const h = await worker.start({
      task: { goal: "g", prompt: "p" },
      workspaceDir: "/ws",
      timeoutMs: 1,
    });
    await drain(worker, h.runId);
    expect(await worker.status(h.runId)).toMatchObject({ phase: "terminal", outcome: "failed" });
  });

  it("maps a thrown runCli to terminal/failed with message", async () => {
    const worker = createCliWorker({
      id: "kiro",
      runCli: async () => {
        throw new Error("boom");
      },
    });
    const h = await worker.start({
      task: { goal: "g", prompt: "p" },
      workspaceDir: "/ws",
      timeoutMs: 1,
    });
    await drain(worker, h.runId);
    expect(await worker.status(h.runId)).toMatchObject({
      phase: "terminal",
      outcome: "failed",
      summary: "boom",
    });
  });

  it("forwards model/credentialEnv to runCli; does NOT leak sessionId on the interface (P0-2)", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const worker = createCliWorker({
      id: "claude-cli",
      runCli: fakeRunCli({ ok: true }, (i) => seen.push(i as Record<string, unknown>)),
    });
    await worker.start({
      task: { goal: "g", prompt: "implement" },
      workspaceDir: "/ws/task-1",
      model: "claude-sonnet",
      continuityKey: "task-1",
      credentialEnv: { ANTHROPIC_API_KEY: "sk-x" },
      timeoutMs: 5000,
    });
    expect(seen[0]).toMatchObject({
      backendId: "claude-cli",
      model: "claude-sonnet",
      prompt: "implement",
      workspaceDir: "/ws/task-1",
      credentialEnv: { ANTHROPIC_API_KEY: "sk-x" },
      timeoutMs: 5000,
    });
    // first run has no prior session under the continuityKey
    expect(seen[0].sessionId).toBeUndefined();
  });

  it("uses ExecutionContext identity env as credential source", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const worker = createCliWorker({
      id: "codex-cli",
      runCli: fakeRunCli({ ok: true }, (i) => seen.push(i as Record<string, unknown>)),
    });
    await worker.start({
      task: { goal: "g", prompt: "implement" },
      workspaceDir: "/ws/task-2",
      executionContext: {
        identity: {
          policy: "enterprise_shared",
          status: "validated",
          credentialEnv: { OPENAI_API_KEY: "resolved" },
          credentialId: "corp-openai",
        },
        placement: { placement: "gateway", executor: "gateway", fallback: "escalate" },
        attribution: { tenantId: "tenant-1", workerId: "codex-cli", credentialId: "corp-openai" },
      },
      timeoutMs: 5000,
    });
    expect(seen[0]).toMatchObject({
      backendId: "codex-cli",
      credentialEnv: { OPENAI_API_KEY: "resolved" },
    });
  });

  it("resumes the CLI session across runs via continuityKey (session kept internal, P0-2)", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const worker = createCliWorker({
      id: "kiro",
      runCli: fakeRunCli({ ok: true, sessionId: "cli-sess-9" }, (i) =>
        seen.push(i as Record<string, unknown>),
      ),
    });
    const a = await worker.start({
      task: { goal: "g", prompt: "round1" },
      workspaceDir: "/ws",
      continuityKey: "task-1",
      timeoutMs: 1,
    });
    await drain(worker, a.runId);
    await worker.start({
      task: { goal: "g", prompt: "round2" },
      workspaceDir: "/ws",
      continuityKey: "task-1",
      timeoutMs: 1,
    });
    // round 2 resumes the session captured from round 1
    expect(seen[0].sessionId).toBeUndefined();
    expect(seen[1].sessionId).toBe("cli-sess-9");
  });

  it("logs (non-streaming default) yields a terminal status + output event", async () => {
    const worker = createCliWorker({
      id: "kiro",
      runCli: fakeRunCli({ ok: true, summary: "final" }),
    });
    const h = await worker.start({
      task: { goal: "g", prompt: "p" },
      workspaceDir: "/ws",
      timeoutMs: 1,
    });
    expect(await drain(worker, h.runId)).toEqual([
      { type: "status", phase: "succeeded" },
      { type: "stdout", data: "final" },
    ]);
  });

  it("cancel (best-effort M0) flags the run terminal/cancelled", async () => {
    let resolveRun: (r: CliRunResult) => void = () => {};
    const worker = createCliWorker({
      id: "kiro",
      runCli: () => new Promise<CliRunResult>((r) => (resolveRun = r)),
    });
    const h = await worker.start({
      task: { goal: "g", prompt: "p" },
      workspaceDir: "/ws",
      timeoutMs: 10000,
    });
    await worker.cancel(h.runId);
    expect(await worker.status(h.runId)).toMatchObject({ phase: "terminal", outcome: "cancelled" });
    resolveRun({ ok: true });
    await drain(worker, h.runId);
    expect((await worker.status(h.runId)).outcome).toBe("cancelled");
  });

  it("status/cancel reject an unknown runId", async () => {
    const worker = createCliWorker({ id: "kiro", runCli: fakeRunCli({ ok: true }) });
    await expect(worker.status("nope")).rejects.toThrow(/unknown runId/);
    await expect(worker.cancel("nope")).rejects.toThrow(/unknown runId/);
  });
});

describe("capability degradation (D-LIVE / abort)", () => {
  it("supportsStreaming/Cancel reflect control axis (drives realtime vs polling)", () => {
    const codex = createCliWorker({
      id: "codex",
      control: ["streaming", "cancellable"],
      runCli: fakeRunCli({ ok: true }),
    });
    const kiro = createCliWorker({
      id: "kiro",
      control: ["streaming"],
      runCli: fakeRunCli({ ok: true }),
    });
    const claude = createCliWorker({
      id: "claude-cli",
      control: [],
      runCli: fakeRunCli({ ok: true }),
    });
    expect([supportsStreaming(codex), supportsCancel(codex)]).toEqual([true, true]);
    expect([supportsStreaming(kiro), supportsCancel(kiro)]).toEqual([true, false]);
    expect([supportsStreaming(claude), supportsCancel(claude)]).toEqual([false, false]);
  });

  it("the Supervisor can drive both control profiles through the SAME interface (Property 11)", async () => {
    const reg = new WorkerAdapterRegistry([
      createCliWorker({
        id: "codex",
        control: ["streaming"],
        runCli: fakeRunCli({ ok: true, summary: "codex ok" }),
      }),
      createCliWorker({
        id: "claude-cli",
        control: [],
        runCli: fakeRunCli({ ok: true, summary: "claude ok" }),
      }),
    ]);
    for (const id of reg.ids()) {
      const worker = reg.resolve(id)!;
      const h = await worker.start({
        task: { goal: "g", prompt: "p" },
        workspaceDir: "/ws",
        timeoutMs: 1,
      });
      await drain(worker, h.runId);
      const s = await worker.status(h.runId);
      expect(isTerminalStatus(s) && s.outcome).toBe("succeeded");
    }
  });
});
