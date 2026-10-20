/**
 * Governance runtime actions with compare-and-restore snapshots.
 * Pause/limit/redirect only restore bindings this action actually changed.
 *
 * Ordinary evolution proposals cannot call this module. Control-plane apply is
 * Surface-gated (`system.runtime-binding-governance` is critical and needs
 * platform approval). The kill switch blocks new mutations and cannot be
 * disabled by evolution; restore/rollback still runs.
 */

import {
  getAgent,
  listBindings,
  updateBindingPriority,
  updateBindingState,
  type BindingState,
  type RuntimeAgent,
} from "../agent-runtime-store.js";
import {
  isGovernanceKillSwitchActive,
  readGovernancePersistedState,
  writeGovernancePersistedState,
} from "./persistent-store.js";
import { getRedirectMapSnapshot, invalidateGovernanceRedirectCache } from "./redirect-cache.js";

export type GovernanceRuntimeAction =
  | "pause"
  | "resume"
  | "limit"
  | "clear_limit"
  | "redirect"
  | "clear_redirect";

export type ApplyGovernanceRuntimeActionResult = {
  ok: boolean;
  reason?: string;
  affectedBindingIds: string[];
  redirectTargetAgentId?: string | null;
};

/** Snapshot of bindings changed by a pause (or redirect pause). */
export type AgentPauseRecord = {
  /** States before this pause action. */
  originalStates: Record<string, BindingState>;
  /** Bindings this action set to disabled (restore candidates). */
  disabledByThisAction: string[];
  appliedAt: string;
  reason: string;
};

export type AgentLimitRecord = {
  originalPriorities: Record<string, number>;
  originalStates: Record<string, BindingState>;
  /** Bindings this limit action modified. */
  changedBindingIds: string[];
  appliedAt: string;
  reason: string;
};

export type AgentRedirectRecord = {
  targetAgentId: string;
  appliedAt: string;
  reason: string;
  /** Bindings this redirect disabled (must restore only these). */
  pausedBindingIds: string[];
  /** Prior states for those bindings. */
  originalStates: Record<string, BindingState>;
};

export function applyGovernanceRuntimeAction(params: {
  runtimeAgentId: string;
  action: GovernanceRuntimeAction;
  reason?: string;
  idempotencyKey?: string;
  redirectTargetAgentId?: string | null;
}): ApplyGovernanceRuntimeActionResult {
  const restoreActions = new Set<GovernanceRuntimeAction>([
    "resume",
    "clear_limit",
    "clear_redirect",
  ]);
  if (isGovernanceKillSwitchActive() && !restoreActions.has(params.action)) {
    return { ok: false, reason: "kill-switch-active", affectedBindingIds: [] };
  }
  const agentId = params.runtimeAgentId.trim();
  if (!agentId) {
    return { ok: false, reason: "missing-runtime-agent", affectedBindingIds: [] };
  }

  switch (params.action) {
    case "pause":
      return applyPause(agentId, params.reason ?? "pause");
    case "resume":
      return applyResume(agentId, params.reason ?? "resume");
    case "limit":
      return applyLimit(agentId, params.reason ?? "limit");
    case "clear_limit":
      return clearLimit(agentId, params.reason ?? "clear_limit");
    case "redirect":
      return applyRedirect(
        agentId,
        params.redirectTargetAgentId?.trim() ?? "",
        params.reason ?? "redirect",
      );
    case "clear_redirect":
      return clearRedirect(agentId, params.reason ?? "clear_redirect");
    default:
      return { ok: false, reason: "unknown-action", affectedBindingIds: [] };
  }
}

