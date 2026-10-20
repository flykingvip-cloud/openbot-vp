import {
  getEvolutionSurface,
  type ApplyEvolutionInput,
  type EvolutionAdapter,
  type EvolutionApplication,
  type EvolutionTarget,
  type MetricObservation,
  type RollbackResult,
  type TargetSnapshot,
  type ValidationResult,
} from "@openbot/evolution-core";
import {
  getAgent,
  listBindings,
  updateBindingState,
  type BindingState,
} from "../../agent-runtime-store.js";
import {
  aggregateRuntimeEffectObservations,
  listGovernanceEffectObservationEvents,
  selectRuntimeEffectObservationEvents,
} from "../../evolution-governance/effect-observations.js";
import {
  listGovernanceEffectVerifications,
  openGovernanceEffectWindow,
  revokeGovernanceEffectWindowsForApplication,
} from "../../evolution-governance/effect-verifications.js";
import {
  getEvolutionGovernanceMode,
  type EvolutionGovernanceMode,
} from "../../evolution-governance/mode.js";
import { isGovernanceKillSwitchActive } from "../../evolution-governance/persistent-store.js";
import {
  applyGovernanceRuntimeAction,
  type GovernanceRuntimeAction,
} from "../../evolution-governance/runtime-actions.js";
import { loadAdapterSnapshots, saveAdapterSnapshots } from "../persistent-store.js";

export const RUNTIME_GOVERNANCE_SURFACE_ID = "system.runtime-binding-governance";

export const RUNTIME_GOVERNANCE_ACTIONS = [
  "pause",
  "resume",
  "limit",
  "clear_limit",
  "redirect",
  "clear_redirect",
] as const;

export type RuntimeGovernanceCandidate =
  | {
      kind: "runtime-action";
      runtimeAgentId: string;
      action: GovernanceRuntimeAction;
      redirectTargetAgentId?: string;
      candidateVersion: string;
    }
  | {
      kind: "set-kill-switch";
      active: boolean;
      candidateVersion: string;
    };

export type RuntimeBindingSnapshot = {
  bindingId: string;
  state: BindingState;
};

export type RuntimeActionRestoreSnapshot = {
  runtimeAgentId: string;
  action: GovernanceRuntimeAction;
  originalBindings: RuntimeBindingSnapshot[];
  changedBindingIds: string[];
};

export type RuntimeAgentView = {
  runtimeAgentId: string;
  bindings: RuntimeBindingSnapshot[];
  version: string;
};

export type RuntimeVerificationEffects = {
  humanInterventionRate?: number;
  sampleSize: number;
  skillSuccessRate?: number;
  skillSuccessSampleSize?: number;
  p95LatencyMs?: number;
  latencySampleSize?: number;
  securityViolations?: number;
  securitySampleSize?: number;
  crossTenantContamination?: number;
  tenantSampleSize?: number;
  tokenCost?: number;
  tokenSampleSize?: number;
  deliveryFailureRate?: number;
  deliverySampleSize?: number;
};

export type RuntimeGovernancePort = {
  getMode(): EvolutionGovernanceMode;
  isKillSwitchActive(): boolean;
  inspect(runtimeAgentId: string): RuntimeAgentView | undefined;
  applyAction(input: {
    runtimeAgentId: string;
    action: GovernanceRuntimeAction;
    redirectTargetAgentId?: string;
  }): RuntimeActionRestoreSnapshot;
  restore(snapshot: RuntimeActionRestoreSnapshot): void;
  listVerificationEffects?(input: {
    runtimeAgentId: string;
    applicationId?: string;
    experimentId?: string;
    phase?: "baseline" | "treatment";
    startedAt: string;
    endedAt: string;
    tenantScope?: string;
  }): RuntimeVerificationEffects | undefined;
};

