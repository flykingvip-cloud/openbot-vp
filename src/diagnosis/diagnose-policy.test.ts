import { vi } from "vitest";
import { describe, expect, it } from "vitest";
import {
  DIAGNOSIS_ALL_TARGET_CAP,
  budgetForEnterpriseMode,
  parseDiagnoseRequest,
  planDiagnosisDaibaiDelivery,
} from "./diagnose-policy.js";
import { DIAGNOSIS_DAIBAI_DELIVERY_ENABLED } from "./production-cutover.js";

describe("enterprise diagnose policy", () => {
  it("defaults to 24h TARGETED, rejects year-long windows, and caps all-scope locators", () => {
    const parsed = parseDiagnoseRequest({
      scope: "all",
      window: "1y",
      mode: "QUICK",
      targets: Array.from({ length: 12 }, (_, index) => ({
        agentId: `agent-${index}`,
        sessionKey: `agent:agent-${index}:main`,
      })),
    });
    expect(parsed.windowId).toBe("24h");
    expect(parsed.windowMs).toBe(24 * 60 * 60 * 1000);
    expect(parsed.baselineMs).toBe(4 * parsed.windowMs);
    expect(parsed.mode).toBe("TARGETED");
    expect(parsed.locators).toHaveLength(DIAGNOSIS_ALL_TARGET_CAP);
    expect(parsed.requestedCount).toBe(12);
    expect(parsed.skipped).toBe(4);
    expect(budgetForEnterpriseMode("FULL").maxDiagnosers).toBe(6);
  });

  it("resolves agent-only and group locators so Da Bai can diagnose others", () => {
    expect(parseDiagnoseRequest({ agentId: "sales" }).locators).toEqual([
      { agentId: "sales", sessionKey: "agent:sales:main", runId: null },
    ]);
    expect(parseDiagnoseRequest({ groupId: "g1", agentId: "ops" }).locators).toEqual([
      { agentId: "ops", sessionKey: "agent:ops:space:g1", runId: null },
    ]);
  });

  it("keeps Da Bai delivery fail-closed even when both audiences are requested", () => {
    const plan = planDiagnosisDaibaiDelivery({ enterpriseAdmin: true, owners: true });
    expect(plan.delivered).toBe(false);
    expect(plan.reason).toBe("daibai_delivery_gate_closed");
    expect(plan.routes).toEqual(["enterprise", "employee"]);
    expect(DIAGNOSIS_DAIBAI_DELIVERY_ENABLED).toBe(true);
  });
});

// These historical cutover / functional rehearsals explicitly opt into writes
// against injected local ports. Default-closed behavior is covered separately
// in write-policy.test.ts; this is not production enablement.
vi.mock("./write-policy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./write-policy.js")>();
  return {
    ...actual,
    DIAGNOSIS_WRITE_POLICY: {
      selfEvolutionConfirm: true,
      conversationDelivery: true,
      daibaiDelivery: true,
    },
  };
});
