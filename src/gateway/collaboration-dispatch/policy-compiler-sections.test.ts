import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GroupPolicyInput } from "./effective-policy.js";
import { legacyEffectivePolicySlice } from "./policy-compiler-hash.js";
import {
  L1_GOVERNANCE_CAPABILITIES,
  measureProvenanceCoverage,
} from "./policy-compiler-sections.js";
import { compileEffectiveCollaborationPolicy } from "./policy-compiler.js";
import { POLICY_COMPILER_REVISION } from "./round-policy-snapshot.js";

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(
  readFileSync(join(here, "__fixtures__/p1a1-legacy-field-golden.json"), "utf8"),
) as Array<{ input: GroupPolicyInput; legacy: ReturnType<typeof legacyEffectivePolicySlice> }>;

describe("P1-A1 policy compiler segments", () => {
  it("preserves explicit legacy policies on the historical combination matrix", () => {
    for (const fixture of golden) {
      const compiled = compileEffectiveCollaborationPolicy({
        openDiscussionWithoutMention: false,
        maxVisibleBotRepliesPerRound: 5,
        ...fixture.input,
      });
      const expected = structuredClone(fixture.legacy);
      // Pin the former defaults as explicit L2 policy. Their provenance must
      // change to L2 rather than pretending the platform still defaults to them.
      if (fixture.input.openDiscussionWithoutMention === undefined) {
        expected.provenance.openDiscussionWithoutMention = { value: false, source: "l2" };
      }
      if (fixture.input.maxVisibleBotRepliesPerRound === undefined) {
        expected.provenance.maxVisibleBotRepliesPerRound = { value: 5, source: "l2", requested: 5 };
      }
      expect(legacyEffectivePolicySlice(compiled)).toEqual(expected);
    }
  });

  it("adds five capability segments with floorProtocol=legacy and no consumer flags", () => {
    const effective = compileEffectiveCollaborationPolicy({});
    expect(effective.participation.floorOpenness).toBe("open");
    expect(effective.participation.proactiveBots).toBe(false);
    expect(effective.participation.emergencyFanoutFuse).toBe(12);
    expect(effective.participation.rollCall).toEqual({ enabled: true, ceiling: 12 });
    expect(effective.dispatch.floorProtocol).toBe("legacy");
    expect(effective.dispatch.tuning.floor.admission.budgets.visiblePosts).toBe(3);
    expect(effective.dispatch.tuning.tier1Merge.dutyFloor).toBe(25);
    expect(effective.dispatch.tuning.cheapGate.clearlyIrrelevant).toBe(18);
    expect(effective.governance.capabilities).toEqual(L1_GOVERNANCE_CAPABILITIES);
    expect(effective.governance.coordinatorBotId).toBeNull();
    expect(effective.governance.task.deliverableRequired).toBe(false);
    expect(effective.context.crossSourceRetrieval).toBe(true);
    expect(effective.context.confidentialityCeiling).toBe("internal");
    expect(effective.presentation.replyLanguage).toBe("inherit");
    expect(POLICY_COMPILER_REVISION).toBe("1.3.0");
  });

  it("derives floorOpenness / proactiveBots / rollCall / presentation from L2 inputs", () => {
    const effective = compileEffectiveCollaborationPolicy({
      openDiscussionWithoutMention: true,
      humanStartsNewRound: false,
      maxVisibleBotRepliesPerRoundBroad: 4,
      replyLanguage: "zh",
      coordinatorBotId: "bot-c",
      confidentialityTier: "restricted",
      collaborationMode: "task_driven",
    });
    expect(effective.participation.floorOpenness).toBe("open");
    expect(effective.participation.proactiveBots).toBe(true);
    expect(effective.participation.rollCall.ceiling).toBe(4);
    expect(effective.presentation.replyLanguage).toBe("zh");
    expect(effective.governance.coordinatorBotId).toBe("bot-c");
    expect(effective.context.confidentialityCeiling).toBe("restricted");
    expect(effective.governance.task.deliverableRequired).toBe(true);
    expect(effective.provenance.segments.participation.floorOpenness.source).toBe("l2");
    expect(effective.provenance.segments.presentation.replyLanguage).toEqual({
      value: "zh",
      source: "l2",
      requested: "zh",
    });
  });

  it("achieves 100% provenance coverage on the five capability segments", () => {
    const matrix: GroupPolicyInput[] = [
      {},
      { maxVisibleBotRepliesPerRound: 20, replyLanguage: "en" },
      {
        openDiscussionWithoutMention: true,
        maxVisibleBotRepliesPerRoundBroad: 99,
        confidentialityTier: "secret",
        mentionBotMustRespond: true,
      },
      { collaborationMode: "review_driven", coordinatorBotId: "c1", deliverableRequired: false },
    ];
    for (const input of matrix) {
      const effective = compileEffectiveCollaborationPolicy(input);
      const coverage = measureProvenanceCoverage({
        participation: effective.participation,
        dispatch: effective.dispatch,
        governance: effective.governance,
        context: effective.context,
        presentation: effective.presentation,
        provenance: effective.provenance.segments,
      });
      expect(coverage.missing, JSON.stringify(coverage.missing)).toEqual([]);
      expect(coverage.mismatched, JSON.stringify(coverage.mismatched)).toEqual([]);
      expect(coverage.covered).toBe(coverage.total);
      expect(coverage.total).toBeGreaterThan(40);
    }
  });

  it("keeps legacy fields including clamps unchanged when new segment inputs are dirty", () => {
    const base: GroupPolicyInput = {
      maxVisibleBotRepliesPerRound: 20,
      collaborationMode: "research",
      lowSignalStrategy: "one_reply",
    };
    const withNewSegments: GroupPolicyInput = {
      ...base,
      maxVisibleBotRepliesPerRoundBroad: 99,
      confidentialityTier: "secret",
      // Runtime may persist a dirty string; compile must not widen legacy clamps.
      replyLanguage: "fr" as GroupPolicyInput["replyLanguage"],
    };
    const baseline = compileEffectiveCollaborationPolicy(base);
    const withNew = compileEffectiveCollaborationPolicy(withNewSegments);

    expect(legacyEffectivePolicySlice(withNew)).toEqual(legacyEffectivePolicySlice(baseline));
    expect(withNew.clamps).toEqual(baseline.clamps);
    expect(
      withNew.clamps.some((c) =>
        ["maxVisibleBotRepliesPerRoundBroad", "replyLanguage", "confidentialityTier"].includes(
          c.field,
        ),
      ),
    ).toBe(false);

    // Segment + provenance still record the constrained outcomes (no consumers yet).
    expect(withNew.participation.rollCall.ceiling).toBe(12);
    expect(withNew.provenance.segments.participation.rollCall.ceiling).toMatchObject({
      value: 12,
      source: "l1-hard",
      requested: 99,
    });
    expect(withNew.context.confidentialityCeiling).toBe("internal");
    expect(withNew.provenance.segments.context.confidentialityCeiling).toMatchObject({
      value: "internal",
      source: "l1-default",
      requested: "secret",
    });
    expect(withNew.presentation.replyLanguage).toBe("inherit");
    expect(withNew.provenance.segments.presentation.replyLanguage).toMatchObject({
      value: "inherit",
      source: "l1-default",
      requested: "fr",
    });
  });

  it("keeps bot roles free of L3 task capabilities (L1-hard)", () => {
    const caps = compileEffectiveCollaborationPolicy({}).governance.capabilities;
    expect(caps.member_bot).toEqual([]);
    expect(caps.coordinator.some((c) => c.startsWith("task."))).toBe(false);
    expect(caps.owner).toContain("task.assign");
    expect(caps.admin).toContain("task.owner_transfer");
  });
});
