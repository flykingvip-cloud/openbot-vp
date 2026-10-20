// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GovernanceDecision, RunGovernanceSnapshot } from "./decision.js";

const { appendMock } = vi.hoisted(() => ({ appendMock: vi.fn() }));
vi.mock("./shadow-sink.js", () => ({ appendGovernanceShadowDecision: appendMock }));

const {
  MISSING_PARENT_AUTHORIZATION_REASON,
  SUBAGENT_BILLING_CONTEXT_ABSENT_REASON,
  SUBAGENT_USAGE_NOT_BILLED_REASON,
  buildSubagentUsageAttributionDecision,
  recordSubagentUsageAttributionShadow,
} = await import("./subagent-usage-shadow.js");

const USAGE = { input: 12, output: 3 };

function childSnapshot(overrides: Partial<RunGovernanceSnapshot> = {}): RunGovernanceSnapshot {
  return {
    snapshotId: "gd-parent-snapshot",
    runId: "parent-run",
    parentRunId: "parent-run",
    governanceMode: "shadow",
    decisions: [],
    effectiveModelSet: { allowlist: ["openai/gpt-5.2"] },
    commercialAuthorizationId: "auth-parent-1",
    createdAt: "2026-09-28T00:00:00.000Z",
    ...overrides,
  };
}

function recorded(): GovernanceDecision[] {
  return appendMock.mock.calls.map(([decision]) => decision as GovernanceDecision);
}

