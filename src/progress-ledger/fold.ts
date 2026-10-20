import { LedgerInvariantError, LedgerWriteError } from "./errors.js";
import { collectEvidence, hasAllowedEvidence, requirePayloadEvidence } from "./evidence.js";
import {
  assertLedgerInvariants,
  FORBIDDEN_EVENT_ACTORS,
  hasDirectStatusMutation,
} from "./invariants.js";
import {
  DEFAULT_STALE_AFTER_MS,
  PROGRESS_LEDGER_SCHEMA_VERSION,
  type AcceptanceItem,
  type BlockingGate,
  type BlockingReason,
  type ExecutionEvent,
  type ExecutionLedger,
  type ExecutionStep,
  type ProgressEvidence,
  type SeedAcceptanceDraft,
  type SeedStepDraft,
} from "./types.js";

const BLOCKING_REASONS = new Set<BlockingReason>([
  "blocked_user",
  "blocked_authorization",
  "blocked_external",
  "blocked_data",
  "blocked_policy",
  "blocked_system",
]);

const MEANINGFUL_TYPES = new Set<ExecutionEvent["type"]>([
  "PLAN_SEEDED",
  "STEP_STARTED",
  "TOOL_SUCCEEDED",
  "TOOL_FAILED",
  "EVIDENCE_RECORDED",
  "VALIDATION_PASSED",
  "VALIDATION_FAILED",
  "ACCEPTANCE_MET",
  "ACCEPTANCE_UNMET",
  "STEP_EXECUTED",
  "STEP_VERIFIED",
  "STEP_COMPLETED",
  "STEP_FAILED",
  "STEP_BLOCKED",
  "STEP_UNBLOCKED",
  "GATE_RAISED",
  "GATE_CLEARED",
  "REPLAN_APPENDED",
  "MEANINGFUL_PROGRESS",
]);

function cloneLedger(ledger: ExecutionLedger): ExecutionLedger {
  return structuredClone(ledger);
}

function requireActor(event: ExecutionEvent): void {
  if (FORBIDDEN_EVENT_ACTORS.has(String(event.actor))) {
    throw new LedgerInvariantError("I1", `actor ${String(event.actor)} cannot mutate ledger`);
  }
  if (
    event.actor !== "runtime" &&
    event.actor !== "validator" &&
    event.actor !== "human" &&
    event.actor !== "system"
  ) {
    throw new LedgerInvariantError("I1", `unknown actor ${String(event.actor)}`);
  }
  if (hasDirectStatusMutation(event)) {
    throw new LedgerInvariantError("I1", `event ${event.id} writes status directly`);
  }
}

function requireStep(ledger: ExecutionLedger, stepId: string | undefined): ExecutionStep {
  if (!stepId) {
    throw new LedgerWriteError("stepId is required");
  }
  const step = ledger.steps.find((item) => item.id === stepId);
  if (!step) {
    throw new LedgerWriteError(`unknown step ${stepId}`);
  }
  if (step.retired) {
    throw new LedgerWriteError(`retired step ${stepId} cannot accept new execution`);
  }
  return step;
}

function requireAcceptance(
  ledger: ExecutionLedger,
  acceptanceId: string | undefined,
): AcceptanceItem {
  if (!acceptanceId) {
    throw new LedgerWriteError("acceptanceId is required");
  }
  const item = ledger.acceptance.find((row) => row.id === acceptanceId);
  if (!item) {
    throw new LedgerWriteError(`unknown acceptance ${acceptanceId}`);
  }
  return item;
}

function appendEvidence(target: { evidence: ProgressEvidence[] }, rows: ProgressEvidence[]): void {
  target.evidence.push(...rows);
}

function parseBlockingReason(
  value: unknown,
  fallback: BlockingReason = "blocked_system",
): BlockingReason {
  return typeof value === "string" && BLOCKING_REASONS.has(value as BlockingReason)
    ? (value as BlockingReason)
    : fallback;
}

function gateFromEvent(event: ExecutionEvent, step?: ExecutionStep): BlockingGate {
  if (event.payload.gate) {
    return {
      ...event.payload.gate,
      stepId: event.payload.gate.stepId ?? event.stepId ?? step?.id,
    };
  }
  const reason = parseBlockingReason(event.payload.reason, "blocked_user");
  const typeByReason: Record<BlockingReason, BlockingGate["type"]> = {
    blocked_user: "user_confirmation",
    blocked_authorization: "authorization",
    blocked_external: "external",
    blocked_data: "data",
    blocked_policy: "policy",
    blocked_system: "system",
  };
  return {
    type: typeByReason[reason],
    reason,
    question: event.payload.question ?? step?.blocking?.question ?? "等待处理后再继续",
    stepId: event.stepId ?? step?.id,
  };
}

function seedAcceptance(draft: SeedAcceptanceDraft, atMs: number): AcceptanceItem {
  return {
    id: draft.id,
    text: draft.text,
    required: draft.required !== false,
    status: "unknown",
    evidence: [],
    satisfiedByStepIds: draft.satisfiedByStepIds ?? [],
    updatedAtMs: atMs,
  };
}

