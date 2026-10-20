import type { EvolutionSurface } from "./contracts.js";
import type { ApplicationScope, EvolutionRiskLevel } from "./types.js";

export const SURFACE_AUTONOMY_MODES = ["off", "assist", "auto"] as const;
export type SurfaceAutonomyMode = (typeof SURFACE_AUTONOMY_MODES)[number];

export const DEFAULT_SURFACE_AUTONOMY_MODE: SurfaceAutonomyMode = "assist";

export type SurfaceAutonomyPolicy = {
  surfaceId: string;
  mode: SurfaceAutonomyMode;
  maxApplications: number;
  usedApplications: number;
  maxImpactScope: ApplicationScope;
  expiresAt?: string;
};

export type SurfaceAutonomyDecision = { ok: true } | { ok: false; code: string; reason: string };

const IMPACT_RANK: Record<ApplicationScope, number> = {
  shadow: 0,
  canary: 1,
  active: 2,
};

export function defaultSurfaceAutonomyPolicy(surfaceId: string): SurfaceAutonomyPolicy {
  return {
    surfaceId,
    mode: DEFAULT_SURFACE_AUTONOMY_MODE,
    maxApplications: 0,
    usedApplications: 0,
    maxImpactScope: "shadow",
  };
}

export function evaluateSurfaceAutonomy(input: {
  surface: EvolutionSurface | null;
  policy?: SurfaceAutonomyPolicy;
  killSwitch?: boolean;
  now?: string;
  requestedScope?: ApplicationScope;
  expandScope?: boolean;
}): SurfaceAutonomyDecision {
  const surface = input.surface;
  if (!surface) {
    return { ok: false, code: "unknown_surface", reason: "unregistered surface fails closed" };
  }
  if (surface.riskLevel === "critical") {
    return { ok: false, code: "critical_surface", reason: "critical surfaces never auto-apply" };
  }
  if (!surface.autoApply) {
    return { ok: false, code: "auto_apply_disabled", reason: "surface autoApply is not granted" };
  }
  if (!surface.allowedOperations.includes("apply")) {
    return { ok: false, code: "operation_forbidden", reason: "surface does not allow apply" };
  }
  if (input.killSwitch) {
    return { ok: false, code: "kill_switch_active", reason: "kill switch blocks new applications" };
  }
  if (input.expandScope) {
    return {
      ok: false,
      code: "scope_widened",
      reason: "automation cannot widen tenant, principal, or capability scope",
    };
  }
  const policy = input.policy ?? defaultSurfaceAutonomyPolicy(surface.surfaceId);
  if (policy.surfaceId !== surface.surfaceId) {
    return { ok: false, code: "policy_mismatch", reason: "autonomy policy does not match surface" };
  }
  if (policy.mode === "off") {
    return { ok: false, code: "mode_off", reason: "surface autonomy is off" };
  }
  if (policy.mode !== "auto") {
    return { ok: false, code: "assist_default", reason: "default assist cannot auto-apply" };
  }
  if (policy.expiresAt && (input.now ?? "") >= policy.expiresAt) {
    return { ok: false, code: "policy_expired", reason: "surface autonomy TTL has expired" };
  }
  if (policy.usedApplications >= policy.maxApplications) {
    return { ok: false, code: "budget_exhausted", reason: "surface autonomy budget is exhausted" };
  }
  const requested = input.requestedScope ?? "shadow";
  if (IMPACT_RANK[requested] > IMPACT_RANK[policy.maxImpactScope]) {
    return {
      ok: false,
      code: "impact_exceeded",
      reason: "requested apply scope exceeds autonomy impact limit",
    };
  }
  return { ok: true };
}

export function canAutoApplySurface(surface: EvolutionSurface): boolean {
  return evaluateSurfaceAutonomy({ surface }).ok;
}

export function recommendAutonomyFollowUp(input: {
  result: "improved" | "neutral" | "regressed" | "inconclusive" | "pending";
  riskLevel: EvolutionRiskLevel;
}): "continue" | "hold" | "rollback-recommended" {
  if (input.result === "regressed") {
    return input.riskLevel === "low" ? "rollback-recommended" : "hold";
  }
  if (input.result === "inconclusive" || input.result === "pending") {
    return "hold";
  }
  return "continue";
}
