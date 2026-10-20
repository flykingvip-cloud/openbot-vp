import { describe, expect, it } from "vitest";
import { samplesByCategory } from "./dataset.js";
import type { ConversationTaskFlags } from "./feature.js";
import { assertIdempotentDecisions, assertShadowOnly } from "./invariants.js";
import { evaluateTurn, evaluateTurnGated, fingerprintText, replayTurns } from "./replay.js";

const shadowFlags: ConversationTaskFlags = {
  detection: true,
  qualification: true,
  activation: false,
  projection: false,
  authorization: false,
};

describe("shadow replay", () => {
  it("produces shadow-only logs that pass the shadow invariant", () => {
    const decision = evaluateTurn({ messageId: "m1", text: "每周监控竞品价格，异常时通知我" });
    expect(decision.log.shadowOnly).toBe(true);
    expect(() => assertShadowOnly(decision.log, shadowFlags)).not.toThrow();
  });

  it("is idempotent for a redelivered message (CT8)", () => {
    const dups = samplesByCategory().get("duplicate_idempotency") ?? [];
    expect(dups.length).toBeGreaterThanOrEqual(2);
    const entries = dups.map((s) => ({
      messageId: s.input.messageId,
      log: evaluateTurn(s.input).log,
    }));
    expect(() => assertIdempotentDecisions(entries)).not.toThrow();
    // Byte-stable logs for identical input.
    expect(entries[0].log).toEqual(entries[1].log);
  });

  it("returns no decision when the detection flag is off (flag-off == unchanged)", () => {
    const input = { messageId: "m2", text: "查一下今天的销售额" };
    expect(evaluateTurnGated(input, { ...shadowFlags, detection: false })).toBeNull();
    expect(evaluateTurnGated(input, shadowFlags)).not.toBeNull();
  });

  it("resolves authorization fail-closed for external side effects", () => {
    const broadcast = evaluateTurn({
      messageId: "m3",
      text: "整理后发给全部销售",
      hasActiveTaskBinding: true,
    });
    expect(broadcast.sideEffect).toBe("broadcast");
    expect(broadcast.authorization).toBe("human_gate_required");

    const noSideEffect = evaluateTurn({ messageId: "m4", text: "查一下今天的销售额" });
    expect(noSideEffect.authorization).toBe("none");
  });

  it("replays a batch as a pure map", () => {
    const decisions = replayTurns([
      { messageId: "a", text: "什么是毛利率？" },
      { messageId: "b", text: "下周一提醒我提交报销" },
    ]);
    expect(decisions).toHaveLength(2);
    expect(decisions[1].qualification.kind).toBe("reminder");
  });
});

describe("privacy-safe fingerprint", () => {
  it("is stable and does not embed raw text", () => {
    const text = "每周监控竞品价格，异常时通知我";
    const fp = fingerprintText(text);
    expect(fp).toBe(fingerprintText(text));
    expect(fp.startsWith("fp_")).toBe(true);
    expect(fp).not.toContain("监控");
    expect(fp).not.toContain(text);
  });

  it("distinguishes different inputs", () => {
    expect(fingerprintText("查一下销售额")).not.toBe(fingerprintText("查一下利润"));
  });
});
