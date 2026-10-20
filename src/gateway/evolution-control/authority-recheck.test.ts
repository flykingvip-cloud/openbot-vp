import type {
  EvolutionApplication,
  EvolutionLedgerEvent,
  EvolutionProposal,
  ExternalEffectDomainReader,
} from "@openbot/evolution-core";
import { describe, expect, it } from "vitest";
import { recheckAuthorityFromLedger } from "./authority-recheck.js";

const BEFORE = "style:markdown:on_completion:ask:balanced:professional";
const AFTER = "style:markdown:milestone:ask:balanced:professional";

function proposal(over: Partial<EvolutionProposal> = {}): EvolutionProposal {
  return {
    schemaVersion: 2,
    proposalId: "evo:auth-1",
    sourceEvidenceRefs: ["ev-a"],
    sourceMechanismRef: "diagnosis.behavior.reporting_cadence_gap",
    target: { domain: "agent", agentId: "bot-1" },
    candidateRef: "cand:auth-1",
    surfaceId: "agent.working-dna",
    expectedEffects: [],
    riskLevel: "medium",
    confidentialityScope: "enterprise",
    tenantScope: "tenant-a",
    grantId: "grant-1",
    status: "VERIFIED",
    createdAt: "2026-09-06T10:00:00.000Z",
    expiresAt: "2026-09-07T00:00:00.000Z",
    experimentId: "exp-auth-1",
    applicationId: "app-auth-1",
    verificationId: "ver-auth-1",
    ...over,
  };
}

function application(): EvolutionApplication {
  return {
    schemaVersion: 1,
    applicationId: "app-auth-1",
    proposalId: "evo:auth-1",
    experimentId: "exp-auth-1",
    adapterId: "working-dna",
    idempotencyKey: "apply-auth-1",
    targetVersionBefore: BEFORE,
    targetVersionAfter: AFTER,
    rollbackRef: "rb-auth-1",
    scope: "canary",
    status: "applied",
    appliedToRuntime: true,
  };
}

function event(type: EvolutionLedgerEvent["type"]): EvolutionLedgerEvent {
  return {
    schemaVersion: 1,
    eventId: `led:${type}`,
    type,
    timestamp: "2026-09-06T11:00:00.000Z",
    proposalId: "evo:auth-1",
    target: { domain: "agent", agentId: "bot-1" },
    surfaceId: "agent.working-dna",
    tenantScope: "tenant-a",
    principalRef: "ent-admin",
    grantId: "grant-1",
    evidenceRefs: ["ev-a"],
    previousEventHash: null,
    eventHash: type,
  };
}

function reader(version: string): ExternalEffectDomainReader {
  return {
    async readWorkingStyle() {
      return { status: "ok", version, hash: "h", rawLength: 8 };
    },
  };
}

describe("authority recheck from ledger replay", () => {
  it("fails a forged VERIFIED row when the working-style store is unchanged", async () => {
    await expect(
      recheckAuthorityFromLedger({
        proposal: proposal(),
        application: application(),
        events: [event("application.applied"), event("verification.completed")],
        readDomain: reader(BEFORE),
      }),
    ).resolves.toMatchObject({
      outcome: "still_open",
      reasonCode: "sot_unchanged",
      mayCloseFinding: false,
    });
  });

  it("confirms the live store against verification.completed", async () => {
    await expect(
      recheckAuthorityFromLedger({
        proposal: proposal(),
        application: application(),
        events: [event("application.applied"), event("verification.completed")],
        readDomain: reader(AFTER),
      }),
    ).resolves.toMatchObject({
      outcome: "resolved",
      reasonCode: "sot_confirmed",
      mayCloseFinding: true,
      verificationRef: {
        schemaVersion: 1,
        proposalId: "evo:auth-1",
        experimentId: "exp-auth-1",
        applicationId: "app-auth-1",
        verificationId: "ver-auth-1",
        rollbackRef: "rb-auth-1",
      },
    });
  });

  it("rejects Capsule reflux until a contract is registered", async () => {
    await expect(
      recheckAuthorityFromLedger({
        proposal: proposal({ surfaceId: "knowledge.experience-capsule" }),
        application: application(),
        events: [event("verification.completed")],
        readDomain: reader(AFTER),
      }),
    ).resolves.toEqual({
      outcome: "blocked",
      reasonCode: "unsupported_surface",
      mayCloseFinding: false,
      surfaceId: "knowledge.experience-capsule",
    });
  });
});