function observationsFromRuntimeEffects(
  effects: RuntimeVerificationEffects | undefined,
  windowRef: string,
): MetricObservation[] {
  if (!effects) {
    return [];
  }
  const rows: MetricObservation[] = [];
  if (effects.humanInterventionRate != null && effects.sampleSize > 0) {
    rows.push({
      metricId: "governance_human_intervention_rate",
      value: effects.humanInterventionRate,
      sampleSize: effects.sampleSize,
      windowRef,
    });
  }
  if (effects.skillSuccessRate != null) {
    const sampleSize = effects.skillSuccessSampleSize ?? effects.sampleSize;
    if (sampleSize > 0) {
      rows.push({
        metricId: "skill_success_rate",
        value: effects.skillSuccessRate,
        sampleSize,
        windowRef,
      });
    }
  }
  if (effects.p95LatencyMs != null) {
    const sampleSize = effects.latencySampleSize ?? effects.sampleSize;
    if (sampleSize > 0) {
      rows.push({
        metricId: "p95_latency",
        value: effects.p95LatencyMs,
        sampleSize,
        windowRef,
      });
    }
  }
  if (effects.securityViolations != null) {
    const sampleSize = effects.securitySampleSize ?? effects.sampleSize;
    if (sampleSize > 0) {
      rows.push({
        metricId: "security_violations",
        value: effects.securityViolations,
        sampleSize,
        windowRef,
      });
    }
  }
  if (effects.crossTenantContamination != null) {
    const sampleSize = effects.tenantSampleSize ?? effects.sampleSize;
    if (sampleSize > 0) {
      rows.push({
        metricId: "cross_tenant_contamination",
        value: effects.crossTenantContamination,
        sampleSize,
        windowRef,
      });
    }
  }
  if (effects.tokenCost != null) {
    const sampleSize = effects.tokenSampleSize ?? effects.sampleSize;
    if (sampleSize > 0) {
      rows.push({
        metricId: "token_cost",
        value: effects.tokenCost,
        sampleSize,
        windowRef,
      });
    }
  }
  if (effects.deliveryFailureRate != null) {
    const sampleSize = effects.deliverySampleSize ?? effects.sampleSize;
    if (sampleSize > 0) {
      rows.push({
        metricId: "delivery_failure_rate",
        value: effects.deliveryFailureRate,
        sampleSize,
        windowRef,
      });
    }
  }
  return rows;
}

function isSystemTarget(
  target: EvolutionTarget,
): target is { domain: "system"; componentId: string } {
  return target.domain === "system";
}

export function surfaceAllowsRuntimeApply(): boolean {
  const surface = getEvolutionSurface(RUNTIME_GOVERNANCE_SURFACE_ID);
  return Boolean(surface?.allowedOperations.includes("apply"));
}

export function runtimeBindingVersion(view: RuntimeAgentView): string {
  return view.version;
}

