/**
 * Real governance tick: seed assets from runtime agents → detect anomalies →
 * execute pause with idempotency → persist assets/anomalies/actions/metrics.
 *
 * Operational signals: binding telemetry + lifecycle skill health (success/latency/usage).
 */

import {
  listAgents,
  listBindings,
  listTelemetry,
  type RuntimeAgent,
} from "../agent-runtime-store.js";
import { readSkillInvocationEvents } from "../skill-invocation/event-store.js";
import { listRobotSkillAssets } from "../skill-lifecycle-store.js";
import { observeRuntimeAutoConsumption } from "./application-consumption-shadow.js";
import { recordRuntimeAutoApplicationShadow } from "./control-plane-application-shadow.js";
import { recordSkillInvocationEffectObservation } from "./effect-observations.js";
import {
  DEFAULT_MINIMUM_EVALUATION_SAMPLES,
  isBoundEffectVerification,
  openGovernanceEffectWindow,
} from "./effect-verifications.js";
import {
  getEvolutionGovernanceMode,
  isEvolutionAutoRecoveryEnabled,
  isEvolutionAutoRuntimeMutationEnabled,
  isEvolutionGovernancePipelineEnabled,
} from "./mode.js";
import {
  isGovernanceKillSwitchActive,
  readGovernancePersistedState,
  writeGovernancePersistedState,
  type GovernanceEffectVerification,
  type GovernancePersistedState,
} from "./persistent-store.js";
import { applyGovernanceRuntimeAction } from "./runtime-actions.js";
import { governanceTickWriters } from "./tick-writer-capability.js";

function listCurrentEffectWindows(): GovernanceEffectVerification[] {
  return [...(readGovernancePersistedState().effectVerifications ?? [])];
}

/** Min skill usage before success/latency rules fire. */
const SKILL_METRIC_MIN_USAGE = 5;
/** Auto-pause when weighted success rate is below this. */
const LOW_SUCCESS_RATE_PAUSE = 0.5;
/** High latency (ms) → human-gate anomaly (no auto-pause). */
const HIGH_LATENCY_MS = 30_000;
/** Default wait before remeasuring a pause for resume/hold. */
export const DEFAULT_EFFECT_VERIFY_MS = 60 * 60 * 1000;

let effectVerifyMsForTests: number | null = null;

/** Test-only: shorten verification window. */
export function setEffectVerifyMsForTests(ms: number | null): void {
  effectVerifyMsForTests = ms;
}

let effectVerifyMsConfig: number | null = null;

/** Production config: set verify window (ms). Null resets to default. */
export function configureEffectVerifyMs(ms: number | null): void {
  if (ms == null || !Number.isFinite(ms) || ms < 0) {
    effectVerifyMsConfig = null;
    return;
  }
  effectVerifyMsConfig = Math.floor(ms);
}

function effectVerifyMs(): number {
  if (effectVerifyMsForTests != null) {
    return effectVerifyMsForTests;
  }
  if (effectVerifyMsConfig != null) {
    return effectVerifyMsConfig;
  }
  const fromEnv = Number(process.env.OPENBOT_GOV_EFFECT_VERIFY_MS);
  if (Number.isFinite(fromEnv) && fromEnv >= 0) {
    return Math.floor(fromEnv);
  }
  return DEFAULT_EFFECT_VERIFY_MS;
}

export type GovernanceTickResult = {
  assetsSeeded: number;
  anomalies: number;
  actionsExecuted: number;
  pausedAgents: string[];
  resumedAgents: string[];
  effectsClosed: number;
  cyclesWritten: number;
};

type AssetRow = {
  id: string;
  type: "bot";
  runtimeAgentId: string;
  status: "active" | "paused" | "error";
  name: string;
  tenantId: string | null;
  bindingCount: number;
  activeBindingCount: number;
  invocationCount7d: number;
  tokenConsumption7d: number;
  /** Lifecycle skill operational metrics (0–1). */
  skillSuccessRate: number | null;
  skillAvgLatencyMs: number | null;
  skillUsageTotal: number;
};

type AnomalyRow = {
  id: string;
  assetId: string;
  type:
    | "no_active_binding"
    | "all_bindings_disabled"
    | "idle_with_cost"
    | "error_health"
    | "low_skill_success_rate"
    | "high_skill_latency";
  status: "pending" | "acted";
  createdAt: string;
  reason: string;
};

function observePendingRuntimeAction(input: {
  commandId: string;
  runtimeAgentId: string;
  action: "pause" | "resume" | "limit" | "clear_limit";
  tenantScope?: string | null;
}): void {
  try {
    recordRuntimeAutoApplicationShadow({
      commandId: input.commandId,
      runtimeAgentId: input.runtimeAgentId,
      action: input.action,
      liveExecuted: false,
    });
  } catch {
    // The authoritative consumption store below latches persistence failures.
  }
  observeRuntimeAutoConsumption({
    commandId: input.commandId,
    runtimeAgentId: input.runtimeAgentId,
    action: input.action,
    liveExecuted: false,
    mode: getEvolutionGovernanceMode(),
    killSwitch: isGovernanceKillSwitchActive(),
    tenantScope: input.tenantScope,
  });
}

type ActionRow = {
  id: string;
  assetId: string;
  action: "pause" | "resume" | "hold" | "limit" | "clear_limit" | "redirect";
  status: "executed" | "skipped";
  idempotencyKey: string;
  reason: string;
  executedAt: string;
};

type MetricsRow = {
  assetId: string;
  date: string;
  invocationCount: number;
  tokenConsumption: number;
  skillSuccessRate: number | null;
  skillAvgLatencyMs: number | null;
  skillUsageTotal: number;
};

/**
 * Production governance evaluation for one tick.
 * Idempotent pause actions keyed by assetId+rule+day.
 * After pause, opens an effect window → later ticks verify and may resume/hold.
 */
