import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compareCandidateVsInvoked } from "./compare.ts";
import { digestName, scanForbiddenSubstrings } from "./digest.ts";
import { assertImplementationClosed, decideShadowRoute } from "./evaluate.ts";
import { computeRequiredRecall } from "./recall.ts";
import { SCORE_WEIGHTS } from "./score.ts";
import { PHASE1_FLAGS, type CatalogEntry, type TaskEnvelope } from "./types.ts";
import { parseTaskEnvelope } from "./validate-envelope.ts";

const clock = digestName("skill", "clock-kind-lookup");
const sample = digestName("skill", "sample-kind-lookup");
const writeSkill = digestName("skill", "publisher");
const clockTool = digestName("tool", "read_clock_kind");
const writeTool = digestName("tool", "sessions_send");
const tagRead = digestName("tag", "readonly");

function envelope(overrides: Partial<TaskEnvelope> = {}): TaskEnvelope {
  return {
    schema: "openbot.execution-router.task-envelope.v1",
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
  { nameDigest: sample, tagDigests: [tagRead], sideEffect: false },
  { nameDigest: writeSkill, tagDigests: [], sideEffect: true },
];

const tools: CatalogEntry[] = [
  { nameDigest: clockTool, tagDigests: [tagRead], sideEffect: false },
  { nameDigest: writeTool, tagDigests: [], sideEffect: true },
];

describe("Phase 1 shadow design offline package", () => {
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
    assertImplementationClosed(decision);
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

  it("records digest-only skill/tool candidates without changing catalogs", () => {
    const decision = decideShadowRoute({
      envelope: envelope({ taskClass: "single_readonly_tool" }),
      eligibleSkills: skills,
      constructedTools: tools,
    });
    expect(decision.skillCandidates.every((row) => /^[0-9a-f]{16}$/.test(row.nameDigest))).toBe(
      true,
    );
    expect(decision.toolCandidates[0]?.nameDigest).toBe(clockTool);
    expect(skills).toHaveLength(3);
    expect(tools).toHaveLength(2);
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
    const comparison = compareCandidateVsInvoked({
      skillCandidates: decision.skillCandidates.map((row) => row.nameDigest),
      skillInvoked: [clock],
      toolCandidates: decision.toolCandidates.map((row) => row.nameDigest),
      toolInvoked: [clockTool],
    });
    expect(comparison.skillIntersectionCount).toBe(1);
    expect(comparison.toolIntersectionCount).toBe(1);
  });

  it("parses the envelope schema and keeps privacy hits at zero", () => {
    const parsed = parseTaskEnvelope(envelope());
    expect(parsed.schema).toBe("openbot.execution-router.task-envelope.v1");
    expect(scanForbiddenSubstrings(JSON.stringify(parsed))).toEqual([]);
    expect(() => parseTaskEnvelope({ ...envelope(), textDigest: "not-a-digest" })).toThrow(
      /textDigest/,
    );
  });

  it("does not treat P2-C performance numbers as score weights", () => {
    expect(SCORE_WEIGHTS).toEqual({ classMatch: 0.5, tagOverlap: 0.3, riskAlign: 0.2 });
    expect(SCORE_WEIGHTS.classMatch + SCORE_WEIGHTS.tagOverlap + SCORE_WEIGHTS.riskAlign).toBe(1);
  });

  it("loads the published JSON schemas", () => {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const envelopeSchema = JSON.parse(
      readFileSync(path.join(root, "task-envelope.schema.json"), "utf8"),
    );
    const eventSchema = JSON.parse(
      readFileSync(path.join(root, "shadow-events.schema.json"), "utf8"),
    );
    expect(envelopeSchema.$id).toBe("openbot.execution-router.task-envelope.v1");
    expect(eventSchema.properties.apply.const).toBe(false);
    expect(eventSchema.properties.flags.properties.ORCHESTRATION_LIVE_INVOKE.const).toBe(false);
  });
});
