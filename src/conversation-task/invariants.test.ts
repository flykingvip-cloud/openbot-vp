import { describe, expect, it } from "vitest";
import type { ConversationTaskFlags } from "./feature.js";
import {
  assertActivationRequiresAllConditions,
  assertCandidateBoundary,
  assertCompletionClaimIgnored,
  assertConversationTaskBoundary,
  assertIdempotentDecisions,
  assertNoInsufficientUpgrade,
  assertNoMissionInPersonalScope,
  assertQualificationPure,
  assertShadowOnly,
  assertSideEffectOrthogonal,
  evaluateActivation,
  isModelCompletionClaim,
  resolveAuthorization,
} from "./invariants.js";
import { REASON } from "./reason-codes.js";
import { emptyTaskSignals } from "./types.js";
import type { ConversationTask, ShadowDecisionLog, TaskCandidate, TaskSignals } from "./types.js";

function signals(overrides: Partial<TaskSignals>): TaskSignals {
  return { ...emptyTaskSignals(), ...overrides };
}

const cleanCandidate: TaskCandidate = {
  kind: "candidate",
  candidateId: "c1",
  conversationId: "conv1",
  sourceMessageId: "m1",
  detection: { detected: true, signals: emptyTaskSignals(), confidence: "low", reasons: [] },
  qualification: { kind: "chat", reasons: [] },
  status: "observing",
  createdAtMs: 0,
};

const cleanTask: ConversationTask = {
  id: "t1",
  conversationId: "conv1",
  requesterId: "u1",
  goal: "monitor competitor pricing",
  acceptanceRules: [],
  lifecycle: "active",
  createdAtMs: 0,
  updatedAtMs: 0,
};

const shadowFlagsOff: ConversationTaskFlags = {
  detection: true,
  qualification: true,
  activation: false,
  projection: false,
  authorization: false,
};

describe("CT1 candidate boundary", () => {
  it("accepts a clean candidate", () => {
    expect(() => assertCandidateBoundary(cleanCandidate)).not.toThrow();
  });

  it("rejects a candidate carrying execution/ledger/auth capability", () => {
    for (const cap of ["ledgerId", "agentId", "authorization", "steps", "quota"]) {
      const tainted = { ...cleanCandidate, [cap]: "x" } as unknown as TaskCandidate;
      expect(() => assertCandidateBoundary(tainted)).toThrowError(/CT1/);
    }
  });
});

describe("CT2 ConversationTask carries no execution state", () => {
  it("accepts a clean task", () => {
    expect(() => assertConversationTaskBoundary(cleanTask)).not.toThrow();
  });

  it("rejects execution runtime fields", () => {
    for (const field of ["steps", "progress", "evidence", "running", "blocked"]) {
      const tainted = { ...cleanTask, [field]: true } as unknown as ConversationTask;
      expect(() => assertConversationTaskBoundary(tainted)).toThrowError(/CT2/);
    }
  });
});

describe("CT3 qualification is pure", () => {
  it("accepts valid results", () => {
    expect(() => assertQualificationPure({ kind: "chat", reasons: [] })).not.toThrow();
    expect(() =>
      assertQualificationPure({ kind: "needs_clarification", missing: ["goal"], reasons: [] }),
    ).not.toThrow();
  });

  it("rejects side-channel keys", () => {
    const tainted = { kind: "chat", reasons: [], ledgerWrite: true } as never;
    expect(() => assertQualificationPure(tainted)).toThrowError(/CT3/);
  });
});

describe("CT4/CT5/CT6 no single-signal upgrade", () => {
  it("no-ops for non-L2 kinds", () => {
    expect(() =>
      assertNoInsufficientUpgrade(signals({ hasFutureIntent: true }), "reminder"),
    ).not.toThrow();
  });

  it("rejects future-intent-only L2 (missing persistent state)", () => {
    expect(() =>
      assertNoInsufficientUpgrade(signals({ hasFutureIntent: true }), "long_running_candidate"),
    ).toThrowError(/CT4/);
  });

  it("rejects persistent-state-only L2 (no continuation driver)", () => {
    expect(() =>
      assertNoInsufficientUpgrade(signals({ hasPersistentState: true }), "long_running_candidate"),
    ).toThrowError(/CT5/);
  });

  it("accepts persistent state plus a continuation driver", () => {
    expect(() =>
      assertNoInsufficientUpgrade(
        signals({ hasPersistentState: true, hasRecurringIntent: true }),
        "long_running_candidate",
      ),
    ).not.toThrow();
  });

  it("accepts an explicit multi-step plan without persistent evaluation state", () => {
    expect(() =>
      assertNoInsufficientUpgrade(signals({ hasMultipleStages: true }), "long_running_candidate"),
    ).not.toThrow();
  });
});

