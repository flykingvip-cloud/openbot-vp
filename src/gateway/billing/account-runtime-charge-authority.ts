/**
 * Single-process commercial authority for Account Computer (v4.1 §9 gate 2).
 *
 * Slot acquire and credit holds stay here, on the control plane. Worker
 * sessions do not import this module. A stopped heartbeat never reaches a
 * charge. Parallel admission uses the existing in-process locks; it does not
 * open a second reader on the billing ledgers.
 */

import type {
  AccountWorkerChargeGate,
  WorkerHeartbeatVerdict,
} from "../governance/account-worker-runtime.js";
import { finishAgentRun, tryAcquireAgentRunSlot } from "./agent-run-registry.js";
import { getCreditReservation, tryHoldCreditReservation } from "./credit-reservation-store.js";

export async function chargeOnControlPlane<T>(params: {
  gate: AccountWorkerChargeGate;
  verdict: WorkerHeartbeatVerdict;
  charge: () => Promise<T>;
}): Promise<{ charged: true; value: T } | { charged: false; reason: string }> {
  params.gate.note(params.verdict);
  if (!params.verdict.continueBilling || !params.gate.mayCharge()) {
    return { charged: false, reason: params.verdict.reason };
  }
  const value = await params.charge();
  return { charged: true, value };
}

export async function admitSingleProcessRun(input: {
  runId: string;
  enterpriseId: string;
  maxConcurrentRuns: number;
  reservedCredits: number;
  availableCredits: number;
  authorizationDecisionId: string;
  registryPath: string;
  reservationPath: string;
}): Promise<{
  admitted: boolean;
  idempotent: boolean;
  slotReason?: string;
  creditReason?: string;
}> {
  const slot = await tryAcquireAgentRunSlot(
    {
      runId: input.runId,
      enterpriseId: input.enterpriseId,
      maxConcurrentRuns: input.maxConcurrentRuns,
      allowBurstConcurrency: false,
    },
    input.registryPath,
  );
  if (!slot.ok && slot.reason === "DUPLICATE_ACTIVE") {
    const existing = await getCreditReservation(input.runId, input.reservationPath);
    return {
      admitted: existing?.status === "held" || existing?.status === "settled",
      idempotent: true,
    };
  }
  if (!slot.ok) {
    return { admitted: false, idempotent: false, slotReason: slot.reason };
  }
  const credit = await tryHoldCreditReservation({
    runId: input.runId,
    enterpriseId: input.enterpriseId,
    authorizationDecisionId: input.authorizationDecisionId,
    subscriptionId: "sub-account-runtime",
    subscriptionSnapshotId: "snap-account-runtime",
    planId: "plan-account-runtime",
    planVersionId: "pv-account-runtime",
    reservedCredits: input.reservedCredits,
    availableCredits: input.availableCredits,
    storePath: input.reservationPath,
  });
  if (!credit.ok) {
    await finishAgentRun(input.runId, input.registryPath);
    return { admitted: false, idempotent: false, creditReason: credit.reason };
  }
  return { admitted: true, idempotent: false };
}
