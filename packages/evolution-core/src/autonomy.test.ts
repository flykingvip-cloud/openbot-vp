import { describe, expect, it } from "vitest";
import {
  canAutoApplySurface,
  defaultSurfaceAutonomyPolicy,
  evaluateSurfaceAutonomy,
  recommendAutonomyFollowUp,
} from "./autonomy.js";
import type { EvolutionSurface } from "./contracts.js";
import { getEvolutionSurface, listEvolutionSurfaces } from "./surfaces.js";

function lowRiskAutoSurface(): EvolutionSurface {
  return {
    ...getEvolutionSurface("knowledge.experience-capsule")!,
    autoApply: true,
  };
}

describe("surface autonomy", () => {
  it("defaults every registered surface to assist with no auto-apply", () => {
    expect(defaultSurfaceAutonomyPolicy("agent.working-dna").mode).toBe("assist");
    for (const surface of listEvolutionSurfaces()) {
      expect(surface.autoApply).toBe(false);
      expect(canAutoApplySurface(surface)).toBe(false);
    }
  });

  it("never auto-applies a critical surface even when mode is auto", () => {
    const critical: EvolutionSurface = {
      ...getEvolutionSurface("system.runtime-binding-governance")!,
      autoApply: true,
      allowedOperations: ["inspect", "suggest", "experiment", "apply", "observe"],
    };
    expect(
      evaluateSurfaceAutonomy({
        surface: critical,
        policy: {
          ...defaultSurfaceAutonomyPolicy(critical.surfaceId),
          mode: "auto",
          maxApplications: 3,
        },
        killSwitch: false,
        requestedScope: "shadow",
      }),
    ).toMatchObject({ ok: false, code: "critical_surface" });
  });

  it("allows auto only for an explicit low-risk grant within budget and impact", () => {
    const surface = lowRiskAutoSurface();
    const policy = {
      ...defaultSurfaceAutonomyPolicy(surface.surfaceId),
      mode: "auto" as const,
      maxApplications: 2,
      usedApplications: 0,
      maxImpactScope: "shadow" as const,
      expiresAt: "2026-09-07T00:00:00.000Z",
    };
    expect(
      evaluateSurfaceAutonomy({
        surface,
        policy,
        killSwitch: false,
        now: "2026-09-06T12:00:00.000Z",
        requestedScope: "shadow",
      }).ok,
    ).toBe(true);
    expect(
      evaluateSurfaceAutonomy({
        surface,
        policy,
        killSwitch: true,
        now: "2026-09-06T12:00:00.000Z",
        requestedScope: "shadow",
      }),
    ).toMatchObject({ ok: false, code: "kill_switch_active" });
    expect(
      evaluateSurfaceAutonomy({
        surface,
        policy: { ...policy, usedApplications: 2 },
        now: "2026-09-06T12:00:00.000Z",
        requestedScope: "shadow",
      }),
    ).toMatchObject({ ok: false, code: "budget_exhausted" });
    expect(
      evaluateSurfaceAutonomy({
        surface,
        policy,
        now: "2026-09-06T12:00:00.000Z",
        requestedScope: "canary",
      }),
    ).toMatchObject({ ok: false, code: "impact_exceeded" });
    expect(
      evaluateSurfaceAutonomy({
        surface,
        policy,
        now: "2026-09-06T12:00:00.000Z",
        requestedScope: "shadow",
        expandScope: true,
      }),
    ).toMatchObject({ ok: false, code: "scope_widened" });
    expect(
      evaluateSurfaceAutonomy({
        surface,
        policy: { ...policy, expiresAt: "2026-09-06T11:00:00.000Z" },
        now: "2026-09-06T12:00:00.000Z",
        requestedScope: "shadow",
      }),
    ).toMatchObject({ ok: false, code: "policy_expired" });
  });

  it("holds inconclusive results and recommends rollback only for low-risk regressions", () => {
    expect(recommendAutonomyFollowUp({ result: "inconclusive", riskLevel: "low" })).toBe("hold");
    expect(recommendAutonomyFollowUp({ result: "regressed", riskLevel: "high" })).toBe("hold");
    expect(recommendAutonomyFollowUp({ result: "regressed", riskLevel: "low" })).toBe(
      "rollback-recommended",
    );
    expect(recommendAutonomyFollowUp({ result: "improved", riskLevel: "low" })).toBe("continue");
  });
});
