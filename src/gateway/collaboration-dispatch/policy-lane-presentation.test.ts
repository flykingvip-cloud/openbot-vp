/**
 * P1-A5 ⑤ — presentation lane helper (Floor Runtime v2.1 §5.5; BP-14 + BP-20).
 */
import { afterEach, describe, expect, it } from "vitest";
import type { GatewayCollaborationGroupOperatingState } from "../collaboration-learning.js";
import { drainPolicyLaneDivergences, peekPolicyLaneDivergences } from "./policy-lane-divergence.js";
import {
  pinnedReplyLanguage,
  projectSpaceEffectivePolicyView,
  readOperatingStateReplyLanguageRaw,
  resolvePresentationLaneMode,
  resolvePresentationLaneReplyLanguage,
  RUNTIME_NOT_ENFORCED_EFFECTIVE_FIELDS,
  withSpaceEffectivePolicy,
} from "./policy-lane-presentation.js";
import { resolveCollaborationReplyLanguage } from "./reply-language.js";
import { compileGroupEffectivePolicy } from "./resolve-effective-policy.js";

afterEach(() => {
  drainPolicyLaneDivergences();
});

function osWithLanguage(replyLanguage: unknown): GatewayCollaborationGroupOperatingState {
  return {
    collaborationPolicy: {
      humanStartsNewRound: true,
      mentionBotMustRespond: true,
      mentionHumanNotifiesOnly: true,
      openDiscussionWithoutMention: true,
      maxVisibleBotRepliesPerRound: 3,
      botMaySelfAdvanceWithoutHuman: true,
      entersWaitingForHumanAfterVisibleTurnsExhausted: true,
      ...(replyLanguage !== undefined ? { replyLanguage } : {}),
    },
  } as unknown as GatewayCollaborationGroupOperatingState;
}

function effectiveFor(os: GatewayCollaborationGroupOperatingState) {
  return compileGroupEffectivePolicy({ operatingState: os });
}

describe("P1-A5 ⑤ presentation lane mode", () => {
  it("defaults to legacy when unset (flag off)", () => {
    expect(resolvePresentationLaneMode({} as never)).toBe("legacy");
    expect(resolvePresentationLaneMode({ collaboration: {} } as never)).toBe("legacy");
    expect(
      resolvePresentationLaneMode({ collaboration: { lane: { context: "effective" } } } as never),
    ).toBe("legacy");
    expect(
      resolvePresentationLaneMode({ collaboration: { lane: { presentation: "bogus" } } } as never),
    ).toBe("legacy");
    expect(
      resolvePresentationLaneMode({
        collaboration: { lane: { presentation: "shadow" } },
      } as never),
    ).toBe("shadow");
    expect(
      resolvePresentationLaneMode({
        collaboration: { lane: { presentation: "effective" } },
      } as never),
    ).toBe("effective");
  });

  it("reads the raw BP-14 source verbatim (composition root)", () => {
    expect(readOperatingStateReplyLanguageRaw(osWithLanguage("en"))).toBe("en");
    expect(readOperatingStateReplyLanguageRaw(osWithLanguage("inherit"))).toBe("inherit");
    expect(readOperatingStateReplyLanguageRaw(osWithLanguage(undefined))).toBeUndefined();
    expect(readOperatingStateReplyLanguageRaw(null)).toBeUndefined();
    expect(pinnedReplyLanguage("inherit")).toBeNull();
    expect(pinnedReplyLanguage("zh")).toBe("zh");
  });
});

