import { describe, expect, it } from "vitest";
import { assertNoSensitiveFields } from "../privacy.js";
import { digestName, scanForbiddenSubstrings } from "./digest.js";
import { parseShadowTaskEnvelope } from "./envelope.js";
import { decideShadowRoute } from "./evaluate.js";
import { projectShadowEvent } from "./event.js";
import { TASK_ENVELOPE_SCHEMA } from "./types.js";

describe("Phase 1 I1 privacy negatives", () => {
  it("rejects nested sensitive fields on the envelope", () => {
    expect(() =>
      parseShadowTaskEnvelope({
        schema: TASK_ENVELOPE_SCHEMA,
        taskClass: "plain_text_qa",
        riskClass: "read_only",
        channelKind: "internal",
        textDigest: digestName("text", "safe"),
        arguments: { token: "sk-nestedsecret", prompt: "do not store" },
      }),
    ).toThrow(/sensitive/);
  });

  it("rejects a snapshot that still carries nested secrets", () => {
    expect(() =>
      assertNoSensitiveFields({
        apply: false,
        extra: { arguments: { token: "sk-nestedsecret" } },
      }),
    ).toThrow(/forbids field/);
  });

  it("keeps serialized shadow events free of forbidden substrings and raw names", () => {
    const envelope = parseShadowTaskEnvelope({
      schema: TASK_ENVELOPE_SCHEMA,
      taskClass: "skill_dense_readonly",
      riskClass: "read_only",
      channelKind: "internal",
      textDigest: digestName("text", "safe offline label"),
      tagDigests: [digestName("tag", "readonly")],
    });
    const decision = decideShadowRoute({
      envelope,
      eligibleSkills: [
        {
          nameDigest: digestName("skill", "clock-kind-lookup"),
          tagDigests: [digestName("tag", "readonly")],
          sideEffect: false,
        },
        { nameDigest: digestName("skill", "publisher"), tagDigests: [], sideEffect: true },
      ],
      constructedTools: [
        {
          nameDigest: digestName("tool", "read_clock_kind"),
          tagDigests: [digestName("tag", "readonly")],
          sideEffect: false,
        },
        { nameDigest: digestName("tool", "sessions_send"), tagDigests: [], sideEffect: true },
      ],
    });
    const snapshot = projectShadowEvent({
      decision,
      runIdDigest: digestName("run", "privacy-run"),
      sessionKeyHash: digestName("session", "hashed-session"),
    });
    const serialized = JSON.stringify(snapshot);
    expect(scanForbiddenSubstrings(serialized)).toEqual([]);
    expect(serialized).not.toContain("SKILL.md");
    expect(serialized).not.toContain("Bearer ");
    expect(serialized).not.toContain("https://");
    expect(serialized).not.toContain("clock-kind-lookup");
    expect(serialized).not.toContain("read_clock_kind");
    expect(snapshot.apply).toBe(false);
  });
});