export function runEvolutionGovernancePipeline(input?: { now?: number }): GovernanceTickResult {
  if (isGovernanceKillSwitchActive()) {
    return {
      assetsSeeded: 0,
      anomalies: 0,
      actionsExecuted: 0,
      pausedAgents: [],
      resumedAgents: [],
      effectsClosed: 0,
      cyclesWritten: 0,
    };
  }
  if (!isEvolutionGovernancePipelineEnabled()) {
    // Mode=off: seed nothing, take no actions (ops can still call snapshot RPCs).
    return {
      assetsSeeded: 0,
      anomalies: 0,
      actionsExecuted: 0,
      pausedAgents: [],
      resumedAgents: [],
      effectsClosed: 0,
      cyclesWritten: 0,
    };
  }

  const state = readGovernancePersistedState();
  const agents = listAgents({
    lifecycle: null,
    health: null,
    tenantId: null,
    searchQuery: "",
  });
  const now = input?.now ?? Date.now();
  const dayKey = new Date(now).toISOString().slice(0, 10);

  const assets: AssetRow[] = agents.map((agent) => buildAssetRow(agent));
  const assetByRuntime = new Map(assets.map((a) => [a.runtimeAgentId, a]));
  const metrics: MetricsRow[] = assets.map((asset) => ({
    assetId: asset.id,
    date: dayKey,
    invocationCount: asset.invocationCount7d,
    tokenConsumption: asset.tokenConsumption7d,
    skillSuccessRate: asset.skillSuccessRate,
    skillAvgLatencyMs: asset.skillAvgLatencyMs,
    skillUsageTotal: asset.skillUsageTotal,
  }));

  const anomalies: AnomalyRow[] = [];
  const actions: ActionRow[] = [];
  const pausedAgents: string[] = [];
  const resumedAgents: string[] = [];
  const priorActions = (state.actions as ActionRow[]) ?? [];
  let effectVerifications: GovernanceEffectVerification[] = [
    ...((state.effectVerifications as GovernanceEffectVerification[]) ?? []),
  ];

  ensureControlObservationWindows({
    assets,
    existing: effectVerifications,
    now,
  });
  const effectClose = evaluateOpenEffectWindows({
    effectVerifications: listCurrentEffectWindows(),
    assetByRuntime,
    dayKey,
    now,
    priorActions,
  });
  effectVerifications = listCurrentEffectWindows();
  actions.push(...effectClose.actions);
  resumedAgents.push(...effectClose.resumedAgents);

  for (const asset of assets) {
    // Rule 1: all bindings disabled while agent still "active"
    if (asset.bindingCount > 0 && asset.activeBindingCount === 0) {
      anomalies.push({
        id: `anom:${asset.id}:all_disabled:${dayKey}`,
        assetId: asset.id,
        type: "all_bindings_disabled",
        status: "acted",
        createdAt: new Date().toISOString(),
        reason: "All capability bindings are disabled",
      });
    }

    // Rule 2: no bindings (informational)
    if (asset.bindingCount === 0) {
      anomalies.push({
        id: `anom:${asset.id}:no_binding:${dayKey}`,
        assetId: asset.id,
        type: "no_active_binding",
        status: "pending",
        createdAt: new Date().toISOString(),
        reason: "Agent has no capability bindings",
      });
    }

    const mayMutate = isEvolutionAutoRuntimeMutationEnabled();

    // Rule 3: cost without invocations (idle spend)
    if (
      asset.tokenConsumption7d > 0 &&
      asset.invocationCount7d === 0 &&
      asset.status === "active"
    ) {
      anomalies.push({
        id: `anom:${asset.id}:idle_cost:${dayKey}`,
        assetId: asset.id,
        type: "idle_with_cost",
        status: mayMutate ? "acted" : "pending",
        createdAt: new Date().toISOString(),
        reason: mayMutate
          ? "Token consumption without invocations in 7d window"
          : "Token consumption without invocations — pending human approval (assist)",
      });
      if (mayMutate) {
        const action = executePauseOnce({
          asset,
          dayKey,
          reason: "idle_with_cost",
          priorActions,
          effectVerifications,
          now,
        });
        actions.push(action.action);
        effectVerifications = action.effectVerifications;
        if (action.action.status === "executed") {
          pausedAgents.push(asset.runtimeAgentId);
        }
      } else {
        observePendingRuntimeAction({
          commandId: `pause:${asset.runtimeAgentId}:idle_with_cost:${dayKey}`,
          runtimeAgentId: asset.runtimeAgentId,
          action: "pause",
          tenantScope: asset.tenantId,
        });
      }
    }

    // Rule 4: agent health error
    if (asset.status === "error") {
      anomalies.push({
        id: `anom:${asset.id}:error_health:${dayKey}`,
        assetId: asset.id,
        type: "error_health",
        status: mayMutate ? "acted" : "pending",
        createdAt: new Date().toISOString(),
        reason: mayMutate
          ? "Agent health is error"
          : "Agent health is error — pending human approval (assist)",
      });
      if (mayMutate) {
        const action = executePauseOnce({
          asset,
          dayKey,
          reason: "error_health",
          priorActions,
          effectVerifications,
          now,
        });
        actions.push(action.action);
        effectVerifications = action.effectVerifications;
        if (action.action.status === "executed") {
          pausedAgents.push(asset.runtimeAgentId);
        }
      } else {
        observePendingRuntimeAction({
          commandId: `pause:${asset.runtimeAgentId}:error_health:${dayKey}`,
          runtimeAgentId: asset.runtimeAgentId,
          action: "pause",
          tenantScope: asset.tenantId,
        });
      }
    }

    // Rule 5: lifecycle draining
    if (asset.status === "paused") {
      if (mayMutate) {
        const action = executePauseOnce({
          asset,
          dayKey,
          reason: "lifecycle-draining",
          priorActions,
          effectVerifications,
          now,
        });
        actions.push(action.action);
        effectVerifications = action.effectVerifications;
        if (action.action.status === "executed") {
          pausedAgents.push(asset.runtimeAgentId);
        }
      } else {
        anomalies.push({
          id: `anom:${asset.id}:draining:${dayKey}`,
          assetId: asset.id,
          type: "all_bindings_disabled",
          status: "pending",
          createdAt: new Date().toISOString(),
          reason: "Lifecycle draining — pending human approval (assist)",
        });
        observePendingRuntimeAction({
          commandId: `pause:${asset.runtimeAgentId}:lifecycle-draining:${dayKey}`,
          runtimeAgentId: asset.runtimeAgentId,
          action: "pause",
          tenantScope: asset.tenantId,
        });
      }
    }

    // Rule 6: low skill success
    if (
      asset.status === "active" &&
      asset.skillUsageTotal >= SKILL_METRIC_MIN_USAGE &&
      asset.skillSuccessRate != null &&
      asset.skillSuccessRate < LOW_SUCCESS_RATE_PAUSE
    ) {
      anomalies.push({
        id: `anom:${asset.id}:low_skill_success:${dayKey}`,
        assetId: asset.id,
        type: "low_skill_success_rate",
        status: mayMutate ? "acted" : "pending",
        createdAt: new Date().toISOString(),
        reason: mayMutate
          ? `Skill successRate ${(asset.skillSuccessRate * 100).toFixed(1)}% — soft limit applied`
          : `Skill successRate ${(asset.skillSuccessRate * 100).toFixed(1)}% — pending human approval (assist)`,
      });
      if (mayMutate) {
        const action = executeLimitOnce({
          asset,
          dayKey,
          reason: "low_skill_success_rate",
          priorActions,
          effectVerifications,
          now,
        });
        actions.push(action.action);
        effectVerifications = action.effectVerifications;
      } else {
        observePendingRuntimeAction({
          commandId: `limit:${asset.runtimeAgentId}:low_skill_success_rate:${dayKey}`,
          runtimeAgentId: asset.runtimeAgentId,
          action: "limit",
          tenantScope: asset.tenantId,
        });
      }
    }

    // Rule 7: high skill latency
    if (
      asset.skillUsageTotal >= SKILL_METRIC_MIN_USAGE &&
      asset.skillAvgLatencyMs != null &&
      asset.skillAvgLatencyMs >= HIGH_LATENCY_MS
    ) {
      anomalies.push({
        id: `anom:${asset.id}:high_skill_latency:${dayKey}`,
        assetId: asset.id,
        type: "high_skill_latency",
        status: mayMutate ? "acted" : "pending",
        createdAt: new Date().toISOString(),
        reason: mayMutate
          ? `Skill avgLatency ${Math.round(asset.skillAvgLatencyMs)}ms — soft limit applied`
          : `Skill avgLatency ${Math.round(asset.skillAvgLatencyMs)}ms — pending human approval (assist)`,
      });
      if (mayMutate) {
        const action = executeLimitOnce({
          asset,
          dayKey,
          reason: "high_skill_latency",
          priorActions,
          effectVerifications,
          now,
        });
        actions.push(action.action);
        effectVerifications = action.effectVerifications;
      } else {
        observePendingRuntimeAction({
          commandId: `limit:${asset.runtimeAgentId}:high_skill_latency:${dayKey}`,
          runtimeAgentId: asset.runtimeAgentId,
          action: "limit",
          tenantScope: asset.tenantId,
        });
      }
    }
  }

  // Re-read so Tick cursor writes are not clobbered by in-memory copies.
  const latest = readGovernancePersistedState();
  const diskWindows = latest.effectVerifications ?? [];
  const diskIds = new Set(diskWindows.map((row) => row.id));
  const localOnlyWindows = effectVerifications.filter((row) => !diskIds.has(row.id));
  const next: GovernancePersistedState = {
    ...latest,
    assets,
    anomalies: mergeById(state.anomalies as AnomalyRow[], anomalies),
    actions: mergeById(priorActions, actions),
    metrics: mergeMetrics(state.metrics as MetricsRow[], metrics),
    effectVerifications: [...diskWindows, ...localOnlyWindows].slice(-200),
    limits: latest.limits ?? {},
    redirects: latest.redirects ?? {},
    jobCursor: {
      ...latest.jobCursor,
      lastAggregationAt: new Date().toISOString(),
      lastAutoGovAt: new Date().toISOString(),
    },
  };
  writeGovernancePersistedState(next);

  return {
    assetsSeeded: assets.length,
    anomalies: anomalies.length,
    actionsExecuted: actions.filter((a) => a.status === "executed").length,
    pausedAgents: [...new Set(pausedAgents)],
    resumedAgents: [...new Set(resumedAgents)],
    effectsClosed: effectClose.closed,
    cyclesWritten: effectClose.cyclesWritten,
  };
}

