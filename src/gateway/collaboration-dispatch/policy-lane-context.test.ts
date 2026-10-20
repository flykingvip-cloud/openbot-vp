/**
 * P1-A5 ④ — context lane helper (Floor Runtime v2.1 §5.5).
 */
import { afterEach, describe, expect, it } from "vitest";
import { maxLevelFromGroupConfidentiality } from "../context-scope/confidentiality.js";
import { DEFAULT_CONTEXT_POLICY } from "../context-scope/types.js";
import { contextPolicyFromEffective } from "./legacy-policy-view.js";
import {
  CONTEXT_LANE_DEFAULT_MODE,
  describeContextLaneSingleTrackCutover,
  drainPolicyLaneDivergences,
  isContextLaneShadowWindowClean,
  normalizeConfidentialityTierForCompiler,
  resolveContextLaneForReplyRun,
  resolveContextLaneForRound,
  resolveContextLaneMode,
} from "./policy-lane-context.js";
import { compileGroupEffectivePolicy } from "./resolve-effective-policy.js";

afterEach(() => {
  drainPolicyLaneDivergences();
});

describe("P1-A5 ④ context lane mode", () => {
  it("defaults to effective when unset; explicit legacy/shadow remain kill-switch", () => {
    expect(CONTEXT_LANE_DEFAULT_MODE).toBe("effective");
    expect(resolveContextLaneMode({} as never)).toBe("effective");
    expect(resolveContextLaneMode({ collaboration: {} } as never)).toBe("effective");
    expect(resolveContextLaneMode({ collaboration: { lane: {} } } as never)).toBe("effective");
    expect(
      resolveContextLaneMode({ collaboration: { lane: { context: "shadow" } } } as never),
    ).toBe("shadow");
    expect(
      resolveContextLaneMode({ collaboration: { lane: { context: "legacy" } } } as never),
    ).toBe("legacy");
    expect(
      resolveContextLaneMode({ collaboration: { lane: { context: "effective" } } } as never),
    ).toBe("effective");
  });

  it("normalizes secret → restricted for the compiler", () => {
    expect(normalizeConfidentialityTierForCompiler("secret")).toBe("restricted");
    expect(normalizeConfidentialityTierForCompiler("restricted")).toBe("restricted");
    expect(normalizeConfidentialityTierForCompiler("public")).toBe("public");
    expect(normalizeConfidentialityTierForCompiler("nope")).toBeUndefined();
  });
});

describe("P1-A5 ④ resolveContextLaneForRound (BP-11)", () => {
  const effective = compileGroupEffectivePolicy({});
  const legacyPolicy = {
    contextPolicy: contextPolicyFromEffective(effective.context, false),
  };

  it("legacy mode: serves PolicyV1.contextPolicy, omits groupConfidentiality, no divergence", () => {
    const resolved = resolveContextLaneForRound({
      effective,
      legacyPolicy,
      mode: "legacy",
    });
    expect(resolved.mode).toBe("legacy");
    expect(resolved.planPolicy).toEqual(legacyPolicy.contextPolicy);
    expect(resolved.groupConfidentiality).toBeUndefined();
    expect(resolved.divergences).toEqual([]);
  });

  it("shadow mode: serves legacy live; golden-equivalent contextPolicy writes no divergence", () => {
    const resolved = resolveContextLaneForRound({
      effective,
      legacyPolicy,
      mode: "shadow",
    });
    expect(resolved.planPolicy).toEqual(legacyPolicy.contextPolicy);
    expect(resolved.groupConfidentiality).toBeUndefined();
    // Both sides map to internal when OS has no confidentialityTier.
    expect(resolved.divergences).toEqual([]);
  });

  it("effective mode: serves effective.context (plan-only groupConfidentiality)", () => {
    const resolved = resolveContextLaneForRound({
      effective,
      legacyPolicy,
      mode: "effective",
    });
    expect(resolved.planPolicy).toEqual(contextPolicyFromEffective(effective.context, false));
    expect(resolved.groupConfidentiality).toBe(effective.context.confidentialityCeiling);
    expect(resolved.groupConfidentiality).toBe("internal");
  });
});

