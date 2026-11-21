import type {
  ApplyEvolutionInput,
  EvolutionAdapter,
  EvolutionApplication,
  EvolutionTarget,
  ObserveApplicationInput,
  RollbackResult,
  TargetSnapshot,
  ValidationResult,
} from "@openbot/evolution-core";
import { readSkillInvocationEvents } from "../../skill-invocation/event-store.js";
import {
  getPersonalSkillAssetDetail,
  installSkillToRobotAsset,
  listRobotSkillAssets,
  listTenantRobotSkillAssets,
  publishSkillReview,
  restoreRobotSkillInstallation,
  restoreSkillLifecycleState,
  upgradeRobotSkillAsset,
  type SkillLifecycleState,
} from "../../skill-lifecycle-store.js";
import {
  crossTenantFromIds,
  filterCohort,
  observationsFromCohort,
  securityViolationFromFailureCategory,
} from "../observation-cohort.js";
import { loadAdapterSnapshots, saveAdapterSnapshots } from "../persistent-store.js";

export const SKILL_OPERATIONS = ["publish", "install", "promote"] as const;
export type SkillOperation = (typeof SKILL_OPERATIONS)[number];

export type SkillCandidate = {
  skillId: string;
  operation: SkillOperation;
  agentId?: string;
  candidateVersion: string;
};

export type SkillInstallationSnapshot = {
  installed: boolean;
  installedVersion?: string;
  enabled?: boolean;
};

export type SkillInvocationSample = {
  outcome: "success" | "failure" | "cancelled";
  latencyMs: number;
  completedAt: number;
  agentId?: string;
  tenantId?: string | null;
  failureCategory?: string | null;
  experimentId?: string | null;
  applicationId?: string | null;
};

export type SkillRecord = {
  skillId: string;
  name: string;
  summary: string;
  lifecycle: SkillLifecycleState;
  version: string;
  successRate: number;
  installations: Record<string, SkillInstallationSnapshot>;
  completedInvocations?: number;
  avgLatency?: number;
  invocations?: SkillInvocationSample[];
};

export type SkillCompletedInvocationFilter = {
  skillId: string;
  agentId?: string;
  tenantId?: string | null;
  startedAtMs: number;
  endedAtMs: number;
};

export type SkillLifecyclePort = {
  get(skillId: string): SkillRecord | undefined;
  installation(agentId: string, skillId: string): SkillInstallationSnapshot | undefined;
  publish(skillId: string): SkillRecord;
  install(agentId: string, skillId: string): SkillRecord;
  promote(agentId: string, skillId: string): SkillRecord;
  restoreLifecycle(skillId: string, lifecycle: SkillLifecycleState): void;
  restoreInstallation(agentId: string, skillId: string, previous: SkillInstallationSnapshot): void;
  listCompletedInvocations?(filter: SkillCompletedInvocationFilter): SkillInvocationSample[];
};

type SkillRollbackSnapshot = {
  operation: SkillOperation;
  skillId: string;
  previousLifecycle: SkillLifecycleState;
  agentId?: string;
  previousInstallation?: SkillInstallationSnapshot;
};

const RUNNABLE: ReadonlySet<SkillLifecycleState> = new Set(["private", "approved", "published"]);

function isCapabilityTarget(
  target: EvolutionTarget,
): target is { domain: "capability"; skillId: string } {
  return target.domain === "capability";
}

function skillVersion(record: SkillRecord): string {
  return `skill:${record.lifecycle}:${record.version}`;
}

function surfaceForOperation(operation: SkillOperation): string {
  return operation === "install" ? "capability.skill-installation" : "capability.skill-spec";
}

function adapterIdForOperation(operation: SkillOperation): "skill" | "skill-installation" {
  return operation === "install" ? "skill-installation" : "skill";
}

