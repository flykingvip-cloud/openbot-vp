import type {
  BackendCapability,
  BackendEvent,
  BackendRunResult,
  ExecutionBackend,
  ModelRef,
  PlannedStep,
  RunContext,
  RunHandle,
} from "@openbot/aor-core";

export type StubResponder = (step: PlannedStep) => string;

/**
 * Deterministic second ExecutionBackend for platform validation.
 * Returns canned text from an injectable responder; zero OpenBot coupling.
 */
export class StubExecutionBackend implements ExecutionBackend {
  readonly id = "stub";
  private counter = 0;
  private readonly pending = new Map<string, Promise<BackendRunResult>>();

  constructor(private readonly responder: StubResponder) {}

  capabilities(): Promise<BackendCapability> {
    return Promise.resolve({ models: [] });
  }

  run(step: PlannedStep, ctx: RunContext): Promise<RunHandle> {
    const runId = `stub-${++this.counter}`;
    const controller = new AbortController();
    if (ctx.signal?.aborted) {
      controller.abort();
    } else if (ctx.signal) {
      ctx.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    const promise = (async (): Promise<BackendRunResult> => {
      if (controller.signal.aborted) {
        throw new Error("aborted");
      }
      const text = this.responder(step);
      return {
        text,
        usage: {
          inputTokens: Math.max(1, Math.floor(text.length / 4)),
          outputTokens: Math.max(1, Math.floor(text.length / 4)),
          totalTokens: Math.max(2, Math.floor(text.length / 2)),
          costUsd: 0.001,
        },
        raw: { backend: "stub", model: step.model },
      };
    })();
    this.pending.set(runId, promise);
    return Promise.resolve({ runId });
  }

  async *stream(handle: RunHandle): AsyncIterable<BackendEvent> {
    yield { kind: "lifecycle", phase: "start" };
    const entry = this.pending.get(handle.runId);
    if (!entry) {
      yield { kind: "lifecycle", phase: "error", detail: "unknown run" };
      return;
    }
    try {
      const result = await entry;
      if (result.text) {
        yield { kind: "assistant", delta: result.text };
      }
      yield { kind: "lifecycle", phase: "end" };
    } catch (err) {
      yield { kind: "lifecycle", phase: "error", detail: String(err) };
    }
  }

  async wait(handle: RunHandle): Promise<BackendRunResult> {
    const entry = this.pending.get(handle.runId);
    if (!entry) {
      throw new Error(`Unknown run: ${handle.runId}`);
    }
    try {
      return await entry;
    } finally {
      this.pending.delete(handle.runId);
    }
  }

  abort(handle: RunHandle): Promise<void> {
    this.pending.delete(handle.runId);
    return Promise.resolve();
  }
}

/** Map (taskType, model) → canned output for cross-backend tests. */
export function createFixtureResponder(
  fixtures: Map<string, string>,
  keyFn: (step: PlannedStep) => string = (step) =>
    `${step.taskType}::${step.model.provider}/${step.model.id}`,
): StubExecutionBackend {
  return new StubExecutionBackend((step) => fixtures.get(keyFn(step)) ?? "");
}

export function modelKey(model: ModelRef): string {
  return `${model.provider}/${model.id}`;
}
