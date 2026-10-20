/**
 * Browser plan-once phase gates (BROWSER_PLAN_ONCE_PHASE_GATES).
 *
 * Production must not silently allow plan_once when sessionPhase /
 * ownershipPhase are omitted (easy to forget → automate before INTERACTIVE
 * or during 接管). Prefer auto-inject from a registered Account Computer
 * provider; if still missing, warn + BLOCKED on the production/tool path.
 *
 * Tests / inject-deps may pass allowMissingPhaseGates or rely on the library
 * default (requirePhases=false) when calling evaluatePlanOnceWireGate directly.
 */

import { createSubsystemLogger } from "../logging/subsystem.js";

export const BROWSER_PLAN_ONCE_PHASE_GATES = "BROWSER_PLAN_ONCE_PHASE_GATES" as const;

const log = createSubsystemLogger("account-computer/plan-once");

export type PlanOncePhaseContext = {
  sessionPhase?: string | null;
  ownershipPhase?: string | null;
  humanTakeover?: boolean;
};

export type PlanOncePhaseProvider = (opts?: {
  agentSessionKey?: string;
}) => PlanOncePhaseContext | null | undefined;

let phaseProvider: PlanOncePhaseProvider | null = null;

/** Hosts (Account Computer / gateway) register real session+ownership state. */
export function setPlanOncePhaseProvider(provider: PlanOncePhaseProvider | null): void {
  phaseProvider = provider;
}

export function getPlanOncePhaseProvider(): PlanOncePhaseProvider | null {
  return phaseProvider;
}

export function resetPlanOncePhaseProviderForTests(): void {
  phaseProvider = null;
}

export type ResolvePlanOncePhaseGatesOpts = {
  explicit?: PlanOncePhaseContext;
  agentSessionKey?: string;
  /**
   * When true (browser tool / production path), missing phases after inject
   * → warn + caller must BLOCKED. When false, missing phases stay allow
   * (unit / inject-deps).
   */
  requirePhases?: boolean;
  /** Test-only escape: never require; still warns when omitted. */
  allowMissingPhaseGates?: boolean;
};

export type ResolvedPlanOncePhaseGates = PlanOncePhaseContext & {
  /** True when either phase was absent before inject filled it. */
  omittedBeforeInject: boolean;
  /** True when provider supplied at least one phase field. */
  injected: boolean;
  /** True when production path would block due to still-missing phases. */
  missingRequired: boolean;
  /** Human-readable block reason when missingRequired. */
  missingReason?: string;
  source: "explicit" | "provider" | "mixed" | "none";
};

function nonEmpty(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const t = value.trim();
  return t.length > 0 ? t : undefined;
}

/**
 * Merge tool args with optional Account Computer provider, then decide whether
 * production must block. Always emits a structured warning when gates would
 * have been omitted (before or after inject attempt).
 */
export function resolvePlanOncePhaseGates(
  opts: ResolvePlanOncePhaseGatesOpts = {},
): ResolvedPlanOncePhaseGates {
  const explicitSession = nonEmpty(opts.explicit?.sessionPhase ?? undefined);
  const explicitOwnership = nonEmpty(opts.explicit?.ownershipPhase ?? undefined);
  const explicitTakeover = opts.explicit?.humanTakeover === true ? true : undefined;

  const omittedBeforeInject = !explicitSession || !explicitOwnership;

  let injectedSession: string | undefined;
  let injectedOwnership: string | undefined;
  let injectedTakeover: boolean | undefined;
  let injected = false;

  if (omittedBeforeInject && phaseProvider) {
    try {
      const fromProvider = phaseProvider({ agentSessionKey: opts.agentSessionKey }) ?? null;
      if (fromProvider) {
        injectedSession = nonEmpty(fromProvider.sessionPhase ?? undefined);
        injectedOwnership = nonEmpty(fromProvider.ownershipPhase ?? undefined);
        if (fromProvider.humanTakeover === true) {
          injectedTakeover = true;
        }
        injected = !!(injectedSession || injectedOwnership || injectedTakeover);
      }
    } catch (err) {
      log.warn("plan_once phase provider threw; continuing without inject", {
        event: "plan_once.phase_provider_error",
        landing: BROWSER_PLAN_ONCE_PHASE_GATES,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const sessionPhase = explicitSession ?? injectedSession;
  const ownershipPhase = explicitOwnership ?? injectedOwnership;
  const humanTakeover = explicitTakeover ?? injectedTakeover;

  let source: ResolvedPlanOncePhaseGates["source"] = "none";
  if (explicitSession || explicitOwnership || explicitTakeover) {
    source = injected ? "mixed" : "explicit";
  } else if (injected) {
    source = "provider";
  }

  const stillMissingSession = !sessionPhase;
  const stillMissingOwnership = !ownershipPhase;
  const allowMissing = opts.allowMissingPhaseGates === true;
  const requirePhases = opts.requirePhases === true && !allowMissing;
  const missingRequired = requirePhases && (stillMissingSession || stillMissingOwnership);

  const missingParts: string[] = [];
  if (stillMissingSession) {
    missingParts.push("sessionPhase");
  }
  if (stillMissingOwnership) {
    missingParts.push("ownershipPhase");
  }
  const missingReason = missingRequired
    ? `production plan_once requires ${missingParts.join(" + ")} ` +
      `(pass tool args or register setPlanOncePhaseProvider). ` +
      `Omitting them silently allowed automation before INTERACTIVE / during 接管.`
    : undefined;

  if (omittedBeforeInject || missingRequired) {
    log.warn("plan_once phase gates omitted or incomplete", {
      event: "plan_once.phase_gates_omitted",
      landing: BROWSER_PLAN_ONCE_PHASE_GATES,
      omittedBeforeInject,
      injected,
      source,
      sessionPhase: sessionPhase ?? null,
      ownershipPhase: ownershipPhase ?? null,
      requirePhases,
      allowMissingPhaseGates: allowMissing,
      action: missingRequired ? "block" : allowMissing ? "allow_missing" : "allow_legacy",
      missingReason: missingReason ?? null,
    });
  }

  return {
    sessionPhase: sessionPhase ?? null,
    ownershipPhase: ownershipPhase ?? null,
    humanTakeover,
    omittedBeforeInject,
    injected,
    missingRequired,
    missingReason,
    source,
  };
}

/** True for NODE_ENV=production; false under Vitest / test. */
export function isPlanOnceProductionEnv(): boolean {
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    return false;
  }
  return process.env.NODE_ENV === "production";
}
