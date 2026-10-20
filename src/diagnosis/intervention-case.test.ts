import { describe, expect, it } from "vitest";
import {
  canTransitionInterventionCase,
  newInterventionCaseId,
  transitionInterventionCase,
  type InterventionCase,
} from "./intervention-case.js";

function base(partial: Partial<InterventionCase> = {}): InterventionCase {
  return {
    schemaVersion: 1,
    caseId: newInterventionCaseId("t1"),
    tenantId: "tenant-a",
    status: "suggested",
    actionKind: "identity",
    title: "补身份字段",
    actor: "owner",
    source: {
      actionId: "act:identity:bot-1",
      growthAgentId: "bot-1",
      growthGroupId: null,
    },
    target: {
      kind: "agent_1to1",
      agentId: "bot-1",
      sessionKey: "agent:bot-1:main",
    },
    createdAt: "2026-10-14T00:00:00.000Z",
    updatedAt: "2026-10-14T00:00:00.000Z",
    ...partial,
  };
}

describe("InterventionCase status machine", () => {
  it("allows suggested → queued|expanding|blocked|cancelled", () => {
    expect(canTransitionInterventionCase("suggested", "queued")).toBe(true);
    expect(canTransitionInterventionCase("suggested", "expanding")).toBe(true);
    expect(canTransitionInterventionCase("suggested", "blocked")).toBe(true);
    expect(canTransitionInterventionCase("suggested", "cancelled")).toBe(true);
  });

  it("rejects closed → dispatched and other illegal migrations", () => {
    const closed = base({ status: "closed" });
    expect(transitionInterventionCase(closed, "dispatched")).toEqual({
      ok: false,
      reason: "terminal",
    });
    expect(canTransitionInterventionCase("queued", "receipted")).toBe(false);
    expect(canTransitionInterventionCase("receipted", "verified")).toBe(false);
  });

  it("forbids group_parent entering dispatching without expand path", () => {
    const parent = base({
      status: "queued",
      target: { kind: "group_parent", agentId: null, sessionKey: null },
      source: {
        actionId: "act:memory:grp",
        growthAgentId: null,
        growthGroupId: "grp-1",
      },
    });
    expect(transitionInterventionCase(parent, "dispatching")).toEqual({
      ok: false,
      reason: "parent_dispatch_forbidden",
    });
  });

  it("reserves verified (no inbound M2 transition)", () => {
    expect(canTransitionInterventionCase("receipted", "verified")).toBe(false);
    expect(canTransitionInterventionCase("closed", "verified")).toBe(false);
    const receipted = base({ status: "receipted" });
    expect(transitionInterventionCase(receipted, "closed").ok).toBe(true);
  });
});