export function createMemorySkillLifecyclePort(seed: SkillRecord[] = []): SkillLifecyclePort {
  const rows = new Map(seed.map((row) => [row.skillId, structuredClone(row)]));
  const require = (skillId: string): SkillRecord => {
    const row = rows.get(skillId);
    if (!row) {
      throw new Error(`skill not found: ${skillId}`);
    }
    return row;
  };
  return {
    get(skillId) {
      const row = rows.get(skillId);
      return row ? structuredClone(row) : undefined;
    },
    installation(agentId, skillId) {
      const row = rows.get(skillId);
      const current = row?.installations[agentId];
      return current ? { ...current } : undefined;
    },
    publish(skillId) {
      const row = require(skillId);
      row.lifecycle = "published";
      rows.set(skillId, row);
      return structuredClone(row);
    },
    install(agentId, skillId) {
      const row = require(skillId);
      row.installations[agentId] = {
        installed: true,
        enabled: true,
        installedVersion: row.version,
      };
      rows.set(skillId, row);
      return structuredClone(row);
    },
    promote(agentId, skillId) {
      const row = require(skillId);
      const current = row.installations[agentId];
      if (!current?.installed) {
        throw new Error(`skill ${skillId} is not installed on ${agentId}`);
      }
      row.installations[agentId] = {
        ...current,
        installedVersion: row.version,
        enabled: true,
      };
      rows.set(skillId, row);
      return structuredClone(row);
    },
    restoreLifecycle(skillId, lifecycle) {
      const row = require(skillId);
      row.lifecycle = lifecycle;
      rows.set(skillId, row);
    },
    restoreInstallation(agentId, skillId, previous) {
      const row = require(skillId);
      if (!previous.installed) {
        delete row.installations[agentId];
      } else {
        row.installations[agentId] = { ...previous };
      }
      rows.set(skillId, row);
    },
    listCompletedInvocations(filter) {
      const row = rows.get(filter.skillId);
      return (row?.invocations ?? []).filter((event) => {
        if (event.completedAt < filter.startedAtMs || event.completedAt > filter.endedAtMs) {
          return false;
        }
        if (filter.agentId && event.agentId && event.agentId !== filter.agentId) {
          return false;
        }
        return true;
      });
    },
  };
}

