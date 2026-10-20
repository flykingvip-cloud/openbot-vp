import { describe, expect, it } from "vitest";
import type { ToolRequest } from "./contract.js";
import { decide, type PolicyInputs } from "./policy-runtime.js";

function req(toolName = "exec"): ToolRequest {
  return {
    id: "req-1",
    source: { type: "cursor", tenantId: "t1" },
    tool: { name: toolName },
    input: { args: ["echo", "hi"] },
    context: {},
    trace: { sessionId: "s1", correlationId: "c1" },
  };
}

const okScope: PolicyInputs["scope"] = { allowed: true };

describe("Policy Runtime — decide (compile-time single decision)", () => {
  it("ALLOW when scope ok and no constraints/approval", () => {
    const d = decide(req(), { scope: okScope });
    expect(d.decision).toBe("ALLOW");
    // trace records the scope stage.
    expect(d.decisionTrace.some((e) => e.stage === "scope.domain")).toBe(true);
  });

  it("DENY on missing scope, with locatable reason + deny trace", () => {
    const d = decide(req(), { scope: { allowed: false, missingScope: "operator.write" } });
    expect(d.decision).toBe("DENY");
    expect(d.decision === "DENY" && d.reason).toContain("operator.write");
    expect(d.decisionTrace.find((e) => e.stage === "scope.domain")?.effect).toBe("deny");
  });

  it("DENY on domain mismatch", () => {
    const d = decide(req(), {
      scope: { allowed: false, domainMismatch: true, requiredDomain: "platform" },
    });
    expect(d.decision === "DENY" && d.reason).toContain("platform");
  });

  it("DENY when approval required but unresolved (default-safe, R3.5)", () => {
    const d = decide(req(), { scope: okScope, approval: { requiresApproval: true } });
    expect(d.decision === "DENY" && d.reason).toBe("exec_approval_unresolved");
  });

  it("DENY when approval explicitly denied", () => {
    const d = decide(req(), {
      scope: okScope,
      approval: { requiresApproval: true, resolution: "deny" },
    });
    expect(d.decision === "DENY" && d.reason).toBe("exec_approval_denied");
  });

  it("ALLOW when approval required and resolved allow", () => {
    const d = decide(req(), {
      scope: okScope,
      approval: { requiresApproval: true, resolution: "allow" },
      allowlist: { applicable: true, analysisOk: true, satisfied: true },
    });
    expect(d.decision).toBe("ALLOW");
    expect(d.matchedRules).toContain("exec.approval");
    expect(d.matchedRules).toContain("exec.allowlist");
  });

  it("MODIFY when proposed constraints present", () => {
    const d = decide(req(), {
      scope: okScope,
      proposedConstraints: { timeoutMs: 5000 },
    });
    expect(d.decision).toBe("MODIFY");
    expect(d.decision === "MODIFY" && d.constraints.timeoutMs).toBe(5000);
  });

  it("MODIFY tightens to strict sandbox when risk crosses threshold", () => {
    const d = decide(req(), { scope: okScope, risk: { score: 9, threshold: 7 } });
    expect(d.decision).toBe("MODIFY");
    if (d.decision === "MODIFY") {
      expect(d.constraints.sandboxMode).toBe("strict");
      expect(d.constraints.allowNetwork).toBe(false);
    }
    expect(d.decisionTrace.find((e) => e.stage === "risk.score")?.effect).toBe("modify");
  });

  it("low risk does not tighten (stays ALLOW)", () => {
    const d = decide(req(), { scope: okScope, risk: { score: 2, threshold: 7 } });
    expect(d.decision).toBe("ALLOW");
  });

  it("records Loom attribution as informational (neutral), carries matchedRules", () => {
    const d = decide(req(), {
      scope: okScope,
      attribution: { owner: "kiro-fabric", taskId: "openbot-fabric", matchedRules: ["loom:r1"] },
    });
    expect(d.decision).toBe("ALLOW");
    expect(d.matchedRules).toContain("loom:r1");
    expect(d.decisionTrace.find((e) => e.stage === "loom.attribution")?.effect).toBe("neutral");
  });
});

describe("Policy Runtime — intent never affects the decision (Rule #1)", () => {
  it("identical inputs with differing request intent metadata yield identical decisions", () => {
    // intent is not a decide input at all; prove decision depends only on hard signals.
    const inputs: PolicyInputs = { scope: okScope, risk: { score: 8, threshold: 7 } };
    const a = decide(req("exec"), inputs);
    const b = decide(req("git"), inputs);
    expect(a.decision).toBe(b.decision);
    if (a.decision === "MODIFY" && b.decision === "MODIFY") {
      expect(a.constraints).toEqual(b.constraints);
    }
  });
});
