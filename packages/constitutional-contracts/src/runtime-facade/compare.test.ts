import { describe, expect, it } from "vitest";
import {
  PHASE_D_P8C_SHADOW_LEGACY_COMPARE_SCOPE,
  SHADOW_COMPARE_ENV,
  compareShadowToLegacy,
  isConstitutionalShadowCompareEnabled,
} from "./compare.js";

describe("shadow↔legacy compare (P8c)", () => {
  it("stays inert when shadow is off even if compare is on", () => {
    const result = compareShadowToLegacy(
      {
        legacyDecision: "constitutional.declared.v1",
        constitutionalDecision: "constitutional.declared.v1",
      },
      { shadowEnabled: false, compare: true },
    );
    expect(result.scope).toBe(PHASE_D_P8C_SHADOW_LEGACY_COMPARE_SCOPE);
    expect(result.shadowCompared).toBe(false);
    expect(result.compareMatch).toBeNull();
    expect(result.legacyDecisionPresent).toBe(true);
    expect(result.constitutionalDecisionPresent).toBe(true);
    expect(result.readyToTighten).toBe(false);
    expect(result.paintedAliasUsedAsPath).toBe(false);
  });

  it("stays inert when COMPARE is default-off under shadow", () => {
    const result = compareShadowToLegacy(
      {
        legacyDecision: "constitutional.declared.v1",
        constitutionalDecision: "constitutional.declared.v1",
      },
      { shadowEnabled: true },
    );
    expect(result.shadowCompared).toBe(false);
    expect(result.compareMatch).toBeNull();
    expect(result.readyToTighten).toBe(false);
    expect(result.compareMessage).toContain("COMPARE default-off");
  });

  it("sets shadowCompared=true and compareMatch on dual opt-in with enough snapshots", () => {
    const match = compareShadowToLegacy(
      {
        legacyPathRef: "constitutional.declared.v1",
        constitutionalDecision: "constitutional.declared.v1",
      },
      { shadowEnabled: true, compare: true },
    );
    expect(match.shadowCompared).toBe(true);
    expect(match.compareMatch).toBe(true);
    expect(match.legacyDecisionPresent).toBe(true);
    expect(match.constitutionalDecisionPresent).toBe(true);
    expect(match.readyToTighten).toBe(false);
    expect(match.compareMessage).toContain("match");

    const mismatch = compareShadowToLegacy(
      {
        legacyDecision: "legacy-other",
        constitutionalDecision: "constitutional.declared.v1",
      },
      { shadowEnabled: true, env: { [SHADOW_COMPARE_ENV]: "true" } },
    );
    expect(mismatch.shadowCompared).toBe(true);
    expect(mismatch.compareMatch).toBe(false);
    expect(mismatch.readyToTighten).toBe(false);
    expect(mismatch.compareMessage).toContain("mismatch");
  });

  it("does not set shadowCompared when either side is missing", () => {
    const noLegacy = compareShadowToLegacy(
      { constitutionalDecision: "constitutional.declared.v1" },
      { shadowEnabled: true, compare: true },
    );
    expect(noLegacy.shadowCompared).toBe(false);
    expect(noLegacy.compareMatch).toBeNull();
    expect(noLegacy.legacyDecisionPresent).toBe(false);
    expect(noLegacy.constitutionalDecisionPresent).toBe(true);

    const noConst = compareShadowToLegacy(
      { legacyDecision: "constitutional.declared.v1" },
      { shadowEnabled: true, compare: true },
    );
    expect(noConst.shadowCompared).toBe(false);
    expect(noConst.compareMatch).toBeNull();
    expect(noConst.legacyDecisionPresent).toBe(true);
    expect(noConst.constitutionalDecisionPresent).toBe(false);
  });

  it("treats legacyPathRef as a string snapshot, never as Path elevation", () => {
    const result = compareShadowToLegacy(
      {
        legacyPathRef: "lobster",
        constitutionalDecision: "lobster",
      },
      { shadowEnabled: true, compare: true },
    );
    expect(result.shadowCompared).toBe(true);
    expect(result.compareMatch).toBe(true);
    expect(result.paintedAliasUsedAsPath).toBe(false);
    expect(result.readyToTighten).toBe(false);
  });

  it("does not read process.env; honors caller snapshot only", () => {
    const previous = process.env[SHADOW_COMPARE_ENV];
    process.env[SHADOW_COMPARE_ENV] = "true";
    try {
      expect(isConstitutionalShadowCompareEnabled({})).toBe(false);
      const result = compareShadowToLegacy(
        {
          legacyDecision: "a",
          constitutionalDecision: "a",
        },
        { shadowEnabled: true },
      );
      expect(result.shadowCompared).toBe(false);
      expect(
        isConstitutionalShadowCompareEnabled({ [SHADOW_COMPARE_ENV]: "yes" }),
      ).toBe(true);
    } finally {
      if (previous === undefined) {
        delete process.env[SHADOW_COMPARE_ENV];
      } else {
        process.env[SHADOW_COMPARE_ENV] = previous;
      }
    }
  });

  it("rolls back when COMPARE is explicitly false", () => {
    const result = compareShadowToLegacy(
      {
        legacyDecision: "a",
        constitutionalDecision: "a",
      },
      {
        shadowEnabled: true,
        compare: false,
        env: { [SHADOW_COMPARE_ENV]: "false" },
      },
    );
    expect(result.shadowCompared).toBe(false);
    expect(result.compareMatch).toBeNull();
    expect(result.readyToTighten).toBe(false);
  });
});