export function createSkillAdapter(
  port: SkillLifecyclePort,
  allowedOperations: readonly SkillOperation[],
  options?: { persistDir?: string },
): EvolutionAdapter<SkillCandidate> {
  const adapterId = allowedOperations.includes("install") ? "skill-installation" : "skill";
  const loaded = loadAdapterSnapshots(options?.persistDir, adapterId, {
    snapshots: {} as Record<string, SkillRollbackSnapshot>,
  });
  const applied = new Map(Object.entries(loaded.applied));
  const snapshots = new Map(Object.entries(loaded.extras.snapshots));
  const persist = () =>
    saveAdapterSnapshots(options?.persistDir, adapterId, {
      applied: Object.fromEntries(applied),
      extras: { snapshots: Object.fromEntries(snapshots) },
    });

  return {
    adapterId,
    domain: "capability",

    async inspect(target): Promise<TargetSnapshot> {
      if (!isCapabilityTarget(target)) {
        throw new Error("skill adapter requires a capability target");
      }
      const record = port.get(target.skillId);
      return {
        target,
        version: record ? skillVersion(record) : "missing",
        surfaceId:
          adapterId === "skill-installation"
            ? "capability.skill-installation"
            : "capability.skill-spec",
        sourceOfTruth: "src/gateway/skill-lifecycle-store.ts",
      };
    },

    async validate(candidate, context): Promise<ValidationResult> {
      if (!isCapabilityTarget(context.proposal.target)) {
        return { ok: false, code: "target_mismatch", reason: "proposal target is not a skill" };
      }
      if (candidate.skillId !== context.proposal.target.skillId) {
        return {
          ok: false,
          code: "target_mismatch",
          reason: "candidate skill does not match proposal target",
        };
      }
      if (!allowedOperations.includes(candidate.operation)) {
        return {
          ok: false,
          code: "operation_forbidden",
          reason: `${adapterId} cannot ${candidate.operation}`,
        };
      }
      if (context.proposal.surfaceId !== surfaceForOperation(candidate.operation)) {
        return {
          ok: false,
          code: "surface_mismatch",
          reason: "skill operation does not match surface",
        };
      }
      const record = port.get(candidate.skillId);
      if (!record) {
        return { ok: false, code: "not_found", reason: "skill not found" };
      }
      if (!record.name.trim() || !record.summary.trim()) {
        return {
          ok: false,
          code: "offline_validation_failed",
          reason: "skill name and summary are required",
        };
      }
      if (record.lifecycle === "retired" || record.lifecycle === "rejected") {
        return {
          ok: false,
          code: "lifecycle_blocked",
          reason: "retired or rejected skills cannot evolve",
        };
      }
      if (candidate.operation === "publish") {
        return { ok: true };
      }
      if (!candidate.agentId?.trim()) {
        return {
          ok: false,
          code: "missing_agent",
          reason: "install and promote require a canary agentId",
        };
      }
      if (!RUNNABLE.has(record.lifecycle)) {
        return {
          ok: false,
          code: "lifecycle_blocked",
          reason: "canary install requires a runnable published or approved skill",
        };
      }
      if (
        candidate.operation === "promote" &&
        !port.installation(candidate.agentId, candidate.skillId)?.installed
      ) {
        return {
          ok: false,
          code: "not_installed",
          reason: "promote requires an existing installation",
        };
      }
      return { ok: true };
    },

    async apply(input: ApplyEvolutionInput<SkillCandidate>): Promise<EvolutionApplication> {
      const existing = applied.get(input.idempotencyKey);
      if (existing) {
        return existing;
      }
      const validation = await this.validate(input.candidate, input.context);
      if (!validation.ok) {
        throw new Error(validation.reason);
      }
      const before = port.get(input.candidate.skillId);
      if (!before) {
        throw new Error("skill not found");
      }
      const agentId = input.candidate.agentId;
      if (input.scope === "shadow") {
        const shadow: EvolutionApplication = {
          schemaVersion: 1,
          applicationId: `app:${input.idempotencyKey}`,
          proposalId: input.context.proposal.proposalId,
          experimentId: input.context.experiment.experimentId,
          adapterId: adapterIdForOperation(input.candidate.operation),
          idempotencyKey: input.idempotencyKey,
          targetVersionBefore: skillVersion(before),
          targetVersionAfter: skillVersion(before),
          rollbackRef: `rollback:${input.idempotencyKey}:${input.candidate.operation}`,
          scope: "shadow",
          status: "applied",
          appliedToRuntime: false,
          appliedAt: new Date().toISOString(),
        };
        applied.set(input.idempotencyKey, shadow);
        persist();
        return shadow;
      }
      const previousInstallation = agentId
        ? port.installation(agentId, input.candidate.skillId)
        : undefined;
      let after = before;
      if (input.candidate.operation === "publish") {
        after = port.publish(input.candidate.skillId);
      } else if (input.candidate.operation === "install" && agentId) {
        after = port.install(agentId, input.candidate.skillId);
      } else if (input.candidate.operation === "promote" && agentId) {
        after = port.promote(agentId, input.candidate.skillId);
      }
      const application: EvolutionApplication = {
        schemaVersion: 1,
        applicationId: `app:${input.idempotencyKey}`,
        proposalId: input.context.proposal.proposalId,
        experimentId: input.context.experiment.experimentId,
        adapterId: adapterIdForOperation(input.candidate.operation),
        idempotencyKey: input.idempotencyKey,
        targetVersionBefore: skillVersion(before),
        targetVersionAfter: skillVersion(after),
        rollbackRef: `rollback:${input.idempotencyKey}:${input.candidate.operation}`,
        scope: input.scope,
        status: "applied",
        appliedToRuntime: true,
        appliedAt: new Date().toISOString(),
      };
      snapshots.set(application.rollbackRef, {
        operation: input.candidate.operation,
        skillId: input.candidate.skillId,
        previousLifecycle: before.lifecycle,
        ...(agentId ? { agentId } : {}),
        previousInstallation: previousInstallation ?? { installed: false },
      });
      applied.set(input.idempotencyKey, application);
      persist();
      return application;
    },

    async observeTarget(target, windowRef, window) {
      if (!isCapabilityTarget(target) || !window) {
        return [];
      }
      const startedAtMs = Date.parse(window.startedAt);
      const endedAtMs = Date.parse(window.endedAt);
      if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs)) {
        return [];
      }
      const events =
        port.listCompletedInvocations?.({
          skillId: target.skillId,
          startedAtMs,
          endedAtMs,
        }) ?? [];
      const completed = events.filter((row) => row.outcome !== "cancelled");
      return observationsFromCohort({
        events: filterCohort(
          completed.map((row) => ({
            occurredAt: row.completedAt,
            succeeded: row.outcome === "success",
            latencyMs: row.latencyMs,
            securityViolation: securityViolationFromFailureCategory(row.failureCategory),
            crossTenantContamination: crossTenantFromIds(row.tenantId, window.tenantScope),
            agentId: row.agentId,
            tenantId: row.tenantId ?? undefined,
            experimentId: row.experimentId ?? undefined,
            applicationId: row.applicationId ?? undefined,
          })),
          window,
          {
            experimentId: window.experimentId,
            tenantId: window.tenantScope ?? undefined,
            cohortRef: window.cohortRef,
          },
        ),
        windowRef,
        primary: {
          metricId: "skill_success_rate",
          value: (rows) => rows.filter((row) => row.succeeded).length / rows.length,
        },
        includeLatencyP95: true,
      });
    },

    async observe(input: ObserveApplicationInput) {
      const snapshot = snapshots.get(input.application.rollbackRef);
      if (!snapshot) {
        return [];
      }
      return (
        this.observeTarget?.(
          { domain: "capability", skillId: snapshot.skillId },
          input.windowRef,
          input.window,
        ) ?? []
      );
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
      if (!snapshot) {
        return {
          applicationId: application.applicationId,
          status: "failed",
          restoredVersion: application.targetVersionBefore,
          reason: "rollback snapshot missing",
        };
      }
      if (snapshot.operation === "publish") {
        port.restoreLifecycle(snapshot.skillId, snapshot.previousLifecycle);
      } else if (snapshot.agentId) {
        port.restoreInstallation(
          snapshot.agentId,
          snapshot.skillId,
          snapshot.previousInstallation ?? { installed: false },
        );
      }
      applied.set(application.idempotencyKey, { ...application, status: "rolled_back" });
      persist();
      return {
        applicationId: application.applicationId,
        status: "rolled_back",
        restoredVersion: application.targetVersionBefore,
      };
    },
  };
}

