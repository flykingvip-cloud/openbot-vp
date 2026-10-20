import { LedgerInvariantError } from "./errors.js";
import { hasAllowedEvidence, isAllowedEvidenceType } from "./evidence.js";
import { getLedgerMetrics } from "./metrics.js";
import type {
  ExecutionEvent,
  ExecutionLedger,
  ExecutionStep,
  LedgerInvariantId,
  LedgerInvariantViolation,
  ProgressView,
} from "./types.js";

export const FORBIDDEN_EVENT_ACTORS = new Set(["llm", "model", "assistant", "planner", "agent"]);

const STRONGER_THAN_LEDGER = /即将完成|马上完成|即将完成|almost done|about to finish/i;

export function hasDirectStatusMutation(event: ExecutionEvent): boolean {
  const payload = event.payload;
  if (payload.status !== undefined) {
    return true;
  }
  for (const step of payload.steps ?? []) {
    if (step && typeof step === "object" && "status" in step) {
      return true;
    }
  }
  for (const item of payload.acceptance ?? []) {
    if (item && typeof item === "object" && "status" in item) {
      return true;
    }
  }
  for (const step of payload.addedSteps ?? []) {
    if (step && typeof step === "object" && "status" in step) {
      return true;
    }
  }
  return false;
}

function checkI1(events: readonly ExecutionEvent[]): LedgerInvariantViolation[] {
  const violations: LedgerInvariantViolation[] = [];
  for (const event of events) {
    if (FORBIDDEN_EVENT_ACTORS.has(String(event.actor))) {
      violations.push({
        id: "I1",
        message: `event ${event.id} actor=${String(event.actor)} cannot mutate ledger`,
      });
    }
    if (hasDirectStatusMutation(event)) {
      violations.push({
        id: "I1",
        message: `event ${event.id} writes status directly`,
      });
    }
  }
  return violations;
}

function checkI2(ledger: ExecutionLedger): LedgerInvariantViolation[] {
  return ledger.steps
    .filter((step) => step.status === "completed" && !(step.executed && step.verified))
    .map((step) => ({
      id: "I2" as const,
      message: `step ${step.id} is completed without executed∧verified`,
    }));
}

function checkI3(ledger: ExecutionLedger): LedgerInvariantViolation[] {
  return ledger.acceptance
    .filter((item) => item.status === "met" && !hasAllowedEvidence(item.evidence))
    .map((item) => ({
      id: "I3" as const,
      message: `acceptance ${item.id} is met without allowed evidence`,
    }));
}

function checkI4(ledger: ExecutionLedger): LedgerInvariantViolation[] {
  if (!ledger.completed) {
    return [];
  }
  const unmet = ledger.acceptance.filter(
    (item) => item.required && !(item.status === "met" && hasAllowedEvidence(item.evidence)),
  );
  if (unmet.length === 0) {
    return [];
  }
  return [
    {
      id: "I4",
      message: `task.completed but required acceptance not met: ${unmet.map((item) => item.id).join(",")}`,
    },
  ];
}

function checkI5(
  events: readonly ExecutionEvent[],
  ledger: ExecutionLedger,
): LedgerInvariantViolation[] {
  const violations: LedgerInvariantViolation[] = [];
  for (const event of events) {
    if (event.type !== "REPLAN_APPENDED") {
      continue;
    }
    const retired = new Set(event.payload.retiredStepIds ?? []);
    for (const step of ledger.steps) {
      if (step.planVersion > event.planVersion) {
        continue;
      }
      if (retired.has(step.id) && !step.retired) {
        violations.push({
          id: "I5",
          message: `replan ${event.id} lost historical step ${step.id}`,
        });
      }
    }
  }
  const byId = new Map<string, ExecutionStep[]>();
  for (const step of ledger.steps) {
    const list = byId.get(step.id) ?? [];
    list.push(step);
    byId.set(step.id, list);
  }
  for (const [id, versions] of byId) {
    const planVersions = new Set(versions.map((step) => step.planVersion));
    if (versions.length > 1 && planVersions.size === 1) {
      violations.push({
        id: "I5",
        message: `step ${id} duplicated inside the same planVersion`,
      });
    }
  }
  return violations;
}

