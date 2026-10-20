import { describe, expect, it } from "vitest";
import {
  evaluatePolicy,
  loadExamplePolicy,
  normalizePolicyDecision,
  parseToolkitPolicy,
  type PolicyFacts,
} from "./policy.js";

function facts(
  partial: Partial<PolicyFacts> & Pick<PolicyFacts, "toolId" | "operation">,
): PolicyFacts {
  return {
    risk: "low",
    sideEffects: false,
    destructive: false,
    credentialAccess: false,
    withinWorkspace: false,
    scopedCredentialAccess: false,
    ...partial,
  };
}

describe("toolkit policy evaluator", () => {
  const policy = loadExamplePolicy();

  it("parses policy.example.json", () => {
    expect(policy.default).toBe("deny");
    expect(policy.rules.length).toBeGreaterThanOrEqual(5);
    expect(policy.limits?.approvalTtlSeconds).toBe(300);
  });

  it("allow: low risk without side effects", () => {
    const evaluation = evaluatePolicy(
      policy,
      facts({ toolId: "web", operation: "search", risk: "low", sideEffects: false }),
    );
    expect(evaluation.decision).toBe("allow");
    expect(evaluation.matchedRuleIndex).toBe(0);
  });

  it("allow-with-receipt: workspace write within workspace", () => {
    const evaluation = evaluatePolicy(
      policy,
      facts({
        toolId: "workspace",
        operation: "write",
        risk: "medium",
        sideEffects: true,
        withinWorkspace: true,
      }),
    );
    expect(evaluation.decision).toBe("allow-with-receipt");
    expect(evaluation.rawDecision).toBe("allow-with-receipt");
  });

  it("require-approval: high risk with side effects", () => {
    const evaluation = evaluatePolicy(
      policy,
      facts({
        toolId: "shell",
        operation: "exec",
        risk: "high",
        sideEffects: true,
      }),
    );
    expect(evaluation.decision).toBe("require-approval");
    expect(evaluation.requiresExplicitApproval).toBe(false);
  });

  it("require-approval: destructive maps to explicit approval", () => {
    const evaluation = evaluatePolicy(
      policy,
      facts({
        toolId: "workspace",
        operation: "write",
        risk: "medium",
        sideEffects: true,
        destructive: true,
        withinWorkspace: false,
      }),
    );
    expect(evaluation.decision).toBe("require-approval");
    expect(evaluation.rawDecision).toBe("require-explicit-approval");
    expect(evaluation.requiresExplicitApproval).toBe(true);
  });

  it("deny: credential access without scope", () => {
    const evaluation = evaluatePolicy(
      policy,
      facts({
        toolId: "mcp-connectors",
        operation: "call-tool",
        risk: "medium",
        sideEffects: false,
        credentialAccess: true,
      }),
    );
    expect(evaluation.decision).toBe("deny");
    expect(evaluation.rawDecision).toBe("deny-unless-scoped");
  });

  it("allow-with-receipt: credential access when scoped", () => {
    const evaluation = evaluatePolicy(
      policy,
      facts({
        toolId: "mcp-connectors",
        operation: "call-tool",
        risk: "medium",
        sideEffects: false,
        credentialAccess: true,
        scopedCredentialAccess: true,
      }),
    );
    expect(evaluation.decision).toBe("allow-with-receipt");
  });

  it("deny: default when no rule matches", () => {
    const evaluation = evaluatePolicy(
      policy,
      facts({
        toolId: "visualization",
        operation: "render",
        risk: "medium",
        sideEffects: true,
      }),
    );
    expect(evaluation.decision).toBe("deny");
    expect(evaluation.matchedRuleIndex).toBe(-1);
  });

  it("rejects invalid policy documents", () => {
    expect(() => parseToolkitPolicy({})).toThrow(/default/);
  });

  it("normalizes deny-unless-scoped based on scopedCredentialAccess", () => {
    expect(
      normalizePolicyDecision(
        "deny-unless-scoped",
        facts({ toolId: "x", operation: "y", credentialAccess: true }),
      ),
    ).toEqual({ decision: "deny", requiresExplicitApproval: false });
    expect(
      normalizePolicyDecision(
        "deny-unless-scoped",
        facts({
          toolId: "x",
          operation: "y",
          credentialAccess: true,
          scopedCredentialAccess: true,
        }),
      ),
    ).toEqual({ decision: "allow-with-receipt", requiresExplicitApproval: false });
  });
});