export function createSkillSpecAdapter(
  port: SkillLifecyclePort,
  options?: { persistDir?: string },
): EvolutionAdapter<SkillCandidate> {
  return createSkillAdapter(port, ["publish", "promote"], options);
}

export function createSkillInstallationAdapter(
  port: SkillLifecyclePort,
  options?: { persistDir?: string },
): EvolutionAdapter<SkillCandidate> {
  return createSkillAdapter(port, ["install"], options);
}

function toRecord(skillId: string): SkillRecord {
  const detail = getPersonalSkillAssetDetail(skillId);
  return {
    skillId: detail.id,
    name: detail.profile.name,
    summary: detail.profile.summary,
    lifecycle: detail.lifecycle,
    version: detail.version,
    successRate: detail.health.successRate,
    installations: {},
  };
}

export function createDefaultSkillLifecyclePort(scope?: {
  tenantId: string;
  userId: string;
}): SkillLifecyclePort {
  return {
    get(skillId) {
      try {
        return toRecord(skillId);
      } catch {
        return undefined;
      }
    },
    installation(agentId, skillId) {
      const entry = (
        scope ? listTenantRobotSkillAssets({ ...scope, agentId }) : listRobotSkillAssets(agentId)
      ).find((row) => row.id === skillId);
      return entry
        ? {
            installed: true,
            installedVersion: entry.installedVersion,
            enabled: entry.enabled,
          }
        : undefined;
    },
    publish(skillId) {
      publishSkillReview({ skillId, scope: { kind: "enterprise" } });
      return toRecord(skillId);
    },
    install(agentId, skillId) {
      installSkillToRobotAsset({
        agentId,
        skillId,
        ...(scope ? { tenantId: scope.tenantId, ownerUserId: scope.userId } : {}),
      });
      return toRecord(skillId);
    },
    promote(agentId, skillId) {
      upgradeRobotSkillAsset({ agentId, skillId, scope });
      return toRecord(skillId);
    },
    restoreLifecycle(skillId, lifecycle) {
      restoreSkillLifecycleState(skillId, lifecycle);
    },
    restoreInstallation(agentId, skillId, previous) {
      restoreRobotSkillInstallation({
        agentId,
        skillId,
        installed: previous.installed,
        scope,
        ...(previous.installedVersion ? { installedVersion: previous.installedVersion } : {}),
        ...(typeof previous.enabled === "boolean" ? { enabled: previous.enabled } : {}),
      });
    },
    listCompletedInvocations(filter) {
      return readSkillInvocationEvents({ skillId: filter.skillId, agentId: filter.agentId })
        .filter((event): event is Extract<typeof event, { type: "skill_invocation_completed" }> => {
          return event.type === "skill_invocation_completed";
        })
        .filter((event) => {
          if (event.completedAt < filter.startedAtMs || event.completedAt > filter.endedAtMs) {
            return false;
          }
          return true;
        })
        .map((event) => ({
          outcome: event.outcome,
          latencyMs: event.latencyMs,
          completedAt: event.completedAt,
          agentId: event.agentId,
          tenantId: event.tenantId,
          failureCategory: event.failureCategory,
          ...(event.experimentId ? { experimentId: event.experimentId } : {}),
          ...(event.applicationId ? { applicationId: event.applicationId } : {}),
        }));
    },
  };
}
