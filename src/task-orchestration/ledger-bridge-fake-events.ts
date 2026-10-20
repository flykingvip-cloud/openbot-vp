/**
 * Orchestration Plane — ledger-bridge fake-event I1 proof (P4.5).
 *
 * Folds in-memory events (never via the writer) and checks:
 *   - I1–I5 on events + folded ledger (`collectLedgerInvariants`)
 *   - I6 / I8 on projection (`collectProjectionInvariants`)
 *   - I7 is **not** defined in `progress-ledger/invariants.ts`
 *
 * Fake orchestrator intents: reject assistant_text / model_claim /
 * ack-as-STEP_COMPLETED; accept tool_result and `ackLedgerIntent`.
 * `writerCalled` is always false — this module must not import
 * `appendLedgerEvent`.
 */

import { foldEvents } from "../progress-ledger/fold.js";
import {
  collectLedgerInvariants,
  collectProjectionInvariants,
} from "../progress-ledger/invariants.js";
import { projectProgress } from "../progress-ledger/project.js";
import type {
  ExecutionEvent,
  ExecutionLedger,
  LedgerInvariantViolation,
  ProgressView,
} from "../progress-ledger/types.js";
import {
  ackLedgerIntent,
  assertLedgerBridgeOutput,
  toolResultLedgerIntent,
  type OrchestratorLedgerIntent,
} from "./ledger-bridge.js";

/** I7 is a writer/quiet concern; it is not defined in progress-ledger/invariants.ts. */
export const LEDGER_I7_DEFINED_IN_INVARIANTS = false;

export type FakeIntentCase = {
  name: string;
  intent: OrchestratorLedgerIntent;
  expectAccepted: boolean;
};

export type FakeIntentVerdict = {
  name: string;
  accepted: boolean;
  expectAccepted: boolean;
  errorMessage?: string;
};

export type LedgerBridgeFakeEventProof = {
  writerCalled: false;
  i7DefinedInInvariants: false;
  events: readonly ExecutionEvent[];
  ledger: ExecutionLedger;
  view: ProgressView;
  ledgerInvariantViolations: readonly LedgerInvariantViolation[];
  projectionInvariantViolations: readonly LedgerInvariantViolation[];
  intents: readonly FakeIntentVerdict[];
};

const FAKE_TASK_ID = "orch-fake-i1";

function fakeEvents(): ExecutionEvent[] {
  return [
    {
      id: "evt_seed",
      atMs: 1_000,
      type: "PLAN_SEEDED",
      taskId: FAKE_TASK_ID,
      planVersion: 1,
      actor: "runtime",
      payload: {
        goal: "offline ledger-bridge I1 proof",
        acceptance: [{ id: "A1", text: "tool result recorded", satisfiedByStepIds: ["E1"] }],
        steps: [{ id: "E1", title: "record tool result", acceptanceIds: ["A1"] }],
      },
    },
    {
      id: "evt_start",
      atMs: 2_000,
      type: "STEP_STARTED",
      taskId: FAKE_TASK_ID,
      stepId: "E1",
      planVersion: 1,
      actor: "runtime",
      payload: {},
    },
    {
      id: "evt_tool",
      atMs: 3_000,
      type: "TOOL_SUCCEEDED",
      taskId: FAKE_TASK_ID,
      stepId: "E1",
      planVersion: 1,
      actor: "runtime",
      payload: {
        toolName: "web_fetch",
        evidence: {
          type: "tool_result",
          atMs: 3_000,
          source: "web_fetch",
          verification: "passed",
        },
      },
    },
  ];
}

export function fakeLedgerIntentCases(): FakeIntentCase[] {
  return [
    {
      name: "assistant_text",
      intent: { eventType: "EVIDENCE_RECORDED", evidenceType: "assistant_text" },
      expectAccepted: false,
    },
    {
      name: "model_claim",
      intent: { eventType: "EVIDENCE_RECORDED", evidenceType: "model_claim" },
      expectAccepted: false,
    },
    {
      name: "ack_as_step_completed",
      intent: { eventType: "STEP_COMPLETED", ackOnly: true },
      expectAccepted: false,
    },
    {
      name: "tool_result",
      intent: toolResultLedgerIntent("web_fetch"),
      expectAccepted: true,
    },
    {
      name: "ack_ledger_intent",
      intent: ackLedgerIntent(),
      expectAccepted: true,
    },
  ];
}

function judgeIntent(next: FakeIntentCase): FakeIntentVerdict {
  try {
    assertLedgerBridgeOutput(next.intent);
    return { name: next.name, accepted: true, expectAccepted: next.expectAccepted };
  } catch (error) {
    return {
      name: next.name,
      accepted: false,
      expectAccepted: next.expectAccepted,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Fold fake events, project, and judge bridge intents. Never writes.
 */
export function proveLedgerBridgeFakeEvents(): LedgerBridgeFakeEventProof {
  const events = fakeEvents();
  const ledger = foldEvents(events);
  const originalLedgerJson = JSON.stringify(ledger);
  const view = projectProgress(ledger, { mode: "deliver" }, 4_000);
  const ledgerInvariantViolations = collectLedgerInvariants(events, ledger);
  const projectionInvariantViolations = collectProjectionInvariants(
    ledger,
    view,
    originalLedgerJson,
    JSON.stringify(events),
  );
  const intents = fakeLedgerIntentCases().map(judgeIntent);

  return {
    writerCalled: false,
    i7DefinedInInvariants: LEDGER_I7_DEFINED_IN_INVARIANTS,
    events,
    ledger,
    view,
    ledgerInvariantViolations,
    projectionInvariantViolations,
    intents,
  };
}
