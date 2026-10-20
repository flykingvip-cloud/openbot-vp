/**
 * P1-A5 ② — dispatch lane helper (Floor Runtime v2.1 §5.5;
 * BP-03 / BP-06..10 / BP-13 / B1 keywordCaps).
 */
import { afterEach, describe, expect, it } from "vitest";
import type { GatewayCollaborationGroupOperatingState } from "../collaboration-learning.js";
import { toLegacyPolicyView } from "./legacy-policy-view.js";
import {
  L1_CHEAP_GATE_DEFAULTS,
  L1_KEYWORD_CAPS_DEFAULTS,
  L1_TIER1_MERGE_DEFAULTS,
} from "./policy-compiler-sections.js";
import {
  effectivePreserveConflict,
  effectiveTier1Merge,
  legacyPreserveConflict,
  legacyTier1Merge,
  resolveDispatchLaneKeywordCaps,
  resolveDispatchLaneMode,
  resolveDispatchLanePolicyV1,
  resolveDispatchLanePreserveConflict,
  resolveDispatchLaneTier1Merge,
} from "./policy-lane-dispatch.js";
import { drainPolicyLaneDivergences, peekPolicyLaneDivergences } from "./policy-lane-divergence.js";
import { compileGroupEffectivePolicy } from "./resolve-effective-policy.js";

afterEach(() => {
  drainPolicyLaneDivergences();
});

function osWithMode(collaborationMode: string | null): GatewayCollaborationGroupOperatingState {
  return {
    groupProfile: {
      displayName: "t",
      purpose: null,
      currentMission: null,
      expectedOutputs: [],
      successCriteria: [],
      collaborationMode,
    },
  } as unknown as GatewayCollaborationGroupOperatingState;
}

function effectiveFor(os: GatewayCollaborationGroupOperatingState | null) {
  return compileGroupEffectivePolicy({ operatingState: os });
}

describe("P1-A5 ② dispatch lane mode", () => {
  it("defaults to legacy when unset / invalid (flag off)", () => {
    expect(resolveDispatchLaneMode({} as never)).toBe("legacy");
    expect(resolveDispatchLaneMode({ collaboration: {} } as never)).toBe("legacy");
    expect(
      resolveDispatchLaneMode({
        collaboration: { lane: { participation: "effective" } },
      } as never),
    ).toBe("legacy");
    expect(
      resolveDispatchLaneMode({
        collaboration: { lane: { dispatch: "bogus" } },
      } as never),
    ).toBe("legacy");
    expect(
      resolveDispatchLaneMode({
        collaboration: { lane: { dispatch: "shadow" } },
      } as never),
    ).toBe("shadow");
    expect(
      resolveDispatchLaneMode({
        collaboration: { lane: { dispatch: "effective" } },
      } as never),
    ).toBe("effective");
  });
});

describe("P1-A5 ② resolveDispatchLaneTier1Merge (BP-03)", () => {
  it("legacy: serves L1_TIER1_MERGE_DEFAULTS (byte-equal to pre-lane DEFAULT_MERGE_POLICY)", () => {
    const resolved = resolveDispatchLaneTier1Merge({ mode: "legacy" });
    expect(resolved.mode).toBe("legacy");
    expect(resolved.merge).toEqual({ ...L1_TIER1_MERGE_DEFAULTS });
    expect(resolved.divergences).toEqual([]);
    expect(peekPolicyLaneDivergences()).toEqual([]);
  });

  it("legacy≡shadow equivalence — no divergence when effective matches L1", () => {
    const effective = effectiveFor(null);
    const legacy = resolveDispatchLaneTier1Merge({ effective, mode: "legacy" });
    const shadow = resolveDispatchLaneTier1Merge({ effective, mode: "shadow" });
    expect(shadow.merge).toEqual(legacy.merge);
    expect(shadow.divergences).toEqual([]);
    expect(effectiveTier1Merge(effective)).toEqual(legacy.merge);
  });

  it("shadow: records lane=dispatch divergence when stale raw differs from effective", () => {
    const effective = effectiveFor(null);
    const resolved = resolveDispatchLaneTier1Merge({
      effective,
      tier1MergeRaw: {
        dutyFloor: 99,
        proactiveReplyThreshold: 1,
        dutyWeight: 0.1,
        relevanceWeight: 0.9,
      },
      mode: "shadow",
    });
    expect(resolved.merge.dutyFloor).toBe(99); // still serves legacy
    expect(resolved.divergences).toHaveLength(1);
    expect(resolved.divergences[0]?.lane).toBe("dispatch");
    expect(resolved.divergences[0]?.field).toBe("tier1Merge");
    expect(peekPolicyLaneDivergences()).toHaveLength(1);
  });

  it("effective: serves authority.policy.effective.dispatch.tuning.tier1Merge", () => {
    const effective = effectiveFor(null);
    const resolved = resolveDispatchLaneTier1Merge({
      effective,
      tier1MergeRaw: { dutyFloor: 99 },
      mode: "effective",
    });
    expect(resolved.merge).toEqual(effectiveTier1Merge(effective));
    expect(resolved.merge.dutyFloor).toBe(L1_TIER1_MERGE_DEFAULTS.dutyFloor);
  });
});