function seedStep(draft: SeedStepDraft, planVersion: number): ExecutionStep {
  return {
    id: draft.id,
    planVersion,
    title: draft.title,
    status: "pending",
    executed: false,
    verified: false,
    acceptanceIds: draft.acceptanceIds ?? [],
    evidence: [],
    retired: false,
  };
}

function refreshTaskCompleted(ledger: ExecutionLedger): void {
  const required = ledger.acceptance.filter((item) => item.required);
  ledger.completed =
    required.length > 0 &&
    required.every((item) => item.status === "met" && hasAllowedEvidence(item.evidence));
}

function applySeed(event: ExecutionEvent): ExecutionLedger {
  if (event.type !== "PLAN_SEEDED") {
    throw new LedgerWriteError("first event must be PLAN_SEEDED");
  }
  const goal = event.payload.goal ?? "";
  const acceptance = (event.payload.acceptance ?? []).map((item) =>
    seedAcceptance(item, event.atMs),
  );
  const steps = (event.payload.steps ?? []).map((item) => seedStep(item, event.planVersion));
  const ledger: ExecutionLedger = {
    schemaVersion: PROGRESS_LEDGER_SCHEMA_VERSION,
    taskId: event.taskId,
    goal,
    lastUpdatedAtMs: event.atMs,
    lastMeaningfulChangeAtMs: event.atMs,
    staleAfterMs:
      typeof event.payload.staleAfterMs === "number" && event.payload.staleAfterMs > 0
        ? event.payload.staleAfterMs
        : DEFAULT_STALE_AFTER_MS,
    acceptance,
    steps,
    replans: [],
    currentPlanVersion: event.planVersion,
    completed: false,
  };
  refreshTaskCompleted(ledger);
  return ledger;
}

