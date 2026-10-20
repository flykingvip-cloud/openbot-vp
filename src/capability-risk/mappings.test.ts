import { describe, expect, it } from "vitest";
import { SIDE_EFFECT_CLASSES } from "../conversation-task/types.js";
import { EVOLUTION_RISK_LEVELS } from "../diagnosis/evolution-proposal.js";
import { DEFAULT_DANGEROUS_NODE_COMMANDS } from "../gateway/node-command-policy.js";
import {
  riskLevelFromBlockingGateType,
  riskLevelFromDiagnosisRisk,
  riskLevelFromNodeCommandDanger,
  riskLevelFromShellAdmission,
  riskLevelFromSideEffectClass,
} from "./mappings.js";
import {
  CAPABILITY_RISK_LEVELS,
  compareRiskLevel,
  isAtLeastRiskLevel,
  isCapabilityRiskLevel,
  maxRiskLevel,
  raiseRiskLevel,
  riskRank,
  type CapabilityRiskLevel,
} from "./risk-level.js";

describe("risk level ordering", () => {
  it("ranks levels ascending", () => {
    expect(CAPABILITY_RISK_LEVELS.map(riskRank)).toEqual([0, 1, 2, 3, 4]);
  });

  it("compares levels by danger", () => {
    expect(compareRiskLevel("L0", "L4")).toBeLessThan(0);
    expect(compareRiskLevel("L4", "L0")).toBeGreaterThan(0);
    expect(compareRiskLevel("L2", "L2")).toBe(0);
  });

  it("composes independent signals upward", () => {
    expect(maxRiskLevel("L0", "L3", "L1")).toBe("L3");
    expect(maxRiskLevel("L0")).toBe("L0");
    // No signals cannot invent danger, but it also cannot clear it: callers must
    // supply at least one level, and the identity is the least dangerous.
    expect(maxRiskLevel()).toBe("L0");
  });

  it("never lowers a level when raising to a floor", () => {
    expect(raiseRiskLevel("L4", "L1")).toBe("L4");
    expect(raiseRiskLevel("L1", "L3")).toBe("L3");
    for (const level of CAPABILITY_RISK_LEVELS) {
      for (const floor of CAPABILITY_RISK_LEVELS) {
        expect(riskRank(raiseRiskLevel(level, floor))).toBeGreaterThanOrEqual(riskRank(level));
      }
    }
  });

  it("answers at-least questions inclusively", () => {
    expect(isAtLeastRiskLevel("L3", "L3")).toBe(true);
    expect(isAtLeastRiskLevel("L4", "L3")).toBe(true);
    expect(isAtLeastRiskLevel("L2", "L3")).toBe(false);
  });

  it("recognizes only real levels", () => {
    expect(isCapabilityRiskLevel("L0")).toBe(true);
    expect(isCapabilityRiskLevel("L5")).toBe(false);
    expect(isCapabilityRiskLevel("low")).toBe(false);
    expect(isCapabilityRiskLevel(2)).toBe(false);
  });
});

describe("diagnosis risk mapping", () => {
  it("maps the real enum exhaustively with no gaps", () => {
    // Binds the adapter to the actual source enum, so adding a level there
    // surfaces here rather than silently falling through to the default.
    expect([...EVOLUTION_RISK_LEVELS]).toEqual(["low", "medium", "high"]);
    expect(EVOLUTION_RISK_LEVELS.map(riskLevelFromDiagnosisRisk)).toEqual(["L2", "L3", "L4"]);
  });

  it("floors at L2 because a remediation always mutates something", () => {
    expect(riskLevelFromDiagnosisRisk("low")).toBe("L2");
  });

  it("fails closed on an unknown level", () => {
    expect(riskLevelFromDiagnosisRisk("catastrophic")).toBe("L4");
    expect(riskLevelFromDiagnosisRisk("")).toBe("L4");
  });
});

