import {
  type ApplyEvolutionInput,
  type EvolutionAdapter,
  type EvolutionApplication,
  type EvolutionTarget,
  type ObserveApplicationInput,
  type RollbackResult,
  type TargetSnapshot,
  type ValidationResult,
} from "@openbot/evolution-core";
import type { OpenBotConfig } from "../../../config/config.js";
import { writeJsonAtomic } from "../../../infra/json-files.js";
import { readEffectiveEvolutionTaskOutcomes } from "../../../task-outcome/growth-bridge.js";
import { EVOLUTION_TASK_OUTCOMES_FILENAME } from "../../agent-growth/evolution-task-outcomes.js";
import {
  applyWorkingStyleDelta,
  DEFAULT_WORKING_STYLE,
  type WorkingStyle,
} from "../../agent-growth/genome.js";
import {
  readRobotWorkingStyleOrDefault,
  resolveRobotWorkingStyleChangePath,
  compareAndSwapRobotWorkingStyle,
  workingStyleVersion,
  type WorkingStyleChangeRecord,
} from "../../agent-growth/working-style-store.js";
import {
  crossTenantFromIds,
  filterCohort,
  observationsFromCohort,
  type CohortOutcome,
} from "../observation-cohort.js";
import { loadAdapterSnapshots, saveAdapterSnapshots } from "../persistent-store.js";

export const WORKING_DNA_TASK_OUTCOMES_FILENAME = EVOLUTION_TASK_OUTCOMES_FILENAME;

export type WorkingDnaTaskOutcome = CohortOutcome & {
  agentId: string;
  taskId?: string;
};

export type WorkingDnaObservationPort = {
  listTaskOutcomes(filter: {
    agentId: string;
    startedAtMs: number;
    endedAtMs: number;
    experimentId?: string;
    applicationId?: string;
  }): WorkingDnaTaskOutcome[];
};

export function createMemoryWorkingDnaObservationPort(
  seed: WorkingDnaTaskOutcome[] = [],
): WorkingDnaObservationPort {
  const rows = seed.map((row) => ({ ...row }));
  return {
    listTaskOutcomes(filter) {
      return rows.filter((row) => {
        if (row.agentId !== filter.agentId) {
          return false;
        }
        return row.occurredAt >= filter.startedAtMs && row.occurredAt <= filter.endedAtMs;
      });
    },
  };
}

function enrichWorkingDnaCohort(
  events: CohortOutcome[],
  tenantScope: string | null,
): CohortOutcome[] {
  return events.map((event) => ({
    ...event,
    crossTenantContamination:
      event.crossTenantContamination ?? crossTenantFromIds(event.tenantId, tenantScope),
  }));
}

export function createFileWorkingDnaObservationPort(cfg: OpenBotConfig): WorkingDnaObservationPort {
  return {
    listTaskOutcomes(filter) {
      // Production reads the effective projection (highest non-revoked version per task).
      return readEffectiveEvolutionTaskOutcomes(cfg, filter.agentId)
        .filter((row) => {
          return row.occurredAt >= filter.startedAtMs && row.occurredAt <= filter.endedAtMs;
        })
        .map((row) => ({
          agentId: row.agentId,
          occurredAt: row.occurredAt,
          succeeded: row.succeeded,
          ...(row.tenantId ? { tenantId: row.tenantId } : {}),
          ...(row.experimentId ? { experimentId: row.experimentId } : {}),
          ...(row.applicationId ? { applicationId: row.applicationId } : {}),
          ...(row.taskId ? { taskId: row.taskId } : {}),
          ...(row.runId ? { runId: row.runId } : {}),
          // R85d: preserve evaluation evidence for experiment metrics.
          ...(row.cohortRef ? { cohortRef: row.cohortRef } : {}),
          ...(typeof row.latencyMs === "number" && Number.isFinite(row.latencyMs)
            ? { latencyMs: row.latencyMs }
            : {}),
          ...(typeof row.securityViolation === "boolean"
            ? { securityViolation: row.securityViolation }
            : {}),
          ...(typeof row.humanTakeover === "boolean" ? { humanTakeover: row.humanTakeover } : {}),
          ...(typeof row.suspectedAuthorizationBypass === "boolean"
            ? { suspectedAuthorizationBypass: row.suspectedAuthorizationBypass }
            : {}),
          ...(row.crossTenantContamination !== undefined
            ? { crossTenantContamination: row.crossTenantContamination }
            : {}),
        }));
    },
  };
}

export type WorkingDnaCandidate = {
  agentId: string;
  delta: Partial<WorkingStyle>;
  baselineStyle: WorkingStyle;
  candidateVersion: string;
};

const styleVersion = workingStyleVersion;
function isAgentTarget(target: EvolutionTarget): target is { domain: "agent"; agentId: string } {
  return target.domain === "agent";
}

