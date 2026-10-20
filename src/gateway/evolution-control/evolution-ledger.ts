import { createHash } from "node:crypto";
import type {
  EvolutionLedgerEvent,
  EvolutionLedgerEventType,
  EvolutionTarget,
} from "@openbot/evolution-core";

export type LedgerAppendInput = {
  eventId: string;
  type: EvolutionLedgerEventType;
  timestamp: string;
  proposalId: string;
  target: EvolutionTarget;
  surfaceId: string;
  tenantScope: string | null;
  principalRef: string;
  grantId: string;
  evidenceRefs: string[];
  experimentId?: string;
  applicationId?: string;
  verificationId?: string;
  drillId?: string;
  domainReceiptRef?: string;
  legacySource?: boolean;
  exclusionReason?: string;
  externalEffectOutcome?: string;
};

export type EvolutionLedger = {
  append(input: LedgerAppendInput): EvolutionLedgerEvent;
  list(filter?: { proposalId?: string }): EvolutionLedgerEvent[];
  replay(proposalId: string): EvolutionLedgerEvent[];
};

function canonicalize(event: Omit<EvolutionLedgerEvent, "eventHash">): string {
  return JSON.stringify({
    schemaVersion: event.schemaVersion,
    eventId: event.eventId,
    type: event.type,
    timestamp: event.timestamp,
    proposalId: event.proposalId,
    target: event.target,
    surfaceId: event.surfaceId,
    tenantScope: event.tenantScope,
    principalRef: event.principalRef,
    grantId: event.grantId,
    evidenceRefs: event.evidenceRefs,
    experimentId: event.experimentId ?? null,
    applicationId: event.applicationId ?? null,
    verificationId: event.verificationId ?? null,
    drillId: event.drillId ?? null,
    domainReceiptRef: event.domainReceiptRef ?? null,
    previousEventHash: event.previousEventHash,
    legacySource: event.legacySource ?? false,
    exclusionReason: event.exclusionReason ?? null,
    externalEffectOutcome: event.externalEffectOutcome ?? null,
  });
}

function hashPayload(payload: string): string {
  return createHash("sha256").update(payload).digest("hex");
}

export function createMemoryEvolutionLedger(
  seed: readonly EvolutionLedgerEvent[] = [],
): EvolutionLedger {
  const events: EvolutionLedgerEvent[] = [];
  let tip: string | null = null;
  for (const event of seed) {
    const unsigned: Omit<EvolutionLedgerEvent, "eventHash"> = {
      schemaVersion: 1,
      eventId: event.eventId,
      type: event.type,
      timestamp: event.timestamp,
      proposalId: event.proposalId,
      target: event.target,
      surfaceId: event.surfaceId,
      tenantScope: event.tenantScope,
      principalRef: event.principalRef,
      grantId: event.grantId,
      evidenceRefs: [...event.evidenceRefs],
      previousEventHash: tip,
      ...(event.experimentId ? { experimentId: event.experimentId } : {}),
      ...(event.applicationId ? { applicationId: event.applicationId } : {}),
      ...(event.verificationId ? { verificationId: event.verificationId } : {}),
      ...(event.drillId ? { drillId: event.drillId } : {}),
      ...(event.domainReceiptRef ? { domainReceiptRef: event.domainReceiptRef } : {}),
      ...(event.legacySource ? { legacySource: true } : {}),
      ...(event.exclusionReason ? { exclusionReason: event.exclusionReason } : {}),
      ...(event.externalEffectOutcome
        ? { externalEffectOutcome: event.externalEffectOutcome }
        : {}),
    };
    const expectedHash = hashPayload(canonicalize(unsigned));
    if (event.previousEventHash !== tip || event.eventHash !== expectedHash) {
      throw new Error(`evolution ledger chain broken at ${event.eventId}`);
    }
    events.push(event);
    tip = event.eventHash;
  }
  return {
    append(input) {
      const unsigned: Omit<EvolutionLedgerEvent, "eventHash"> = {
        schemaVersion: 1,
        eventId: input.eventId,
        type: input.type,
        timestamp: input.timestamp,
        proposalId: input.proposalId,
        target: input.target,
        surfaceId: input.surfaceId,
        tenantScope: input.tenantScope,
        principalRef: input.principalRef,
        grantId: input.grantId,
        evidenceRefs: [...input.evidenceRefs],
        previousEventHash: tip,
        ...(input.experimentId ? { experimentId: input.experimentId } : {}),
        ...(input.applicationId ? { applicationId: input.applicationId } : {}),
        ...(input.verificationId ? { verificationId: input.verificationId } : {}),
        ...(input.drillId ? { drillId: input.drillId } : {}),
        ...(input.domainReceiptRef ? { domainReceiptRef: input.domainReceiptRef } : {}),
        ...(input.legacySource ? { legacySource: true } : {}),
        ...(input.exclusionReason ? { exclusionReason: input.exclusionReason } : {}),
        ...(input.externalEffectOutcome
          ? { externalEffectOutcome: input.externalEffectOutcome }
          : {}),
      };
      const event: EvolutionLedgerEvent = {
        ...unsigned,
        eventHash: hashPayload(canonicalize(unsigned)),
      };
      events.push(event);
      tip = event.eventHash;
      return event;
    },
    list(filter) {
      if (!filter?.proposalId) {
        return [...events];
      }
      return events.filter((row) => row.proposalId === filter.proposalId);
    },
    replay(proposalId) {
      return events.filter((row) => row.proposalId === proposalId);
    },
  };
}
