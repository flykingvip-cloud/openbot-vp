import type {
  ApplyEvolutionInput,
  EvolutionAdapter,
  EvolutionApplication,
  EvolutionTarget,
  RollbackResult,
  TargetSnapshot,
  ValidationResult,
} from "@openbot/evolution-core";
import {
  ORGANIZATION_ROUTING_STRATEGIES,
  buildOrganizationShadowPlan,
  nextRoutingPolicy,
  routingPolicyVersion,
  type OrganizationRoutingPolicy,
  type OrganizationRoutingStrategyId,
  type OrganizationShadowPlan,
} from "../../../organization/routing-policy.js";
import {
  readManagedOrganizationTaskAssignmentsSync,
  taskAssignmentLatencyMs,
  type TaskAssignment,
} from "../../../organization/task-assignment.js";
import { readSkillInvocationEvents } from "../../skill-invocation/event-store.js";
import { filterCohort, observationsFromCohort } from "../observation-cohort.js";
import {
  attributeOwnerSkillInvocations,
  collectOrganizationTaskOutcomes,
} from "../organization-task-outcomes.js";
import {
  createDurableMap,
  loadAdapterSnapshots,
  saveAdapterSnapshots,
} from "../persistent-store.js";

export type OrganizationTaskSignal = {
  taskId: string;
  securityViolation?: boolean;
  crossTenantContamination?: boolean;
  latencyMs?: number;
};

export type OrganizationCandidate = {
  groupId: string;
  kind: "task-routing" | "team-composition";
  strategyId?: OrganizationRoutingStrategyId;
  defaultOwnerAgentId?: string;
  memberIds?: string[];
  sampleNewTaskTitles?: string[];
  candidateVersion: string;
};

export type OrganizationPolicyPort = {
  getPolicy(groupId: string): OrganizationRoutingPolicy | undefined;
  listTasks(groupId: string): TaskAssignment[];
  writePolicy(policy: OrganizationRoutingPolicy): OrganizationRoutingPolicy;
  restorePolicy(policy: OrganizationRoutingPolicy): void;
  createNewTask(groupId: string, title: string): TaskAssignment;
  listTaskSignals?(groupId: string): OrganizationTaskSignal[];
};

export type OrganizationAdapter = EvolutionAdapter<OrganizationCandidate> & {
  getShadowPlan(rollbackRef: string): OrganizationShadowPlan | undefined;
};

type OrganizationRollbackSnapshot = {
  groupId: string;
  previous: OrganizationRoutingPolicy;
  wrotePolicy: boolean;
};

function isOrganizationTarget(
  target: EvolutionTarget,
): target is { domain: "organization"; groupId: string } {
  return target.domain === "organization";
}

function surfaceForKind(kind: OrganizationCandidate["kind"]): string {
  return kind === "team-composition"
    ? "organization.team-composition"
    : "organization.task-routing";
}

export function createMemoryOrganizationPort(
  seed: {
    policy: OrganizationRoutingPolicy;
    tasks?: TaskAssignment[];
    taskSignals?: OrganizationTaskSignal[];
  }[],
): OrganizationPolicyPort {
  const policies = new Map(seed.map((row) => [row.policy.groupId, { ...row.policy }]));
  const tasks = new Map<string, TaskAssignment[]>(
    seed.map((row) => [row.policy.groupId, row.tasks?.map((task) => ({ ...task })) ?? []]),
  );
  const signals = new Map<string, OrganizationTaskSignal[]>(
    seed.map((row) => [
      row.policy.groupId,
      row.taskSignals?.map((signal) => ({ ...signal })) ?? [],
    ]),
  );
  const requirePolicy = (groupId: string): OrganizationRoutingPolicy => {
    const policy = policies.get(groupId);
    if (!policy) {
      throw new Error(`organization policy not found: ${groupId}`);
    }
    return policy;
  };
  return {
    getPolicy(groupId) {
      const policy = policies.get(groupId);
      return policy ? { ...policy } : undefined;
    },
    listTasks(groupId) {
      return (tasks.get(groupId) ?? []).map((row) => ({ ...row }));
    },
    listTaskSignals(groupId) {
      return (signals.get(groupId) ?? []).map((row) => ({ ...row }));
    },
    writePolicy(policy) {
      policies.set(policy.groupId, { ...policy });
      return { ...policy };
    },
    restorePolicy(policy) {
      policies.set(policy.groupId, { ...policy });
    },
    createNewTask(groupId, title) {
      const policy = requirePolicy(groupId);
      const assignment: TaskAssignment = {
        id: `task:${groupId}:${title}`,
        organizationId: groupId,
        title,
        ownerAgentId: policy.defaultOwnerAgentId,
        createdByAgentId: policy.defaultOwnerAgentId,
        status: "pending",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ackRequired: false,
      };
      const list = tasks.get(groupId) ?? [];
      list.push(assignment);
      tasks.set(groupId, list);
      return { ...assignment };
    },
  };
}

