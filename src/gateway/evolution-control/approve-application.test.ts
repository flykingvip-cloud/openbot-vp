import type { EvolutionApplication, EvolutionProposal } from "@openbot/evolution-core";
import { describe, expect, it } from "vitest";
import { approveApplicationAuthority } from "./approve-application.js";
import type { EvolutionControlPlane } from "./control-plane.js";
import { createMemoryEvolutionLedger } from "./evolution-ledger.js";

function proposal(): EvolutionProposal {
  return {
    schemaVersion: 2,
    proposalId: "prop-1",
    status: "CANARY",
    tenantScope: "tenant-a",
    surfaceId: "agent.working-dna",
    candidateRef: "cand-1",
    target: { domain: "agent", agentId: "agent-1" },
    grantId: "grant-1",
    sourceEvidenceRefs: ["ev-1"],
    confidentialityScope: "enterprise",
    riskLevel: "low",
    sourceMechanismRef: "diagnosis.manual",
    expectedEffects: [],
    createdAt: "2026-10-15T00:00:00.000Z",
    expiresAt: "2026-10-16T00:00:00.000Z",
  };
}

function application(): EvolutionApplication {
  return {
    schemaVersion: 1,
    applicationId: "app-1",
    proposalId: "prop-1",
    experimentId: "exp-1",
    adapterId: "working-dna",
    idempotencyKey: "cmd-1",
    targetVersionBefore: "before",
    targetVersionAfter: "after",
    rollbackRef: "rb-1",
    scope: "canary",
    status: "applied",
    appliedToRuntime: true,
    appliedAt: "2026-10-15T00:00:01.000Z",
  };
}

function mockPlane(over?: {
  application?: EvolutionApplication;
  proposal?: EvolutionProposal;
}): EvolutionControlPlane {
  const app = over?.application ?? application();
  const prop = over?.proposal ?? proposal();
  const ledger = createMemoryEvolutionLedger();
  return {
    getApplication: (id: string) => (id === app.applicationId ? app : undefined),
    getProposal: (id: string) => (id === prop.proposalId ? prop : undefined),
    ledger,
  } as unknown as EvolutionControlPlane;
}

describe("approveApplicationAuthority", () => {
  it("appends application.approved without promoting and is idempotent", () => {
    const plane = mockPlane();
    const first = approveApplicationAuthority(plane, {
      commandId: "cmd-approve-1",
      applicationId: "app-1",
      principalRef: "operator-1",
      trustedTenantId: "tenant-a",
    });
    expect(first.alreadyApproved).toBe(false);
    expect(first.eventId).toBe("led:cmd-approve-1:approved");
    expect(plane.getProposal("prop-1")?.status).toBe("CANARY");
    const events = plane.ledger.list({ proposalId: "prop-1" });
    expect(
      events.some((e) => e.type === "application.approved" && e.applicationId === "app-1"),
    ).toBe(true);
    expect(events.some((e) => e.type === "promotion.completed")).toBe(false);

    const second = approveApplicationAuthority(plane, {
      commandId: "cmd-approve-2",
      applicationId: "app-1",
      principalRef: "operator-1",
      trustedTenantId: "tenant-a",
    });
    expect(second.alreadyApproved).toBe(true);
    expect(
      plane.ledger.list({ proposalId: "prop-1" }).filter((e) => e.type === "application.approved")
        .length,
    ).toBe(1);
  });

  it("rejects non-applied applications and tenant mismatches", () => {
    expect(() =>
      approveApplicationAuthority(
        mockPlane({ application: { ...application(), status: "pending" } }),
        {
          commandId: "cmd-x",
          applicationId: "app-1",
          principalRef: "operator-1",
          trustedTenantId: "tenant-a",
        },
      ),
    ).toThrow(/not applied/);
    expect(() =>
      approveApplicationAuthority(mockPlane(), {
        commandId: "cmd-x",
        applicationId: "app-1",
        principalRef: "operator-1",
        trustedTenantId: "other-tenant",
      }),
    ).toThrow(/proposal not found/);
  });
});