export function createMemoryRuntimeGovernancePort(seed: {
  mode?: EvolutionGovernanceMode;
  killSwitch?: boolean;
  agents: RuntimeAgentView[];
  effectsByAgent?: Record<string, RuntimeVerificationEffects>;
}): RuntimeGovernancePort {
  const mode = seed.mode ?? "assist";
  const killSwitch = seed.killSwitch ?? false;
  const agents = new Map(seed.agents.map((row) => [row.runtimeAgentId, structuredClone(row)]));
  const requireAgent = (runtimeAgentId: string): RuntimeAgentView => {
    const agent = agents.get(runtimeAgentId);
    if (!agent) {
      throw new Error(`runtime agent not found: ${runtimeAgentId}`);
    }
    return agent;
  };
  const snapshotVersion = (agent: RuntimeAgentView): string =>
    `runtime:${agent.runtimeAgentId}:${agent.bindings.map((row) => `${row.bindingId}:${row.state}`).join(",")}`;
  return {
    getMode: () => mode,
    isKillSwitchActive: () => killSwitch,
    inspect(runtimeAgentId) {
      const agent = agents.get(runtimeAgentId);
      if (!agent) {
        return undefined;
      }
      return structuredClone({ ...agent, version: snapshotVersion(agent) });
    },
    applyAction(input) {
      if (killSwitch) {
        throw new Error("kill-switch-active");
      }
      const agent = requireAgent(input.runtimeAgentId);
      const originalBindings = agent.bindings.map((row) => ({ ...row }));
      const changedBindingIds: string[] = [];
      if (input.action === "pause") {
        agent.bindings = agent.bindings.map((row) => {
          if (row.state === "active") {
            changedBindingIds.push(row.bindingId);
            return { ...row, state: "disabled" };
          }
          return row;
        });
      } else if (input.action === "resume") {
        agent.bindings = agent.bindings.map((row) => {
          if (row.state === "disabled") {
            changedBindingIds.push(row.bindingId);
            return { ...row, state: "active" };
          }
          return row;
        });
      } else if (input.action === "limit") {
        agent.bindings = agent.bindings.map((row) => {
          if (row.state === "active") {
            changedBindingIds.push(row.bindingId);
            return { ...row, state: "degraded" };
          }
          return row;
        });
      } else if (input.action === "clear_limit") {
        agent.bindings = agent.bindings.map((row) => {
          if (row.state === "degraded") {
            changedBindingIds.push(row.bindingId);
            return { ...row, state: "active" };
          }
          return row;
        });
      }
      agent.version = snapshotVersion(agent);
      agents.set(agent.runtimeAgentId, agent);
      return {
        runtimeAgentId: agent.runtimeAgentId,
        action: input.action,
        originalBindings,
        changedBindingIds,
      };
    },
    restore(snapshot) {
      const agent = requireAgent(snapshot.runtimeAgentId);
      const originals = new Map(snapshot.originalBindings.map((row) => [row.bindingId, row]));
      agent.bindings = agent.bindings.map((row) => {
        if (!snapshot.changedBindingIds.includes(row.bindingId)) {
          return row;
        }
        return originals.get(row.bindingId) ?? row;
      });
      agent.version = snapshotVersion(agent);
      agents.set(agent.runtimeAgentId, agent);
    },
    listVerificationEffects(input) {
      return seed.effectsByAgent?.[input.runtimeAgentId];
    },
  };
}

export function runtimeSkillInvocationInWindow(
  event: {
    type: string;
    completedAt: number;
    outcome: string;
    experimentId?: string | null;
  },
  input: {
    startedAt: number;
    endedAt: number;
    experimentId?: string;
    phase?: "baseline" | "treatment";
  },
): boolean {
  if (
    event.type !== "skill_invocation_completed" ||
    event.completedAt < input.startedAt ||
    event.completedAt > input.endedAt ||
    event.outcome === "cancelled"
  ) {
    return false;
  }
  const experimentId = event.experimentId ?? undefined;
  if (input.phase === "treatment" && input.experimentId) {
    return experimentId === input.experimentId;
  }
  if (
    input.phase === "baseline" &&
    input.experimentId &&
    experimentId &&
    experimentId !== input.experimentId
  ) {
    return false;
  }
  return true;
}

