/**
 * P1-A5 ① — participation lane helper (Floor Runtime v2.1 §5.5; BP-01/02 + mentionBotMustRespond).
 */
import { afterEach, describe, expect, it } from "vitest";
import type { GatewayCollaborationGroupOperatingState } from "../collaboration-learning.js";
import { buildParticipationCharterPolicy } from "../collaboration-learning/group-charter.js";
import { L1_DEFAULT } from "./policy-compiler.js";
import { drainPolicyLaneDivergences, peekPolicyLaneDivergences } from "./policy-lane-divergence.js";
import {
  legacyBroadcastCeiling,
  legacyPolicyCeiling,
  resolveParticipationLaneMentionMustRespond,
  resolveParticipationLaneMode,
  resolveParticipationLaneOpenDiscussion,
  resolveParticipationLaneVisibleLimits,
} from "./policy-lane-participation.js";
import { compileGroupEffectivePolicy } from "./resolve-effective-policy.js";

afterEach(() => {
  drainPolicyLaneDivergences();
});

function osWithParticipation(overrides: {
  maxVisibleBotRepliesPerRound?: number;
  maxVisibleBotRepliesPerRoundBroad?: number;
  openDiscussionWithoutMention?: boolean;
  mentionBotMustRespond?: boolean;
}): GatewayCollaborationGroupOperatingState {
  return {
    collaborationPolicy: {
      humanStartsNewRound: true,
      mentionBotMustRespond: overrides.mentionBotMustRespond ?? true,
      mentionHumanNotifiesOnly: true,
      openDiscussionWithoutMention: overrides.openDiscussionWithoutMention ?? true,
      maxVisibleBotRepliesPerRound: overrides.maxVisibleBotRepliesPerRound ?? 3,
      ...(overrides.maxVisibleBotRepliesPerRoundBroad !== undefined
        ? { maxVisibleBotRepliesPerRoundBroad: overrides.maxVisibleBotRepliesPerRoundBroad }
        : {}),
      botMaySelfAdvanceWithoutHuman: true,
      entersWaitingForHumanAfterVisibleTurnsExhausted: true,
    },
  } as unknown as GatewayCollaborationGroupOperatingState;
}

function effectiveFor(os: GatewayCollaborationGroupOperatingState) {
  return compileGroupEffectivePolicy({ operatingState: os });
}

describe("P1-A5 ① participation lane mode", () => {
  it("defaults to legacy when unset / invalid (flag off)", () => {
    expect(resolveParticipationLaneMode({} as never)).toBe("legacy");
    expect(resolveParticipationLaneMode({ collaboration: {} } as never)).toBe("legacy");
    expect(
      resolveParticipationLaneMode({
        collaboration: { lane: { presentation: "effective" } },
      } as never),
    ).toBe("legacy");
    expect(
      resolveParticipationLaneMode({
        collaboration: { lane: { participation: "bogus" } },
      } as never),
    ).toBe("legacy");
    expect(
      resolveParticipationLaneMode({
        collaboration: { lane: { participation: "shadow" } },
      } as never),
    ).toBe("shadow");
    expect(
      resolveParticipationLaneMode({
        collaboration: { lane: { participation: "effective" } },
      } as never),
    ).toBe("effective");
  });
});