function applyPause(agentId: string, reason: string): ApplyGovernanceRuntimeActionResult {
  const state = readGovernancePersistedState();
  const pauses = { ...state.pauses } as Record<string, AgentPauseRecord>;
  if (pauses[agentId]?.disabledByThisAction?.length) {
    return {
      ok: true,
      reason: "pause-already-applied",
      affectedBindingIds: pauses[agentId].disabledByThisAction,
    };
  }

  const bindings = listBindings({
    runtimeAgentId: agentId,
    capabilityId: null,
    bindingType: null,
    bindingState: null,
    health: null,
  });
  const originalStates: Record<string, BindingState> = {};
  const disabledByThisAction: string[] = [];
  for (const binding of bindings) {
    originalStates[binding.bindingId] = binding.bindingState;
    if (binding.bindingState === "disabled") {
      continue; // leave pre-existing disabled alone
    }
    try {
      updateBindingState(binding.bindingId, "disabled");
      disabledByThisAction.push(binding.bindingId);
    } catch {
      // skip
    }
  }
  pauses[agentId] = {
    originalStates,
    disabledByThisAction,
    appliedAt: new Date().toISOString(),
    reason,
  };
  writeGovernancePersistedState({ ...state, pauses });
  return { ok: true, reason, affectedBindingIds: disabledByThisAction };
}

/**
 * Resume only bindings this pause action disabled, and only if still disabled.
 * Restores each to its pre-pause state (active/degraded/warming), not blanket active.
 */
function applyResume(agentId: string, reason: string): ApplyGovernanceRuntimeActionResult {
  const state = readGovernancePersistedState();
  const pauses = { ...state.pauses } as Record<string, AgentPauseRecord>;
  const record = pauses[agentId];
  if (!record) {
    // No snapshot: refuse to mass-enable (would escalate privileges).
    return { ok: false, reason: "no-pause-snapshot", affectedBindingIds: [] };
  }
  const affected: string[] = [];
  for (const bindingId of record.disabledByThisAction) {
    const binding = listBindings({
      runtimeAgentId: agentId,
      capabilityId: null,
      bindingType: null,
      bindingState: null,
      health: null,
    }).find((b) => b.bindingId === bindingId);
    if (!binding) {
      continue;
    }
    // Only restore if still disabled (still under our pause).
    if (binding.bindingState !== "disabled") {
      continue;
    }
    const prior = record.originalStates[bindingId] ?? "active";
    // Never restore to disabled via this path (we only disabled non-disabled ones).
    const restoreState: BindingState = prior === "disabled" ? "active" : prior;
    try {
      updateBindingState(bindingId, restoreState);
      affected.push(bindingId);
    } catch {
      // skip
    }
  }
  delete pauses[agentId];
  writeGovernancePersistedState({ ...state, pauses });
  return { ok: true, reason, affectedBindingIds: affected };
}

function applyLimit(agentId: string, reason: string): ApplyGovernanceRuntimeActionResult {
  const state = readGovernancePersistedState();
  const limits = { ...state.limits } as Record<string, AgentLimitRecord>;
  if (limits[agentId]) {
    return {
      ok: true,
      reason: "limit-already-applied",
      affectedBindingIds: limits[agentId].changedBindingIds,
    };
  }
  const bindings = listBindings({
    runtimeAgentId: agentId,
    capabilityId: null,
    bindingType: null,
    bindingState: null,
    health: null,
  });
  const originalPriorities: Record<string, number> = {};
  const originalStates: Record<string, BindingState> = {};
  const changedBindingIds: string[] = [];
  for (const binding of bindings) {
    if (binding.bindingState === "disabled") {
      continue; // do not touch security/manual disables
    }
    originalPriorities[binding.bindingId] = binding.routingPriority;
    originalStates[binding.bindingId] = binding.bindingState;
    const nextPriority = Math.max(1, Math.floor(binding.routingPriority * 0.2));
    try {
      updateBindingPriority(binding.bindingId, nextPriority);
      if (binding.bindingState === "active") {
        updateBindingState(binding.bindingId, "degraded");
      }
      changedBindingIds.push(binding.bindingId);
    } catch {
      // skip
    }
  }
  limits[agentId] = {
    originalPriorities,
    originalStates,
    changedBindingIds,
    appliedAt: new Date().toISOString(),
    reason,
  };
  writeGovernancePersistedState({ ...state, limits });
  return { ok: true, reason, affectedBindingIds: changedBindingIds };
}