export function createLiveRuntimeGovernancePort(): RuntimeGovernancePort {
  return {
    getMode: () => getEvolutionGovernanceMode(),
    isKillSwitchActive: () => isGovernanceKillSwitchActive(),
    inspect(runtimeAgentId) {
      const agent = getAgent(runtimeAgentId);
      if (!agent) {
        return undefined;
      }
      const bindings = listBindings({
        runtimeAgentId,
        capabilityId: null,
        bindingType: null,
        bindingState: null,
        health: null,
      }).map((binding) => ({
        bindingId: binding.bindingId,
        state: binding.bindingState,
      }));
      return {
        runtimeAgentId,
        bindings,
        version: `runtime:${runtimeAgentId}:${bindings
          .map((row) => `${row.bindingId}:${row.state}`)
          .join(",")}`,
      };
    },
    applyAction(input) {
      const before = this.inspect(input.runtimeAgentId);
      const result = applyGovernanceRuntimeAction({
        runtimeAgentId: input.runtimeAgentId,
        action: input.action,
        ...(input.redirectTargetAgentId
          ? { redirectTargetAgentId: input.redirectTargetAgentId }
          : {}),
      });
      if (!result.ok) {
        throw new Error(result.reason ?? "runtime action failed");
      }
      return {
        runtimeAgentId: input.runtimeAgentId,
        action: input.action,
        originalBindings: before?.bindings ?? [],
        changedBindingIds: result.affectedBindingIds,
      };
    },
    restore(snapshot) {
      if (snapshot.action === "pause") {
        applyGovernanceRuntimeAction({
          runtimeAgentId: snapshot.runtimeAgentId,
          action: "resume",
        });
        return;
      }
      if (snapshot.action === "limit") {
        applyGovernanceRuntimeAction({
          runtimeAgentId: snapshot.runtimeAgentId,
          action: "clear_limit",
        });
        return;
      }
      if (snapshot.action === "redirect") {
        applyGovernanceRuntimeAction({
          runtimeAgentId: snapshot.runtimeAgentId,
          action: "clear_redirect",
        });
        return;
      }
      for (const binding of snapshot.originalBindings) {
        if (!snapshot.changedBindingIds.includes(binding.bindingId)) {
          continue;
        }
        updateBindingState(binding.bindingId, binding.state);
      }
    },
    listVerificationEffects(input) {
      const startedAt = Date.parse(input.startedAt);
      const endedAt = Date.parse(input.endedAt);
      if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) {
        return undefined;
      }
      const selected = selectRuntimeEffectObservationEvents({
        events: listGovernanceEffectObservationEvents(),
        windows: listGovernanceEffectVerifications(),
        runtimeAgentId: input.runtimeAgentId,
        phase: input.phase ?? "baseline",
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        experimentId: input.experimentId,
        applicationId: input.applicationId,
        tenantId: input.tenantScope,
      });
      const aggregated = aggregateRuntimeEffectObservations(selected);
      if (!aggregated) {
        return undefined;
      }
      return aggregated;
    },
  };
}