describe("P1-A5 ① resolveParticipationLaneVisibleLimits (BP-01/02)", () => {
  it("legacy: serves raw OS clamp, no divergence, zero change", () => {
    const os = osWithParticipation({
      maxVisibleBotRepliesPerRound: 3,
      maxVisibleBotRepliesPerRoundBroad: 4,
    });
    const resolved = resolveParticipationLaneVisibleLimits({
      effective: effectiveFor(os),
      operatingState: os,
      botCount: 10,
      mode: "legacy",
    });
    expect(resolved.mode).toBe("legacy");
    expect(resolved.policyCeiling).toBe(3);
    expect(resolved.broadcastCeiling).toBe(4);
    expect(resolved.divergences).toEqual([]);
    expect(peekPolicyLaneDivergences()).toEqual([]);
  });

  it("legacy≡shadow equivalence across representative inputs — no divergence", () => {
    const cases: Array<{
      maxVisible?: number;
      broad?: number;
      botCount: number;
    }> = [
      { maxVisible: 3, broad: undefined, botCount: 8 },
      { maxVisible: 5, broad: 4, botCount: 10 },
      { maxVisible: 1, broad: 1, botCount: 3 },
      { maxVisible: 99, broad: 99, botCount: 6 }, // both clamp to 12
      { maxVisible: undefined, broad: undefined, botCount: 4 },
    ];
    for (const c of cases) {
      const os = osWithParticipation({
        ...(c.maxVisible !== undefined ? { maxVisibleBotRepliesPerRound: c.maxVisible } : {}),
        ...(c.broad !== undefined ? { maxVisibleBotRepliesPerRoundBroad: c.broad } : {}),
      });
      // When maxVisible omitted, wipe the default 3 so legacy falls through like unset.
      if (c.maxVisible === undefined) {
        delete (os.collaborationPolicy as { maxVisibleBotRepliesPerRound?: number })
          .maxVisibleBotRepliesPerRound;
      }
      const effective = effectiveFor(os);
      const legacy = resolveParticipationLaneVisibleLimits({
        effective,
        operatingState: os,
        botCount: c.botCount,
        mode: "legacy",
      });
      const shadow = resolveParticipationLaneVisibleLimits({
        effective,
        operatingState: os,
        botCount: c.botCount,
        mode: "shadow",
      });
      expect(shadow.policyCeiling).toBe(legacy.policyCeiling);
      expect(shadow.broadcastCeiling).toBe(legacy.broadcastCeiling);
      expect(shadow.divergences).toEqual([]);
    }
    expect(peekPolicyLaneDivergences()).toEqual([]);
  });

  it("shadow: stale/foreign effective writes lane=participation divergence", () => {
    const os = osWithParticipation({ maxVisibleBotRepliesPerRound: 3 });
    const stale = effectiveFor(osWithParticipation({ maxVisibleBotRepliesPerRound: 7 }));
    const key = {
      tenantId: "t1",
      groupId: "g1",
      episodeId: "ep_1",
      beatId: "ep_1:b0",
      policySnapshotId: "pss_1",
      policyHash: "h",
      compilerRevision: "1.2.0",
    };
    const resolved = resolveParticipationLaneVisibleLimits({
      effective: stale,
      operatingState: os,
      botCount: 10,
      mode: "shadow",
      key,
    });
    expect(resolved.policyCeiling).toBe(3); // serves legacy
    expect(resolved.divergences.some((d) => d.field === "maxVisible")).toBe(true);
    expect(resolved.divergences.find((d) => d.field === "maxVisible")).toMatchObject({
      lane: "participation",
      field: "maxVisible",
      legacyValue: 3,
      effectiveValue: 7,
      key,
    });
    expect(peekPolicyLaneDivergences().length).toBeGreaterThan(0);
  });

  it("effective: serves authority.policy.effective.participation ceilings", () => {
    const os = osWithParticipation({
      maxVisibleBotRepliesPerRound: 4,
      maxVisibleBotRepliesPerRoundBroad: 6,
    });
    const resolved = resolveParticipationLaneVisibleLimits({
      effective: effectiveFor(os),
      operatingState: os,
      botCount: 10,
      mode: "effective",
    });
    expect(resolved.policyCeiling).toBe(4);
    expect(resolved.broadcastCeiling).toBe(6);
  });

  it("legacy clamp helpers match pre-lane visible-reply-limit byte-for-byte", () => {
    expect(
      legacyPolicyCeiling(osWithParticipation({ maxVisibleBotRepliesPerRound: 99 }), null),
    ).toBe(12);
    expect(
      legacyPolicyCeiling(osWithParticipation({ maxVisibleBotRepliesPerRound: 0 }), null),
    ).toBe(1);
    expect(legacyBroadcastCeiling(osWithParticipation({}), 5)).toBe(5);
    expect(
      legacyBroadcastCeiling(osWithParticipation({ maxVisibleBotRepliesPerRoundBroad: 3 }), 10),
    ).toBe(3);
  });
});

it("null operatingState: broadcast ceiling matches unset-broad legacy (min(botCount,12))", () => {
  // Required DecideInput.operatingState may be explicitly null; must not invent an L2 broad.
  const botCount = 5;
  expect(legacyBroadcastCeiling(null, botCount)).toBe(Math.min(botCount, 12));
  expect(legacyBroadcastCeiling(undefined, botCount)).toBe(Math.min(botCount, 12));
  const resolved = resolveParticipationLaneVisibleLimits({
    operatingState: null,
    botCount,
    mode: "legacy",
  });
  expect(resolved.broadcastCeiling).toBe(5);
  expect(resolved.policyCeiling).toBe(5); // L1 default when no OS and no effective
});

describe("P1-A5 ① resolveParticipationLaneMentionMustRespond", () => {
  it("legacy: uses injected effective (no divergence)", () => {
    const os = osWithParticipation({ mentionBotMustRespond: true });
    const resolved = resolveParticipationLaneMentionMustRespond({
      effective: effectiveFor(os),
      operatingState: os,
      mode: "legacy",
    });
    expect(resolved.mentionBotMustRespond).toBe(true);
    expect(resolved.divergences).toEqual([]);
  });

  it("shadow: raw OS ≡ effective → no divergence; serves legacy", () => {
    const os = osWithParticipation({ mentionBotMustRespond: false });
    const resolved = resolveParticipationLaneMentionMustRespond({
      effective: effectiveFor(os),
      operatingState: os,
      mode: "shadow",
    });
    expect(resolved.mentionBotMustRespond).toBe(false);
    expect(resolved.divergences).toEqual([]);
  });

  it("shadow: stale effective records mentionBotMustRespond divergence", () => {
    const os = osWithParticipation({ mentionBotMustRespond: true });
    const stale = effectiveFor(osWithParticipation({ mentionBotMustRespond: false }));
    const resolved = resolveParticipationLaneMentionMustRespond({
      effective: stale,
      operatingState: os,
      mode: "shadow",
    });
    // legacy serve = compile-or-inject path uses the (stale) injected effective
    expect(resolved.mentionBotMustRespond).toBe(false);
    expect(resolved.divergences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lane: "participation",
          field: "mentionBotMustRespond",
          legacyValue: true,
          effectiveValue: false,
        }),
      ]),
    );
  });

  it("effective: serves authority.policy.effective.participation.mentionBotMustRespond", () => {
    const os = osWithParticipation({ mentionBotMustRespond: true });
    expect(
      resolveParticipationLaneMentionMustRespond({
        effective: effectiveFor(os),
        operatingState: os,
        mode: "effective",
      }).mentionBotMustRespond,
    ).toBe(true);
  });
});