function securityFromOwnerSkillInvocations(
  task: TaskAssignment,
  configDir?: string,
): boolean | undefined {
  const attributed = attributeOwnerSkillInvocations({
    task,
    events: readSkillInvocationEvents({ agentId: task.ownerAgentId, configDir }),
    windowTenantScope: null,
  });
  if (attributed.invocationRefs.length === 0) {
    // Fail-closed: missing attributed owner-skill events leave security and
    // tenant sensors unset. Never invent zeros.
    return undefined;
  }
  return attributed.securityViolation;
}

export function createFileOrganizationPolicyPort(
  filePath: string,
  options?: {
    listPersistedTasks?: (groupId: string) => TaskAssignment[];
    inspectTaskSecurity?: (task: TaskAssignment) => boolean | undefined;
    skillEventsConfigDir?: string;
  },
): OrganizationPolicyPort {
  const policies = createDurableMap<OrganizationRoutingPolicy>(filePath);
  const tasks = new Map<string, TaskAssignment[]>();
  const listPersistedTasks =
    options?.listPersistedTasks ?? readManagedOrganizationTaskAssignmentsSync;
  const mergedTasks = (groupId: string): TaskAssignment[] => {
    const byId = new Map(listPersistedTasks(groupId).map((row) => [row.id, { ...row }]));
    for (const row of tasks.get(groupId) ?? []) {
      byId.set(row.id, { ...row });
    }
    return [...byId.values()];
  };
  return {
    getPolicy(groupId) {
      const policy = policies.get(groupId);
      return policy ? { ...policy } : undefined;
    },
    listTasks(groupId) {
      return mergedTasks(groupId);
    },
    listTaskSignals(groupId) {
      return mergedTasks(groupId).flatMap((task) => {
        const latencyMs = taskAssignmentLatencyMs(task);
        if (latencyMs == null) {
          return [];
        }
        const securityViolation = (
          options?.inspectTaskSecurity ??
          ((row: TaskAssignment) =>
            securityFromOwnerSkillInvocations(row, options?.skillEventsConfigDir))
        )(task);
        // Tenant contamination stays unset here: this port has no tenant sensor.
        return [
          {
            taskId: task.id,
            latencyMs,
            ...(typeof securityViolation === "boolean" ? { securityViolation } : {}),
          },
        ];
      });
    },
    writePolicy(policy) {
      policies.set(policy.groupId, { ...policy });
      return { ...policy };
    },
    restorePolicy(policy) {
      policies.set(policy.groupId, { ...policy });
    },
    createNewTask(groupId, title) {
      const policy = policies.get(groupId);
      if (!policy) {
        throw new Error(`organization policy not found: ${groupId}`);
      }
      const assignment: TaskAssignment = {
        id: `task:${groupId}:${title}`,
        organizationId: groupId,
        title,
        ownerAgentId: policy.defaultOwnerAgentId,
        createdByAgentId: policy.defaultOwnerAgentId,
        status: "pending",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ackRequired: false,
      };
      const list = tasks.get(groupId) ?? [];
      list.push(assignment);
      tasks.set(groupId, list);
      return { ...assignment };
    },
  };
}

