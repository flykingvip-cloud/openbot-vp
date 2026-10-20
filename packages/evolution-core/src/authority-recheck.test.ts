import { describe, expect, it } from "vitest";
import {
  decideAuthorityRecheck,
  ledgerHasOnlyReceipts,
  ledgerHasVerificationProof,
  resolveAuthorityRecheckContract,
} from "./authority-recheck.js";
import type { EvolutionLedgerEvent } from "./types.js";

function event(type: EvolutionLedgerEvent["type"], eventId = type): EvolutionLedgerEvent {
  return {
    schemaVersion: 1,
    eventId,
    type,
    timestamp: "2026-09-06T11:00:00.000Z",
    proposalId: "evo:1",
    target: { domain: "agent", agentId: "bot" },
    surfaceId: "agent.working-dna",
    tenantScope: "tenant-a",
    principalRef: "ent-admin",
    grantId: "grant-1",
    evidenceRefs: ["ev-a"],
    previousEventHash: null,
    eventHash: eventId,
  };
}

describe("authority recheck registry", () => {
  it("registers only the first-period Working DNA and Skill Installation contracts", () => {
    expect(resolveAuthorityRecheckContract("agent.working-dna")).toEqual({
      ok: true,
      contract: {
        surfaceId: "agent.working-dna",
        domainReaderKind: "working-style-store",
        sourceOfTruth: "src/gateway/agent-growth/working-style-store.ts",
      },
    });
    expect(resolveAuthorityRecheckContract("capability.skill-installation").ok).toBe(true);
    expect(resolveAuthorityRecheckContract("knowledge.experience-capsule")).toEqual({
      ok: false,
      code: "unsupported_surface",
    });
    expect(resolveAuthorityRecheckContract("organization.task-routing").ok).toBe(false);
    expect(resolveAuthorityRecheckContract("system.runtime-binding-governance").ok).toBe(false);
  });
});

describe("authority recheck against ledger replay", () => {
  const verifiedEvents = [event("application.applied"), event("verification.completed")];

  it("treats a matching SoT plus verification.completed as resolved", () => {
    expect(
      decideAuthorityRecheck({
        surfaceId: "agent.working-dna",
        proposalStatus: "VERIFIED",
        events: verifiedEvents,
        expectedVersion: "style-after",
        baselineVersion: "style-before",
        observation: { status: "ok", observedVersion: "style-after" },
      }),
    ).toEqual({
      outcome: "resolved",
      reasonCode: "sot_confirmed",
      mayCloseFinding: true,
      surfaceId: "agent.working-dna",
      domainReaderKind: "working-style-store",
    });
    expect(ledgerHasVerificationProof(verifiedEvents)).toBe(true);
  });

  it("keeps the finding open when VERIFIED but the store is unchanged", () => {
    expect(
      decideAuthorityRecheck({
        surfaceId: "agent.working-dna",
        proposalStatus: "VERIFIED",
        events: verifiedEvents,
        expectedVersion: "style-after",
        baselineVersion: "style-before",
        observation: { status: "ok", observedVersion: "style-before" },
      }),
    ).toEqual({
      outcome: "still_open",
      reasonCode: "sot_unchanged",
      mayCloseFinding: false,
      surfaceId: "agent.working-dna",
      domainReaderKind: "working-style-store",
    });
  });

  it("rejects a forged VERIFIED status that has no verification.completed proof", () => {
    const receipts = [event("application.applied"), event("legacy.imported")];
    expect(ledgerHasOnlyReceipts(receipts)).toBe(true);
    expect(
      decideAuthorityRecheck({
        surfaceId: "capability.skill-installation",
        proposalStatus: "VERIFIED",
        events: receipts,
        expectedVersion: "skill:published:1.0.0",
        baselineVersion: "skill:published:0.9.0",
        observation: { status: "ok", observedVersion: "skill:published:1.0.0" },
      }),
    ).toMatchObject({
      outcome: "still_open",
      reasonCode: "forged_verified",
      mayCloseFinding: false,
      domainReaderKind: "skill-lifecycle-store",
    });
  });

  it("blocks Capsule until a recheck contract exists", () => {
    expect(
      decideAuthorityRecheck({
        surfaceId: "knowledge.experience-capsule",
        proposalStatus: "VERIFIED",
        events: verifiedEvents,
        expectedVersion: "cap-after",
        baselineVersion: "cap-before",
        observation: { status: "ok", observedVersion: "cap-after" },
      }),
    ).toEqual({
      outcome: "blocked",
      reasonCode: "unsupported_surface",
      mayCloseFinding: false,
      surfaceId: "knowledge.experience-capsule",
    });
  });

  it("does not treat a missing store as no-regression", () => {
    expect(
      decideAuthorityRecheck({
        surfaceId: "agent.working-dna",
        proposalStatus: "VERIFIED",
        events: verifiedEvents,
        expectedVersion: "style-after",
        baselineVersion: "style-before",
        observation: { status: "missing", observedVersion: null },
      }),
    ).toMatchObject({
      outcome: "inconclusive",
      reasonCode: "sot_missing",
      mayCloseFinding: false,
    });
  });
});