function buildAssetRow(agent: RuntimeAgent): AssetRow {
  const bindings = listBindings({
    runtimeAgentId: agent.runtimeAgentId,
    capabilityId: null,
    bindingType: null,
    bindingState: null,
    health: null,
  });
  const activeBindingCount = bindings.filter((b) => b.bindingState === "active").length;
  let invocationCount7d = 0;
  let tokenConsumption7d = 0;
  for (const binding of bindings) {
    invocationCount7d += binding.invocationMetrics?.calls7d ?? 0;
    tokenConsumption7d += binding.invocationMetrics?.tokenConsumption7d ?? 0;
  }
  // Include agent-level telemetry when present.
  try {
    const telemetry = listTelemetry({
      runtimeAgentId: agent.runtimeAgentId,
      capabilityId: null,
      window: "7d",
    });
    for (const sample of telemetry) {
      tokenConsumption7d = Math.max(tokenConsumption7d, sample.tokenConsumption7d ?? 0);
      invocationCount7d = Math.max(invocationCount7d, sample.calls7d ?? 0);
    }
  } catch {
    // telemetry optional
  }

  const skillOps = collectSkillOperationalMetrics(agent.runtimeAgentId);
  // Prefer skill usage as invocation signal when binding metrics are empty.
  if (invocationCount7d === 0 && skillOps.skillUsageTotal > 0) {
    invocationCount7d = skillOps.skillUsageTotal;
  }

  const status: AssetRow["status"] =
    agent.health === "unhealthy" || agent.health === "unavailable"
      ? "error"
      : agent.lifecycle === "draining" ||
          agent.lifecycle === "suspended" ||
          agent.lifecycle === "deprecated" ||
          agent.lifecycle === "archived"
        ? "paused"
        : "active";

  return {
    id: `asset:bot:${agent.runtimeAgentId}`,
    type: "bot",
    runtimeAgentId: agent.runtimeAgentId,
    status,
    name: agent.runtimeAgentId,
    tenantId: agent.tenantCoverage?.[0] ?? null,
    bindingCount: bindings.length,
    activeBindingCount,
    invocationCount7d,
    tokenConsumption7d,
    skillSuccessRate: skillOps.skillSuccessRate,
    skillAvgLatencyMs: skillOps.skillAvgLatencyMs,
    skillUsageTotal: skillOps.skillUsageTotal,
  };
}

/**
 * Aggregate operational metrics for a runtime agent.
 * Prefer agent-scoped skill_invocation_completed events (not global skill.health),
 * so robot A's failures do not poison robot B's governance signals.
 */
