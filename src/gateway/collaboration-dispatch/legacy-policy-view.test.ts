import { describe, expect, it } from "vitest";
import type { GatewayCollaborationGroupOperatingState } from "../collaboration-learning/operating-state-types.js";
import { makeOperatingState, operatingStateMatrix } from "./__fixtures__/policy-source-matrix.js";
import {
  LEGACY_POLICY_V1_CONSUMED_FIELDS,
  resolveCollaborationPolicyV1,
  toLegacyPolicyView,
} from "./legacy-policy-view.js";
import { DEFAULT_COLLABORATION_POLICY, type CollaborationPolicyV1 } from "./policy.js";
import { compileGroupEffectivePolicy } from "./resolve-effective-policy.js";

/** Pre-P1-A3 overlay semantics (BP-06), kept only as the equality oracle. */
function overlayFromLegacyOperatingState(
  base: CollaborationPolicyV1,
  operatingState?: GatewayCollaborationGroupOperatingState | null,
): CollaborationPolicyV1 {
  const legacy = operatingState?.collaborationPolicy;
  if (!legacy) {
    return base;
  }
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const maxVisible = legacy.maxVisibleBotRepliesPerRound;
  const maxSupplementBots =
    typeof maxVisible === "number"
      ? clamp(maxVisible - 1, 1, 3)
      : base.supplement.maxSupplementBots;
  return {
    ...base,
    mention: {
      ...base.mention,
      mentionBotMustRespond: legacy.mentionBotMustRespond,
    },
    supplement: {
      ...base.supplement,
      enabled:
        typeof (legacy as { allowSupplementAfterPrimary?: boolean }).allowSupplementAfterPrimary ===
        "boolean"
          ? (legacy as { allowSupplementAfterPrimary: boolean }).allowSupplementAfterPrimary
          : base.supplement.enabled,
      maxSupplementBots,
    },
    coordinator: {
      ...base.coordinator,
      enabled:
        (legacy as { coordinatorSummarizeAfterRound?: boolean }).coordinatorSummarizeAfterRound ===
        true,
    },
  };
}

function oldResolveCollaborationPolicyV1(params?: {
  operatingState?: GatewayCollaborationGroupOperatingState | null;
  forDirectSession?: boolean;
}): CollaborationPolicyV1 {
  const merged = overlayFromLegacyOperatingState(
    DEFAULT_COLLABORATION_POLICY,
    params?.operatingState,
  );
  if (!params?.forDirectSession) {
    return merged;
  }
  return {
    ...merged,
    supplement: { ...merged.supplement, enabled: false },
    coordinator: { ...merged.coordinator, enabled: false },
    contextPolicy: { ...merged.contextPolicy, mandatoryGroupContext: false },
  };
}

