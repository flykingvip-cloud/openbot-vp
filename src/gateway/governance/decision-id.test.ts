import { describe, expect, it } from "vitest";
import {
  isGovernanceDecisionId,
  newGovernanceDecisionId,
  resolveGovernanceDecisionIds,
} from "./decision-id.js";

describe("governance decisionId rules", () => {
  it("mints gd- prefixed ids", () => {
    const id = newGovernanceDecisionId();
    expect(id.startsWith("gd-")).toBe(true);
    expect(isGovernanceDecisionId(id)).toBe(true);
    expect(isGovernanceDecisionId("auth-123")).toBe(false);
    expect(isGovernanceDecisionId("gd-")).toBe(false);
    expect(newGovernanceDecisionId()).not.toBe(id);
  });

  it("commercial-run reuses authorizationDecisionId as decisionId", () => {
    expect(
      resolveGovernanceDecisionIds({ source: "commercial-run", authorizationDecisionId: "auth-1" }),
    ).toEqual({ decisionId: "auth-1", commercialAuthorizationId: "auth-1" });
  });

  it("commercial-run without a commercial id mints a gd- id", () => {
    const ids = resolveGovernanceDecisionIds({ source: "commercial-run" });
    expect(isGovernanceDecisionId(ids.decisionId)).toBe(true);
    expect(ids.commercialAuthorizationId).toBeUndefined();
  });

  it("model envelope gets its own id and links the commercial id", () => {
    const commercial = resolveGovernanceDecisionIds({
      source: "commercial-run",
      authorizationDecisionId: "auth-42",
    });
    const model = resolveGovernanceDecisionIds({
      source: "model-entitlement",
      authorizationDecisionId: "auth-42",
    });
    expect(model.decisionId).not.toBe(commercial.decisionId);
    expect(isGovernanceDecisionId(model.decisionId)).toBe(true);
    expect(model.commercialAuthorizationId).toBe(commercial.commercialAuthorizationId);
    expect(model.commercialAuthorizationId).toBe("auth-42");
  });

  it.each(["agent-invocation", "access-control", "node", "capability", "other"] as const)(
    "%s gets a fresh gd- id",
    (source) => {
      const ids = resolveGovernanceDecisionIds({ source, uuid: () => "fixed" });
      expect(ids).toEqual({ decisionId: "gd-fixed" });
    },
  );
});