export function collectSkillOperationalMetrics(runtimeAgentId: string): {
  skillSuccessRate: number | null;
  skillAvgLatencyMs: number | null;
  skillUsageTotal: number;
} {
  try {
    const events = readSkillInvocationEvents({
      agentId: runtimeAgentId,
      limit: 500,
    });
    const completed = events.filter(
      (e): e is Extract<typeof e, { type: "skill_invocation_completed" }> =>
        e.type === "skill_invocation_completed",
    );
    if (completed.length > 0) {
      const successCount = completed.filter((e) => e.outcome === "success").length;
      const latencySum = completed.reduce((sum, e) => sum + Math.max(0, e.latencyMs ?? 0), 0);
      return {
        skillSuccessRate: successCount / completed.length,
        skillAvgLatencyMs: latencySum / completed.length,
        skillUsageTotal: completed.length,
      };
    }
    // Fallback: relation usage only (no success signal without events).
    const skills = listRobotSkillAssets(runtimeAgentId);
    const usageTotal = skills.reduce((sum, s) => sum + Math.max(0, s.usageCount ?? 0), 0);
    return {
      skillSuccessRate: null,
      skillAvgLatencyMs: null,
      skillUsageTotal: usageTotal,
    };
  } catch {
    return { skillSuccessRate: null, skillAvgLatencyMs: null, skillUsageTotal: 0 };
  }
}

function executePauseOnce(params: {
  asset: AssetRow;
  dayKey: string;
  reason: string;
  priorActions: ActionRow[];
  effectVerifications: GovernanceEffectVerification[];
  now: number;
}): { action: ActionRow; effectVerifications: GovernanceEffectVerification[] } {
  const idempotencyKey = `pause:${params.asset.runtimeAgentId}:${params.reason}:${params.dayKey}`;
  const prior = params.priorActions.find(
    (a) => a.idempotencyKey === idempotencyKey && a.status === "executed",
  );
  if (prior) {
    return {
      action: {
        ...prior,
        status: "skipped",
        reason: `${params.reason}:already-executed`,
        executedAt: new Date().toISOString(),
      },
      effectVerifications: params.effectVerifications,
    };
  }
  const result = applyGovernanceRuntimeAction({
    runtimeAgentId: params.asset.runtimeAgentId,
    action: "pause",
    reason: params.reason,
    idempotencyKey,
  });
  recordRuntimeAutoApplicationShadow({
    commandId: idempotencyKey,
    runtimeAgentId: params.asset.runtimeAgentId,
    action: "pause",
    liveExecuted: result.ok,
  });
  observeRuntimeAutoConsumption({
    commandId: idempotencyKey,
    runtimeAgentId: params.asset.runtimeAgentId,
    action: "pause",
    liveExecuted: result.ok,
    mode: getEvolutionGovernanceMode(),
    killSwitch: isGovernanceKillSwitchActive(),
    tenantScope: params.asset.tenantId,
  });
  const action: ActionRow = {
    id: `act:${idempotencyKey}`,
    assetId: params.asset.id,
    action: "pause",
    status: result.ok ? "executed" : "skipped",
    idempotencyKey,
    reason: result.reason ?? params.reason,
    executedAt: new Date().toISOString(),
  };
  let effectVerifications = params.effectVerifications;
  if (result.ok && action.status === "executed") {
    effectVerifications = openEffectVerification({
      asset: params.asset,
      reason: params.reason,
      now: params.now,
      existing: effectVerifications,
    });
  }
  return { action, effectVerifications };
}

function executeLimitOnce(params: {
  asset: AssetRow;
  dayKey: string;
  reason: string;
  priorActions: ActionRow[];
  effectVerifications: GovernanceEffectVerification[];
  now: number;
}): { action: ActionRow; effectVerifications: GovernanceEffectVerification[] } {
  const idempotencyKey = `limit:${params.asset.runtimeAgentId}:${params.reason}:${params.dayKey}`;
  const prior = params.priorActions.find(
    (a) => a.idempotencyKey === idempotencyKey && a.status === "executed",
  );
  if (prior) {
    return {
      action: {
        ...prior,
        status: "skipped",
        reason: `${params.reason}:already-limited`,
        executedAt: new Date().toISOString(),
      },
      effectVerifications: params.effectVerifications,
    };
  }
  const result = applyGovernanceRuntimeAction({
    runtimeAgentId: params.asset.runtimeAgentId,
    action: "limit",
    reason: params.reason,
    idempotencyKey,
  });
  recordRuntimeAutoApplicationShadow({
    commandId: idempotencyKey,
    runtimeAgentId: params.asset.runtimeAgentId,
    action: "limit",
    liveExecuted: result.ok,
  });
  observeRuntimeAutoConsumption({
    commandId: idempotencyKey,
    runtimeAgentId: params.asset.runtimeAgentId,
    action: "limit",
    liveExecuted: result.ok,
    mode: getEvolutionGovernanceMode(),
    killSwitch: isGovernanceKillSwitchActive(),
    tenantScope: params.asset.tenantId,
  });
  const action: ActionRow = {
    id: `act:${idempotencyKey}`,
    assetId: params.asset.id,
    action: "limit",
    status: result.ok ? "executed" : "skipped",
    idempotencyKey,
    reason: result.reason ?? params.reason,
    executedAt: new Date().toISOString(),
  };
  let effectVerifications = params.effectVerifications;
  if (result.ok && action.status === "executed") {
    effectVerifications = openEffectVerification({
      asset: params.asset,
      reason: `limit:${params.reason}`,
      now: params.now,
      existing: effectVerifications,
    });
  }
  return { action, effectVerifications };
}

function openEffectVerification(params: {
  asset: AssetRow;
  reason: string;
  now: number;
  existing: GovernanceEffectVerification[];
}): GovernanceEffectVerification[] {
  const id = `effect:${params.reason.startsWith("limit:") ? "limit" : "pause"}:${params.asset.runtimeAgentId}:${params.reason}`;
  // One open window per agent+reason.
  if (params.existing.some((e) => e.id === id && e.status === "open")) {
    return params.existing;
  }
  const openedAt = new Date(params.now).toISOString();
  const interval = effectVerifyMs();
  const row: GovernanceEffectVerification = {
    id,
    assetId: params.asset.id,
    runtimeAgentId: params.asset.runtimeAgentId,
    reason: params.reason,
    pausedAt: openedAt,
    openedAt,
    observationStartedAt: openedAt,
    verifyAfterAt: new Date(params.now + interval).toISOString(),
    nextEvaluateAt: new Date(params.now + interval).toISOString(),
    evaluationIntervalMs: interval,
    evaluationCount: 0,
    consumedInvocationIds: [],
    minimumSampleSize: 1,
    observationUntil: new Date(
      params.now + Math.max(interval, DEFAULT_EFFECT_VERIFY_MS),
    ).toISOString(),
    baseline: {
      skillSuccessRate: params.asset.skillSuccessRate,
      skillUsageTotal: params.asset.skillUsageTotal,
      invocationCount7d: params.asset.invocationCount7d,
      tokenConsumption7d: params.asset.tokenConsumption7d,
    },
    status: "open",
    ...(params.asset.tenantId ? { tenantId: params.asset.tenantId } : {}),
  };
  return [...params.existing.filter((e) => e.id !== id), row];
}