describe("P1-A5 ① resolveParticipationLaneOpenDiscussion", () => {
  it("shadow: golden-equivalent when OS matches compiled effective", () => {
    for (const open of [true, false]) {
      const os = osWithParticipation({ openDiscussionWithoutMention: open });
      const resolved = resolveParticipationLaneOpenDiscussion({
        effective: effectiveFor(os),
        operatingState: os,
        mode: "shadow",
      });
      expect(resolved.openDiscussionWithoutMention).toBe(open);
      expect(resolved.divergences).toEqual([]);
    }
  });
});

describe("P1-A5 ① BP-04/05 charter dead branch (2³ exhaustive)", () => {
  /**
   * buildParticipationCharterPolicy only emits fixed template lines. Across the
   * 2³ combinations of (mentionBotMustRespond, openDiscussionWithoutMention,
   * humanStartsNewRound), none of the whenToSpeak lines match the old
   * charterRequiresMentionToSpeak predicates (被@必须回应 / 未点名时不要全员开口 / …).
   * The decision-engine fan-out skip was therefore unreachable and is deleted.
   */
  function charterRequiresMentionToSpeak(whenToSpeak: readonly string[]): boolean {
    return whenToSpeak.some((line) => {
      const compact = line.replace(/\s+/g, "");
      if (/必须考虑/.test(line) || compact.includes("必须考虑")) {
        return false;
      }
      if (/非\s*@/.test(line) || compact.includes("非@")) {
        return false;
      }
      if (
        /未点名时不要全员开口|才开放扇出/.test(line) ||
        compact.includes("未点名时不要全员开口")
      ) {
        return true;
      }
      if (
        (line.includes("被 @") || compact.includes("被@")) &&
        /必须回应|才(能|可)?发言/.test(line)
      ) {
        return true;
      }
      return (
        (line.includes("@") && /必须回应|才(能|可)?发言|when\s+mentioned/i.test(line)) ||
        /@mentioned/i.test(line)
      );
    });
  }

  it("all 8 (mention × openDiscussion × humanStarts) charters never require mention-to-speak", () => {
    const bools = [false, true] as const;
    let covered = 0;
    for (const mention of bools) {
      for (const open of bools) {
        for (const humanStarts of bools) {
          covered += 1;
          const policy = buildParticipationCharterPolicy({
            purpose: "test",
            currentMission: "mission",
            collaborationPolicy: {
              humanStartsNewRound: humanStarts,
              mentionBotMustRespond: mention,
              mentionHumanNotifiesOnly: true,
              openDiscussionWithoutMention: open,
              maxVisibleBotRepliesPerRound: 3,
              botMaySelfAdvanceWithoutHuman: false,
              entersWaitingForHumanAfterVisibleTurnsExhausted: true,
            },
          });
          expect(charterRequiresMentionToSpeak(policy.whenToSpeak)).toBe(false);
        }
      }
    }
    expect(covered).toBe(8);
  });
});

describe("P1-A5 follow-up: participation L1 defaults ≡ policy-compiler L1_DEFAULT", () => {
  it("legacy ceilings / booleans with null OS equal L1_DEFAULT fields", () => {
    expect(legacyPolicyCeiling(null)).toBe(L1_DEFAULT.maxVisibleBotRepliesPerRound);
    const open = resolveParticipationLaneOpenDiscussion({
      operatingState: null,
      effective: compileGroupEffectivePolicy({ operatingState: null }),
      mode: "legacy",
    });
    expect(open.openDiscussionWithoutMention).toBe(L1_DEFAULT.openDiscussionWithoutMention);
    const mention = resolveParticipationLaneMentionMustRespond({
      operatingState: null,
      effective: compileGroupEffectivePolicy({ operatingState: null }),
      mode: "legacy",
    });
    expect(mention.mentionBotMustRespond).toBe(L1_DEFAULT.mentionBotMustRespond);
    const vis = resolveParticipationLaneVisibleLimits({
      operatingState: null,
      botCount: 3,
      effective: compileGroupEffectivePolicy({ operatingState: null }),
      mode: "legacy",
    });
    expect(vis.policyCeiling).toBe(L1_DEFAULT.maxVisibleBotRepliesPerRound);
  });
});