describe("P1-A5 ④ resolveContextLaneForReplyRun (BP-12)", () => {
  it("legacy mode: session tier + resolveRunContextPolicy shape (zero change)", () => {
    const resolved = resolveContextLaneForReplyRun({
      forDirectSession: true,
      sessionConfidentialityTier: "restricted",
      mode: "legacy",
    });
    expect(resolved.groupConfidentiality).toBe("restricted");
    expect(resolved.planPolicy.mandatoryGroupContext).toBe(false);
    expect(resolved.divergences).toEqual([]);
  });

  it("shadow mode: value-equivalent when session tier feeds the composition root", () => {
    const resolved = resolveContextLaneForReplyRun({
      forDirectSession: false,
      sessionConfidentialityTier: "restricted",
      mode: "shadow",
    });
    expect(resolved.groupConfidentiality).toBe("restricted");
    expect(resolved.divergences).toEqual([]);
    expect(maxLevelFromGroupConfidentiality(resolved.groupConfidentiality)).toBe("restricted");
  });

  it("effective mode: serves effective.context.confidentialityCeiling", () => {
    const resolved = resolveContextLaneForReplyRun({
      forDirectSession: false,
      sessionConfidentialityTier: "public",
      mode: "effective",
    });
    expect(resolved.groupConfidentiality).toBe("public");
    expect(resolved.planPolicy.allowExternalSources).toBe(
      DEFAULT_CONTEXT_POLICY.allowExternalSources,
    );
  });

  it("shadow: secret session stays value-equivalent on confidentiality.maxLevel", () => {
    // Both sides: secret → restricted maxLevel after normalize, so no divergence.
    const resolved = resolveContextLaneForReplyRun({
      forDirectSession: false,
      sessionConfidentialityTier: "secret",
      mode: "shadow",
    });
    expect(maxLevelFromGroupConfidentiality("secret")).toBe("restricted");
    expect(maxLevelFromGroupConfidentiality(resolved.groupConfidentiality)).toBe("restricted");
    // Live still serves raw "secret" in shadow/legacy so maxLevel stays restricted.
    expect(resolved.groupConfidentiality).toBe("secret");
    expect(resolved.divergences).toEqual([]);
  });
});

describe("context lane single-track cutover (effective default)", () => {
  it("documents effective default, kill-switch, and safe group chat defaults", () => {
    const guide = describeContextLaneSingleTrackCutover();
    expect(guide.defaultMode).toBe("effective");
    expect(guide.killSwitch).toBe("legacy");
    expect(guide.flag).toBe("collaboration.lane.context");
    expect(guide.groupChatDefaults.mandatorySources).toEqual(["conversation", "group"]);
    expect(guide.groupChatDefaults.knowledgeRequires).toEqual(["retrieve", "act", "ui_scope"]);
    expect(guide.cutoverSteps.length).toBeGreaterThanOrEqual(4);
    expect(resolveContextLaneMode({} as never)).toBe("effective");
  });

  it("effective path serves authority.policy.effective.context for round + reply", () => {
    const effective = compileGroupEffectivePolicy({});
    const legacyPolicy = {
      contextPolicy: contextPolicyFromEffective(effective.context, false),
    };
    const round = resolveContextLaneForRound({
      effective,
      legacyPolicy,
      // mode omitted → resolveContextLaneMode → effective default
      cfg: { collaboration: {} } as never,
    });
    expect(round.mode).toBe("effective");
    expect(round.planPolicy).toEqual(contextPolicyFromEffective(effective.context, false));
    expect(round.groupConfidentiality).toBe(effective.context.confidentialityCeiling);

    const reply = resolveContextLaneForReplyRun({
      forDirectSession: false,
      sessionConfidentialityTier: "restricted",
      cfg: { collaboration: { lane: {} } } as never,
    });
    expect(reply.mode).toBe("effective");
    expect(reply.groupConfidentiality).toBe("restricted");
  });

  it("shadow window clean when no context-lane divergences", () => {
    expect(isContextLaneShadowWindowClean([])).toBe(true);
    expect(
      isContextLaneShadowWindowClean([
        {
          lane: "presentation",
          field: "replyLanguage",
          legacyValue: "zh",
          effectiveValue: "en",
          atMs: 1,
        },
      ]),
    ).toBe(true);
    expect(
      isContextLaneShadowWindowClean([
        {
          lane: "context",
          field: "contextPolicy",
          legacyValue: {},
          effectiveValue: {},
          atMs: 1,
        },
      ]),
    ).toBe(false);
  });
});