describe("subagent usage attribution shadow (P4-0)", () => {
  beforeEach(() => {
    appendMock.mockReset();
    appendMock.mockResolvedValue(true);
  });

  it("parent authorization id → skipped + subagent-usage-not-billed, linked to the parent", async () => {
    const decision = await recordSubagentUsageAttributionShadow({
      isSubagentLane: true,
      isCliBackend: false,
      runId: "child-run",
      snapshot: childSnapshot(),
      usage: USAGE,
    });
    expect(recorded()).toHaveLength(1);
    expect(recorded()[0]).toEqual(decision);
    expect(decision).toMatchObject({
      source: "commercial-run",
      mode: "shadow",
      effect: "skipped",
      reason: SUBAGENT_USAGE_NOT_BILLED_REASON,
      runId: "child-run",
      parentRunId: "parent-run",
      parentDecisionId: "gd-parent-snapshot",
      commercialAuthorizationId: "auth-parent-1",
      shadow: {
        existing: { effect: "skipped", source: "commercial-run", reason: "no-commercial-gate" },
        divergence: "D5",
      },
    });
    // A fresh id: the parent's commercial id is linked, never reused as this decisionId.
    expect(decision?.decisionId).toMatch(/^gd-/);
    expect(decision?.decisionId).not.toBe("auth-parent-1");
  });

  it("snapshot without an authorization id → missing-parent-authorization", async () => {
    const decision = await recordSubagentUsageAttributionShadow({
      isSubagentLane: true,
      isCliBackend: false,
      runId: "child-run",
      snapshot: childSnapshot({ commercialAuthorizationId: undefined }),
      usage: USAGE,
    });
    expect(decision).toMatchObject({
      effect: "skipped",
      reason: MISSING_PARENT_AUTHORIZATION_REASON,
      parentRunId: "parent-run",
      parentDecisionId: "gd-parent-snapshot",
    });
    expect(decision).not.toHaveProperty("commercialAuthorizationId");
  });

  // Regression: the parent snapshot carries tenantId/actorId and
  // `snapshotForChildModelHandoff` copies them to the child, but this writer read
  // only the authorization id. Observed on production 2026-10-01: the subagent row
  // had commercialAuthorizationId=auth-9329fa86 yet no tenant and no actor, while
  // the parent's model-entitlement row on the same runId carried tenantId=001 and
  // actorId=platform-user:<uuid>.
  it("forwards the parent tenant and actor onto the usage envelope", () => {
    const decision = buildSubagentUsageAttributionDecision({
      runId: "child-run",
      snapshot: childSnapshot({
        tenantId: "001",
        actorId: "platform-user:90fed19a-1c8b-4420-87e0-bcc6165e32fa",
      }),
      ts: "2026-09-28T00:00:00.000Z",
    });
    expect(decision).toMatchObject({
      source: "commercial-run",
      entry: "E6",
      runId: "child-run",
      tenantId: "001",
      actorId: "platform-user:90fed19a-1c8b-4420-87e0-bcc6165e32fa",
      commercialAuthorizationId: "auth-parent-1",
    });
  });

  it("omits tenant and actor when the parent snapshot has neither", () => {
    const decision = buildSubagentUsageAttributionDecision({
      runId: "child-run",
      snapshot: childSnapshot(),
      ts: "2026-09-28T00:00:00.000Z",
    });
    expect(decision).not.toHaveProperty("tenantId");
    expect(decision).not.toHaveProperty("actorId");
  });

  it("no snapshot → missing-parent-authorization without parent fields", () => {
    const decision = buildSubagentUsageAttributionDecision({
      runId: "child-run",
      ts: "2026-09-28T00:00:00.000Z",
    });
    expect(decision).toMatchObject({
      source: "commercial-run",
      mode: "shadow",
      effect: "skipped",
      reason: MISSING_PARENT_AUTHORIZATION_REASON,
      runId: "child-run",
      shadow: { divergence: "D5" },
    });
    expect(decision).not.toHaveProperty("parentRunId");
    expect(decision).not.toHaveProperty("parentDecisionId");
    expect(decision).not.toHaveProperty("commercialAuthorizationId");
  });

  it("stamps entry E6 on every usage envelope, never E2 / E3", () => {
    const ts = "2026-09-28T00:00:00.000Z";
    const rows = [
      buildSubagentUsageAttributionDecision({ runId: "child-run", snapshot: childSnapshot(), ts }),
      buildSubagentUsageAttributionDecision({
        runId: "child-run",
        snapshot: childSnapshot(),
        reason: SUBAGENT_BILLING_CONTEXT_ABSENT_REASON,
        ts,
      }),
      buildSubagentUsageAttributionDecision({ runId: "child-run", ts }),
    ];
    expect(rows.map((row) => [row.reason, row.entry])).toEqual([
      [SUBAGENT_USAGE_NOT_BILLED_REASON, "E6"],
      [SUBAGENT_BILLING_CONTEXT_ABSENT_REASON, "E6"],
      [MISSING_PARENT_AUTHORIZATION_REASON, "E6"],
    ]);
  });

  it("P4-1 reason applies only with a parent authorization id", () => {
    const ts = "2026-09-28T00:00:00.000Z";
    expect(
      buildSubagentUsageAttributionDecision({
        runId: "child-run",
        snapshot: childSnapshot(),
        reason: SUBAGENT_BILLING_CONTEXT_ABSENT_REASON,
        ts,
      }),
    ).toMatchObject({
      effect: "skipped",
      reason: SUBAGENT_BILLING_CONTEXT_ABSENT_REASON,
      commercialAuthorizationId: "auth-parent-1",
    });
    // Without the parent id the caller's reason is ignored.
    expect(
      buildSubagentUsageAttributionDecision({
        runId: "child-run",
        snapshot: childSnapshot({ commercialAuthorizationId: undefined }),
        reason: SUBAGENT_BILLING_CONTEXT_ABSENT_REASON,
        ts,
      }),
    ).toMatchObject({ effect: "skipped", reason: MISSING_PARENT_AUTHORIZATION_REASON });
  });

  it.each([
    ["zero usage", { isSubagentLane: true, isCliBackend: false, usage: { input: 0 } }],
    ["no usage", { isSubagentLane: true, isCliBackend: false, usage: undefined }],
    ["not the subagent lane", { isSubagentLane: false, isCliBackend: false, usage: USAGE }],
    ["CLI backend", { isSubagentLane: true, isCliBackend: true, usage: USAGE }],
  ])("%s records nothing", async (_label, extra) => {
    const decision = await recordSubagentUsageAttributionShadow({
      runId: "child-run",
      snapshot: childSnapshot(),
      ...extra,
    });
    expect(decision).toBeUndefined();
    expect(appendMock).not.toHaveBeenCalled();
  });

  it("a failing sink never throws into the run", async () => {
    appendMock.mockRejectedValueOnce(new Error("disk full"));
    await expect(
      recordSubagentUsageAttributionShadow({
        isSubagentLane: true,
        isCliBackend: false,
        runId: "child-run",
        snapshot: childSnapshot(),
        usage: USAGE,
      }),
    ).resolves.toBeUndefined();
  });
});
