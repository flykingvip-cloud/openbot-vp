import type { ExecutionReceipt } from "../contracts.js";
import {
  EXECUTION_EVENTS,
  EXECUTION_STAGES,
  createTaskEnvelope,
  type ChatRunObservation,
  type ExecutionEventName,
  type ExecutionLatencies,
  type ExecutionStage,
  type ObservedToolkitReceipt,
  type RoutingDecision,
  type SkillBaseline,
  type TaskEnvelope,
  type ToolBaseline,
} from "./contracts.js";
import { assertNoSensitiveFields, projectToolkitReceipt } from "./privacy.js";

export type ExecutionObserverOptions = {
  runId: string;
  sessionKeyHash?: string;
  tenantId?: string;
  agentId?: string;
  /** Default false. Disabled observers are no-ops. */
  enabled?: boolean;
  now?: () => number;
};

export type ExecutionObserver = {
  readonly enabled: boolean;
  markStage: (stage: ExecutionStage) => void;
  recordEvent: (event: ExecutionEventName, extra?: Record<string, unknown>) => void;
  recordRouting: (decision: Omit<RoutingDecision, "runId">) => void;
  recordSkillBaseline: (baseline: SkillBaseline) => void;
  recordToolBaseline: (baseline: ToolBaseline) => void;
  attachToolkitReceipt: (receipt: ExecutionReceipt) => void;
  snapshot: () => ChatRunObservation | null;
};

const STAGE_ORDER = new Map<ExecutionStage, number>(
  EXECUTION_STAGES.map((stage, index) => [stage, index]),
);

function computeLatencies(stages: Partial<Record<ExecutionStage, number>>): ExecutionLatencies {
  const inbound = stages.inbound_accepted;
  const promptReady = stages.system_prompt_ready;
  const modelStarted = stages.model_started;
  const firstToken = stages.first_token;
  const completed = stages.run_completed;
  return {
    ...(inbound != null && promptReady != null
      ? { routePrepMs: Math.max(0, promptReady - inbound) }
      : {}),
    ...(modelStarted != null && firstToken != null
      ? { ttftMs: Math.max(0, firstToken - modelStarted) }
      : {}),
    ...(inbound != null && completed != null ? { totalMs: Math.max(0, completed - inbound) } : {}),
  };
}

/**
 * Best-effort Phase 0 observer. Failures never throw to the caller.
 * Disabled by default so importing this module cannot change chat behavior.
 */
export function createExecutionObserver(options: ExecutionObserverOptions): ExecutionObserver {
  const enabled = options.enabled === true;
  const now = options.now ?? Date.now;
  let envelope: TaskEnvelope | null = null;
  const stages: Partial<Record<ExecutionStage, number>> = {};
  const events: ExecutionEventName[] = [];
  let routing: RoutingDecision | undefined;
  let skillBaseline: SkillBaseline | undefined;
  let toolBaseline: ToolBaseline | undefined;
  const toolkitReceipts: ObservedToolkitReceipt[] = [];

  const run = (fn: () => void): void => {
    if (!enabled) {
      return;
    }
    try {
      fn();
    } catch {
      // Observation must never enter the chat reply path.
    }
  };

  const ensureEnvelope = (): TaskEnvelope => {
    if (!envelope) {
      envelope = createTaskEnvelope({
        runId: options.runId,
        sessionKeyHash: options.sessionKeyHash,
        tenantId: options.tenantId,
        agentId: options.agentId,
        nowMs: now(),
      });
      events.push(EXECUTION_EVENTS.TASK_ENVELOPE_CREATED);
    }
    return envelope;
  };

  return {
    enabled,
    markStage(stage) {
      run(() => {
        ensureEnvelope();
        stages[stage] ??= now();
      });
    },
    recordEvent(event, extra) {
      run(() => {
        if (extra) {
          assertNoSensitiveFields(extra);
        }
        ensureEnvelope();
        events.push(event);
      });
    },
    recordRouting(decision) {
      run(() => {
        const current = ensureEnvelope();
        routing = { ...decision, runId: current.runId };
      });
    },
    recordSkillBaseline(baseline) {
      run(() => {
        ensureEnvelope();
        skillBaseline = { ...baseline };
        events.push(EXECUTION_EVENTS.SKILL_CANDIDATES_RETRIEVED);
      });
    },
    recordToolBaseline(baseline) {
      run(() => {
        ensureEnvelope();
        toolBaseline = { ...baseline };
        events.push(EXECUTION_EVENTS.TOOL_CANDIDATES_RETRIEVED);
        events.push(EXECUTION_EVENTS.TOOL_SCHEMA_EXPOSED);
      });
    },
    attachToolkitReceipt(receipt) {
      run(() => {
        ensureEnvelope();
        toolkitReceipts.push(projectToolkitReceipt(receipt));
      });
    },
    snapshot() {
      if (!enabled || !envelope) {
        return null;
      }
      try {
        return {
          envelope,
          ...(routing ? { routing } : {}),
          stages: { ...stages },
          events: [...events],
          ...(skillBaseline ? { skillBaseline } : {}),
          ...(toolBaseline ? { toolBaseline } : {}),
          latencies: computeLatencies(stages),
          toolkitReceipts: [...toolkitReceipts],
        };
      } catch {
        return null;
      }
    },
  };
}

export function stageOrderIndex(stage: ExecutionStage): number {
  return STAGE_ORDER.get(stage) ?? -1;
}

export function isMonotonicStageSequence(stages: readonly ExecutionStage[]): boolean {
  let last = -1;
  for (const stage of stages) {
    const index = stageOrderIndex(stage);
    if (index < last) {
      return false;
    }
    last = index;
  }
  return true;
}
