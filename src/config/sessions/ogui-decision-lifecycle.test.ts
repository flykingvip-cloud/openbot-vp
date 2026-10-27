import { describe, expect, it } from "vitest";
import { OpenBotSchema } from "../zod-schema.js";
import {
  OGUI_DECISION_LIFECYCLE_ENV,
  OGUI_DECISION_MUTATOR_NAME,
  classifyOguiAnswerDecisionFields,
  evaluateOguiAnswerLifecycle,
  type OguiAnswerDecisionFields,
  isOguiDecisionLifecycleEnabled,
  isOguiDecisionLifecycleEnabledFor,
  planOguiDecisionMutation,
} from "./ogui-decision-lifecycle.js";
import { parseOguiDecisionRecord, type OguiDecisionRecord } from "./ogui-decision.js";

function waitingRecord(version = 1): OguiDecisionRecord {
  const record = parseOguiDecisionRecord({
    decisionId: "dec-1",
    version,
    decisionStatus: "waiting",
    resumeStatus: "pending",
    resumeRef: "resume-1",
    scope: {
      sessionKey: "agent:main:main",
      userId: "user-from-auth",
      originRunId: "run-1",
    },
    prompt: "Which path?",
    options: [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ],
    allowCustom: true,
    multiSelect: false,
    issuedAtMs: 1,
    updatedAtMs: 1,
  });
  if (!record) {
    throw new Error("fixture record failed to parse");
  }
  return record;
}

describe("OGUI decision lifecycle flag", () => {
  it("defaults off for empty config and a missing env key", () => {
    const previous = process.env[OGUI_DECISION_LIFECYCLE_ENV];
    delete process.env[OGUI_DECISION_LIFECYCLE_ENV];
    try {
      expect(isOguiDecisionLifecycleEnabled()).toBe(false);
      expect(isOguiDecisionLifecycleEnabled({ cfg: {}, env: {} })).toBe(false);
      expect(
        isOguiDecisionLifecycleEnabled({
          cfg: { collaboration: { task: { oguiDecisionLifecycle: false } } },
          env: {},
        }),
      ).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env[OGUI_DECISION_LIFECYCLE_ENV];
      } else {
        process.env[OGUI_DECISION_LIFECYCLE_ENV] = previous;
      }
    }
  });

  it("stays off when the allowlist is filled and the master switch is off", () => {
    expect(
      isOguiDecisionLifecycleEnabled({
        cfg: {
          collaboration: {
            task: {
              oguiDecisionLifecycle: false,
              oguiDecisionLifecycleAllowlist: ["tenant-a", "skill-incubation"],
            },
          },
        },
        env: {},
        subjectId: "tenant-a",
      }),
    ).toBe(false);
  });

  it("accepts an explicit opt-in and authorizes the locked writer", () => {
    expect(
      isOguiDecisionLifecycleEnabled({
        cfg: { collaboration: { task: { oguiDecisionLifecycle: true } } },
        env: {},
      }),
    ).toBe(true);
    expect(planOguiDecisionMutation({ kind: "issue", lifecycleEnabled: true })).toEqual({
      ok: true,
      writes: true,
      mutator: OGUI_DECISION_MUTATOR_NAME,
      reason: "ready",
      kind: "issue",
    });
    expect(planOguiDecisionMutation({ kind: "consume", lifecycleEnabled: true })).toEqual({
      ok: true,
      writes: true,
      mutator: OGUI_DECISION_MUTATOR_NAME,
      reason: "ready",
      kind: "consume",
    });
    expect(planOguiDecisionMutation({ kind: "supersede", lifecycleEnabled: false })).toEqual({
      ok: false,
      writes: false,
      mutator: "updateSessionStore",
      reason: "flag_off",
    });
  });

  it("matches an allowlist subject without treating an empty list as an enable", () => {
    const cfg = {
      collaboration: {
        task: {
          oguiDecisionLifecycle: true,
          oguiDecisionLifecycleAllowlist: ["tenant-a"],
        },
      },
    };
    expect(
      isOguiDecisionLifecycleEnabledFor({
        cfg,
        env: {},
        subjectIds: ["skill-incubation", "tenant-a"],
      }),
    ).toBe(true);
    expect(
      isOguiDecisionLifecycleEnabledFor({
        cfg,
        env: {},
        subjectIds: ["skill-incubation"],
      }),
    ).toBe(false);
    expect(
      isOguiDecisionLifecycleEnabledFor({
        cfg: { collaboration: { task: {} } },
        env: {},
        subjectIds: ["tenant-a"],
      }),
    ).toBe(false);
  });

  it("lets an explicit env off-token override a config opt-in", () => {
    const cfg = { collaboration: { task: { oguiDecisionLifecycle: true } } };
    expect(
      isOguiDecisionLifecycleEnabled({
        cfg,
        env: { [OGUI_DECISION_LIFECYCLE_ENV]: "0" },
      }),
    ).toBe(false);
    expect(
      isOguiDecisionLifecycleEnabled({
        cfg,
        env: { [OGUI_DECISION_LIFECYCLE_ENV]: "maybe" },
      }),
    ).toBe(false);
    expect(
      isOguiDecisionLifecycleEnabled({
        cfg: {},
        env: { [OGUI_DECISION_LIFECYCLE_ENV]: "1" },
      }),
    ).toBe(true);
  });

  it("requires an exact subject when the allowlist is non-empty", () => {
    const cfg = {
      collaboration: {
        task: {
          oguiDecisionLifecycle: true,
          oguiDecisionLifecycleAllowlist: ["tenant-a"],
        },
      },
    };
    expect(isOguiDecisionLifecycleEnabled({ cfg, env: {}, subjectId: "tenant-a" })).toBe(true);
    expect(isOguiDecisionLifecycleEnabled({ cfg, env: {}, subjectId: "tenant-b" })).toBe(false);
    expect(isOguiDecisionLifecycleEnabled({ cfg, env: {} })).toBe(false);
  });

  it("parses the config flag as optional and off when omitted", () => {
    const omitted = OpenBotSchema.safeParse({});
    expect(omitted.success).toBe(true);
    if (!omitted.success) {
      return;
    }
    expect(omitted.data.collaboration?.task?.oguiDecisionLifecycle).toBeUndefined();
    expect(isOguiDecisionLifecycleEnabled({ cfg: omitted.data, env: {} })).toBe(false);

    const opted = OpenBotSchema.safeParse({
      collaboration: {
        task: {
          oguiDecisionLifecycle: true,
          oguiDecisionLifecycleAllowlist: [],
        },
      },
    });
    expect(opted.success).toBe(true);
    if (!opted.success) {
      return;
    }
    expect(opted.data.collaboration?.task?.oguiDecisionLifecycle).toBe(true);
    expect(isOguiDecisionLifecycleEnabled({ cfg: opted.data, env: {} })).toBe(true);

    expect(
      OpenBotSchema.safeParse({
        collaboration: { task: { oguiDecisionLifecycle: "true" } },
      }).success,
    ).toBe(false);
  });
});