function invocationsForWindow(effect: GovernanceEffectVerification): Array<{
  invocationId: string;
  agentId: string;
  tenantId?: string | null;
  completedAt: number;
  outcome: string;
  latencyMs: number;
  failureCategory?: string | null;
  experimentId?: string | null;
  applicationId?: string | null;
}> {
  const openedAt = Date.parse(effect.openedAt ?? effect.pausedAt);
  const until = effect.observationUntil
    ? Date.parse(effect.observationUntil)
    : Number.POSITIVE_INFINITY;
  const bound = isBoundEffectVerification(effect);
  return readSkillInvocationEvents({ agentId: effect.runtimeAgentId }).flatMap((event) => {
    if (event.type !== "skill_invocation_completed") {
      return [];
    }
    if (!Number.isFinite(openedAt) || event.completedAt < openedAt) {
      return [];
    }
    if (Number.isFinite(until) && event.completedAt > until) {
      return [];
    }
    const experimentId = event.experimentId ?? null;
    const applicationId = event.applicationId ?? null;
    const tenantId = event.tenantId ?? null;
    if (bound) {
      if (!experimentId || !applicationId || !tenantId) {
        return [];
      }
      if (
        experimentId !== effect.experimentId ||
        applicationId !== effect.applicationId ||
        tenantId !== effect.tenantId
      ) {
        return [];
      }
    } else if (experimentId || applicationId || !tenantId) {
      return [];
    } else if (effect.tenantId && tenantId !== effect.tenantId) {
      return [];
    }
    return [
      {
        invocationId: event.invocationId,
        agentId: event.agentId,
        tenantId,
        completedAt: event.completedAt,
        outcome: event.outcome,
        latencyMs: event.latencyMs,
        failureCategory: event.failureCategory,
        experimentId,
        applicationId,
      },
    ];
  });
}

type WindowInvocation = ReturnType<typeof invocationsForWindow>[number];

/** Invocations in the frozen window that this cycle has not consumed yet. */
function newInvocationsForWindow(effect: GovernanceEffectVerification): WindowInvocation[] {
  const consumed = new Set(effect.consumedInvocationIds ?? []);
  return invocationsForWindow(effect).filter((row) => !consumed.has(row.invocationId));
}

function telemetryFingerprint(asset: AssetRow | undefined): string {
  return `${asset?.skillSuccessRate ?? "n"}:${asset?.skillAvgLatencyMs ?? "n"}:${asset?.skillUsageTotal ?? 0}`;
}

function costFingerprint(asset: AssetRow | undefined): string {
  return `${asset?.tokenConsumption7d ?? 0}:${asset?.invocationCount7d ?? 0}`;
}

function baselineTelemetryFingerprint(effect: GovernanceEffectVerification): string {
  return `${effect.baseline.skillSuccessRate ?? "n"}:n:${effect.baseline.skillUsageTotal ?? 0}`;
}

function baselineCostFingerprint(effect: GovernanceEffectVerification): string {
  return `${effect.baseline.tokenConsumption7d ?? 0}:${effect.baseline.invocationCount7d ?? 0}`;
}

function newActionsForAgent(params: {
  runtimeAgentId: string;
  priorActions: ActionRow[];
  lastSeenActionId?: string;
  openedAt: string;
}): ActionRow[] {
  const openedAt = Date.parse(params.openedAt);
  let seenLast = !params.lastSeenActionId;
  const next: ActionRow[] = [];
  for (const action of params.priorActions) {
    if (!seenLast) {
      if (action.id === params.lastSeenActionId) {
        seenLast = true;
      }
      continue;
    }
    if (action.assetId !== `asset:bot:${params.runtimeAgentId}`) {
      continue;
    }
    const executedAt = Date.parse(action.executedAt);
    if (Number.isFinite(openedAt) && Number.isFinite(executedAt) && executedAt < openedAt) {
      continue;
    }
    next.push(action);
  }
  return next;
}

function collectCycleEvidence(params: {
  effect: GovernanceEffectVerification;
  current: AssetRow | undefined;
  priorActions: ActionRow[];
}): {
  newInvocations: WindowInvocation[];
  newActions: ActionRow[];
  telemetry: string;
  cost: string;
  health: string;
  hasNewEvidence: boolean;
} {
  const newInvocations = newInvocationsForWindow(params.effect);
  const newActions = newActionsForAgent({
    runtimeAgentId: params.effect.runtimeAgentId,
    priorActions: params.priorActions,
    lastSeenActionId: params.effect.lastSeenActionId,
    openedAt: params.effect.openedAt ?? params.effect.pausedAt,
  });
  const telemetry = telemetryFingerprint(params.current);
  const cost = costFingerprint(params.current);
  const health = params.current?.status ?? "unknown";
  const newTelemetry =
    params.effect.lastTelemetryFingerprint != null
      ? telemetry !== params.effect.lastTelemetryFingerprint
      : telemetry !== baselineTelemetryFingerprint(params.effect);
  const newCost =
    params.effect.lastCostFingerprint != null
      ? cost !== params.effect.lastCostFingerprint
      : cost !== baselineCostFingerprint(params.effect);
  const newHealth = params.effect.lastHealth != null ? health !== params.effect.lastHealth : false;
  return {
    newInvocations,
    newActions,
    telemetry,
    cost,
    health,
    hasNewEvidence:
      newInvocations.length > 0 ||
      newTelemetry ||
      newCost ||
      newHealth ||
      (!isBoundEffectVerification(params.effect) && newActions.length > 0),
  };
}