function applyToExisting(ledger: ExecutionLedger, event: ExecutionEvent): void {
  if (event.taskId !== ledger.taskId) {
    throw new LedgerWriteError(
      `event taskId ${event.taskId} does not match ledger ${ledger.taskId}`,
    );
  }

  switch (event.type) {
    case "PLAN_SEEDED":
      throw new LedgerWriteError("PLAN_SEEDED is only valid as the first event");
    case "STEP_STARTED": {
      const step = requireStep(ledger, event.stepId);
      if (
        !["pending", "blocked", "failed"].includes(step.status) &&
        step.status !== "in_progress"
      ) {
        throw new LedgerWriteError(`cannot start step ${step.id} from ${step.status}`);
      }
      step.status = "in_progress";
      step.startedAtMs = step.startedAtMs ?? event.atMs;
      step.blocking = undefined;
      if (ledger.currentBlocking?.stepId === step.id) {
        ledger.currentBlocking = undefined;
      }
      break;
    }
    case "TOOL_SUCCEEDED":
    case "STEP_EXECUTED": {
      const step = requireStep(ledger, event.stepId);
      if (!["in_progress", "executed"].includes(step.status)) {
        throw new LedgerWriteError(`cannot mark ${step.id} executed from ${step.status}`);
      }
      step.status = "executed";
      step.executed = true;
      appendEvidence(step, collectEvidence(event.payload.evidence));
      break;
    }
    case "TOOL_FAILED":
    case "STEP_FAILED": {
      const step = requireStep(ledger, event.stepId);
      step.status = "failed";
      step.failure = event.payload.failure ?? { code: "tool_failed", message: "tool failed" };
      appendEvidence(step, collectEvidence(event.payload.evidence));
      break;
    }
    case "EVIDENCE_RECORDED": {
      const rows = collectEvidence(event.payload.evidence);
      if (rows.length === 0) {
        throw new LedgerWriteError("EVIDENCE_RECORDED requires allowed evidence");
      }
      if (event.acceptanceId) {
        const item = requireAcceptance(ledger, event.acceptanceId);
        appendEvidence(item, rows);
        item.updatedAtMs = event.atMs;
      } else {
        const step = requireStep(ledger, event.stepId);
        appendEvidence(step, rows);
      }
      break;
    }
    case "VALIDATION_PASSED":
    case "STEP_VERIFIED": {
      const rows = requirePayloadEvidence(event.type, event.payload.evidence);
      const step = requireStep(ledger, event.stepId);
      if (!step.executed && step.status !== "executed" && step.status !== "verified") {
        throw new LedgerInvariantError("I2", `cannot verify ${step.id} before executed`);
      }
      appendEvidence(step, rows);
      step.executed = true;
      step.verified = true;
      step.status = "verified";
      break;
    }
    case "VALIDATION_FAILED": {
      const step = requireStep(ledger, event.stepId);
      appendEvidence(step, collectEvidence(event.payload.evidence));
      step.verified = false;
      if (step.executed) {
        step.status = "executed";
      }
      break;
    }
    case "STEP_COMPLETED": {
      const rows = requirePayloadEvidence(event.type, event.payload.evidence);
      const step = requireStep(ledger, event.stepId);
      if (!(step.executed && step.verified)) {
        throw new LedgerInvariantError("I2", `cannot complete ${step.id} before executed∧verified`);
      }
      appendEvidence(step, rows);
      step.status = "completed";
      step.completedAtMs = event.atMs;
      break;
    }
    case "ACCEPTANCE_MET": {
      const rows = requirePayloadEvidence(event.type, event.payload.evidence);
      const item = requireAcceptance(ledger, event.acceptanceId);
      appendEvidence(item, rows);
      item.status = "met";
      item.updatedAtMs = event.atMs;
      break;
    }
    case "ACCEPTANCE_UNMET": {
      const rows = requirePayloadEvidence(event.type, event.payload.evidence);
      const item = requireAcceptance(ledger, event.acceptanceId);
      appendEvidence(item, rows);
      item.status = "unmet";
      item.updatedAtMs = event.atMs;
      break;
    }
    case "STEP_BLOCKED":
    case "GATE_RAISED": {
      const step = event.stepId ? requireStep(ledger, event.stepId) : undefined;
      const gate = gateFromEvent(event, step);
      if (step) {
        step.status = "blocked";
        step.blocking = { reason: gate.reason, question: gate.question };
        for (const acceptanceId of step.acceptanceIds) {
          const item = ledger.acceptance.find((row) => row.id === acceptanceId);
          if (item && item.status === "unknown") {
            item.status = "blocked";
            item.updatedAtMs = event.atMs;
          }
        }
      }
      ledger.currentBlocking = gate;
      break;
    }
    case "STEP_UNBLOCKED":
    case "GATE_CLEARED": {
      const step = event.stepId ? requireStep(ledger, event.stepId) : undefined;
      if (step) {
        step.status = "in_progress";
        step.blocking = undefined;
        for (const acceptanceId of step.acceptanceIds) {
          const item = ledger.acceptance.find((row) => row.id === acceptanceId);
          if (item && item.status === "blocked") {
            item.status = "unknown";
            item.updatedAtMs = event.atMs;
          }
        }
      }
      if (!step || ledger.currentBlocking?.stepId === step.id) {
        ledger.currentBlocking = undefined;
      }
      break;
    }
    case "REPLAN_APPENDED": {
      const fromVersion = event.payload.fromVersion ?? ledger.currentPlanVersion;
      const toVersion = event.payload.toVersion ?? fromVersion + 1;
      if (fromVersion !== ledger.currentPlanVersion) {
        throw new LedgerWriteError(
          `replan fromVersion ${fromVersion} does not match current ${ledger.currentPlanVersion}`,
        );
      }
      if (toVersion !== fromVersion + 1) {
        throw new LedgerWriteError("replan toVersion must be fromVersion + 1");
      }
      const retiredIds = event.payload.retiredStepIds ?? [];
      for (const id of retiredIds) {
        const historical = ledger.steps.find((item) => item.id === id);
        if (!historical) {
          throw new LedgerInvariantError("I5", `replan cannot drop missing historical step ${id}`);
        }
        historical.retired = true;
      }
      const added = (event.payload.addedSteps ?? []).map((draft) => seedStep(draft, toVersion));
      for (const step of added) {
        if (ledger.steps.some((item) => item.id === step.id && item.planVersion === toVersion)) {
          throw new LedgerWriteError(`duplicate step ${step.id} in planVersion ${toVersion}`);
        }
        ledger.steps.push(step);
      }
      const triggeredBy = event.payload.triggeredBy ?? "runtime";
      if (triggeredBy !== "runtime" && triggeredBy !== "human" && triggeredBy !== "system") {
        throw new LedgerWriteError("replan triggeredBy must be runtime, human, or system");
      }
      ledger.replans.push({
        id: event.id,
        atMs: event.atMs,
        fromVersion,
        toVersion,
        reason: event.payload.replanReason ?? event.payload.reason ?? "replan",
        triggeredBy,
        addedStepIds: added.map((item) => item.id),
        retiredStepIds: retiredIds,
      });
      ledger.currentPlanVersion = toVersion;
      break;
    }
    case "MEANINGFUL_PROGRESS":
      break;
    default: {
      const _exhaustive: never = event.type;
      throw new LedgerWriteError(`unsupported event type ${String(_exhaustive)}`);
    }
  }
}

export function applyEvent(ledger: ExecutionLedger | null, event: ExecutionEvent): ExecutionLedger {
  requireActor(event);
  const next =
    ledger === null
      ? applySeed(event)
      : (() => {
          const cloned = cloneLedger(ledger);
          applyToExisting(cloned, event);
          return cloned;
        })();

  next.lastUpdatedAtMs = event.atMs;
  if (MEANINGFUL_TYPES.has(event.type)) {
    next.lastMeaningfulChangeAtMs = event.atMs;
  }
  refreshTaskCompleted(next);
  return next;
}

export function foldEvents(events: readonly ExecutionEvent[]): ExecutionLedger {
  if (events.length === 0) {
    throw new LedgerWriteError("foldEvents requires at least PLAN_SEEDED");
  }
  let ledger: ExecutionLedger | null = null;
  const applied: ExecutionEvent[] = [];
  for (const event of events) {
    ledger = applyEvent(ledger, event);
    applied.push(event);
    assertLedgerInvariants(applied, ledger);
  }
  return ledger as ExecutionLedger;
}