export function createWorkingDnaAdapter(
  cfg: OpenBotConfig,
  options?: { persistDir?: string; observationPort?: WorkingDnaObservationPort },
): EvolutionAdapter<WorkingDnaCandidate> {
  const observationPort = options?.observationPort ?? createFileWorkingDnaObservationPort(cfg);
  const loaded = loadAdapterSnapshots(options?.persistDir, "working-dna", {
    snapshots: {} as Record<string, WorkingStyle>,
    agentByApplication: {} as Record<string, string>,
  });
  const applied = new Map(Object.entries(loaded.applied));
  const snapshots = new Map(Object.entries(loaded.extras.snapshots));
  const agentByApplication = new Map(Object.entries(loaded.extras.agentByApplication));
  const persist = () =>
    saveAdapterSnapshots(options?.persistDir, "working-dna", {
      applied: Object.fromEntries(applied),
      extras: {
        snapshots: Object.fromEntries(snapshots),
        agentByApplication: Object.fromEntries(agentByApplication),
      },
    });
  return {
    adapterId: "working-dna",
    domain: "agent",

    async inspect(target): Promise<TargetSnapshot> {
      if (!isAgentTarget(target)) {
        throw new Error("working-dna adapter requires an agent target");
      }
      const style = await readRobotWorkingStyleOrDefault(cfg, target.agentId);
      return {
        target,
        version: styleVersion(style),
        surfaceId: "agent.working-dna",
        sourceOfTruth: "src/gateway/agent-growth/working-style-store.ts",
      };
    },

    async validate(candidate, context): Promise<ValidationResult> {
      if (!isAgentTarget(context.proposal.target)) {
        return { ok: false, code: "target_mismatch", reason: "proposal target is not an agent" };
      }
      if (candidate.agentId !== context.proposal.target.agentId) {
        return {
          ok: false,
          code: "target_mismatch",
          reason: "candidate agent does not match proposal target",
        };
      }
      if (context.proposal.surfaceId !== "agent.working-dna") {
        return {
          ok: false,
          code: "surface_mismatch",
          reason: "working-dna adapter cannot widen surface",
        };
      }
      if (Object.keys(candidate.delta).length === 0) {
        return { ok: false, code: "empty_candidate", reason: "working DNA candidate has no delta" };
      }
      const current = await readRobotWorkingStyleOrDefault(cfg, candidate.agentId);
      const frozen = { ...DEFAULT_WORKING_STYLE, ...candidate.baselineStyle };
      const currentVersion = styleVersion(current);
      const frozenVersion = styleVersion(frozen);
      // The canary write is exactly frozen baseline plus this candidate's delta.
      // Active apply of that same candidate must still validate. Any other style
      // remains baseline drift. The frozen baseline itself is not rewritten.
      const canaryVersion = styleVersion(applyWorkingStyleDelta(frozen, candidate.delta));
      if (currentVersion !== frozenVersion && currentVersion !== canaryVersion) {
        return {
          ok: false,
          code: "baseline_drift",
          reason: "current Working DNA no longer matches frozen baseline",
        };
      }
      return { ok: true };
    },

    async apply(input: ApplyEvolutionInput<WorkingDnaCandidate>): Promise<EvolutionApplication> {
      const existing = applied.get(input.idempotencyKey);
      if (existing) {
        return existing;
      }
      const validation = await this.validate(input.candidate, input.context);
      if (!validation.ok) {
        throw new Error(validation.reason);
      }
      const agentId = input.candidate.agentId;
      const current = await readRobotWorkingStyleOrDefault(cfg, agentId);
      const beforeVersion = styleVersion(current);
      const frozen = { ...DEFAULT_WORKING_STYLE, ...input.candidate.baselineStyle };
      const candidateVersion = styleVersion(applyWorkingStyleDelta(frozen, input.candidate.delta));
      if (beforeVersion !== styleVersion(frozen) && beforeVersion !== candidateVersion) {
        throw new Error("baseline_drift");
      }
      if (input.scope === "shadow") {
        const shadow: EvolutionApplication = {
          schemaVersion: 1,
          applicationId: `app:${input.idempotencyKey}`,
          proposalId: input.context.proposal.proposalId,
          experimentId: input.context.experiment.experimentId,
          adapterId: "working-dna",
          idempotencyKey: input.idempotencyKey,
          targetVersionBefore: beforeVersion,
          targetVersionAfter: beforeVersion,
          rollbackRef: `rollback:${input.idempotencyKey}`,
          scope: "shadow",
          status: "applied",
          appliedToRuntime: false,
          appliedAt: new Date().toISOString(),
        };
        applied.set(input.idempotencyKey, shadow);
        persist();
        return shadow;
      }
      const previousValues: Partial<WorkingStyle> = {};
      const nextStyle = applyWorkingStyleDelta(current, input.candidate.delta);
      for (const key of Object.keys(input.candidate.delta) as Array<keyof WorkingStyle>) {
        if (current[key] !== nextStyle[key]) {
          Object.assign(previousValues, { [key]: current[key] });
        }
      }
      const swapped = await compareAndSwapRobotWorkingStyle(cfg, agentId, beforeVersion, (locked) =>
        applyWorkingStyleDelta(locked, input.candidate.delta),
      );
      if (!swapped.ok) {
        throw new Error("version_conflict");
      }
      const change: WorkingStyleChangeRecord = {
        changedAtMs: Date.now(),
        baselineOperationalScore: null,
        appliedDelta: input.candidate.delta,
        previousValues,
        assessedAtMs: null,
      };
      await writeJsonAtomic(resolveRobotWorkingStyleChangePath(cfg, agentId), change);
      const after = swapped.after;
      const application: EvolutionApplication = {
        schemaVersion: 1,
        applicationId: `app:${input.idempotencyKey}`,
        proposalId: input.context.proposal.proposalId,
        experimentId: input.context.experiment.experimentId,
        adapterId: "working-dna",
        idempotencyKey: input.idempotencyKey,
        targetVersionBefore: beforeVersion,
        targetVersionAfter: styleVersion(after),
        rollbackRef: `rollback:${input.idempotencyKey}`,
        scope: input.scope,
        status: "applied",
        appliedToRuntime: true,
        appliedAt: new Date().toISOString(),
      };
      snapshots.set(application.rollbackRef, { ...current });
      agentByApplication.set(application.applicationId, agentId);
      applied.set(input.idempotencyKey, application);
      persist();
      return application;
    },

    async observeTarget(target, windowRef, window) {
      if (!isAgentTarget(target) || !window) {
        return [];
      }
      const startedAtMs = Date.parse(window.startedAt);
      const endedAtMs = Date.parse(window.endedAt);
      if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs)) {
        return [];
      }
      const events = enrichWorkingDnaCohort(
        filterCohort(
          observationPort.listTaskOutcomes({
            agentId: target.agentId,
            startedAtMs,
            endedAtMs,
            experimentId: window.experimentId,
          }),
          window,
          {
            experimentId: window.experimentId,
            agentId: target.agentId,
            tenantId: window.tenantScope ?? undefined,
            cohortRef: window.cohortRef,
            requireCohort: window.phase === "treatment",
            requireRunId: window.phase === "treatment",
          },
        ),
        window.tenantScope,
      );
      return observationsFromCohort({
        events,
        windowRef,
        primary: {
          metricId: "task_success_rate",
          value: (rows) => rows.filter((row) => row.succeeded).length / rows.length,
        },
        includeLatencyP95: true,
        includeHumanTakeover: true,
      });
    },

    async observe(input: ObserveApplicationInput) {
      const agentId = agentByApplication.get(input.application.applicationId);
      if (!agentId || !input.window) {
        return [];
      }
      const startedAtMs = Date.parse(input.window.startedAt);
      const endedAtMs = Date.parse(input.window.endedAt);
      if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs)) {
        return [];
      }
      const events = enrichWorkingDnaCohort(
        filterCohort(
          observationPort.listTaskOutcomes({
            agentId,
            startedAtMs,
            endedAtMs,
            experimentId: input.window.experimentId,
            applicationId: input.application.applicationId,
          }),
          input.window,
          {
            experimentId: input.window.experimentId,
            applicationId: input.application.applicationId,
            agentId,
            tenantId: input.window.tenantScope ?? undefined,
            cohortRef: input.window.cohortRef,
            requireCohort: true,
            requireRunId: input.window.phase === "treatment",
          },
        ),
        input.window.tenantScope,
      );
      return observationsFromCohort({
        events,
        windowRef: input.windowRef,
        primary: {
          metricId: "task_success_rate",
          value: (rows) => rows.filter((row) => row.succeeded).length / rows.length,
        },
        includeLatencyP95: true,
        includeHumanTakeover: true,
      });
    },

    async rollback(application: EvolutionApplication): Promise<RollbackResult> {
      if (application.scope === "shadow") {
        const rolled: EvolutionApplication = { ...application, status: "rolled_back" };
        applied.set(application.idempotencyKey, rolled);
        persist();
        return {
          applicationId: application.applicationId,
          status: "rolled_back",
          restoredVersion: application.targetVersionBefore,
        };
      }
      const snapshot = snapshots.get(application.rollbackRef);
      const agentId = agentByApplication.get(application.applicationId);
      if (!snapshot || !agentId) {
        return {
          applicationId: application.applicationId,
          status: "failed",
          restoredVersion: application.targetVersionBefore,
          reason: "rollback snapshot missing",
        };
      }
      const swapped = await compareAndSwapRobotWorkingStyle(
        cfg,
        agentId,
        application.targetVersionAfter,
        () => snapshot,
      );
      if (!swapped.ok) {
        return {
          applicationId: application.applicationId,
          status: "failed",
          restoredVersion: swapped.actualVersion,
          reason: "version_conflict",
        };
      }
      const rolled: EvolutionApplication = { ...application, status: "rolled_back" };
      applied.set(application.idempotencyKey, rolled);
      persist();
      return {
        applicationId: application.applicationId,
        status: "rolled_back",
        restoredVersion: styleVersion(snapshot),
      };
    },
  };
}