function ingestWindowSkillObservations(
  effect: GovernanceEffectVerification,
  invocations: WindowInvocation[],
): number {
  let written = 0;
  for (const invocation of invocations) {
    try {
      recordSkillInvocationEffectObservation({
        effectVerificationId: effect.id,
        invocation,
        ...(effect.modelRevision ? { modelRevision: effect.modelRevision } : {}),
        ...(effect.configRevision ? { configRevision: effect.configRevision } : {}),
      });
      written += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (
        message === "unbound-invocation-excluded" ||
        message === "observation-window-closed" ||
        message === "model-revision-mismatch" ||
        message === "config-revision-mismatch"
      ) {
        continue;
      }
      throw error;
    }
  }
  return written;
}

function writeTickEvaluationProbe(
  effect: GovernanceEffectVerification,
  decision: "resume" | "hold" | "escalate",
  now: number,
  evaluationCycleId: string,
  measured: WindowInvocation[],
): boolean {
  if (!effect.tenantId) {
    return false;
  }
  const securityHit = measured.some((row) => {
    const category = row.failureCategory;
    return (
      category === "security" ||
      category === "security_violation" ||
      category === "security_violations" ||
      category === "authz" ||
      category === "authorization"
    );
  });
  const until = effect.observationUntil ? Date.parse(effect.observationUntil) : now;
  const openedAt = Date.parse(effect.openedAt ?? effect.pausedAt);
  const occurredAt = Math.max(
    Number.isFinite(openedAt) ? openedAt : now,
    Number.isFinite(until) ? Math.min(now, until) : now,
  );
  try {
    governanceTickWriters.recordRuntimeProbe({
      effectVerificationId: effect.id,
      eventId: `obs:probe:${evaluationCycleId}`,
      sourceReceiptRef: `tick:${evaluationCycleId}`,
      occurredAt,
      tenantId: effect.tenantId,
      evaluation: decision,
      evaluationCycleId,
      metricsSnapshotRef: `metrics:${evaluationCycleId}`,
      ...(isBoundEffectVerification(effect)
        ? { experimentId: effect.experimentId, applicationId: effect.applicationId }
        : {}),
      ...(hasId(effect.modelRevision) ? { modelRevision: effect.modelRevision } : {}),
      ...(hasId(effect.configRevision) ? { configRevision: effect.configRevision } : {}),
      ...(measured.length > 0
        ? {
            skillSuccess: measured.every((row) => row.outcome === "success"),
            deliveryFailed: measured.some((row) => row.outcome === "failure"),
            latencyMs: measured[0]?.latencyMs,
            securityViolation: securityHit,
            ...(hasId(effect.tenantId)
              ? {
                  crossTenantContamination: measured.some(
                    (row) => hasId(row.tenantId) && row.tenantId !== effect.tenantId,
                  ),
                }
              : {}),
          }
        : {}),
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      message === "unbound-invocation-excluded" ||
      message === "observation-window-closed" ||
      message === "missing-tenant" ||
      message === "missing-evaluation-cycle"
    ) {
      return false;
    }
    throw error;
  }
}

function hasId(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isControlObservationWindow(
  row: GovernanceEffectVerification,
  runtimeAgentId: string,
): boolean {
  const commandId = row.commandId ?? "";
  return (
    row.runtimeAgentId === runtimeAgentId &&
    (row.reason === "baseline:control" ||
      commandId === `control:${runtimeAgentId}` ||
      commandId.startsWith(`control:${runtimeAgentId}:`))
  );
}

/** Same generation is idempotent; a closed generation does not reuse its commandId. */
function nextControlCommandId(
  runtimeAgentId: string,
  existing: GovernanceEffectVerification[],
  now: number,
): string {
  const live = existing.find(
    (row) => isControlObservationWindow(row, runtimeAgentId) && row.status === "open",
  );
  if (live?.commandId) {
    return live.commandId;
  }
  const used = new Set(
    existing
      .filter((row) => isControlObservationWindow(row, runtimeAgentId))
      .map((row) => row.commandId)
      .filter((value): value is string => Boolean(value)),
  );
  const windowStart = String(now);
  const candidate = `control:${runtimeAgentId}:${windowStart}`;
  if (!used.has(candidate)) {
    return candidate;
  }
  let suffix = 1;
  let next = `${candidate}:${suffix}`;
  while (used.has(next)) {
    suffix += 1;
    next = `${candidate}:${suffix}`;
  }
  return next;
}

function ensureControlObservationWindows(params: {
  assets: AssetRow[];
  existing: GovernanceEffectVerification[];
  now: number;
}): void {
  const known = mergeById(params.existing, listCurrentEffectWindows());
  for (const asset of params.assets) {
    if (!asset.tenantId) {
      continue;
    }
    const liveControl = known.some(
      (row) => isControlObservationWindow(row, asset.runtimeAgentId) && row.status === "open",
    );
    if (liveControl) {
      continue;
    }
    const opened = openGovernanceEffectWindow({
      runtimeAgentId: asset.runtimeAgentId,
      reason: "baseline:control",
      action: "observe",
      commandId: nextControlCommandId(asset.runtimeAgentId, known, params.now),
      tenantId: asset.tenantId,
      now: params.now,
      minimumSampleSize: DEFAULT_MINIMUM_EVALUATION_SAMPLES,
      evaluationIntervalMs: effectVerifyMs(),
      baseline: {
        skillSuccessRate: asset.skillSuccessRate,
        skillUsageTotal: asset.skillUsageTotal,
        invocationCount7d: asset.invocationCount7d,
        tokenConsumption7d: asset.tokenConsumption7d,
      },
    });
    known.push(opened);
  }
}

function evaluateTickDecision(
  effect: GovernanceEffectVerification,
  current: AssetRow | undefined,
  newInvocations: WindowInvocation[],
  newActions: ActionRow[],
): { decision: "resume" | "hold" | "escalate"; note: string } | "insufficient" {
  const invocationCount = newInvocations.length;
  if (!current && invocationCount === 0 && newActions.length === 0) {
    return "insufficient";
  }
  const currentRate = current?.skillSuccessRate ?? null;
  const baselineRate = effect.baseline.skillSuccessRate;
  const idleFixed =
    effect.reason === "idle_with_cost" &&
    (current?.tokenConsumption7d ?? 0) === 0 &&
    (current?.invocationCount7d ?? 0) === 0;
  const successImproved =
    currentRate != null &&
    baselineRate != null &&
    currentRate >= baselineRate + 0.1 &&
    currentRate >= LOW_SUCCESS_RATE_PAUSE;
  const healthRecovered =
    effect.reason === "error_health" && current != null && current.status === "active";
  const isLimitEffect = effect.reason.startsWith("limit:");
  const latencyImproved =
    isLimitEffect &&
    effect.reason.includes("high_skill_latency") &&
    (current?.skillAvgLatencyMs == null || current.skillAvgLatencyMs < HIGH_LATENCY_MS);
  const securityHit = newInvocations.some((row) => {
    const category = row.failureCategory;
    return (
      category === "security" ||
      category === "security_violation" ||
      category === "security_violations" ||
      category === "authz" ||
      category === "authorization"
    );
  });
  if (securityHit) {
    return { decision: "escalate", note: "security regression in new invocations" };
  }
  if (effect.action === "observe" && !isBoundEffectVerification(effect)) {
    const intervened = newActions.some(
      (row) =>
        row.status === "executed" &&
        (row.action === "pause" ||
          row.action === "hold" ||
          row.action === "limit" ||
          row.action === "redirect"),
    );
    if (intervened || current?.status === "error" || current?.status === "paused") {
      return { decision: "hold", note: "control cycle observed a real governance intervention" };
    }
    if (
      newActions.some(
        (row) =>
          row.status === "executed" && (row.action === "resume" || row.action === "clear_limit"),
      )
    ) {
      return { decision: "resume", note: "control cycle observed a real resume" };
    }
    if (invocationCount > 0) {
      const successRate =
        newInvocations.filter((row) => row.outcome === "success").length / invocationCount;
      if (successRate >= 0.8 && current?.status === "active") {
        return { decision: "resume", note: `control invocations successRate ${successRate}` };
      }
      return { decision: "hold", note: `control invocations successRate ${successRate}` };
    }
    if (current?.status === "active") {
      return { decision: "resume", note: "control cycle had new telemetry without intervention" };
    }
    return "insufficient";
  }
  if (isBoundEffectVerification(effect)) {
    if (invocationCount === 0 && currentRate == null && current?.skillUsageTotal === 0) {
      return "insufficient";
    }
    const successRate =
      newInvocations.length > 0
        ? newInvocations.filter((row) => row.outcome === "success").length / newInvocations.length
        : currentRate;
    if (successRate != null && successRate >= 0.8) {
      return { decision: "resume", note: `treatment invocations successRate ${successRate}` };
    }
    if (successRate != null) {
      return { decision: "hold", note: `treatment invocations successRate ${successRate}` };
    }
    return "insufficient";
  }
  const hasMetrics =
    invocationCount > 0 ||
    (current != null &&
      (current.skillUsageTotal >= SKILL_METRIC_MIN_USAGE || current.invocationCount7d > 0));
  if (!hasMetrics && !idleFixed && !healthRecovered) {
    return "insufficient";
  }
  if (idleFixed || successImproved || healthRecovered || latencyImproved) {
    return {
      decision: "resume",
      note: idleFixed
        ? "idle cost cleared"
        : successImproved
          ? `successRate ${baselineRate} → ${currentRate}`
          : latencyImproved
            ? "latency recovered under threshold"
            : "health recovered",
    };
  }
  return {
    decision: "hold",
    note: "no improvement after verify window — remains paused for human review",
  };
}

function evaluateOpenEffectWindows(params: {
  effectVerifications: GovernanceEffectVerification[];
  assetByRuntime: Map<string, AssetRow>;
  dayKey: string;
  now: number;
  priorActions: ActionRow[];
}): {
  effectVerifications: GovernanceEffectVerification[];
  actions: ActionRow[];
  resumedAgents: string[];
  closed: number;
  cyclesWritten: number;
} {
  const actions: ActionRow[] = [];
  const resumedAgents: string[] = [];
  let closed = 0;
  let cyclesWritten = 0;
  for (const effect of params.effectVerifications) {
    if (effect.status !== "open") {
      continue;
    }
    const dueAt = Date.parse(effect.nextEvaluateAt ?? effect.verifyAfterAt);
    if (!Number.isFinite(dueAt) || params.now < dueAt) {
      continue;
    }
    if (effect.lastEvaluationAt && Date.parse(effect.lastEvaluationAt) >= params.now) {
      continue;
    }
    const current = params.assetByRuntime.get(effect.runtimeAgentId);
    const evidence = collectCycleEvidence({
      effect,
      current,
      priorActions: params.priorActions,
    });
    const interval = effect.evaluationIntervalMs ?? effectVerifyMs();
    const until = effect.observationUntil ? Date.parse(effect.observationUntil) : Number.NaN;
    const termElapsed = Number.isFinite(until) && params.now >= until;
    if (!evidence.hasNewEvidence) {
      governanceTickWriters.persistEvaluation({
        effectVerificationId: effect.id,
        evaluationCount: effect.evaluationCount ?? 0,
        lastEvaluationAt: new Date(params.now).toISOString(),
        nextEvaluateAt: new Date(params.now + interval).toISOString(),
        lastTelemetryFingerprint: evidence.telemetry,
        lastCostFingerprint: evidence.cost,
        lastHealth: evidence.health,
      });
      if (termElapsed) {
        governanceTickWriters.submitDecision({
          decisionId: `tick:${effect.id}:expired`,
          effectVerificationId: effect.id,
          decision: "hold",
          evidenceRefs: [`tick:expired:${effect.id}`],
          sourceReceiptRef: `tick:expired:${effect.id}`,
          now: params.now,
          outcomeNote: "observation term elapsed with insufficient samples",
        });
        closed += 1;
      }
      continue;
    }
    ingestWindowSkillObservations(effect, evidence.newInvocations);
    const cycleIndex = effect.evaluationCount ?? 0;
    const evaluationCycleId = `cycle:${effect.id}:${cycleIndex}`;
    const cycleEvaluation = evaluateTickDecision(
      effect,
      current,
      evidence.newInvocations,
      evidence.newActions,
    );
    if (cycleEvaluation === "insufficient") {
      governanceTickWriters.persistEvaluation({
        effectVerificationId: effect.id,
        evaluationCount: cycleIndex,
        lastEvaluationAt: new Date(params.now).toISOString(),
        nextEvaluateAt: new Date(params.now + interval).toISOString(),
        consumedInvocationIds: [
          ...(effect.consumedInvocationIds ?? []),
          ...evidence.newInvocations.map((row) => row.invocationId),
        ],
        lastTelemetryFingerprint: evidence.telemetry,
        lastCostFingerprint: evidence.cost,
        lastHealth: evidence.health,
        lastSeenActionId: evidence.newActions.at(-1)?.id ?? effect.lastSeenActionId,
      });
      if (termElapsed) {
        governanceTickWriters.submitDecision({
          decisionId: `tick:${effect.id}:expired`,
          effectVerificationId: effect.id,
          decision: "hold",
          evidenceRefs: [`tick:expired:${effect.id}`],
          sourceReceiptRef: `tick:expired:${effect.id}`,
          now: params.now,
          outcomeNote: "observation term elapsed with insufficient samples",
        });
        closed += 1;
      }
      continue;
    }
    const written = writeTickEvaluationProbe(
      effect,
      cycleEvaluation.decision,
      params.now,
      evaluationCycleId,
      evidence.newInvocations,
    );
    if (written) {
      cyclesWritten += 1;
    }
    const nextCount = written ? cycleIndex + 1 : cycleIndex;
    governanceTickWriters.persistEvaluation({
      effectVerificationId: effect.id,
      evaluationCount: nextCount,
      lastEvaluationAt: new Date(params.now).toISOString(),
      lastEvaluationReceiptRef: `tick:${evaluationCycleId}`,
      nextEvaluateAt: new Date(params.now + interval).toISOString(),
      consumedInvocationIds: [
        ...(effect.consumedInvocationIds ?? []),
        ...evidence.newInvocations.map((row) => row.invocationId),
      ],
      lastTelemetryFingerprint: evidence.telemetry,
      lastCostFingerprint: evidence.cost,
      lastHealth: evidence.health,
      lastSeenActionId: evidence.newActions.at(-1)?.id ?? effect.lastSeenActionId,
    });
    const minSamples = effect.minimumSampleSize ?? 1;
    const critical = cycleEvaluation.decision === "escalate";
    const enough = nextCount >= minSamples;
    const shouldClose = critical || enough || termElapsed;
    if (!shouldClose) {
      continue;
    }
    if (
      cycleEvaluation.decision === "resume" &&
      !isBoundEffectVerification(effect) &&
      !isEvolutionAutoRecoveryEnabled() &&
      !termElapsed
    ) {
      continue;
    }
    const evaluatedCloseDecision = critical
      ? "escalate"
      : termElapsed && !enough
        ? "hold"
        : cycleEvaluation.decision;
    const isLimitEffect = effect.reason.startsWith("limit:");
    const recoveryAction = isLimitEffect ? "clear_limit" : "resume";
    const recoveryKey = `${recoveryAction}:${effect.runtimeAgentId}:${effect.reason}:${params.dayKey}`;
    const autoRecoveryAllowed = isEvolutionAutoRecoveryEnabled();
    if (
      evaluatedCloseDecision === "resume" &&
      !isBoundEffectVerification(effect) &&
      !autoRecoveryAllowed
    ) {
      observePendingRuntimeAction({
        commandId: recoveryKey,
        runtimeAgentId: effect.runtimeAgentId,
        action: recoveryAction,
        tenantScope: effect.tenantId,
      });
    }
    const closeDecision =
      evaluatedCloseDecision === "resume" &&
      !isBoundEffectVerification(effect) &&
      !autoRecoveryAllowed
        ? "hold"
        : evaluatedCloseDecision;
    // Bound Evolution windows close as a decision only. Auto-resume would undo
    // the canary apply before rollback/verify.
    if (closeDecision === "resume" && !isBoundEffectVerification(effect)) {
      const already = params.priorActions.find(
        (a) => a.idempotencyKey === recoveryKey && a.status === "executed",
      );
      if (!already) {
        const result = applyGovernanceRuntimeAction({
          runtimeAgentId: effect.runtimeAgentId,
          action: recoveryAction,
          reason: `effect-verify:${effect.reason}`,
          idempotencyKey: recoveryKey,
        });
        recordRuntimeAutoApplicationShadow({
          commandId: recoveryKey,
          runtimeAgentId: effect.runtimeAgentId,
          action: recoveryAction,
          liveExecuted: result.ok,
        });
        observeRuntimeAutoConsumption({
          commandId: recoveryKey,
          runtimeAgentId: effect.runtimeAgentId,
          action: recoveryAction,
          liveExecuted: result.ok,
          mode: getEvolutionGovernanceMode(),
          killSwitch: isGovernanceKillSwitchActive(),
          tenantScope: effect.tenantId,
        });
        actions.push({
          id: `act:${recoveryKey}`,
          assetId: effect.assetId,
          action: recoveryAction,
          status: result.ok ? "executed" : "skipped",
          idempotencyKey: recoveryKey,
          reason: result.reason ?? `verify-resume:${effect.reason}`,
          executedAt: new Date(params.now).toISOString(),
        });
        if (result.ok) {
          resumedAgents.push(effect.runtimeAgentId);
        }
      }
    } else {
      const holdKey = `${closeDecision}:${effect.runtimeAgentId}:${effect.reason}:${params.dayKey}`;
      actions.push({
        id: `act:${holdKey}`,
        assetId: effect.assetId,
        action: "hold",
        status: "executed",
        idempotencyKey: holdKey,
        reason: `effect-verify-${closeDecision}:${effect.reason}`,
        executedAt: new Date(params.now).toISOString(),
      });
    }
    governanceTickWriters.submitDecision({
      decisionId: `tick:${effect.id}:${params.dayKey}:${nextCount}`,
      effectVerificationId: effect.id,
      decision: closeDecision,
      evidenceRefs: [`tick:${params.dayKey}:${effect.id}`],
      sourceReceiptRef: `tick:${params.dayKey}:${effect.id}:${nextCount}`,
      now: params.now,
      outcomeNote: cycleEvaluation.note,
    });
    closed += 1;
  }
  return {
    effectVerifications: listCurrentEffectWindows(),
    actions,
    resumedAgents,
    closed,
    cyclesWritten,
  };
}

function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const map = new Map<string, T>();
  for (const row of existing ?? []) {
    if (row?.id) {
      map.set(row.id, row);
    }
  }
  for (const row of incoming) {
    map.set(row.id, row);
  }
  return [...map.values()].slice(-500);
}

function mergeMetrics(existing: MetricsRow[], incoming: MetricsRow[]): MetricsRow[] {
  const map = new Map<string, MetricsRow>();
  for (const row of existing ?? []) {
    if (row?.assetId && row?.date) {
      map.set(`${row.assetId}:${row.date}`, row);
    }
  }
  for (const row of incoming) {
    map.set(`${row.assetId}:${row.date}`, row);
  }
  return [...map.values()].slice(-500);
}
