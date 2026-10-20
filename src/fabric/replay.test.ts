import { describe, expect, it } from "vitest";
import { buildExecutionRecord, type FabricExecutionRecord } from "./audit.js";
import type { PolicyDecision, ToolExecutionResult, ToolRequest } from "./contract.js";
import { decide, type PolicyInputs } from "./policy-runtime.js";
import { decisionsEqual, dryRunDiff, isRelaxation, replayDecision } from "./replay.js";

function req(): ToolRequest {
  return {
    id: "req-1",
    source: { type: "cursor" },
    tool: { name: "exec" },
    input: { args: ["echo"] },
    context: {},
    trace: { sessionId: "s1", correlationId: "c1" },
  };
}

function execResult(): ToolExecutionResult {
  return {
    id: "req-1",
    status: "success",
    timing: { start: 1, end: 2 },
    trace: { policyDecisionId: "req-1", executionId: "e1" },
  };
}

function recordWith(inputs: PolicyInputs): FabricExecutionRecord {
  const decision = decide(req(), inputs);
  return buildExecutionRecord({
    request: req(),
    decision,
    result: execResult(),
    policyInputs: inputs,
  });
}

describe("replay — decisionsEqual", () => {
  it("compares decision kind, reason, and constraints", () => {
    const allow: PolicyDecision = { decision: "ALLOW", matchedRules: [], decisionTrace: [] };
    expect(decisionsEqual(allow, { ...allow })).toBe(true);
    const denyA: PolicyDecision = {
      decision: "DENY",
      reason: "a",
      matchedRules: [],
      decisionTrace: [],
    };
    const denyB: PolicyDecision = {
      decision: "DENY",
      reason: "b",
      matchedRules: [],
      decisionTrace: [],
    };
    expect(decisionsEqual(denyA, denyB)).toBe(false);
  });
});

describe("replay — replayDecision (R17.1)", () => {
  it("re-runs decision deterministically and matches the original", () => {
    const rec = recordWith({ scope: { allowed: true }, risk: { score: 9, threshold: 7 } });
    const res = replayDecision(rec);
    expect(res.matches).toBe(true);
    expect(res.replayed.decision).toBe("MODIFY");
  });

  it("throws when a record has no stored policy inputs", () => {
    const rec = buildExecutionRecord({
      request: req(),
      decision: { decision: "ALLOW", matchedRules: [], decisionTrace: [] },
      result: execResult(),
    });
    expect(() => replayDecision(rec)).toThrow();
  });
});

describe("replay — isRelaxation", () => {
  it("DENY → non-DENY is a relaxation", () => {
    const deny: PolicyDecision = {
      decision: "DENY",
      reason: "x",
      matchedRules: [],
      decisionTrace: [],
    };
    const allow: PolicyDecision = { decision: "ALLOW", matchedRules: [], decisionTrace: [] };
    expect(isRelaxation(deny, allow)).toBe(true);
  });

  it("weakening sandbox (strict→none) is a relaxation", () => {
    const strict: PolicyDecision = {
      decision: "MODIFY",
      constraints: { sandboxMode: "strict" },
      matchedRules: [],
      decisionTrace: [],
    };
    const none: PolicyDecision = {
      decision: "MODIFY",
      constraints: { sandboxMode: "none" },
      matchedRules: [],
      decisionTrace: [],
    };
    expect(isRelaxation(strict, none)).toBe(true);
    expect(isRelaxation(none, strict)).toBe(false); // tightening is not relaxation
  });

  it("re-enabling network is a relaxation", () => {
    const off: PolicyDecision = {
      decision: "MODIFY",
      constraints: { allowNetwork: false },
      matchedRules: [],
      decisionTrace: [],
    };
    const on: PolicyDecision = {
      decision: "MODIFY",
      constraints: { allowNetwork: true },
      matchedRules: [],
      decisionTrace: [],
    };
    expect(isRelaxation(off, on)).toBe(true);
  });
});

describe("replay — D3: Loom signal is neutral (decision invariant, trace differs)", () => {
  it("identical request with vs without attribution → equal decision, different decisionTrace", () => {
    const without = decide(req(), { scope: { allowed: true } });
    const withAttr = decide(req(), {
      scope: { allowed: true },
      attribution: { owner: "kiro-fabric", taskId: "openbot-fabric", matchedRules: ["loom:r1"] },
    });
    // D3 core: a Loom signal must NEVER, by itself, flip ALLOW<->DENY<->MODIFY.
    expect(decisionsEqual(without, withAttr)).toBe(true);
    // It may differ ONLY in the explainability trace, and that entry is neutral.
    const loomEntry = withAttr.decisionTrace.find((e) => e.stage === "loom.attribution");
    expect(loomEntry?.effect).toBe("neutral");
    expect(without.decisionTrace.find((e) => e.stage === "loom.attribution")).toBeUndefined();
    // matchedRules may carry the loom rule id (metadata), but it is not a decider.
    expect(withAttr.decision === "ALLOW" && withAttr.matchedRules).toContain("loom:r1");
  });

  it("attribution cannot rescue a denied request (no DENY→ALLOW via Loom)", () => {
    const scope = { allowed: false, missingScope: "operator.write" };
    const deniedNoLoom = decide(req(), { scope });
    const deniedWithLoom = decide(req(), {
      scope,
      attribution: { owner: "kiro-fabric", matchedRules: ["loom:r1"] },
    });
    expect(deniedNoLoom.decision).toBe("DENY");
    expect(deniedWithLoom.decision).toBe("DENY");
    expect(decisionsEqual(deniedNoLoom, deniedWithLoom)).toBe(true);
  });

  it("unattributed signal is also neutral (decision unchanged vs no signal)", () => {
    const without = decide(req(), { scope: { allowed: true } });
    const withUnattr = decide(req(), {
      scope: { allowed: true },
      attribution: { unattributed: true },
    });
    expect(decisionsEqual(without, withUnattr)).toBe(true);
    expect(withUnattr.decisionTrace.find((e) => e.stage === "loom.attribution")?.effect).toBe(
      "neutral",
    );
  });
});

describe("replay — dryRunDiff (R17.2/17.3/17.4)", () => {
  it("flags a candidate that relaxes an existing denial", () => {
    // original: scope denied → DENY. candidate: force scope allowed → ALLOW (relaxation).
    const denied = recordWith({ scope: { allowed: false, missingScope: "operator.write" } });
    const diff = dryRunDiff([denied], (inputs) => ({ ...inputs, scope: { allowed: true } }));
    expect(diff.entries[0]?.changed).toBe(true);
    expect(diff.entries[0]?.relaxation).toBe(true);
    expect(diff.relaxationCount).toBe(1);
  });

  it("identical candidate yields no change, no relaxation", () => {
    const rec = recordWith({ scope: { allowed: true } });
    const diff = dryRunDiff([rec], (inputs) => inputs);
    expect(diff.entries[0]?.changed).toBe(false);
    expect(diff.relaxationCount).toBe(0);
  });
});