describe("ogui-answer lifecycle fields", () => {
  const records = { "dec-1": waitingRecord(2) };

  it("accepts a legacy answer that omits both decision fields (Ev1)", () => {
    expect(classifyOguiAnswerDecisionFields({})).toEqual({ kind: "legacy" });
    expect(
      evaluateOguiAnswerLifecycle({
        answer: { submission_id: "sub-1" } as unknown as OguiAnswerDecisionFields,
        lifecycleEnabled: false,
      }),
    ).toEqual({ path: "legacy", ok: true });
  });

  it("rejects a lifecycle answer that is missing either decision field (Ev2)", () => {
    expect(
      evaluateOguiAnswerLifecycle({
        answer: { decision_id: "dec-1" },
        lifecycleEnabled: true,
        records,
      }),
    ).toEqual({
      path: "lifecycle",
      ok: false,
      reason: "missing_decision_version",
      fallbackToPlainChat: false,
    });
    expect(
      evaluateOguiAnswerLifecycle({
        answer: { decision_version: 2 },
        lifecycleEnabled: true,
      }),
    ).toMatchObject({
      ok: false,
      reason: "missing_decision_id",
      fallbackToPlainChat: false,
    });
    expect(
      evaluateOguiAnswerLifecycle({
        answer: { decision_id: "   ", decision_version: 2 },
        lifecycleEnabled: true,
      }),
    ).toMatchObject({ ok: false, reason: "missing_decision_id", fallbackToPlainChat: false });
  });

  it("requires decision_version to be a positive integer", () => {
    for (const decision_version of [0, -1, 1.5, "1", true, null]) {
      expect(
        evaluateOguiAnswerLifecycle({
          answer: { decision_id: "dec-1", decision_version },
          lifecycleEnabled: true,
        }),
      ).toMatchObject({
        ok: false,
        reason: "invalid_decision_version",
        fallbackToPlainChat: false,
      });
    }
    expect(
      evaluateOguiAnswerLifecycle({
        answer: { decision_id: "dec-1", decision_version: 2 },
        lifecycleEnabled: true,
      }),
    ).toEqual({ path: "lifecycle", ok: true, decisionId: "dec-1", version: 2 });
  });

  it("rejects unknown and mismatched refs and does not rewrite them as legacy", () => {
    expect(
      evaluateOguiAnswerLifecycle({
        answer: { decision_id: "missing", decision_version: 2 },
        lifecycleEnabled: true,
        records,
      }),
    ).toMatchObject({ ok: false, reason: "unknown_decision", fallbackToPlainChat: false });
    expect(
      evaluateOguiAnswerLifecycle({
        answer: { decision_id: "dec-1", decision_version: 1 },
        lifecycleEnabled: true,
        records,
      }),
    ).toMatchObject({ ok: false, reason: "version_mismatch", fallbackToPlainChat: false });
  });

  it("rejects a lifecycle-shaped answer while the flag is off", () => {
    expect(
      evaluateOguiAnswerLifecycle({
        answer: { decision_id: "dec-1", decision_version: 2 },
        lifecycleEnabled: false,
        records,
      }),
    ).toEqual({
      path: "lifecycle",
      ok: false,
      reason: "flag_off",
      fallbackToPlainChat: false,
    });
  });

  it("rejects identity fields carried on the answer", () => {
    expect(
      evaluateOguiAnswerLifecycle({
        answer: { userId: "spoofed" } as unknown as OguiAnswerDecisionFields,
        lifecycleEnabled: false,
      }),
    ).toMatchObject({ ok: false, reason: "untrusted_identity", fallbackToPlainChat: false });
  });
});
