import type { ModelRef, NormalizedUsage, PlannedStep, StepOutput } from "./types.js";

/**
 * The ExecutionBackend abstraction is AOR's single coupling point to an
 * execution engine. OpenBot is the first implementation (via Gateway RPC /
 * OpenAI-compatible HTTP), but LangGraph, CrewAI, Bedrock Agent, etc. can all
 * become backends without changing the Parser / Planner / Selector / Evaluator.
 *
 * Hard rule: implementations may depend on a backend's *public* contract only;
 * they must never import OpenBot internal modules.
 */

/** Models the backend is able to execute. */
export interface BackendCapability {
  models: ModelRef[];
}

/** Per-run context handed to the backend. */
export interface RunContext {
  sessionKey?: string;
  signal?: AbortSignal;
  /** Optional structured input passed alongside the prompt. */
  input?: unknown;
}

/** Opaque handle returned by {@link ExecutionBackend.run}. */
export interface RunHandle {
  runId: string;
}

/** Unified streaming event shape across backends. */
export type BackendEvent =
  | { kind: "lifecycle"; phase: "start" | "end" | "error"; detail?: string }
  | { kind: "assistant"; delta: string }
  | { kind: "tool"; name: string; detail?: string };

/** Result of awaiting a backend run. */
export type BackendRunResult = StepOutput & { usage: NormalizedUsage };

export interface ExecutionBackend {
  /** Stable backend id, e.g. `openbot`. */
  readonly id: string;
  /** Models this backend can currently execute. */
  capabilities(): Promise<BackendCapability>;
  /** Start a step; returns immediately with a handle. */
  run(step: PlannedStep, ctx: RunContext): Promise<RunHandle>;
  /** Stream unified events for a run. */
  stream(handle: RunHandle): AsyncIterable<BackendEvent>;
  /** Await final output + usage. */
  wait(handle: RunHandle): Promise<BackendRunResult>;
  /** Cancel a run. */
  abort(handle: RunHandle): Promise<void>;
}
