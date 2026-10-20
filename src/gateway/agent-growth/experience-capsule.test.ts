import { describe, expect, it } from "vitest";
import { buildExperienceLesson, deriveCandidateCapsule } from "./experience-capsule.js";

describe("deriveCandidateCapsule", () => {
  it("produces a candidate capsule that is NOT self-approved", () => {
    const capsule = deriveCandidateCapsule({
      trigger: "task_failure",
      scopeId: "agent:daibai",
      botId: "daibai",
      reason: "context_overflow",
      detail: "prompt too large for this model",
      atMs: 1000,
    });

    expect(capsule).not.toBeNull();
    expect(capsule?.status).toBe("candidate");
    // 关键：不自审自批（原实现直接写 approvedBy = 自己）。
    expect(capsule?.approvedBy).toBeUndefined();
    expect(capsule?.approvedAt).toBeUndefined();
    expect(capsule?.createdBy).toBe("daibai");
    expect(capsule?.groupId).toBe("agent:daibai");
  });

  it("classifies failures and rejections as anti-patterns", () => {
    expect(
      deriveCandidateCapsule({
        trigger: "task_failure",
        scopeId: "grp-1",
        botId: "bot-1",
        reason: "agent_error_before_reply",
      })?.capsuleType,
    ).toBe("anti_pattern");
    expect(
      deriveCandidateCapsule({
        trigger: "review_rejected",
        scopeId: "grp-1",
        botId: "bot-1",
        reason: "missing_tests",
      })?.capsuleType,
    ).toBe("anti_pattern");
  });

  it("classifies human takeover as a lesson", () => {
    const capsule = deriveCandidateCapsule({
      trigger: "human_takeover",
      scopeId: "grp-1",
      botId: "bot-1",
      reason: "user_took_over",
    });
    expect(capsule?.capsuleType).toBe("lesson");
    expect(capsule?.sourceType).toBe("session");
  });

  it("carries a recallable summary", () => {
    const capsule = deriveCandidateCapsule({
      trigger: "task_failure",
      scopeId: "grp-1",
      botId: "bot-1",
      reason: "run_slot_unavailable",
      detail: "并发已达上限",
    });
    expect(capsule?.summary).toBe("任务失败（run_slot_unavailable）：并发已达上限");
    expect(capsule?.structuredContent).toMatchObject({
      trigger: "task_failure",
      reason: "run_slot_unavailable",
      detail: "并发已达上限",
    });
  });

  it("keeps secret scopes group-only", () => {
    const capsule = deriveCandidateCapsule({
      trigger: "task_failure",
      scopeId: "grp-1",
      botId: "bot-1",
      reason: "boom",
      confidentialityTier: "secret",
    });
    expect(capsule?.sensitivity).toBe("secret");
    expect(capsule?.reusability).toBe("group_only");
    expect(capsule?.confidentialityScope).toBe("group");
  });

  it("redacts secrets out of raw error detail before persisting", () => {
    const capsule = deriveCandidateCapsule({
      trigger: "task_failure",
      scopeId: "grp-1",
      botId: "bot-1",
      reason: "provider_auth_failed",
      detail: 'upstream 401: api_key="sk-abcdef0123456789" Bearer eyJhbGciOi.z9 failed',
    });

    const serialized = JSON.stringify(capsule);
    expect(serialized).not.toContain("sk-abcdef0123456789");
    expect(serialized).not.toContain("eyJhbGciOi.z9");
    expect(capsule?.summary).toContain("***");
  });

  it("redacts before truncating so a cut cannot leave a partial key", () => {
    const capsule = deriveCandidateCapsule({
      trigger: "task_failure",
      scopeId: "grp-1",
      botId: "bot-1",
      reason: "boom",
      detail: `${"x".repeat(560)} sk-abcdefghijklmnop0123456789`,
    });
    expect(JSON.stringify(capsule)).not.toContain("sk-abcdefghijklmnop");
  });

  it("returns null on insufficient input instead of writing junk", () => {
    expect(
      deriveCandidateCapsule({
        trigger: "task_failure",
        scopeId: "  ",
        botId: "bot-1",
        reason: "boom",
      }),
    ).toBeNull();
    expect(
      deriveCandidateCapsule({
        trigger: "task_failure",
        scopeId: "grp-1",
        botId: "bot-1",
        reason: "   ",
      }),
    ).toBeNull();
  });
});

describe("buildExperienceLesson", () => {
  it("collapses whitespace and tolerates missing detail", () => {
    expect(
      buildExperienceLesson({
        trigger: "review_rejected",
        reason: "no_regression_test",
        detail: "  评审要求\n补一个回归测试  ",
      }),
    ).toBe("评审驳回（no_regression_test）：评审要求 补一个回归测试");
    expect(buildExperienceLesson({ trigger: "task_failure", reason: "boom" })).toBe(
      "任务失败（boom）",
    );
  });
});