export function createRuntimeGovernanceAdapter(
  port: RuntimeGovernancePort,
  options?: { persistDir?: string; governanceConfigDir?: string },
): EvolutionAdapter<RuntimeGovernanceCandidate> {
  const loaded = loadAdapterSnapshots(options?.persistDir, "runtime-governance", {
    snapshots: {} as Record<string, RuntimeActionRestoreSnapshot>,
  });
  const applied = new Map(Object.entries(loaded.applied));
  const snapshots = new Map(Object.entries(loaded.extras.snapshots));
  const persist = () =>
    saveAdapterSnapshots(options?.persistDir, "runtime-governance", {
      applied: Object.fromEntries(applied),
      extras: { snapshots: Object.fromEntries(snapshots) },
    });

  return {
    adapterId: "runtime-governance",
    domain: "system",

    async inspect(target): Promise<TargetSnapshot> {
      if (!isSystemTarget(target)) {
        throw new Error("runtime governance adapter requires a system target");
      }
      const view = port.inspect(target.componentId);
      return {
        target,
        version: view ? runtimeBindingVersion(view) : `mode:${port.getMode()}`,
        surfaceId: RUNTIME_GOVERNANCE_SURFACE_ID,
        sourceOfTruth: "src/gateway/evolution-governance/runtime-actions.ts",
        rollbackRef: port.isKillSwitchActive() ? "kill-switch-active" : "compare-and-restore",
      };
    },

    async validate(candidate, context): Promise<ValidationResult> {
      if (!isSystemTarget(context.proposal.target)) {
        return {
          ok: false,
          code: "target_mismatch",
          reason: "proposal target is not a system component",
        };
      }
      if (context.proposal.surfaceId !== RUNTIME_GOVERNANCE_SURFACE_ID) {
        return {
          ok: false,
          code: "surface_mismatch",
          reason: "runtime candidate requires runtime surface",
        };
      }
      if (candidate.kind === "set-kill-switch") {
        return {
          ok: false,
          code: "operation_forbidden",
          reason: "evolution cannot change the governance kill switch",
        };
      }
      if (candidate.runtimeAgentId !== context.proposal.target.componentId) {
        return {
          ok: false,
          code: "target_mismatch",
          reason: "runtime agent does not match proposal target",
        };
      }
      if (!(RUNTIME_GOVERNANCE_ACTIONS as readonly string[]).includes(candidate.action)) {
        return { ok: false, code: "offline_validation_failed", reason: "unknown runtime action" };
      }
      if (!port.inspect(candidate.runtimeAgentId)) {
        return { ok: false, code: "not_found", reason: "runtime agent not found" };
      }
      if (port.isKillSwitchActive()) {
        return {
          ok: false,
          code: "kill_switch_active",
          reason: "kill switch blocks runtime mutation",
        };
      }
      if (port.getMode() === "assist" || port.getMode() === "off") {
        return {
          ok: false,
          code: "assist_zero_mutation",
          reason: "assist mode cannot mutate runtime through evolution",
        };
      }
      if (!surfaceAllowsRuntimeApply()) {
        return {
          ok: false,
          code: "operation_forbidden",
          reason: "surface does not authorize runtime apply",
        };
      }
      return { ok: true };
    },

    async apply(
      input: ApplyEvolutionInput<RuntimeGovernanceCandidate>,
    ): Promise<EvolutionApplication> {
      const existing = applied.get(input.idempotencyKey);
      if (existing) {
        return existing;
      }
      const validation = await this.validate(input.candidate, input.context);
      if (!validation.ok) {
        throw new Error(validation.reason);
      }
      if (input.candidate.kind !== "runtime-action") {
        throw new Error("evolution cannot change the governance kill switch");
      }
      const candidate = input.candidate;
      const before = port.inspect(candidate.runtimeAgentId);
      if (!before) {
        throw new Error("runtime agent not found");
      }
      const writeAction = input.scope !== "shadow";
      if (writeAction) {
        const liveOthers = [...applied.values()].filter((row) => {
          if (row.status !== "applied" || row.scope === "shadow") {
            return false;
          }
          const prior = snapshots.get(row.rollbackRef);
          return (
            prior?.runtimeAgentId === candidate.runtimeAgentId &&
            row.applicationId !== `app:${input.idempotencyKey}`
          );
        });
        if (liveOthers.length > 0) {
          throw new Error("multiple live runtime applications fail closed");
        }
      }
      let snapshot: RuntimeActionRestoreSnapshot;
      try {
        snapshot = writeAction
          ? port.applyAction({
              runtimeAgentId: input.candidate.runtimeAgentId,
              action: input.candidate.action,
              ...(input.candidate.redirectTargetAgentId
                ? { redirectTargetAgentId: input.candidate.redirectTargetAgentId }
                : {}),
            })
          : {
              runtimeAgentId: input.candidate.runtimeAgentId,
              action: input.candidate.action,
              originalBindings: before.bindings,
              changedBindingIds: [],
            };
      } catch (error) {
        throw error instanceof Error ? error : new Error("runtime action failed");
      }
      const after = port.inspect(input.candidate.runtimeAgentId) ?? before;
      const application: EvolutionApplication = {
        schemaVersion: 1,
        applicationId: `app:${input.idempotencyKey}`,
        proposalId: input.context.proposal.proposalId,
        experimentId: input.context.experiment.experimentId,
        adapterId: "runtime-governance",
        idempotencyKey: input.idempotencyKey,
        targetVersionBefore: runtimeBindingVersion(before),
        targetVersionAfter: runtimeBindingVersion(after),
        rollbackRef: `rollback:${input.idempotencyKey}`,
        scope: input.scope,
        status: "applied",
        appliedToRuntime: input.scope !== "shadow",
        appliedAt: new Date().toISOString(),
      };
      if (writeAction) {
        const tenantId = input.context.tenantScope ?? input.context.proposal.tenantScope;
        if (!tenantId) {
          port.restore(snapshot);
          throw new Error("trusted tenant binding required");
        }
        try {
          openGovernanceEffectWindow(
            {
              runtimeAgentId: input.candidate.runtimeAgentId,
              reason: `evolution:${input.context.commandId}`,
              action: input.candidate.action,
              commandId: input.idempotencyKey,
              beforeSnapshot: {
                action: input.candidate.action,
                originalStates: Object.fromEntries(
                  snapshot.originalBindings.map((row) => [row.bindingId, row.state]),
                ),
                changedBindingIds: snapshot.changedBindingIds,
                ...(input.candidate.redirectTargetAgentId
                  ? { redirectTargetAgentId: input.candidate.redirectTargetAgentId }
                  : {}),
              },
              binding: {
                proposalId: input.context.proposal.proposalId,
                experimentId: input.context.experiment.experimentId,
                applicationId: application.applicationId,
                tenantId,
                domainReceiptRef: application.rollbackRef,
              },
              modelRevision: input.context.experiment.frozen.modelRef,
              configRevision: input.context.experiment.frozen.configSnapshotRef,
              minimumSampleSize: input.context.experiment.minimumSampleSize,
            },
            options?.governanceConfigDir,
          );
        } catch (error) {
          port.restore(snapshot);
          throw error instanceof Error ? error : new Error("effect window open failed");
        }
      }
      snapshots.set(application.rollbackRef, snapshot);
      applied.set(input.idempotencyKey, application);
      persist();
      return application;
    },

    async observeTarget(target, windowRef, window) {
      if (!isSystemTarget(target) || !window) {
        return [];
      }
      const view = port.inspect(target.componentId);
      if (!view) {
        return [];
      }
      return observationsFromRuntimeEffects(
        port.listVerificationEffects?.({
          runtimeAgentId: target.componentId,
          experimentId: window.experimentId,
          phase: window.phase,
          startedAt: window.startedAt,
          endedAt: window.endedAt,
          ...(window.tenantScope ? { tenantScope: window.tenantScope } : {}),
        }),
        windowRef,
      );
    },

    async observe(input) {
      const snapshot = snapshots.get(input.application.rollbackRef);
      if (!snapshot || !input.window) {
        return [];
      }
      return observationsFromRuntimeEffects(
        port.listVerificationEffects?.({
          runtimeAgentId: snapshot.runtimeAgentId,
          applicationId: input.application.applicationId,
          experimentId: input.window.experimentId,
          phase: input.window.phase,
          startedAt: input.window.startedAt,
          endedAt: input.window.endedAt,
          ...(input.window.tenantScope ? { tenantScope: input.window.tenantScope } : {}),
        }),
        input.windowRef,
      );
    },

    async rollback(application: EvolutionApplication): Promise<RollbackResult> {
      const snapshot = snapshots.get(application.rollbackRef);
      if (!snapshot) {
        return {
          applicationId: application.applicationId,
          status: "failed",
          restoredVersion: application.targetVersionBefore,
          reason: "rollback snapshot missing",
        };
      }
      if (snapshot.changedBindingIds.length > 0) {
        port.restore(snapshot);
      }
      revokeGovernanceEffectWindowsForApplication(
        {
          applicationId: application.applicationId,
          reason: "application rolled back",
        },
        options?.governanceConfigDir,
      );
      applied.set(application.idempotencyKey, { ...application, status: "rolled_back" });
      persist();
      const restored = port.inspect(snapshot.runtimeAgentId);
      return {
        applicationId: application.applicationId,
        status: "rolled_back",
        restoredVersion: restored
          ? runtimeBindingVersion(restored)
          : application.targetVersionBefore,
      };
    },
  };
}