describe("side-effect class mapping", () => {
  it("maps the real enum exhaustively", () => {
    expect([...SIDE_EFFECT_CLASSES]).toEqual([
      "none",
      "outbound_message",
      "external_write",
      "broadcast",
    ]);
    expect(SIDE_EFFECT_CLASSES.map(riskLevelFromSideEffectClass)).toEqual(["L1", "L3", "L3", "L3"]);
  });

  it("does not treat the absence of an external effect as public observation", () => {
    // `none` still permits reading private context, so L1 rather than L0.
    expect(riskLevelFromSideEffectClass("none")).toBe("L1");
  });

  it("treats every external effect as consequential", () => {
    for (const cls of ["outbound_message", "external_write", "broadcast"] as const) {
      expect(isAtLeastRiskLevel(riskLevelFromSideEffectClass(cls), "L3")).toBe(true);
    }
  });

  it("fails closed on an unknown class", () => {
    expect(riskLevelFromSideEffectClass("telepathy")).toBe("L4");
  });
});

describe("node command danger mapping", () => {
  it("treats the dangerous set as consequential and others as bounded device access", () => {
    expect(riskLevelFromNodeCommandDanger({ isDangerous: true })).toBe("L3");
    expect(riskLevelFromNodeCommandDanger({ isDangerous: false })).toBe("L2");
  });

  it("covers the real dangerous command set", () => {
    // Grounds the mapping in the actual policy source rather than a copy.
    expect(DEFAULT_DANGEROUS_NODE_COMMANDS.length).toBeGreaterThan(0);
    for (const command of DEFAULT_DANGEROUS_NODE_COMMANDS) {
      expect(typeof command).toBe("string");
      expect(riskLevelFromNodeCommandDanger({ isDangerous: true })).toBe("L3");
    }
  });

  it("never rates a device command as public observation", () => {
    for (const isDangerous of [true, false]) {
      expect(isAtLeastRiskLevel(riskLevelFromNodeCommandDanger({ isDangerous }), "L2")).toBe(true);
    }
  });
});

describe("shell admission mapping", () => {
  it("separates allowlisted from approval-required", () => {
    expect(riskLevelFromShellAdmission("allowlisted")).toBe("L2");
    expect(riskLevelFromShellAdmission("approval-required")).toBe("L3");
  });

  it("fails closed on anything else, including a denial", () => {
    // A denial must be honored, not converted into a risk level.
    expect(riskLevelFromShellAdmission("security=deny")).toBe("L4");
    expect(riskLevelFromShellAdmission("allowlist-miss")).toBe("L4");
  });
});

describe("blocking gate mapping", () => {
  it("assigns risk only to authority gates", () => {
    expect(riskLevelFromBlockingGateType("authorization")).toBe("L3");
    expect(riskLevelFromBlockingGateType("policy")).toBe("L3");
  });

  it("contributes nothing for gates that describe waiting rather than danger", () => {
    for (const gate of ["user_confirmation", "external", "data", "system"] as const) {
      expect(riskLevelFromBlockingGateType(gate)).toBeNull();
    }
  });

  it("fails closed on an unknown gate", () => {
    expect(riskLevelFromBlockingGateType("vibes")).toBe("L4");
  });
});

describe("composition across sources", () => {
  it("takes the most dangerous signal when sources disagree", () => {
    const levels: CapabilityRiskLevel[] = [
      riskLevelFromSideEffectClass("none"),
      riskLevelFromNodeCommandDanger({ isDangerous: false }),
      riskLevelFromDiagnosisRisk("high"),
    ];
    expect(maxRiskLevel(...levels)).toBe("L4");
  });

  it("keeps a low-risk composition low when every source is low", () => {
    expect(
      maxRiskLevel(
        riskLevelFromSideEffectClass("none"),
        riskLevelFromNodeCommandDanger({ isDangerous: false }),
      ),
    ).toBe("L2");
  });

  it("ignores null gate contributions without lowering the result", () => {
    const gate = riskLevelFromBlockingGateType("data");
    const composed = maxRiskLevel(riskLevelFromDiagnosisRisk("medium"), ...(gate ? [gate] : []));
    expect(composed).toBe("L3");
  });
});
