import { describe, expect, it } from "vitest";
import { compareCandidateVsInvoked } from "./compare.js";
import { digestName } from "./digest.js";
import { parseShadowTaskEnvelope } from "./envelope.js";
import { assertImplementationClosed, decideShadowRoute } from "./evaluate.js";
import { projectShadowEvent } from "./event.js";
import { constrainShadowToolsToPolicy, shadowCannotExpandPolicy } from "./policy.js";
import { computeRequiredRecall } from "./recall.js";
import { SCORE_WEIGHTS, scoreSkillCandidates, scoreToolCandidates } from "./score.js";
import {
  PHASE1_FLAGS,
  TASK_ENVELOPE_SCHEMA,
  type CatalogEntry,
  type ShadowTaskEnvelope,
} from "./types.js";

const clock = digestName("skill", "clock-kind-lookup");
const writer = digestName("skill", "publisher");
const clockTool = digestName("tool", "read_clock_kind");
const writeTool = digestName("tool", "sessions_send");
const deniedTool = digestName("tool", "denied-high-score");
const tagRead = digestName("tag", "readonly");

function envelope(overrides: Partial<ShadowTaskEnvelope> = {}): ShadowTaskEnvelope {
  return {
    schema: TASK_ENVELOPE_SCHEMA,
    taskClass: "skill_dense_readonly",
    riskClass: "read_only",
    channelKind: "internal",
    textDigest: digestName("text", "reply with one digit"),
    tagDigests: [tagRead],
    requiredSkillDigests: [clock],
    requiredToolDigests: [clockTool],
    ...overrides,
  };
}

const skills: CatalogEntry[] = [
  { nameDigest: clock, tagDigests: [tagRead], sideEffect: false },
  { nameDigest: writer, tagDigests: [], sideEffect: true },
];

const tools: CatalogEntry[] = [
  { nameDigest: clockTool, tagDigests: [tagRead], sideEffect: false },
  { nameDigest: writeTool, tagDigests: [], sideEffect: true },
];