function clearLimit(agentId: string, reason: string): ApplyGovernanceRuntimeActionResult {
  const state = readGovernancePersistedState();
  const limits = { ...state.limits } as Record<string, AgentLimitRecord>;
  const record = limits[agentId];
  if (!record) {
    return { ok: true, reason: "no-limit-present", affectedBindingIds: [] };
  }
  const affected: string[] = [];
  for (const bindingId of record.changedBindingIds) {
    const binding = listBindings({
      runtimeAgentId: agentId,
      capabilityId: null,
      bindingType: null,
      bindingState: null,
      health: null,
    }).find((b) => b.bindingId === bindingId);
    if (!binding) {
      continue;
    }
    // Compare-and-restore: only if still in limited shape (degraded or lowered priority).
    const priorPriority = record.originalPriorities[bindingId];
    const priorState = record.originalStates[bindingId] ?? "active";
    const stillLimited =
      binding.bindingState === "degraded" ||
      (typeof priorPriority === "number" && binding.routingPriority < priorPriority);
    if (!stillLimited) {
      continue;
    }
    // If someone fully disabled after our limit, do not re-enable.
    if (binding.bindingState === "disabled" && priorState !== "disabled") {
      continue;
    }
    try {
      if (typeof priorPriority === "number") {
        updateBindingPriority(bindingId, priorPriority);
      }
      updateBindingState(bindingId, priorState);
      affected.push(bindingId);
    } catch {
      // skip
    }
  }
  delete limits[agentId];
  writeGovernancePersistedState({ ...state, limits });
  return { ok: true, reason, affectedBindingIds: affected };
}

function validateRedirectTarget(
  sourceAgentId: string,
  targetAgentId: string,
): { ok: true; target: RuntimeAgent } | { ok: false; reason: string } {
  if (!targetAgentId || targetAgentId === sourceAgentId) {
    return { ok: false, reason: "invalid-redirect-target" };
  }
  let target: RuntimeAgent | null = null;
  try {
    target = getAgent(targetAgentId);
  } catch {
    target = null;
  }
  if (!target) {
    return { ok: false, reason: "target-agent-not-found" };
  }
  if (
    target.lifecycle === "archived" ||
    target.lifecycle === "deprecated" ||
    target.lifecycle === "suspended"
  ) {
    return { ok: false, reason: `target-lifecycle-${target.lifecycle}` };
  }
  if (target.health === "unhealthy" || target.health === "unavailable") {
    return { ok: false, reason: `target-health-${target.health}` };
  }
  // Tenant: if both have coverage, require non-empty intersection.
  try {
    const source = getAgent(sourceAgentId);
    if (source?.tenantCoverage?.length && target.tenantCoverage?.length) {
      const ok = source.tenantCoverage.some((t) => target.tenantCoverage.includes(t));
      if (!ok) {
        return { ok: false, reason: "target-tenant-mismatch" };
      }
    }
  } catch {
    // optional
  }
  // Cycle: target must not eventually redirect back to source (or form loop).
  const redirects = (readGovernancePersistedState().redirects ?? {}) as Record<
    string,
    AgentRedirectRecord
  >;
  const seen = new Set<string>([sourceAgentId]);
  let hop: string | undefined = targetAgentId;
  let steps = 0;
  while (hop && steps < 8) {
    if (seen.has(hop)) {
      return { ok: false, reason: "redirect-cycle" };
    }
    seen.add(hop);
    hop = redirects[hop]?.targetAgentId;
    steps += 1;
  }
  // Target under governance pause must not receive redirected traffic.
  const targetPause = (readGovernancePersistedState().pauses ?? {}) as Record<
    string,
    AgentPauseRecord
  >;
  if (targetPause[targetAgentId]?.disabledByThisAction?.length) {
    return { ok: false, reason: "target-governance-paused" };
  }
  // Target fully paused (all bindings disabled)?
  const targetBindings = listBindings({
    runtimeAgentId: targetAgentId,
    capabilityId: null,
    bindingType: null,
    bindingState: null,
    health: null,
  });
  if (targetBindings.length > 0 && targetBindings.every((b) => b.bindingState === "disabled")) {
    return { ok: false, reason: "target-all-bindings-disabled" };
  }
  return { ok: true, target };
}