/**
 * I1–I5 apply to events + folded ledger.
 * I6–I8 are projection / writer concerns (see project.ts and fold tests).
 */
export function collectLedgerInvariants(
  events: readonly ExecutionEvent[],
  ledger: ExecutionLedger,
): LedgerInvariantViolation[] {
  return [
    ...checkI1(events),
    ...checkI2(ledger),
    ...checkI3(ledger),
    ...checkI4(ledger),
    ...checkI5(events, ledger),
  ];
}

export function assertLedgerInvariants(
  events: readonly ExecutionEvent[],
  ledger: ExecutionLedger,
): void {
  const violations = collectLedgerInvariants(events, ledger);
  if (violations[0]) {
    throw new LedgerInvariantError(violations[0].id, violations[0].message);
  }
}

export function isCanonicallyMetAcceptance(item: ExecutionLedger["acceptance"][number]): boolean {
  return item.status === "met" && item.evidence.some((row) => isAllowedEvidenceType(row.type));
}

export function collectProjectionInvariants(
  ledger: ExecutionLedger,
  view: ProgressView,
  originalLedgerJson: string,
  originalEventsJson?: string,
): LedgerInvariantViolation[] {
  const violations: LedgerInvariantViolation[] = [];
  if (JSON.stringify(ledger) !== originalLedgerJson) {
    violations.push({ id: "I6", message: "projection mutated ledger" });
  }
  if (originalEventsJson !== undefined && originalEventsJson.length === 0) {
    violations.push({ id: "I6", message: "projection imported a write path" });
  }
  if (view.taskCompleted && !ledger.completed) {
    violations.push({ id: "I8", message: "view.taskCompleted stronger than ledger" });
  }
  const met = ledger.acceptance.filter(isCanonicallyMetAcceptance).length;
  if (view.acceptanceProgress.met > met) {
    violations.push({ id: "I8", message: "view acceptance.met stronger than ledger" });
  }
  const text = `${view.headline}\n${view.focus}`;
  if (STRONGER_THAN_LEDGER.test(text)) {
    violations.push({ id: "I8", message: "view implies a stronger state than ledger" });
  }
  const blocked =
    Boolean(ledger.currentBlocking) ||
    ledger.steps.some((step) => !step.retired && step.status === "blocked");
  if (blocked && STRONGER_THAN_LEDGER.test(text)) {
    violations.push({ id: "I8", message: "blocked ledger projected as nearly complete" });
  }
  for (const node of view.nodes) {
    const step = ledger.steps.find((item) => item.id === node.id);
    if (!step) {
      continue;
    }
    if (step.status === "blocked" && node.tone !== "blocked") {
      violations.push({ id: "I8", message: `blocked step ${step.id} projected as ${node.tone}` });
    }
    if (step.status === "failed" && node.tone === "done") {
      violations.push({ id: "I8", message: `failed step ${step.id} projected as done` });
    }
    if (step.status !== "completed" && node.tone === "done") {
      violations.push({ id: "I8", message: `step ${step.id} projected done before completed` });
    }
  }
  return violations;
}

export function assertProjectionInvariants(
  ledger: ExecutionLedger,
  view: ProgressView,
  originalLedgerJson: string,
): void {
  const violations = collectProjectionInvariants(ledger, view, originalLedgerJson);
  const first = violations[0];
  if (first) {
    getLedgerMetrics().recordProjectionViolation({
      id: first.id,
      message: first.message,
      taskId: view.taskId,
    });
    throw new LedgerInvariantError(first.id, first.message);
  }
}

export function invariantIds(violations: readonly LedgerInvariantViolation[]): LedgerInvariantId[] {
  return violations.map((item) => item.id);
}
