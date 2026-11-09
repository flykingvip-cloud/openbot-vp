import { describe, expect, it } from "vitest";
import {
  buildSupplementDenialDiagnosis,
  resolveSupplementFirstRejectReason,
} from "./supplement-denial-diagnosis.js";

describe("supplement-denial-diagnosis (pure)", () => {
  it("orders firstRejectReason by real structural evaluation", () => {
    expect(
      resolveSupplementFirstRejectReason({
        primaryCompleted: false,
        primaryBudgetClosed: true,
        primaryMode: "single",
        supplementEnabled: true,
        responseMode: "open",
        edgeTargetCount: 1,
        supplementStructurallyAllowed: false,
      }),
    ).toBe("primary_not_completed");
    expect(
      resolveSupplementFirstRejectReason({
        primaryCompleted: true,
        primaryBudgetClosed: true,
        primaryMode: "single",
        supplementEnabled: true,
        responseMode: "open",
        edgeTargetCount: 1,
        supplementStructurallyAllowed: false,
      }),
    ).toBe("primary_budget_closed");
    expect(
      resolveSupplementFirstRejectReason({
        primaryCompleted: true,
        primaryBudgetClosed: false,
        primaryMode: "explicit_multi",
        supplementEnabled: true,
        responseMode: "open",
        edgeTargetCount: 1,
        supplementStructurallyAllowed: false,
      }),
    ).toBe("explicit_multi");
    expect(
      resolveSupplementFirstRejectReason({
        primaryCompleted: true,
        primaryBudgetClosed: false,
        primaryMode: "single",
        supplementEnabled: false,
        responseMode: "open",
        edgeTargetCount: 1,
        supplementStructurallyAllowed: false,
      }),
    ).toBe("supplement_disabled");
    expect(
      resolveSupplementFirstRejectReason({
        primaryCompleted: true,
        primaryBudgetClosed: false,
        primaryMode: "single",
        supplementEnabled: true,
        responseMode: "single_owner",
        edgeTargetCount: 0,
        supplementStructurallyAllowed: false,
      }),
    ).toBe("single_owner_without_edges");
  });

  it("peer_ask + budget closed → not dispatched this round, no deferred lie", () => {
    const d = buildSupplementDenialDiagnosis({
      roundId: "r1",
      structuralGate: {
        primaryCompleted: true,
        primaryBudgetClosed: true,
        primaryMode: "single",
        supplementEnabled: true,
        responseMode: "open",
        edgeTargetCount: 1,
        supplementStructurallyAllowed: false,
      },
      windowOpened: false,
      windowReason: "not_allowed",
      edges: [
        {
          toAgentId: "bot-exec",
          kind: "peer_ask",
          dispatched: false,
          rejectReason: "deferred",
        },
      ],
      formalTask: { attempted: false, status: "not_attempted", taskId: null },
    });
    expect(d.firstRejectReason).toBe("primary_budget_closed");
    expect(d.userVisibleSummary).toBe("本轮补充未派发");
    expect(d.edges[0]?.rejectReason).toBe("not_dispatched_this_round");
    expect(d.edges[0]?.rejectReason).not.toBe("deferred");
  });

  it("legacy-compatible: diagnosis optional; builder still works with minimal fields", () => {
    const d = buildSupplementDenialDiagnosis({
      roundId: "legacy-round",
      structuralGate: {
        primaryCompleted: true,
        primaryBudgetClosed: false,
        primaryMode: "single",
        supplementEnabled: true,
        responseMode: "open",
        edgeTargetCount: 0,
        supplementStructurallyAllowed: true,
      },
      windowOpened: false,
      windowReason: "no_conclusion",
    });
    expect(d.firstRejectReason).toBe("no_conclusion");
    expect(d.structureOutcome).toBe("passed_without_window");
  });
});

it("a settled late primary preserves only an explicitly admitted continuation", () => {
  const gate = {
    primaryCompleted: true,
    primaryBudgetClosed: true,
    invitedContinuation: true,
    primaryMode: "single",
    supplementEnabled: true,
    responseMode: "lead_plus_supplement",
    edgeTargetCount: 0,
    supplementStructurallyAllowed: true,
  };
  expect(resolveSupplementFirstRejectReason(gate)).toBeNull();
  expect(resolveSupplementFirstRejectReason({ ...gate, primaryCompleted: false })).toBe(
    "primary_not_completed",
  );
  expect(resolveSupplementFirstRejectReason({ ...gate, supplementEnabled: false })).toBe(
    "supplement_disabled",
  );
});
