import { describe, expect, it, vi } from "vitest";
import type { ToolExecutionResult, ToolRequest } from "./contract.js";
import { buildUsage, exceedsCostLimit, reportUsage, type UsageIngestPort } from "./cost.js";

function req(): ToolRequest {
  return {
    id: "req-1",
    source: { type: "openbot", userId: "u1", tenantId: "t1" },
    tool: { name: "agent:summarize" },
    input: {},
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

describe("cost — exceedsCostLimit (R11.2)", () => {
  it("over when estimate >= limit", () => {
    expect(exceedsCostLimit({ costLimit: 1 }, 1)).toBe(true);
    expect(exceedsCostLimit({ costLimit: 1 }, 1.5)).toBe(true);
  });
  it("under when estimate < limit", () => {
    expect(exceedsCostLimit({ costLimit: 1 }, 0.5)).toBe(false);
  });
  it("no limit ⇒ never over", () => {
    expect(exceedsCostLimit({}, 999)).toBe(false);
    expect(exceedsCostLimit(undefined, 999)).toBe(false);
  });
});

describe("cost — buildUsage", () => {
  it("captures correlation/tenant/user/tool/cost", () => {
    const usage = buildUsage(req(), execResult(), 0.42, "2026-06-15T00:00:00.000Z");
    expect(usage).toEqual({
      correlationId: "c1",
      sessionId: "s1",
      tenantId: "t1",
      userId: "u1",
      tool: "agent:summarize",
      costUsd: 0.42,
      occurredAt: "2026-06-15T00:00:00.000Z",
    });
  });
});

describe("cost — reportUsage (best-effort, reuses ingest port)", () => {
  it("ingests via the port", async () => {
    const ingest = vi.fn();
    const port: UsageIngestPort = { ingest };
    const usage = buildUsage(req(), execResult(), 0.1);
    const out = await reportUsage(port, usage);
    expect(out.ok).toBe(true);
    expect(ingest).toHaveBeenCalledWith(usage);
  });

  it("never throws on ingest failure (cost reporting must not break a run)", async () => {
    const port: UsageIngestPort = {
      ingest: () => {
        throw new Error("billing down");
      },
    };
    const out = await reportUsage(port, buildUsage(req(), execResult(), 0.1));
    expect(out.ok).toBe(false);
    expect(out.error).toBe("billing down");
  });
});
