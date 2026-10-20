/**
 * worker/cli-worker.ts — CLI Worker Adapter (development-supervisor M0).
 *
 * Maps the unified `Worker` interface onto a CLI backend run. It does NOT
 * re-implement spawning: the actual execution is an injected `runCli` function
 * (wiring binds it to the existing `runCliAgent`/cli-backend kernel at M1), which
 * keeps this module pure, hermetically testable, and free of heavy runner
 * plumbing. Default (non-streaming) behavior degrades `logs` to a single terminal
 * event and supervision polls `status` (D-LIVE); streaming is layered in M3.3.
 *
 * SECURITY: credentialEnv is forwarded to `runCli` and never logged here. When
 * present, ExecutionContext is only used as the source of that already-resolved
 * env; the Worker definition still stays free of credential/placement policy.
 * P0-2: the CLI `sessionId` is kept INTERNAL (mapped from the generic
 * `continuityKey`); it never appears on the generic Worker interface.
 */

import crypto from "node:crypto";
import type {
  RunStatus,
  Worker,
  WorkerControlCapability,
  WorkerLogEvent,
  WorkerRunHandle,
  WorkerStartInput,
  WorkerTaskCapability,
} from "./types.js";

/** Result of one CLI run (what `runCli` resolves to). */
export interface CliRunResult {
  ok: boolean;
  exitCode?: number;
  /** Redacted result text (e.g. final assistant text); never secrets. */
  summary?: string;
  /** Worker session id for continuity (resume) — kept internal to this adapter. */
  sessionId?: string;
  usage?: { input?: number; output?: number };
}

export interface CliRunInput {
  backendId: string;
  model?: string;
  prompt: string;
  workspaceDir: string;
  sessionId?: string;
  credentialEnv?: Record<string, string>;
  timeoutMs: number;
}

/** Injected execution boundary (default binds to runCliAgent at wiring time). */
export type CliRunFn = (input: CliRunInput) => Promise<CliRunResult>;

interface RunRecord {
  status: RunStatus;
  cancelled: boolean;
  done: Promise<void>;
}

export interface CreateCliWorkerOptions {
  /** Worker id == cli-backend id (model-ref provider segment). */
  id: string;
  taskCapabilities?: readonly WorkerTaskCapability[];
  control?: readonly WorkerControlCapability[];
  runCli: CliRunFn;
}

/**
 * Build a `Worker` backed by a CLI run. `start` launches the run in the
 * background and returns a handle immediately; `status` reflects completion;
 * `logs` (non-streaming default) yields one terminal event after the run ends.
 *
 * Session continuity (P0-2): the CLI session id is kept INTERNAL, mapped from the
 * generic `continuityKey`. It never appears on `WorkerRunHandle`/`WorkerStartInput`.
 */
export function createCliWorker(opts: CreateCliWorkerOptions): Worker {
  const id = opts.id.trim();
  if (!id) {
    throw new Error("createCliWorker: id is required");
  }
  const taskCapabilities = opts.taskCapabilities ?? [];
  const control = opts.control ?? [];
  const runs = new Map<string, RunRecord>();
  // continuityKey → last CLI session id (internal; resumes multi-turn runs).
  const sessionByKey = new Map<string, string>();

  function start(input: WorkerStartInput): Promise<WorkerRunHandle> {
    const runId = crypto.randomUUID();
    const priorSession = input.continuityKey ? sessionByKey.get(input.continuityKey) : undefined;
    const record: RunRecord = {
      status: { phase: "running" },
      cancelled: false,
      done: Promise.resolve(),
    };
    record.done = (async () => {
      try {
        const credentialEnv = input.credentialEnv ?? input.executionContext?.identity.credentialEnv;
        const result = await opts.runCli({
          backendId: id,
          ...(input.model ? { model: input.model } : {}),
          prompt: input.task.prompt,
          workspaceDir: input.workspaceDir,
          ...(priorSession ? { sessionId: priorSession } : {}),
          ...(credentialEnv ? { credentialEnv } : {}),
          timeoutMs: input.timeoutMs,
        });
        if (input.continuityKey && result.sessionId) {
          sessionByKey.set(input.continuityKey, result.sessionId);
        }
        if (record.cancelled) {
          record.status = {
            phase: "terminal",
            outcome: "cancelled",
            ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
          };
          return;
        }
        record.status = {
          phase: "terminal",
          outcome: result.ok ? "succeeded" : "failed",
          ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
          ...(result.summary ? { summary: result.summary } : {}),
          ...(result.usage ? { usage: result.usage } : {}),
        };
      } catch (err) {
        record.status = {
          phase: "terminal",
          outcome: record.cancelled ? "cancelled" : "failed",
          summary: err instanceof Error ? err.message : String(err),
        };
      }
    })();
    runs.set(runId, record);
    return Promise.resolve({ runId, workerId: id });
  }

  function status(runId: string): Promise<RunStatus> {
    const record = runs.get(runId);
    if (!record) {
      return Promise.reject(new Error(`unknown runId: ${runId}`));
    }
    return Promise.resolve(record.status);
  }

  function cancel(runId: string): Promise<void> {
    const record = runs.get(runId);
    if (!record) {
      return Promise.reject(new Error(`unknown runId: ${runId}`));
    }
    // M0 = BEST-EFFORT only (P1-1): flag cancellation so the terminal outcome is
    // `cancelled`. Real per-CLI process termination protocols land in M2.
    record.cancelled = true;
    if (record.status.phase !== "terminal") {
      record.status = { phase: "terminal", outcome: "cancelled" };
    }
    return Promise.resolve();
  }

  async function* logs(runId: string): AsyncIterable<WorkerLogEvent> {
    const record = runs.get(runId);
    if (!record) {
      throw new Error(`unknown runId: ${runId}`);
    }
    // Non-streaming default (D-LIVE degradation): wait for completion, emit one
    // terminal event. Streaming workers override `logs` to emit incrementally (M3.3).
    await record.done;
    const s = record.status;
    yield { type: "status", phase: s.outcome ?? s.phase };
    if (s.summary) {
      yield { type: s.outcome === "failed" ? "stderr" : "stdout", data: s.summary };
    }
  }

  return { id, taskCapabilities, control, start, status, cancel, logs };
}
