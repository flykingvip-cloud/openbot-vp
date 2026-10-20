// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GovernanceDecision, RunGovernanceSnapshot } from "./decision.js";

const { appendMock } = vi.hoisted(() => ({ appendMock: vi.fn() }));
vi.mock("./shadow-sink.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./shadow-sink.js")>()),
  appendGovernanceShadowDecision: appendMock,
}));

const { SHADOW_THREW_REASON, buildShadowEvaluationFailureDecision, recordShadowEvaluationFailure } =
  await import("./shadow-failure.js");
const { recordModelGovernanceDecision } = await import("../../agents/model-fallback-governance.js");
const { applyToolsInvokeGovernance, TOOLS_INVOKE_MODE_ENV, TOOLS_INVOKE_SHADOW_ENV } =
  await import("./tools-invoke-shadow.js");
const { recordSubagentModelShadow, SubagentModelOutsideParentSetError } =
  await import("./spawn-snapshot-handoff.js");

const TS = "2026-09-29T00:00:00.000Z";
const PRIMARY = { provider: "openai", model: "gpt-5.2" };
const FALLBACK = { provider: "anthropic", model: "claude-opus-4-5" };

function recorded(): GovernanceDecision[] {
  return appendMock.mock.calls.map(([decision]) => decision as GovernanceDecision);
}

function throwingCli(): never {
  throw new Error("cli classifier boom");
}

/** A policy table whose every read throws, so the capability evaluation throws. */
function throwingPolicy() {
  const boom = () => {
    throw new Error("policy boom");
  };
  return new Proxy({}, { get: boom, ownKeys: boom, getOwnPropertyDescriptor: boom, has: boom });
}

function childSnapshot(allowlist: unknown[]): RunGovernanceSnapshot {
  return {
    snapshotId: "gd-parent-snapshot",
    runId: "parent-run",
    parentRunId: "parent-run",
    tenantId: "tenant-a",
    actorId: "platform-user:emp-1",
    governanceMode: "shadow",
    decisions: [],
    effectiveModelSet: { allowlist: allowlist as string[] },
    createdAt: TS,
  };
}