function readPath(policy: CollaborationPolicyV1, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = policy;
  for (const part of parts) {
    if (cur === null || typeof cur !== "object") {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Overlay whitelist fields that both paths drive from the same L2 literals. */
const OVERLAY_DRIVEN_CONSUMED = [
  "mention.mentionBotMustRespond",
  "supplement.enabled",
  "supplement.maxSupplementBots",
  "coordinator.enabled",
] as const;

function hasExplicitOverlayInputs(os: GatewayCollaborationGroupOperatingState): boolean {
  const policy = os.collaborationPolicy as
    | (Record<string, unknown> & {
        mentionBotMustRespond?: unknown;
        maxVisibleBotRepliesPerRound?: unknown;
        allowSupplementAfterPrimary?: unknown;
        coordinatorSummarizeAfterRound?: unknown;
      })
    | undefined;
  if (!policy) {
    return false;
  }
  return (
    typeof policy.mentionBotMustRespond === "boolean" &&
    typeof policy.maxVisibleBotRepliesPerRound === "number" &&
    Number.isFinite(policy.maxVisibleBotRepliesPerRound)
  );
}

describe("P1-A3 toLegacyPolicyView", () => {
  it("maps EffectivePolicy overlay whitelist onto PolicyV1 consumed fields", () => {
    const effective = compileGroupEffectivePolicy({
      operatingState: makeOperatingState({
        policy: {
          mentionBotMustRespond: false,
          allowSupplementAfterPrimary: false,
          maxVisibleBotRepliesPerRound: 4,
          coordinatorSummarizeAfterRound: true,
        },
      }),
    });
    const view = toLegacyPolicyView(effective);
    expect(view.mention.mentionBotMustRespond).toBe(false);
    expect(view.supplement.enabled).toBe(false);
    expect(view.supplement.maxSupplementBots).toBe(3);
    expect(view.coordinator.enabled).toBe(true);
    expect(view.fallback.timeoutPolicy.byTaskType.research).toBe(60_000);
    expect(view.fallback.allowSecondaryTakeover).toBe(effective.dispatch.allowSecondaryTakeover);
    expect(view.contextPolicy.mandatoryGroupContext).toBe(true);
  });

  it("forDirectSession disables supplement/coordinator and mandatoryGroupContext", () => {
    const effective = compileGroupEffectivePolicy({});
    const view = toLegacyPolicyView(effective, { forDirectSession: true });
    expect(view.supplement.enabled).toBe(false);
    expect(view.coordinator.enabled).toBe(false);
    expect(view.contextPolicy.mandatoryGroupContext).toBe(false);
  });

  it("is a pure projection: same effective ⇒ same PolicyV1 JSON", () => {
    const effective = compileGroupEffectivePolicy({
      operatingState: makeOperatingState({
        policy: { mentionBotMustRespond: true, maxVisibleBotRepliesPerRound: 3 },
      }),
    });
    expect(JSON.stringify(toLegacyPolicyView(effective))).toBe(
      JSON.stringify(toLegacyPolicyView(effective)),
    );
  });

  it("resolveCollaborationPolicyV1 routes through the composition root + view", () => {
    const os = makeOperatingState({
      policy: {
        mentionBotMustRespond: true,
        allowSupplementAfterPrimary: true,
        maxVisibleBotRepliesPerRound: 5,
        coordinatorSummarizeAfterRound: false,
      },
    });
    const viaResolve = resolveCollaborationPolicyV1({ operatingState: os });
    const viaView = toLegacyPolicyView(compileGroupEffectivePolicy({ operatingState: os }));
    expect(viaResolve).toStrictEqual(viaView);
  });
});

describe("P1-A3 gate: toLegacyPolicyView ≡ old resolve on consumed overlay fields", () => {
  it("equals old overlay when L2 supplies mention + maxVisible (matrix subset)", () => {
    const subset = operatingStateMatrix().filter(hasExplicitOverlayInputs);
    expect(subset.length).toBeGreaterThan(100);
    for (const os of subset) {
      const old = oldResolveCollaborationPolicyV1({ operatingState: os });
      const next = toLegacyPolicyView(compileGroupEffectivePolicy({ operatingState: os }));
      for (const field of OVERLAY_DRIVEN_CONSUMED) {
        // Old overlay copied mentionBotMustRespond even when undefined; skip non-boolean.
        if (field === "mention.mentionBotMustRespond") {
          const raw = os.collaborationPolicy?.mentionBotMustRespond;
          if (typeof raw !== "boolean") {
            continue;
          }
        }
        expect(readPath(next, field), `${os.groupId} ${field}`).toEqual(readPath(old, field));
      }
    }
  });

  it("equals old overlay on the policy.test.ts characterisation cases", () => {
    const cases: Array<{
      label: string;
      os?: GatewayCollaborationGroupOperatingState | null;
      forDirectSession?: boolean;
    }> = [
      {
        label: "whitelist overlay",
        os: makeOperatingState({
          policy: {
            mentionBotMustRespond: false,
            openDiscussionWithoutMention: false,
            maxVisibleBotRepliesPerRound: 4,
            coordinatorSummarizeAfterRound: true,
          },
        }),
      },
      {
        label: "allowSupplement false",
        os: makeOperatingState({
          policy: {
            mentionBotMustRespond: true,
            openDiscussionWithoutMention: true,
            allowSupplementAfterPrimary: false,
            maxVisibleBotRepliesPerRound: 4,
          },
        }),
      },
      { label: "direct session", forDirectSession: true },
    ];
    for (const c of cases) {
      const old = oldResolveCollaborationPolicyV1({
        operatingState: c.os,
        forDirectSession: c.forDirectSession,
      });
      const next = resolveCollaborationPolicyV1({
        operatingState: c.os,
        forDirectSession: c.forDirectSession,
      });
      if (c.forDirectSession) {
        // forDirectSession only forces supplement/coordinator/contextPolicy; mention
        // follows EffectivePolicy L1 (see empty-OS alignment test).
        expect(next.supplement.enabled).toBe(false);
        expect(next.coordinator.enabled).toBe(false);
        expect(next.contextPolicy.mandatoryGroupContext).toBe(false);
        expect(next.contextPolicy).toStrictEqual(old.contextPolicy);
        continue;
      }
      for (const field of OVERLAY_DRIVEN_CONSUMED) {
        expect(readPath(next, field), `${c.label} ${field}`).toEqual(readPath(old, field));
      }
      // Timeouts / contextPolicy stay value-identical (L1 ≡ PolicyV1 defaults).
      expect(next.fallback.timeoutPolicy).toStrictEqual(old.fallback.timeoutPolicy);
      expect(next.contextPolicy).toStrictEqual(old.contextPolicy);
    }
  });

  it("documents L1 alignment when collaborationPolicy is absent (empty OS)", () => {
    const old = oldResolveCollaborationPolicyV1({});
    const next = resolveCollaborationPolicyV1({});
    // Pre-P1-A3 PolicyV1 DEFAULT disagreed with EffectivePolicy L1 on these three.
    // Live decide/round paths already read effective for wrap/supplement/mention;
    // aligning the view closes BP-06 without changing those authoritative reads.
    expect(old.mention.mentionBotMustRespond).toBe(true);
    expect(next.mention.mentionBotMustRespond).toBe(false);
    expect(old.coordinator.enabled).toBe(true);
    expect(next.coordinator.enabled).toBe(false);
    expect(old.supplement.maxSupplementBots).toBe(2);
    expect(next.supplement.maxSupplementBots).toBe(3);
    expect(next.supplement.enabled).toBe(old.supplement.enabled);
    expect(LEGACY_POLICY_V1_CONSUMED_FIELDS.length).toBeGreaterThan(0);
  });
});

describe("P1-A3 view mirrors authority effective for wrap/supplement", () => {
  it("coordinator.enabled tracks effective.dispatch.coordinatorWrap", () => {
    for (const wrap of [false, true]) {
      const effective = compileGroupEffectivePolicy({
        operatingState: makeOperatingState({
          policy: {
            mentionBotMustRespond: true,
            maxVisibleBotRepliesPerRound: 3,
            coordinatorSummarizeAfterRound: wrap,
          },
        }),
      });
      expect(toLegacyPolicyView(effective).coordinator.enabled).toBe(
        effective.dispatch.coordinatorWrap,
      );
      expect(toLegacyPolicyView(effective).coordinator.enabled).toBe(wrap);
    }
  });
});