describe("P1-A5 ⑤ resolvePresentationLaneReplyLanguage (BP-14)", () => {
  it("legacy: serves raw operatingState value, no divergence, zero change", () => {
    for (const lang of ["zh", "en", "inherit", undefined]) {
      const os = osWithLanguage(lang);
      const resolved = resolvePresentationLaneReplyLanguage({
        effective: effectiveFor(os),
        operatingState: os,
        mode: "legacy",
      });
      expect(resolved.mode).toBe("legacy");
      expect(resolved.groupLanguage).toBe(lang);
      expect(resolved.divergences).toEqual([]);
    }
    expect(peekPolicyLaneDivergences()).toEqual([]);
  });

  it("shadow: golden-equivalent for zh|en|inherit|unset — serves legacy, writes no divergence", () => {
    for (const lang of ["zh", "en", "inherit", undefined]) {
      const os = osWithLanguage(lang);
      const resolved = resolvePresentationLaneReplyLanguage({
        effective: effectiveFor(os),
        operatingState: os,
        mode: "shadow",
      });
      expect(resolved.groupLanguage).toBe(lang);
      expect(resolved.divergences).toEqual([]);
    }
    expect(peekPolicyLaneDivergences()).toEqual([]);
  });

  it("shadow: a stale/foreign effective is recorded as lane=presentation divergence", () => {
    const os = osWithLanguage("en");
    const staleEffective = effectiveFor(osWithLanguage("zh"));
    const key = {
      tenantId: "t1",
      groupId: "g1",
      episodeId: "ep_1",
      beatId: "ep_1:b0",
      policySnapshotId: "pss_1",
      policyHash: "h",
      compilerRevision: "1.2.0",
    };
    const resolved = resolvePresentationLaneReplyLanguage({
      effective: staleEffective,
      operatingState: os,
      mode: "shadow",
      key,
    });
    expect(resolved.groupLanguage).toBe("en");
    expect(resolved.divergences).toHaveLength(1);
    expect(resolved.divergences[0]).toMatchObject({
      lane: "presentation",
      field: "replyLanguage",
      legacyValue: "en",
      effectiveValue: "zh",
      key,
    });
    expect(peekPolicyLaneDivergences()).toHaveLength(1);
  });

  it("effective: serves authority.policy.effective.presentation.replyLanguage", () => {
    const os = osWithLanguage("en");
    const resolved = resolvePresentationLaneReplyLanguage({
      effective: effectiveFor(os),
      operatingState: os,
      mode: "effective",
    });
    expect(resolved.groupLanguage).toBe("en");
    const unset = osWithLanguage(undefined);
    expect(
      resolvePresentationLaneReplyLanguage({
        effective: effectiveFor(unset),
        operatingState: unset,
        mode: "effective",
      }).groupLanguage,
    ).toBe("inherit");
  });

  it("dirty L2 language: effective=inherit; both sides detect per turn (no divergence)", () => {
    const os = osWithLanguage("fr");
    const effective = effectiveFor(os);
    expect(effective.presentation.replyLanguage).toBe("inherit");
    expect(effective.provenance.segments.presentation.replyLanguage.requested).toBe("fr");
    const shadow = resolvePresentationLaneReplyLanguage({
      effective,
      operatingState: os,
      mode: "shadow",
    });
    expect(shadow.divergences).toEqual([]);
    const live = resolvePresentationLaneReplyLanguage({
      effective,
      operatingState: os,
      mode: "effective",
    });
    // Value-equivalent at the consumer: same resolved turn language either way.
    for (const userMessage of ["请帮我看下", "please take a look"]) {
      expect(
        resolveCollaborationReplyLanguage({ userMessage, groupLanguage: shadow.groupLanguage }),
      ).toBe(resolveCollaborationReplyLanguage({ userMessage, groupLanguage: live.groupLanguage }));
    }
  });

  it("compiles from operatingState when no effective is passed (non-legacy only)", () => {
    const os = osWithLanguage("zh");
    const resolved = resolvePresentationLaneReplyLanguage({
      operatingState: os,
      mode: "effective",
    });
    expect(resolved.groupLanguage).toBe("zh");
  });
});

describe("P1-A5 ⑤ projectSpaceEffectivePolicyView (BP-20)", () => {
  it("returns frozen effective + provenance + hashes and the not-enforced list", () => {
    const view = projectSpaceEffectivePolicyView({
      operatingState: osWithLanguage("en"),
      collaborationMode: "task_driven",
      systemInstructions: ["先复述约束"],
    });
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.effective)).toBe(true);
    expect(view.effective.presentation.replyLanguage).toBe("en");
    expect(view.effective.provenance.segments.presentation.replyLanguage.source).toBe("l2");
    expect(view.effective.strategy.id).toBe("task_driven");
    expect(view.effective.guidance.systemInstructions).toEqual(["先复述约束"]);
    // P4: botMaySelfAdvanceWithoutHuman is enforced by trySelfAdvance (no longer not-enforced).
    expect(view.effective.governance.botMaySelfAdvanceWithoutHuman).toBe(true);
    expect(view.runtimeNotEnforced).not.toContain("governance.botMaySelfAdvanceWithoutHuman");
    expect(view.runtimeNotEnforced).toEqual(RUNTIME_NOT_ENFORCED_EFFECTIVE_FIELDS);
    expect(view.policyHash).toMatch(/\S+/);
    expect(view.provenanceHash).toMatch(/\S+/);
    expect(view.compilerRevision).toMatch(/\d+\.\d+\.\d+/);
    expect(() => JSON.stringify(view)).not.toThrow();
  });

  it("profile overlay wins over operatingState for mode / final decision (UI precedence)", () => {
    const view = projectSpaceEffectivePolicyView({
      operatingState: osWithLanguage(undefined),
      collaborationMode: "review_driven",
      finalDecisionPolicy: { mode: "human_required", allowAgentPublishProposal: true },
    });
    expect(view.effective.strategy.id).toBe("review_driven");
    expect(view.effective.presentation.replyLanguage).toBe("inherit");
  });

  it("withSpaceEffectivePolicy attaches the view without mutating the snapshot", () => {
    const space = { id: "space:g1", operatingState: osWithLanguage("zh") };
    const out = withSpaceEffectivePolicy(space);
    expect(out.effectivePolicy?.effective.presentation.replyLanguage).toBe("zh");
    expect("effectivePolicy" in space).toBe(false);
  });
});
