// @vitest-environment node
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  adaptCommercialRunGate,
  recordCommercialRunDecision,
  type CommercialRunGateStatus,
} from "./commercial-run-adapter.js";

const TS = "2026-09-28T06:00:00.000Z";
const UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("CommercialRunAdapter mapping", () => {
  it("maps skipped → skipped+legacy with a fresh gd- id when no auth id", () => {
    const decision = adaptCommercialRunGate({
      gate: { status: "skipped", runId: "run-1", actorId: "platform-user:u1" },
      ts: TS,
      uuid: () => UUID,
    });
    expect(decision).toMatchObject({
      effect: "skipped",
      mode: "legacy",
      source: "commercial-run",
      reason: "no-enterprise-scope",
      decisionId: `gd-${UUID}`,
      runId: "run-1",
      actorId: "platform-user:u1",
      ts: TS,
    });
    expect(decision.effect).not.toBe("allow");
  });

  it("maps acquired → allow and reuses authorizationDecisionId as decisionId", () => {
    const decision = adaptCommercialRunGate({
      gate: {
        status: "acquired",
        authorizationDecisionId: "auth-42",
        runId: "run-2",
        tenantId: "tenant-a",
        actorId: "seat:s1",
        subjectId: "run-2",
      },
      ts: TS,
      uuid: () => UUID,
    });
    expect(decision).toMatchObject({
      effect: "allow",
      mode: "enforced",
      source: "commercial-run",
      decisionId: "auth-42",
      commercialAuthorizationId: "auth-42",
      tenantId: "tenant-a",
      actorId: "seat:s1",
      subject: { kind: "run", id: "run-2" },
    });
    expect(decision.decisionId).not.toMatch(/^gd-/);
    expect(decision.reason).toBeUndefined();
  });

  it("maps denied → deny with the gate message as reason", () => {
    const decision = adaptCommercialRunGate({
      gate: {
        status: "denied",
        message: "no capacity",
        authorizationDecisionId: "auth-deny",
        runId: "run-3",
      },
      ts: TS,
    });
    expect(decision).toMatchObject({
      effect: "deny",
      mode: "enforced",
      source: "commercial-run",
      reason: "no capacity",
      decisionId: "auth-deny",
    });
  });

  it("does not put auth logic imports in the adapter source", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "commercial-run-adapter.ts"),
      "utf8",
    );
    expect(source).not.toMatch(
      /authorizeCommercialRun|authorizeAgentInvocation|auditManagementDecision|resolveSecurityProfile|tryAcquireEnterpriseAgentRun/,
    );
    expect(source).not.toMatch(/fabric|constitutional-contracts|aor-core/i);
  });
});

describe("CommercialRunAdapter properties", () => {
  const statusArb = fc.constantFrom<CommercialRunGateStatus>("skipped", "acquired", "denied");

  it("source allow→allow, deny→deny; skipped never becomes allow", () => {
    fc.assert(
      fc.property(
        statusArb,
        fc.option(fc.string({ minLength: 1, maxLength: 24 }), { nil: undefined }),
        fc.option(fc.string({ minLength: 1, maxLength: 40 }), { nil: undefined }),
        (status, authId, message) => {
          const decision = adaptCommercialRunGate({
            gate: {
              status,
              ...(authId ? { authorizationDecisionId: authId } : {}),
              ...(status === "denied" ? { message: message ?? "denied" } : {}),
            },
            ts: TS,
            uuid: () => UUID,
          });
          if (status === "acquired") {
            expect(decision.effect).toBe("allow");
          } else if (status === "denied") {
            expect(decision.effect).toBe("deny");
          } else {
            expect(decision.effect).toBe("skipped");
            expect(decision.effect).not.toBe("allow");
            expect(decision.mode).toBe("legacy");
          }
          expect(decision.source).toBe("commercial-run");
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("recordCommercialRunDecision", () => {
  it("returns the envelope for a skipped gate", () => {
    const decision = recordCommercialRunDecision({
      gate: { status: "skipped", runId: "run-r" },
      ts: TS,
      uuid: () => UUID,
    });
    expect(decision).toMatchObject({
      effect: "skipped",
      mode: "legacy",
      source: "commercial-run",
      decisionId: `gd-${UUID}`,
      runId: "run-r",
    });
  });
});