beforeEach(() => {
  appendMock.mockReset();
  appendMock.mockResolvedValue(true);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("D6 envelope (shadow evaluation threw)", () => {
  it.each(["legacy", "shadow", "enforced"] as const)(
    "is skipped + shadow-threw + D6 under %s, with a fresh gd- id",
    (mode) => {
      const decision = buildShadowEvaluationFailureDecision({
        source: "model-entitlement",
        mode,
        existing: { effect: "allow", source: "model-entitlement", reason: "not-enforced" },
        entry: "E2",
        runId: "run-1",
        tenantId: "tenant-a",
        commercialAuthorizationId: "auth-1",
        ts: TS,
        uuid: () => "11111111-1111-4111-8111-111111111111",
      });
      expect(decision).toEqual({
        effect: "skipped",
        decisionId: "gd-11111111-1111-4111-8111-111111111111",
        source: "model-entitlement",
        entry: "E2",
        mode,
        reason: SHADOW_THREW_REASON,
        runId: "run-1",
        tenantId: "tenant-a",
        commercialAuthorizationId: "auth-1",
        shadow: {
          existing: { effect: "allow", source: "model-entitlement", reason: "not-enforced" },
          divergence: "D6",
        },
        ts: TS,
      });
    },
  );

  it("never throws: a throwing field reader or a rejecting sink is swallowed", async () => {
    expect(
      recordShadowEvaluationFailure({
        fields: () => {
          throw new Error("second failure");
        },
      }),
    ).toBeUndefined();
    expect(appendMock).not.toHaveBeenCalled();

    appendMock.mockRejectedValueOnce(new Error("disk full"));
    const decision = recordShadowEvaluationFailure({
      fields: () => ({
        source: "capability",
        mode: "shadow",
        existing: { effect: "allow", source: "capability", reason: "not-enforced" },
      }),
    });
    expect(decision).toMatchObject({ effect: "skipped", shadow: { divergence: "D6" } });
    await Promise.resolve();
    expect(appendMock).toHaveBeenCalledTimes(1);
  });
});

describe("model-entitlement recorder writes D6 when the envelope build throws (E2 / E3 / E10)", () => {
  it("records D6 with the caller's ids and returns undefined, as before", () => {
    const result = recordModelGovernanceDecision({
      mode: "shadow",
      before: [PRIMARY, FALLBACK],
      after: [FALLBACK],
      isCliBackend: throwingCli,
      runId: "run-1",
      context: {
        entry: "E2",
        tenantId: "tenant-a",
        actorId: "platform-user:emp-1",
        commercialAuthorizationId: "auth-1",
      },
    });
    expect(result).toBeUndefined();
    expect(recorded()).toHaveLength(1);
    expect(recorded()[0]).toMatchObject({
      effect: "skipped",
      source: "model-entitlement",
      entry: "E2",
      mode: "shadow",
      reason: SHADOW_THREW_REASON,
      runId: "run-1",
      tenantId: "tenant-a",
      actorId: "platform-user:emp-1",
      commercialAuthorizationId: "auth-1",
      shadow: {
        existing: { effect: "allow", source: "model-entitlement", reason: "not-enforced" },
        divergence: "D6",
      },
    });
    expect(recorded()[0]?.decisionId).toMatch(/^gd-/);
  });

  it.each([
    [
      "preexisting filter, nothing left",
      { filterApplied: true, after: [] },
      "deny",
      "filter-applied",
    ],
    [
      "preexisting filter, one left",
      { filterApplied: true, after: [FALLBACK] },
      "allow",
      "filter-applied",
    ],
    ["image fallback under enforced", { mode: "enforced", after: [] }, "deny", "filter-applied"],
    ["governance-mode shadow", { filterApplied: false, after: [] }, "allow", "not-enforced"],
  ] as const)("describes the live side (%s)", (_label, extra, effect, reason) => {
    recordModelGovernanceDecision({
      mode: "shadow",
      before: [PRIMARY, FALLBACK],
      isCliBackend: throwingCli,
      ...extra,
    });
    expect(recorded()[0]?.shadow).toEqual({
      existing: { effect, source: "model-entitlement", reason },
      divergence: "D6",
    });
  });
});

describe("/tools/invoke writes D6 when the evaluation throws (E8)", () => {
  it.each([
    ["shadow + SHADOW flag", { [TOOLS_INVOKE_SHADOW_ENV]: "1" }, "shadow"],
    ["enforced", { [TOOLS_INVOKE_MODE_ENV]: "enforced" }, "enforced"],
  ] as const)("%s: records D6 and never rejects", async (_label, env, mode) => {
    const result = await applyToolsInvokeGovernance({
      toolName: "sessions_list",
      enterpriseId: "tenant-1",
      membershipId: "mem-1",
      env,
      capabilityPolicy: throwingPolicy() as never,
    });
    expect(result).toEqual({});
    expect(recorded()).toHaveLength(1);
    expect(recorded()[0]).toMatchObject({
      effect: "skipped",
      source: "capability",
      entry: "E8",
      mode,
      reason: SHADOW_THREW_REASON,
      tenantId: "tenant-1",
      actorId: "membership:mem-1",
      subject: { kind: "capability", id: "sessions_list" },
      shadow: {
        existing: { effect: "allow", source: "capability", reason: "not-enforced" },
        divergence: "D6",
      },
    });
  });
});

describe("subagent model shadow writes D6 when the evaluation throws (E6)", () => {
  it.each(["shadow", "enforced"] as const)(
    "%s: a malformed parent allowlist records D6 and does not reject",
    (mode) => {
      const call = () =>
        recordSubagentModelShadow({
          isSubagentLane: true,
          snapshot: childSnapshot([42]),
          ...PRIMARY,
          runId: "child-run",
          env: { OPENBOT_GOVERNANCE_SUBAGENT_MODEL_MODE: mode },
        });
      expect(call).not.toThrow();
      expect(recorded()).toHaveLength(1);
      expect(recorded()[0]).toMatchObject({
        effect: "skipped",
        source: "model-entitlement",
        entry: "E6",
        mode,
        reason: SHADOW_THREW_REASON,
        runId: "child-run",
        parentRunId: "parent-run",
        parentDecisionId: "gd-parent-snapshot",
        tenantId: "tenant-a",
        actorId: "platform-user:emp-1",
        shadow: { divergence: "D6" },
      });
    },
  );

  it("the enforced reject for a model outside the parent set is unchanged", () => {
    expect(() =>
      recordSubagentModelShadow({
        isSubagentLane: true,
        snapshot: childSnapshot(["anthropic/claude-opus-4-5"]),
        ...PRIMARY,
        runId: "child-run",
        env: { OPENBOT_GOVERNANCE_SUBAGENT_MODEL_MODE: "enforced" },
      }),
    ).toThrow(SubagentModelOutsideParentSetError);
    expect(recorded()).toHaveLength(1);
    expect(recorded()[0]).toMatchObject({
      effect: "deny",
      mode: "enforced",
      reason: "outside-parent-model-set",
      entry: "E6",
    });
    expect(recorded()[0]?.reason).not.toBe(SHADOW_THREW_REASON);
  });
});