describe("Phase 1 I1 shadow compute core", () => {
  it("keeps every live flag false and never applies", () => {
    expect(PHASE1_FLAGS).toEqual({
      SKILL_TOP_K_ENABLED: false,
      TOOL_TOP_K_ENABLED: false,
      SHADOW_ROUTER_RECORD: false,
      SHADOW_ROUTER_APPLY: false,
      DAG_ENABLED: false,
      CONVERSATION_TASK_ENABLED: false,
      ORCHESTRATION_LIVE_INVOKE: false,
    });
    const decision = decideShadowRoute({
      envelope: envelope(),
      eligibleSkills: skills,
      constructedTools: tools,
    });
    expect(decision.apply).toBe(false);
    expect(decision.reasonCode).toBe("SHADOW_DISABLED");
    assertImplementationClosed(decision);
  });

  it("parses a legal envelope and rejects illegal ones", () => {
    const parsed = parseShadowTaskEnvelope(envelope());
    expect(parsed.schema).toBe(TASK_ENVELOPE_SCHEMA);
    expect(() => parseShadowTaskEnvelope(null)).toThrow(/object/);
    expect(() => parseShadowTaskEnvelope({ ...envelope(), schema: "other" })).toThrow(/schema/);
    expect(() => parseShadowTaskEnvelope({ ...envelope(), taskClass: "nope" })).toThrow(
      /taskClass/,
    );
    expect(() => parseShadowTaskEnvelope({ ...envelope(), textDigest: "not-a-digest" })).toThrow(
      /textDigest/,
    );
  });

  it("rejects unknown, overlong, and sensitive envelope fields", () => {
    expect(() => parseShadowTaskEnvelope({ ...envelope(), prompt: "raw user text" })).toThrow(
      /sensitive|unknown/,
    );
    expect(() => parseShadowTaskEnvelope({ ...envelope(), extra: "x" })).toThrow(/unknown/);
    expect(() =>
      parseShadowTaskEnvelope({
        ...envelope(),
        tagDigests: Array.from({ length: 17 }, (_, i) => digestName("tag", `t${i}`)),
      }),
    ).toThrow(/too long/);
    expect(() =>
      parseShadowTaskEnvelope({
        ...envelope(),
        arguments: { token: "sk-secretvalue" },
      }),
    ).toThrow(/sensitive/);
  });

  it("scores Skill and Tool candidates deterministically", () => {
    const first = scoreSkillCandidates(envelope(), skills);
    const second = scoreSkillCandidates(envelope(), skills);
    expect(first).toEqual(second);
    expect(first[0]?.nameDigest).toBe(clock);
    expect(first[0]?.score).toBeGreaterThan(first[1]?.score ?? 0);
    const toolsFirst = scoreToolCandidates(envelope(), tools);
    const toolsSecond = scoreToolCandidates(envelope(), tools);
    expect(toolsFirst).toEqual(toolsSecond);
    expect(toolsFirst[0]?.nameDigest).toBe(clockTool);
  });

  it("produces the same digest for the same input", () => {
    expect(digestName("skill", "Clock-Kind-Lookup")).toBe(clock);
    expect(digestName("tool", "READ_CLOCK_KIND")).toBe(clockTool);
    expect(digestName("text", "reply with one digit")).toBe(envelope().textDigest);
  });

  it("falls back when top-1 is low or the gap is too small", () => {
    const low = decideShadowRoute({
      envelope: envelope({ taskClass: "unknown" }),
      eligibleSkills: skills,
      constructedTools: tools,
    });
    expect(low.apply).toBe(false);
    expect(low.reasonCode).toBe("LOW_CONFIDENCE_FALLBACK_FULL_PATH");

    const twin: CatalogEntry[] = [
      { nameDigest: clock, tagDigests: [tagRead], sideEffect: false },
      { nameDigest: digestName("skill", "clock-twin"), tagDigests: [tagRead], sideEffect: false },
    ];
    const gap = decideShadowRoute({
      envelope: envelope(),
      eligibleSkills: twin,
      constructedTools: tools,
    });
    expect(gap.apply).toBe(false);
    expect(gap.reasonCode).toBe("LOW_CONFIDENCE_FALLBACK_FULL_PATH");
  });

  it("falls back on an empty candidate set", () => {
    const decision = decideShadowRoute({
      envelope: envelope(),
      eligibleSkills: [],
      constructedTools: [],
    });
    expect(decision.apply).toBe(false);
    expect(decision.reasonCode).toBe("LOW_CONFIDENCE_FALLBACK_FULL_PATH");
    expect(decision.skillCandidates).toEqual([]);
    expect(decision.toolCandidates).toEqual([]);
  });

  it("falls back to the full path on an empty envelope", () => {
    const decision = decideShadowRoute({
      envelope: envelope({ taskClass: "unknown", riskClass: "unknown" }),
      eligibleSkills: skills,
      constructedTools: tools,
    });
    expect(decision.apply).toBe(false);
    expect(decision.reasonCode).toBe("EMPTY_ENVELOPE_FALLBACK");
  });

  it("cannot expand a policy result with a high shadow score", () => {
    const constructed: CatalogEntry[] = [
      ...tools,
      { nameDigest: deniedTool, tagDigests: [tagRead], sideEffect: false },
    ];
    const decision = decideShadowRoute({
      envelope: envelope({ taskClass: "single_readonly_tool" }),
      eligibleSkills: skills,
      constructedTools: constructed,
    });
    expect(decision.toolCandidates.some((row) => row.nameDigest === deniedTool)).toBe(true);
    const policySet = [clockTool, writeTool];
    const constrained = constrainShadowToolsToPolicy(decision.toolCandidates, policySet);
    expect(constrained.some((row) => row.nameDigest === deniedTool)).toBe(false);
    expect(
      shadowCannotExpandPolicy({
        policyAuthorizedDigests: policySet,
        shadowToolCandidates: constrained,
      }),
    ).toBe(true);
    expect(decision.apply).toBe(false);
  });

  it("projects a snapshot of digests and counts only", () => {
    const decision = decideShadowRoute({
      envelope: envelope(),
      eligibleSkills: skills,
      constructedTools: tools,
    });
    const snapshot = projectShadowEvent({
      decision,
      runIdDigest: digestName("run", "run-1"),
    });
    expect(snapshot.apply).toBe(false);
    expect(snapshot.skillCandidates.every((row) => /^[0-9a-f]{16}$/.test(row.nameDigest))).toBe(
      true,
    );
    expect(snapshot.toolCandidates).toHaveLength(2);
    expect(snapshot).not.toHaveProperty("prompt");
    expect(snapshot).not.toHaveProperty("arguments");
    expect(JSON.stringify(snapshot)).not.toMatch(/clock-kind-lookup|sessions_send/);
  });

  it("measures required recall offline and compares candidates to invoked", () => {
    const decision = decideShadowRoute({
      envelope: envelope(),
      eligibleSkills: skills,
      constructedTools: tools,
    });
    const recall = computeRequiredRecall({
      requiredSkillDigests: [clock],
      requiredToolDigests: [clockTool],
      skillCandidates: decision.skillCandidates.map((row) => row.nameDigest),
      toolCandidates: decision.toolCandidates.map((row) => row.nameDigest),
    });
    expect(recall.skillRecall).toBe(1);
    expect(recall.toolRecall).toBe(1);
    expect(
      computeRequiredRecall({
        skillCandidates: [],
        toolCandidates: [],
      }),
    ).toEqual({ skillRecall: null, toolRecall: null });
    const comparison = compareCandidateVsInvoked({
      skillCandidates: decision.skillCandidates.map((row) => row.nameDigest),
      skillInvoked: [clock],
      toolCandidates: decision.toolCandidates.map((row) => row.nameDigest),
      toolInvoked: [clockTool],
    });
    expect(comparison.skillIntersectionCount).toBe(1);
    expect(comparison.toolIntersectionCount).toBe(1);
  });

  it("does not treat P2-C performance numbers as score weights", () => {
    expect(SCORE_WEIGHTS).toEqual({ classMatch: 0.5, tagOverlap: 0.3, riskAlign: 0.2 });
    expect(SCORE_WEIGHTS.classMatch + SCORE_WEIGHTS.tagOverlap + SCORE_WEIGHTS.riskAlign).toBe(1);
    expect(SCORE_WEIGHTS).not.toEqual({ classMatch: 632, tagOverlap: 886, riskAlign: 0.8 });
  });
});