export function createOrganizationAdapter(
  port: OrganizationPolicyPort,
  options?: { persistDir?: string; skillEventsConfigDir?: string },
): OrganizationAdapter {
  const loaded = loadAdapterSnapshots(options?.persistDir, "organization", {
    snapshots: {} as Record<string, OrganizationRollbackSnapshot>,
    plans: {} as Record<string, OrganizationShadowPlan>,
  });
  const applied = new Map(Object.entries(loaded.applied));
  const snapshots = new Map(Object.entries(loaded.extras.snapshots));
  const plans = new Map(Object.entries(loaded.extras.plans));
  const persist = () =>
    saveAdapterSnapshots(options?.persistDir, "organization", {
      applied: Object.fromEntries(applied),
      extras: {
        snapshots: Object.fromEntries(snapshots),
        plans: Object.fromEntries(plans),
      },
    });

  const adapter: OrganizationAdapter = {
    adapterId: "organization",
    domain: "organization",

    async inspect(target): Promise<TargetSnapshot> {
      if (!isOrganizationTarget(target)) {
        throw new Error("organization adapter requires an organization target");
      }
      const policy = port.getPolicy(target.groupId);
      return {
        target,
        version: policy ? routingPolicyVersion(policy) : "missing",
        surfaceId: "organization.task-routing",
        sourceOfTruth: "src/organization/routing-policy.ts",
        ...(policy ? { rollbackRef: `policy:${policy.revision}` } : {}),
      };
    },

    async validate(candidate, context): Promise<ValidationResult> {
      if (!isOrganizationTarget(context.proposal.target)) {
        return {
          ok: false,
          code: "target_mismatch",
          reason: "proposal target is not an organization",
        };
      }
      if (candidate.groupId !== context.proposal.target.groupId) {
        return {
          ok: false,
          code: "target_mismatch",
          reason: "candidate group does not match proposal target",
        };
      }
      if (context.proposal.surfaceId !== surfaceForKind(candidate.kind)) {
        return {
          ok: false,
          code: "surface_mismatch",
          reason: "organization kind does not match surface",
        };
      }
      const policy = port.getPolicy(candidate.groupId);
      if (!policy) {
        return { ok: false, code: "not_found", reason: "organization policy not found" };
      }
      if (candidate.kind === "team-composition") {
        return {
          ok: false,
          code: "operation_forbidden",
          reason: "team composition is shadow-only in this phase",
        };
      }
      if (
        !candidate.strategyId ||
        !(ORGANIZATION_ROUTING_STRATEGIES as readonly string[]).includes(candidate.strategyId)
      ) {
        return { ok: false, code: "offline_validation_failed", reason: "unknown routing strategy" };
      }
      if (!candidate.defaultOwnerAgentId?.trim()) {
        return {
          ok: false,
          code: "offline_validation_failed",
          reason: "routing candidate needs an owner",
        };
      }
      return { ok: true };
    },

    async apply(input: ApplyEvolutionInput<OrganizationCandidate>): Promise<EvolutionApplication> {
      const existing = applied.get(input.idempotencyKey);
      if (existing) {
        return existing;
      }
      if (input.candidate.kind === "team-composition") {
        throw new Error("team composition is shadow-only in this phase");
      }
      const validation = await this.validate(input.candidate, input.context);
      if (!validation.ok) {
        throw new Error(validation.reason);
      }
      const current = port.getPolicy(input.candidate.groupId);
      if (!current) {
        throw new Error("organization policy not found");
      }
      const candidatePolicy = nextRoutingPolicy(current, {
        strategyId: input.candidate.strategyId,
        defaultOwnerAgentId: input.candidate.defaultOwnerAgentId,
        ...(input.candidate.memberIds ? { memberIds: input.candidate.memberIds } : {}),
      });
      const plan = buildOrganizationShadowPlan({
        current,
        candidate: candidatePolicy,
        tasks: port.listTasks(input.candidate.groupId),
        sampleNewTaskTitles: input.candidate.sampleNewTaskTitles,
      });
      const writePolicy = input.scope !== "shadow";
      if (writePolicy) {
        port.writePolicy(candidatePolicy);
      }
      const after = writePolicy ? candidatePolicy : current;
      const application: EvolutionApplication = {
        schemaVersion: 1,
        applicationId: `app:${input.idempotencyKey}`,
        proposalId: input.context.proposal.proposalId,
        experimentId: input.context.experiment.experimentId,
        adapterId: "organization",
        idempotencyKey: input.idempotencyKey,
        targetVersionBefore: routingPolicyVersion(current),
        targetVersionAfter: routingPolicyVersion(after),
        rollbackRef: `rollback:${input.idempotencyKey}`,
        scope: input.scope,
        status: "applied",
        appliedToRuntime: input.scope !== "shadow",
        appliedAt: new Date().toISOString(),
      };
      snapshots.set(application.rollbackRef, {
        groupId: input.candidate.groupId,
        previous: current,
        wrotePolicy: writePolicy,
      });
      plans.set(application.rollbackRef, plan);
      applied.set(input.idempotencyKey, application);
      persist();
      return application;
    },

    async observeTarget(target, windowRef, window) {
      if (!isOrganizationTarget(target) || !window) {
        return [];
      }
      const collected = collectOrganizationTaskOutcomes({
        tasks: port.listTasks(target.groupId),
        events: readSkillInvocationEvents({ configDir: options?.skillEventsConfigDir }),
        window,
        groupId: target.groupId,
      });
      const events = filterCohort(collected, window, {
        experimentId: window.experimentId,
        tenantId: window.tenantScope ?? undefined,
        cohortRef: window.cohortRef,
        requireCohort: window.phase === "treatment",
        requireRunId: window.phase === "treatment",
      });
      return observationsFromCohort({
        events,
        windowRef,
        primary: {
          metricId: "first_delivery_pass_rate",
          value: (rows) => rows.filter((row) => row.succeeded).length / rows.length,
        },
        includeHumanTakeover: true,
        includeLatencyP95: true,
        includeDeliveryFailure: true,
      });
    },

    async observe(input) {
      const snapshot = snapshots.get(input.application.rollbackRef);
      if (!snapshot || !input.window) {
        return [];
      }
      const collected = collectOrganizationTaskOutcomes({
        tasks: port.listTasks(snapshot.groupId),
        events: readSkillInvocationEvents({ configDir: options?.skillEventsConfigDir }),
        window: input.window,
        groupId: snapshot.groupId,
        appliedAt: input.application.appliedAt,
      });
      const events = filterCohort(collected, input.window, {
        experimentId: input.window.experimentId,
        applicationId: input.application.applicationId,
        tenantId: input.window.tenantScope ?? undefined,
        cohortRef: input.window.cohortRef,
        requireCohort: true,
        requireRunId: true,
      });
      return observationsFromCohort({
        events,
        windowRef: input.windowRef,
        primary: {
          metricId: "first_delivery_pass_rate",
          value: (rows) => rows.filter((row) => row.succeeded).length / rows.length,
        },
        includeHumanTakeover: true,
        includeLatencyP95: true,
        includeDeliveryFailure: true,
      });
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
      if (snapshot.wrotePolicy) {
        port.restorePolicy(snapshot.previous);
      }
      applied.set(application.idempotencyKey, { ...application, status: "rolled_back" });
      persist();
      return {
        applicationId: application.applicationId,
        status: "rolled_back",
        restoredVersion: routingPolicyVersion(snapshot.previous),
      };
    },

    getShadowPlan(rollbackRef) {
      const plan = plans.get(rollbackRef);
      return plan ? { ...plan, newTaskProjections: [...plan.newTaskProjections] } : undefined;
    },
  };

  return adapter;
}
