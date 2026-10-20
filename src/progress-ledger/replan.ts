import { LedgerWriteError } from "./errors.js";
import { loadFoldedLedger, type ProgressLedgerStore } from "./store.js";
import type { ExecutionLedger, ReplanProposal, SeedStepDraft } from "./types.js";
import { appendLedgerEvent, newLedgerEventId } from "./writer.js";

const REPLAN_TRIGGERED_BY = new Set(["runtime", "human", "system"]);

function assertDraftSteps(steps: readonly SeedStepDraft[]): void {
  if (steps.length === 0) {
    throw new LedgerWriteError("replan must add at least one step");
  }
  for (const step of steps) {
    if (!step.id.trim() || !step.title.trim()) {
      throw new LedgerWriteError("replan steps need id and title");
    }
    if ("status" in step) {
      throw new LedgerWriteError("replan drafts cannot include status");
    }
  }
}

/**
 * Accept a model/human proposal as an append-only REPLAN_APPENDED event.
 * The proposer never writes ledger status; historical steps are only retired.
 */
export async function acceptReplanProposal(
  store: ProgressLedgerStore,
  proposal: ReplanProposal,
  options?: {
    atMs?: number;
    triggeredBy?: "runtime" | "human" | "system";
  },
): Promise<ExecutionLedger> {
  if (!proposal.reason.trim()) {
    throw new LedgerWriteError("replan requires a reason");
  }
  assertDraftSteps(proposal.addedSteps);
  const triggeredBy = options?.triggeredBy ?? "runtime";
  if (!REPLAN_TRIGGERED_BY.has(triggeredBy)) {
    throw new LedgerWriteError("replan triggeredBy must be runtime, human, or system");
  }
  const ledger = await loadFoldedLedger(store);
  if (!ledger) {
    throw new LedgerWriteError("cannot replan an empty ledger");
  }
  if (proposal.taskId !== ledger.taskId && proposal.taskId !== store.taskId) {
    throw new LedgerWriteError("replan taskId does not match ledger");
  }
  const retiredStepIds = proposal.retiredStepIds ?? [];
  for (const id of retiredStepIds) {
    const historical = ledger.steps.find((step) => step.id === id);
    if (!historical) {
      throw new LedgerWriteError(`replan cannot retire unknown step ${id}`);
    }
  }
  return (
    await appendLedgerEvent(store, {
      id: newLedgerEventId(),
      atMs: options?.atMs ?? Date.now(),
      type: "REPLAN_APPENDED",
      taskId: ledger.taskId,
      planVersion: ledger.currentPlanVersion,
      actor: "runtime",
      payload: {
        fromVersion: ledger.currentPlanVersion,
        toVersion: ledger.currentPlanVersion + 1,
        replanReason: proposal.reason.trim(),
        triggeredBy,
        addedSteps: proposal.addedSteps.map((step) => ({
          id: step.id,
          title: step.title,
          acceptanceIds: step.acceptanceIds,
        })),
        retiredStepIds,
      },
    })
  ).ledger;
}
