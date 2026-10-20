import { describe, expect, it } from "vitest";
import type { ToolRequest } from "./contract.js";
import {
  buildExecPolicyInputs,
  createProbeDecideFor,
  type ResolvedExecApprovals,
} from "./probes.js";

function toolNode(name: string, args: string[]) {
  const request: ToolRequest = {
    id: "n1",
    source: { type: "cursor" },
    tool: { name },
    input: { args },
    context: {},
    trace: { sessionId: "s1", correlationId: "c1" },
  };
  return { id: "n1", type: "tool" as const, request, dependsOn: [], status: "pending" as const };
}

// `full` security ⇒ requiresExecApproval=false ⇒ ALLOW (deterministic, no PATH dep).
const fullApprovals: ResolvedExecApprovals = { ask: "off", security: "full", allowlist: [] };
// `allowlist` security + empty allowlist + on-miss ⇒ approval required ⇒ DENY.
const lockedApprovals: ResolvedExecApprovals = {
  ask: "on-miss",
  security: "allowlist",
  allowlist: [],
};

describe("probes — buildExecPolicyInputs (real requiresExecApproval integration)", () => {
  it("full security → no approval required (will ALLOW)", () => {
    const inputs = buildExecPolicyInputs(
      "git status",
      {},
      { resolveApprovals: () => fullApprovals },
    );
    expect(inputs.allowlist?.applicable).toBe(true);
    expect(inputs.approval).toBeUndefined();
  });

  it("allowlist security + empty allowlist → approval required (will DENY)", () => {
    const inputs = buildExecPolicyInputs(
      "rm -rf /",
      {},
      { resolveApprovals: () => lockedApprovals },
    );
    expect(inputs.allowlist?.satisfied).toBe(false);
    expect(inputs.approval?.requiresApproval).toBe(true);
  });
});

describe("probes — createProbeDecideFor (real verdicts, not blanket DENY)", () => {
  it("exec under full security → ALLOW", () => {
    const decideFor = createProbeDecideFor({ resolveApprovals: () => fullApprovals });
    expect(decideFor(toolNode("exec", ["git", "status"])).decision).toBe("ALLOW");
  });

  it("exec under locked allowlist → DENY (real allowlist miss)", () => {
    const decideFor = createProbeDecideFor({ resolveApprovals: () => lockedApprovals });
    expect(decideFor(toolNode("exec", ["rm", "-rf", "/"])).decision).toBe("DENY");
  });

  it("non-exec tool → ALLOW (method scope already authorized upstream)", () => {
    const decideFor = createProbeDecideFor({ resolveApprovals: () => lockedApprovals });
    expect(decideFor(toolNode("apply_patch", [])).decision).toBe("ALLOW");
  });

  it("exec decision carries an exec.allowlist trace stage", () => {
    const decideFor = createProbeDecideFor({ resolveApprovals: () => fullApprovals });
    const d = decideFor(toolNode("exec", ["git", "status"]));
    expect(d.decisionTrace.some((e) => e.stage === "exec.allowlist")).toBe(true);
  });
});

describe("probes — Stage-2 Loom attribution wiring (neutral, decision-invariant / D3)", () => {
  it("injected attributionFor adds a neutral loom.attribution trace entry", () => {
    const decideFor = createProbeDecideFor(
      { resolveApprovals: () => fullApprovals },
      {
        attributionFor: () => ({
          owner: "kiro-fabric",
          taskId: "openbot-fabric",
          matchedRules: ["loom:r1"],
        }),
      },
    );
    const d = decideFor(toolNode("exec", ["git", "status"]));
    const loom = d.decisionTrace.find((e) => e.stage === "loom.attribution");
    expect(loom?.effect).toBe("neutral");
    expect(d.decision === "ALLOW" && d.matchedRules).toContain("loom:r1");
  });

  it("D3: attribution does not change the decision (ALLOW stays ALLOW)", () => {
    const without = createProbeDecideFor({ resolveApprovals: () => fullApprovals });
    const withAttr = createProbeDecideFor(
      { resolveApprovals: () => fullApprovals },
      { attributionFor: () => ({ owner: "kiro-fabric", matchedRules: ["loom:r1"] }) },
    );
    const node = toolNode("exec", ["git", "status"]);
    expect(without(node).decision).toBe("ALLOW");
    expect(withAttr(node).decision).toBe("ALLOW");
  });

  it("D3: attribution cannot rescue a denied exec (locked allowlist stays DENY)", () => {
    const decideFor = createProbeDecideFor(
      { resolveApprovals: () => lockedApprovals },
      { attributionFor: () => ({ owner: "kiro-fabric", matchedRules: ["loom:r1"] }) },
    );
    expect(decideFor(toolNode("exec", ["rm", "-rf", "/"])).decision).toBe("DENY");
  });

  it("attaches attribution to non-exec tool nodes too", () => {
    const decideFor = createProbeDecideFor(
      { resolveApprovals: () => fullApprovals },
      { attributionFor: () => ({ owner: "kiro-fabric" }) },
    );
    const d = decideFor(toolNode("apply_patch", []));
    expect(d.decisionTrace.some((e) => e.stage === "loom.attribution")).toBe(true);
  });
});
