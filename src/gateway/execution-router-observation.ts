/**
 * Best-effort execution-router observation bridge.
 *
 * Default off. Never throws into the chat path. No remote I/O. Does not record
 * user text, tool args, or tool results.
 */
import { createHash } from "node:crypto";
import {
  assertNoSensitiveFields,
  createExecutionObserver,
  type ChatRunObservation,
  type ExecutionObserver,
  type ExecutionStage,
  type SkillBaseline,
  type ToolBaseline,
} from "../../packages/toolkit/src/execution-router/index.js";
import { emitAgentEvent } from "../infra/agent-events.js";
import type { ChatInboundStage } from "./chat-inbound-stage-events.js";

export type { ChatRunObservation };

export const EXECUTION_ROUTER_OBSERVATION_FLAG = "OPENBOT_EXECUTION_ROUTER_OBSERVATION";

const DEFAULT_TTL_MS = 15 * 60 * 1000;

function hashSessionKey(sessionKey: string): string {
  return createHash("sha256").update(sessionKey).digest("hex").slice(0, 16);
}

const STAGE_BY_INBOUND = {
  user_persisted: "inbound_accepted",
  dispatch_started: "inbound_accepted",
  model_started: "model_started",
  first_token: "first_token",
  assistant_persisted: "run_completed",
} as const satisfies Partial<Record<ChatInboundStage, ExecutionStage>>;

type MappedInboundStage = keyof typeof STAGE_BY_INBOUND;

type RunRecord = {
  observer: ExecutionObserver;
  lastTouchAt: number;
};

export type ExecutionObservationSink = (observation: ChatRunObservation) => void;

type BridgeClock = {
  now: () => number;
  ttlMs: number;
  enabled?: boolean;
  sink?: ExecutionObservationSink;
};

const runs = new Map<string, RunRecord>();
let clock: BridgeClock = {
  now: Date.now,
  ttlMs: DEFAULT_TTL_MS,
};

function projectTerminalObservation(observation: ChatRunObservation): Record<string, unknown> {
  return {
    event: "chat.execution_observation",
    sessionKeyHash: observation.envelope.sessionKeyHash,
    stages: observation.stages,
    events: observation.events,
    latencies: observation.latencies,
    ...(observation.skillBaseline ? { skillBaseline: observation.skillBaseline } : {}),
    ...(observation.toolBaseline ? { toolBaseline: observation.toolBaseline } : {}),
    toolkitReceiptCount: observation.toolkitReceipts.length,
  };
}

function defaultObservationSink(observation: ChatRunObservation): void {
  const data = projectTerminalObservation(observation);
  assertNoSensitiveFields(data);
  emitAgentEvent({
    runId: observation.envelope.runId,
    stream: "lifecycle",
    data,
  });
}

function resolveEnvBool(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (!raw) {
    return defaultValue;
  }
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") {
    return true;
  }
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") {
    return false;
  }
  return defaultValue;
}

export function isExecutionRouterObservationEnabled(): boolean {
  if (clock.enabled !== undefined) {
    return clock.enabled;
  }
  return resolveEnvBool(EXECUTION_ROUTER_OBSERVATION_FLAG, false);
}

export function mapChatInboundStageToExecutionStage(
  stage: ChatInboundStage,
): ExecutionStage | undefined {
  return STAGE_BY_INBOUND[stage as MappedInboundStage];
}

function sweepExpired(nowMs: number): void {
  const ttlMs = clock.ttlMs;
  const expired: string[] = [];
  for (const [runId, record] of runs) {
    if (nowMs - record.lastTouchAt >= ttlMs) {
      expired.push(runId);
    }
  }
  for (const runId of expired) {
    const record = runs.get(runId);
    if (record) {
      finishRun(runId, record);
    }
  }
}

function getOrCreate(runId: string, sessionKey: string | undefined, nowMs: number): RunRecord {
  const existing = runs.get(runId);
  if (existing) {
    existing.lastTouchAt = nowMs;
    return existing;
  }
  const record: RunRecord = {
    observer: createExecutionObserver({
      runId,
      sessionKeyHash: sessionKey ? hashSessionKey(sessionKey) : undefined,
      enabled: true,
      now: clock.now,
    }),
    lastTouchAt: nowMs,
  };
  runs.set(runId, record);
  return record;
}