describe("P1-A5 ② resolveDispatchLanePolicyV1 (BP-06..10)", () => {
  it("legacy: equals toLegacyPolicyView(effective) — byte-for-byte with pre-lane", () => {
    const effective = effectiveFor(null);
    const resolved = resolveDispatchLanePolicyV1({ effective, mode: "legacy" });
    const view = toLegacyPolicyView(effective);
    expect(resolved.policy.supplement.enabled).toBe(view.supplement.enabled);
    expect(resolved.policy.supplement.maxSupplementBots).toBe(view.supplement.maxSupplementBots);
    expect(resolved.policy.coordinator.enabled).toBe(view.coordinator.enabled);
    expect(resolved.policy.fallback.allowSecondaryTakeover).toBe(
      view.fallback.allowSecondaryTakeover,
    );
    expect(resolved.divergences).toEqual([]);
  });

  it("legacy≡shadow equivalence across representative OS — no divergence", () => {
    for (const mode of [null, "discussion_driven", "task_driven", "review_driven"] as const) {
      const os = mode === null ? null : osWithMode(mode);
      const effective = effectiveFor(os);
      const legacy = resolveDispatchLanePolicyV1({ effective, mode: "legacy" });
      const shadow = resolveDispatchLanePolicyV1({ effective, mode: "shadow" });
      expect(shadow.policy.supplement).toEqual(legacy.policy.supplement);
      expect(shadow.policy.coordinator.enabled).toBe(legacy.policy.coordinator.enabled);
      expect(shadow.divergences).toEqual([]);
    }
  });

  it("shadow: cheapGate field compares L1 defaults vs tuning (equal today)", () => {
    const effective = effectiveFor(null);
    const shadow = resolveDispatchLanePolicyV1({ effective, mode: "shadow" });
    expect(effective.dispatch.tuning.cheapGate).toEqual({ ...L1_CHEAP_GATE_DEFAULTS });
    expect(shadow.divergences.find((d) => d.field === "cheapGate")).toBeUndefined();
  });

  it("effective: serves toLegacyPolicyView(effective)", () => {
    const effective = effectiveFor(osWithMode("review_driven"));
    const resolved = resolveDispatchLanePolicyV1({ effective, mode: "effective" });
    const view = toLegacyPolicyView(effective);
    expect(resolved.policy.supplement.enabled).toBe(view.supplement.enabled);
    expect(resolved.policy.coordinator.enabled).toBe(view.coordinator.enabled);
  });
});