describe("CT7 side effect orthogonal + fail-closed authorization", () => {
  it("accepts unchanged kind across side effect", () => {
    expect(() => assertSideEffectOrthogonal("short_action", "short_action")).not.toThrow();
  });

  it("rejects a side effect that changes the kind", () => {
    expect(() => assertSideEffectOrthogonal("short_action", "long_running_candidate")).toThrowError(
      /CT7/,
    );
  });

  it("resolves authorization fail-closed", () => {
    expect(resolveAuthorization("none", false)).toBe("none");
    expect(resolveAuthorization("outbound_message", false)).toBe("human_gate_required");
    expect(resolveAuthorization("broadcast", false)).toBe("human_gate_required");
    expect(resolveAuthorization("external_write", true)).toBe("authorized");
  });
});

describe("CT6 activation requires all three conditions", () => {
  it("activates only when all three hold", () => {
    const yes = evaluateActivation({
      hasClearGoal: true,
      hasContinuousExecutionReason: true,
      hasPersistableState: true,
    });
    expect(yes.canActivate).toBe(true);
    expect(() => assertActivationRequiresAllConditions(yes)).not.toThrow();
  });

  it("does not activate when any is missing", () => {
    for (const missing of [
      "hasClearGoal",
      "hasContinuousExecutionReason",
      "hasPersistableState",
    ] as const) {
      const conditions = {
        hasClearGoal: true,
        hasContinuousExecutionReason: true,
        hasPersistableState: true,
        [missing]: false,
      };
      const decision = evaluateActivation(conditions);
      expect(decision.canActivate).toBe(false);
      expect(() => assertActivationRequiresAllConditions(decision)).not.toThrow();
    }
  });
});

describe("CT8 idempotency", () => {
  const log = (over: Partial<ShadowDecisionLog>): ShadowDecisionLog => ({
    shadowOnly: true,
    decisionVersion: "v",
    inputFingerprint: "fp",
    detected: true,
    confidence: "high",
    qualification: "short_action",
    signals: emptyTaskSignals(),
    sideEffect: "none",
    authorization: "none",
    reasonCodes: [],
    atMs: 0,
    ...over,
  });

  it("accepts identical decisions for the same message id", () => {
    expect(() =>
      assertIdempotentDecisions([
        { messageId: "m", log: log({}) },
        { messageId: "m", log: log({}) },
      ]),
    ).not.toThrow();
  });

  it("rejects divergent decisions for the same message id", () => {
    expect(() =>
      assertIdempotentDecisions([
        { messageId: "m", log: log({}) },
        { messageId: "m", log: log({ qualification: "long_running_candidate" }) },
      ]),
    ).toThrowError(/CT8/);
  });
});

describe("CT9 model completion self-claims", () => {
  it("detects completion claims", () => {
    expect(isModelCompletionClaim("这个任务我已经完成了")).toBe(true);
    expect(isModelCompletionClaim("report is done")).toBe(true);
    expect(isModelCompletionClaim("帮我查一下销售额")).toBe(false);
  });

  it("requires claims to map to an ignored no-op", () => {
    expect(() =>
      assertCompletionClaimIgnored("chat", [REASON.MODEL_SELF_CLAIM_IGNORED]),
    ).not.toThrow();
    expect(() => assertCompletionClaimIgnored("long_running_candidate", [])).toThrowError(/CT9/);
    expect(() => assertCompletionClaimIgnored("chat", [])).toThrowError(/CT9/);
  });
});

describe("CT10 shadow-only", () => {
  const log: ShadowDecisionLog = {
    shadowOnly: true,
    decisionVersion: "v",
    inputFingerprint: "fp",
    detected: false,
    confidence: "low",
    qualification: "chat",
    signals: emptyTaskSignals(),
    sideEffect: "none",
    authorization: "none",
    reasonCodes: [],
    atMs: 0,
  };

  it("accepts shadow log with forbidden flags off", () => {
    expect(() => assertShadowOnly(log, shadowFlagsOff)).not.toThrow();
  });

  it("rejects when a forbidden flag is on", () => {
    expect(() => assertShadowOnly(log, { ...shadowFlagsOff, activation: true })).toThrowError(
      /CT10/,
    );
    expect(() => assertShadowOnly(log, { ...shadowFlagsOff, authorization: true })).toThrowError(
      /CT10/,
    );
  });
});

describe("CT11 no mission in personal scope", () => {
  it("rejects mission kind", () => {
    expect(() => assertNoMissionInPersonalScope("mission")).toThrowError(/CT11/);
  });
  it("accepts non-mission kinds", () => {
    expect(() => assertNoMissionInPersonalScope("long_running_candidate")).not.toThrow();
  });
});
