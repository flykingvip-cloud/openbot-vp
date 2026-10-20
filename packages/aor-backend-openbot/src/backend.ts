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
import type { OpenBotChatResponse, OpenBotGatewayClient } from "./client.js";

interface PendingRun {
  promise: Promise<OpenBotChatResponse>;
  controller: AbortController;
}

export interface OpenBotBackendOptions {
  client: OpenBotGatewayClient;
  /** Models advertised by `capabilities()` when the client cannot list them. */
  knownModels?: ModelRef[];
}

/**
 * OpenBot ExecutionBackend.
 *
 * Maps the AOR backend contract onto OpenBot's public surface:
 *   run/wait  -> OpenAI-compatible chat completion (or Gateway `agent` RPC)
 *   stream    -> unified lifecycle/assistant events
 *
 * It holds no OpenBot internal references; everything flows through the
 * injected {@link OpenBotGatewayClient}. HTTP ignores fallback; RPC forwards
 * `modelFallbacks` for OpenBot native `runWithModelFallback`.
 */
export class OpenBotBackend implements ExecutionBackend {
  readonly id = "openbot";
  private readonly client: OpenBotGatewayClient;
  private readonly knownModels: ModelRef[];
  private readonly pending = new Map<string, PendingRun>();
  private counter = 0;

  constructor(options: OpenBotBackendOptions) {
    this.client = options.client;
    this.knownModels = options.knownModels ?? [];
  }

  async capabilities(): Promise<BackendCapability> {
    if (this.client.listModels) {
      try {
        const models = await this.client.listModels();
        if (models.length > 0) {
          return { models };
        }
      } catch {
        // fall through to known models
      }
    }
    return { models: this.knownModels };
  }

  run(step: PlannedStep, ctx: RunContext): Promise<RunHandle> {
    const runId = `obrun-${++this.counter}`;
    const controller = new AbortController();
    if (ctx.signal) {
      if (ctx.signal.aborted) {
        controller.abort();
      } else {
        ctx.signal.addEventListener("abort", () => controller.abort(), { once: true });
      }
    }
    const promise = this.client.chat({
      model: step.model,
      prompt: step.prompt,
      sessionKey: ctx.sessionKey,
      signal: controller.signal,
      fallbackModels: step.fallbackModels,
    });
    this.pending.set(runId, { promise, controller });
    return Promise.resolve({ runId });
  }

  async *stream(handle: RunHandle): AsyncIterable<BackendEvent> {
    const entry = this.pending.get(handle.runId);
    if (!entry) {
      throw new Error(`Unknown run: ${handle.runId}`);
    }
    yield { kind: "lifecycle", phase: "start" };
    try {
      const result = await entry.promise;
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
      const result = await entry.promise;
      return { text: result.text, raw: result.raw, usage: result.usage };
    } finally {
      this.pending.delete(handle.runId);
    }
  }

  abort(handle: RunHandle): Promise<void> {
    const entry = this.pending.get(handle.runId);
    entry?.controller.abort();
    this.pending.delete(handle.runId);
    return Promise.resolve();
  }
}