function applyRedirect(
  agentId: string,
  targetAgentId: string,
  reason: string,
): ApplyGovernanceRuntimeActionResult {
  const validation = validateRedirectTarget(agentId, targetAgentId);
  if (!validation.ok) {
    return { ok: false, reason: validation.reason, affectedBindingIds: [] };
  }
  const state = readGovernancePersistedState();
  const redirects = { ...state.redirects } as Record<string, AgentRedirectRecord>;
  if (redirects[agentId]) {
    return {
      ok: true,
      reason: "redirect-already-applied",
      affectedBindingIds: redirects[agentId].pausedBindingIds,
      redirectTargetAgentId: redirects[agentId].targetAgentId,
    };
  }
  const bindings = listBindings({
    runtimeAgentId: agentId,
    capabilityId: null,
    bindingType: null,
    bindingState: null,
    health: null,
  });
  const originalStates: Record<string, BindingState> = {};
  const pausedBindingIds: string[] = [];
  for (const binding of bindings) {
    if (binding.bindingState === "disabled") {
      continue;
    }
    originalStates[binding.bindingId] = binding.bindingState;
    try {
      updateBindingState(binding.bindingId, "disabled");
      pausedBindingIds.push(binding.bindingId);
    } catch {
      // skip
    }
  }
  redirects[agentId] = {
    targetAgentId: validation.target.runtimeAgentId,
    appliedAt: new Date().toISOString(),
    reason,
    pausedBindingIds,
    originalStates,
  };
  writeGovernancePersistedState({ ...state, redirects });
  invalidateGovernanceRedirectCache();
  return {
    ok: true,
    reason,
    affectedBindingIds: pausedBindingIds,
    redirectTargetAgentId: validation.target.runtimeAgentId,
  };
}

function clearRedirect(agentId: string, reason: string): ApplyGovernanceRuntimeActionResult {
  const state = readGovernancePersistedState();
  const redirects = { ...state.redirects } as Record<string, AgentRedirectRecord>;
  const record = redirects[agentId];
  if (!record) {
    return { ok: true, reason: "no-redirect-present", affectedBindingIds: [] };
  }
  const affected: string[] = [];
  for (const bindingId of record.pausedBindingIds) {
    const binding = listBindings({
      runtimeAgentId: agentId,
      capabilityId: null,
      bindingType: null,
      bindingState: null,
      health: null,
    }).find((b) => b.bindingId === bindingId);
    if (!binding || binding.bindingState !== "disabled") {
      // Only restore if still disabled by us
      continue;
    }
    const prior = record.originalStates[bindingId] ?? "active";
    const restoreState: BindingState = prior === "disabled" ? "active" : prior;
    try {
      updateBindingState(bindingId, restoreState);
      affected.push(bindingId);
    } catch {
      // skip
    }
  }
  delete redirects[agentId];
  writeGovernancePersistedState({ ...state, redirects });
  invalidateGovernanceRedirectCache();
  return { ok: true, reason, affectedBindingIds: affected };
}

export function getAgentLimitRecord(runtimeAgentId: string): AgentLimitRecord | null {
  const limits = readGovernancePersistedState().limits as
    | Record<string, AgentLimitRecord>
    | undefined;
  return limits?.[runtimeAgentId.trim()] ?? null;
}

export function getAgentRedirectRecord(runtimeAgentId: string): AgentRedirectRecord | null {
  const map = getRedirectMapSnapshot();
  return map[runtimeAgentId.trim()] ?? null;
}

export function getAgentPauseRecord(runtimeAgentId: string): AgentPauseRecord | null {
  const pauses = readGovernancePersistedState().pauses as
    | Record<string, AgentPauseRecord>
    | undefined;
  return pauses?.[runtimeAgentId.trim()] ?? null;
}