function deliverToSink(snapshot: ChatRunObservation | null): void {
  if (!snapshot) {
    return;
  }
  const sink = clock.sink ?? defaultObservationSink;
  sink(snapshot);
}

function finishRun(runId: string, record: RunRecord): ChatRunObservation | null {
  const snapshot = record.observer.snapshot();
  try {
    deliverToSink(snapshot);
  } catch {
    // Sink failures must not enter the chat path.
  } finally {
    runs.delete(runId);
  }
  return snapshot;
}

function observeSafely(fn: () => void): void {
  try {
    fn();
  } catch {
    // Observation must never enter the chat reply path.
  }
}

export function observeChatInboundStage(params: {
  runId: string;
  stage: ChatInboundStage;
  sessionKey?: string;
  extra?: Record<string, unknown>;
}): void {
  observeSafely(() => {
    if (!isExecutionRouterObservationEnabled()) {
      return;
    }
    const nowMs = clock.now();
    sweepExpired(nowMs);
    if (params.stage === "user_persist_error") {
      const existing = runs.get(params.runId);
      if (existing) {
        finishRun(params.runId, existing);
      }
      return;
    }
    const mapped = mapChatInboundStageToExecutionStage(params.stage);
    if (!mapped) {
      return;
    }
    if (params.extra) {
      assertNoSensitiveFields(params.extra);
    }
    const record = getOrCreate(params.runId, params.sessionKey, nowMs);
    record.observer.markStage(mapped);
    if (mapped === "run_completed") {
      finishRun(params.runId, record);
    }
  });
}

export function observeExecutionStage(params: {
  runId: string;
  stage: ExecutionStage;
  sessionKey?: string;
}): void {
  observeSafely(() => {
    if (!isExecutionRouterObservationEnabled()) {
      return;
    }
    const nowMs = clock.now();
    sweepExpired(nowMs);
    const record = getOrCreate(params.runId, params.sessionKey, nowMs);
    record.observer.markStage(params.stage);
    if (params.stage === "run_completed") {
      finishRun(params.runId, record);
    }
  });
}

export function observeSkillBaseline(params: {
  runId: string;
  sessionKey?: string;
  baseline: SkillBaseline;
}): void {
  observeSafely(() => {
    if (!isExecutionRouterObservationEnabled()) {
      return;
    }
    const nowMs = clock.now();
    sweepExpired(nowMs);
    getOrCreate(params.runId, params.sessionKey, nowMs).observer.recordSkillBaseline(
      params.baseline,
    );
  });
}

export function observeToolBaseline(params: {
  runId: string;
  sessionKey?: string;
  baseline: ToolBaseline;
}): void {
  observeSafely(() => {
    if (!isExecutionRouterObservationEnabled()) {
      return;
    }
    const nowMs = clock.now();
    sweepExpired(nowMs);
    getOrCreate(params.runId, params.sessionKey, nowMs).observer.recordToolBaseline(
      params.baseline,
    );
  });
}

export function peekExecutionRouterObservation(runId: string): ChatRunObservation | null {
  try {
    return runs.get(runId)?.observer.snapshot() ?? null;
  } catch {
    return null;
  }
}

export function executionRouterObservationSize(): number {
  return runs.size;
}

export function configureExecutionRouterObservationForTest(next?: {
  enabled?: boolean;
  now?: () => number;
  ttlMs?: number;
  sink?: ExecutionObservationSink;
}): void {
  clock = {
    now: next?.now ?? Date.now,
    ttlMs: next?.ttlMs ?? DEFAULT_TTL_MS,
    enabled: next?.enabled,
    sink: next?.sink,
  };
}

export function resetExecutionRouterObservationForTest(): void {
  runs.clear();
  clock = { now: Date.now, ttlMs: DEFAULT_TTL_MS };
}
