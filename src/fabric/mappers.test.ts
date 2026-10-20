import type { AorAuditRecord } from "@openbot/aor-core";
import { describe, expect, it } from "vitest";
import type { PolicyDecision } from "./contract.js";
import {
  attributionToOwnership,
  attributionTraceEntry,
  constraintsFromDecision,
  fromAorAuditRecord,
  tenantContextFromSource,
} from "./mappers.js";

describe("mappers — constraintsFromDecision", () => {
  it("returns constraints for MODIFY", () => {
    const d: PolicyDecision = {
      decision: "MODIFY",
      constraints: { sandboxMode: "strict" },
      matchedRules: [],
      decisionTrace: [],
    };
    expect(constraintsFromDecision(d)).toEqual({ sandboxMode: "strict" });
  });

  it("returns optional constraints for ALLOW, undefined when absent", () => {
    expect(
      constraintsFromDecision({ decision: "ALLOW", matchedRules: [], decisionTrace: [] }),
    ).toBeUndefined();
    expect(
      constraintsFromDecision({
        decision: "ALLOW",
        constraints: { timeoutMs: 1000 },
        matchedRules: [],
        decisionTrace: [],
      }),
    ).toEqual({ timeoutMs: 1000 });
  });

  it("returns undefined for DENY (never runs)", () => {
    expect(
      constraintsFromDecision({
        decision: "DENY",
        reason: "blocked",
        matchedRules: [],
        decisionTrace: [],
      }),
    ).toBeUndefined();
  });
});

describe("mappers — tenantContextFromSource", () => {
  it("maps userId/tenantId; omits absent fields (single-tenant degrade)", () => {
    expect(tenantContextFromSource({ type: "cursor", userId: "u1", tenantId: "t1" })).toEqual({
      userId: "u1",
      tenantId: "t1",
    });
    expect(tenantContextFromSource({ type: "cursor" })).toEqual({});
  });
});

describe("mappers — Loom attribution (compile-time → metadata)", () => {
  it("projects ownership metadata with conflict/unattributed defaults", () => {
    expect(attributionToOwnership({ owner: "kiro-fabric", taskId: "openbot-fabric" })).toEqual({
      owner: "kiro-fabric",
      agent: undefined,
      taskId: "openbot-fabric",
      conflict: false,
      unattributed: false,
    });
  });

  it("attribution trace entry is informational (effect neutral), never deciding", () => {
    const entry = attributionTraceEntry({ owner: "kiro-fabric", taskId: "t" });
    expect(entry.stage).toBe("loom.attribution");
    expect(entry.effect).toBe("neutral");
    expect(entry.hit).toBe(true);

    const unattr = attributionTraceEntry({ unattributed: true });
    expect(unattr.hit).toBe(false);
    expect(unattr.detail).toContain("unattributed");
  });
});

describe("mappers — fromAorAuditRecord (narrow projection, no leak)", () => {
  it("projects only the Fabric-surfaced fields", () => {
    const record: AorAuditRecord = {
      runId: "run-1",
      occurredAt: "2026-06-15T00:00:00.000Z",
      taskType: "summarize",
      goal: "secret goal text",
      strategy: "balanced",
      selection: { model: "anthropic/claude", reason: "best", score: 0.9, estimatedCostUsd: 0.01 },
      totalTokens: 1234,
      totalCostUsd: 0.02,
      latencyMs: 500,
      stepCount: 1,
    };
    const view = fromAorAuditRecord(record);
    expect(view).toEqual({
      runId: "run-1",
      occurredAt: "2026-06-15T00:00:00.000Z",
      model: "anthropic/claude",
      totalTokens: 1234,
      costUsd: 0.02,
      latencyMs: 500,
    });
    // No leak: AOR-internal fields are not surfaced.
    expect(view).not.toHaveProperty("goal");
    expect(view).not.toHaveProperty("strategy");
    expect(view).not.toHaveProperty("selection");
    expect(view).not.toHaveProperty("stepCount");
  });
});
