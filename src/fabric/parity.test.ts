/**
 * parity.test.ts — zero-regression evidence for Fabric integration (R13.2/3/4, R19.2).
 *
 * Fabric is an additive, feature-gated surface: it must not weaken any existing
 * enforcement, and it must never auto-mutate policy. These tests are the
 * security evidence that "feature off/on" does not change existing decisions and
 * that Fabric's own default is fail-closed.
 */
import { afterEach, describe, expect, it } from "vitest";
import { getFabricService, setFabricServiceProvider } from "../gateway/server-methods/fabric.js";
import { requiresExecApproval } from "../infra/exec-approvals.js";
import { buildExecutionRecord } from "./audit.js";
import type { ToolRequest } from "./contract.js";
import { FABRIC_ENABLED_ENV } from "./feature.js";
import { deriveFeedback } from "./feedback.js";

afterEach(() => {
  setFabricServiceProvider(null);
  delete process.env[FABRIC_ENABLED_ENV];
});

describe("parity — existing exec-approval gate is independent of the Fabric flag", () => {
  it("requiresExecApproval yields identical results with Fabric off vs on", () => {
    const cases = [
      { ask: "on-miss", security: "allowlist", analysisOk: false, allowlistSatisfied: false },
      { ask: "on-miss", security: "allowlist", analysisOk: true, allowlistSatisfied: true },
      { ask: "always", security: "full", analysisOk: true, allowlistSatisfied: true },
      { ask: "off", security: "full", analysisOk: true, allowlistSatisfied: false },
    ] as const;

    delete process.env[FABRIC_ENABLED_ENV];
    const off = cases.map((c) => requiresExecApproval(c));
    process.env[FABRIC_ENABLED_ENV] = "1";
    const on = cases.map((c) => requiresExecApproval(c));

    expect(on).toEqual(off); // Fabric never alters the existing gate's verdicts.
  });
});

describe("parity — Fabric default service is fail-closed (no weakening)", () => {
  function execReq(): ToolRequest {
    return {
      id: "req-1",
      source: { type: "cursor" },
      tool: { name: "exec" },
      input: { args: ["rm", "-rf", "/"] },
      context: {},
      trace: { sessionId: "s1", correlationId: "c1" },
    };
  }

  it("enabling Fabric does NOT open an unguarded exec path (exec → denied)", async () => {
    setFabricServiceProvider(null);
    process.env[FABRIC_ENABLED_ENV] = "1";
    const service = getFabricService();
    expect(service).not.toBeNull();
    const { result } = await service!.execute(execReq());
    // Default decide marks exec-class as approval-required + unresolved → DENY.
    expect(result.status).toBe("denied");
  });

  it("dry-run check on exec is DENY under the fail-closed default", () => {
    setFabricServiceProvider(null);
    process.env[FABRIC_ENABLED_ENV] = "1";
    expect(getFabricService()!.check(execReq()).decision).toBe("DENY");
  });
});

describe("parity — feedback never auto-mutates policy (R19.2)", () => {
  it("all derived signals are proposals (autoApplied === false)", () => {
    const records = Array.from({ length: 3 }, (_, i) =>
      buildExecutionRecord({
        request: {
          id: `r${i}`,
          source: { type: "cursor" },
          tool: { name: "git" },
          input: {},
          context: {},
          trace: { sessionId: "s1", correlationId: `c${i}` },
        },
        decision: { decision: "ALLOW", matchedRules: [], decisionTrace: [] },
        result: {
          id: `r${i}`,
          status: "failed",
          timing: { start: 1, end: 2 },
          trace: { policyDecisionId: `r${i}`, executionId: `e${i}` },
        },
      }),
    );
    const signals = deriveFeedback(records);
    expect(signals.length).toBeGreaterThan(0);
    for (const s of signals) {
      expect(s.autoApplied).toBe(false);
    }
  });
});