describe("P1-A5 ② resolveDispatchLanePreserveConflict (BP-13)", () => {
  it("legacy: OS review_driven or challenge — byte-equal to pre-lane chat.ts", () => {
    expect(
      legacyPreserveConflict({
        contributionRole: "challenge",
        operatingState: osWithMode("discussion_driven"),
      }),
    ).toBe(true);
    expect(
      legacyPreserveConflict({
        contributionRole: "supplement",
        operatingState: osWithMode("review_driven"),
      }),
    ).toBe(true);
    expect(
      legacyPreserveConflict({
        contributionRole: "supplement",
        operatingState: osWithMode("discussion_driven"),
      }),
    ).toBe(false);
  });

  it("legacy≡shadow equivalence — no divergence when OS mode matches strategy", () => {
    for (const mode of ["discussion_driven", "task_driven", "review_driven"] as const) {
      const os = osWithMode(mode);
      const effective = effectiveFor(os);
      const legacy = resolveDispatchLanePreserveConflict({
        effective,
        operatingState: os,
        contributionRole: "supplement",
        mode: "legacy",
      });
      const shadow = resolveDispatchLanePreserveConflict({
        effective,
        operatingState: os,
        contributionRole: "supplement",
        mode: "shadow",
      });
      expect(shadow.preserveConflict).toBe(legacy.preserveConflict);
      expect(shadow.divergences).toEqual([]);
      expect(effectivePreserveConflict({ contributionRole: "supplement", effective })).toBe(
        legacy.preserveConflict,
      );
    }
  });

  it("shadow: records divergence when OS mode disagrees with effective.strategy", () => {
    // Stale OS says review_driven but we pass an effective compiled from discussion_driven.
    const discussionOs = osWithMode("discussion_driven");
    const effective = effectiveFor(discussionOs);
    const staleOs = osWithMode("review_driven");
    const resolved = resolveDispatchLanePreserveConflict({
      effective,
      operatingState: staleOs,
      contributionRole: "supplement",
      mode: "shadow",
    });
    expect(resolved.preserveConflict).toBe(true); // serves legacy (stale OS)
    expect(resolved.divergences).toHaveLength(1);
    expect(resolved.divergences[0]?.lane).toBe("dispatch");
    expect(resolved.divergences[0]?.field).toBe("preserveConflict");
  });

  it("effective: serves strategy.preserveConflict (or challenge)", () => {
    const os = osWithMode("review_driven");
    const effective = effectiveFor(os);
    expect(
      resolveDispatchLanePreserveConflict({
        effective,
        operatingState: os,
        contributionRole: "supplement",
        mode: "effective",
      }).preserveConflict,
    ).toBe(true);
    expect(
      resolveDispatchLanePreserveConflict({
        effective: effectiveFor(osWithMode("discussion_driven")),
        contributionRole: "challenge",
        mode: "effective",
      }).preserveConflict,
    ).toBe(true);
  });
});

describe("P1-A5 ② resolveDispatchLaneKeywordCaps (B1)", () => {
  it("legacy: equals L1_KEYWORD_CAPS_DEFAULTS (visible-reply-limit pre-lane caps)", () => {
    const resolved = resolveDispatchLaneKeywordCaps({ mode: "legacy" });
    expect(resolved.caps).toEqual({ ...L1_KEYWORD_CAPS_DEFAULTS });
    expect(resolved.divergences).toEqual([]);
  });

  it("legacy≡shadow equivalence — no divergence", () => {
    const effective = effectiveFor(null);
    const legacy = resolveDispatchLaneKeywordCaps({ effective, mode: "legacy" });
    const shadow = resolveDispatchLaneKeywordCaps({ effective, mode: "shadow" });
    expect(shadow.caps).toEqual(legacy.caps);
    expect(shadow.divergences).toEqual([]);
  });

  it("effective: serves effective.dispatch.tuning.keywordCaps", () => {
    const effective = effectiveFor(null);
    const resolved = resolveDispatchLaneKeywordCaps({ effective, mode: "effective" });
    expect(resolved.caps).toEqual({ ...effective.dispatch.tuning.keywordCaps });
  });
});

describe("P1-A5 ② exhaustive legacyTier1Merge clamp matrix", () => {
  it("undefined / partial / full raw → L1 fill (matches pre-lane DEFAULT_MERGE_POLICY)", () => {
    expect(legacyTier1Merge(undefined)).toEqual({ ...L1_TIER1_MERGE_DEFAULTS });
    expect(legacyTier1Merge({})).toEqual({ ...L1_TIER1_MERGE_DEFAULTS });
    expect(legacyTier1Merge({ dutyFloor: 10 })).toEqual({
      ...L1_TIER1_MERGE_DEFAULTS,
      dutyFloor: 10,
    });
    expect(
      legacyTier1Merge({
        dutyFloor: 1,
        proactiveReplyThreshold: 2,
        dutyWeight: 0.5,
        relevanceWeight: 0.5,
      }),
    ).toEqual({
      dutyFloor: 1,
      proactiveReplyThreshold: 2,
      dutyWeight: 0.5,
      relevanceWeight: 0.5,
    });
  });
});
