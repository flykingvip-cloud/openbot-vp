import type { ObservationWindow } from "@openbot/evolution-core";
import { describe, expect, it } from "vitest";
import type { TaskAssignment } from "../../organization/task-assignment.js";
import { buildCompletedInvocationEvent } from "../skill-invocation/event-store.js";
import type {
  RecordSkillInvocationCompletedInput,
  SkillInvocationEvent,
} from "../skill-invocation/types.js";
import { observationsFromCohort } from "./observation-cohort.js";
import {
  attributeOwnerSkillInvocations,
  collectOrganizationTaskOutcomes,
  isOwnerSkillAttributedToTask,
} from "./organization-task-outcomes.js";

const GROUP_ID = "group-org-attr";
const TENANT = "tenant-org-a";
const OWNER = "bot-owner";

function task(over: Partial<TaskAssignment> = {}): TaskAssignment {
  return {
    id: "task-1",
    organizationId: GROUP_ID,
    title: "Weekly brief",
    ownerAgentId: OWNER,
    createdByAgentId: OWNER,
    status: "completed",
    createdAt: "2026-09-06T10:00:00.000Z",
    updatedAt: "2026-09-06T10:00:00.040Z",
    completedAt: "2026-09-06T10:00:00.040Z",
    ackRequired: false,
    tenantId: TENANT,
    runId: "run-1",
    ...over,
  };
}

function completed(over: Partial<RecordSkillInvocationCompletedInput> = {}) {
  return buildCompletedInvocationEvent({
    skillId: "org-owner-skill",
    agentId: OWNER,
    tenantId: TENANT,
    outcome: "success",
    latencyMs: 40,
    failureCategory: null,
    runId: "run-1",
    taskId: "task-1",
    completedAt: Date.parse("2026-09-06T10:00:00.020Z"),
    ...over,
  });
}

function window(over: Partial<ObservationWindow> = {}): ObservationWindow {
  return {
    windowId: "w",
    experimentId: "exp-org",
    phase: "baseline",
    startedAt: "2026-09-06T09:00:00.000Z",
    endedAt: "2026-09-06T11:00:00.000Z",
    tenantScope: TENANT,
    targetKey: `organization:${GROUP_ID}`,
    modelRevision: "m",
    configRevision: "c",
    cohortRef: "cohort-org",
    ...over,
  };
}

describe("organization owner-skill attribution", () => {
  it("requires AND-compatible taskId/runId matches and rejects explicit conflicts", () => {
    const assigned = task();
    const bothMatch = completed({ runId: "run-1", taskId: "task-1" });
    const taskIdOnly = completed({ runId: null, taskId: "task-1" });
    const runIdOnly = completed({ runId: "run-1", taskId: null });
    const runConflicts = completed({ runId: "run-other", taskId: "task-1" });
    const taskConflicts = completed({ runId: "run-1", taskId: "task-other" });
    const nearby: SkillInvocationEvent = completed({
      runId: null,
      taskId: null,
      completedAt: Date.parse("2026-09-06T10:00:00.020Z"),
    });
    expect(isOwnerSkillAttributedToTask(bothMatch, assigned)).toBe(true);
    expect(isOwnerSkillAttributedToTask(taskIdOnly, assigned)).toBe(true);
    expect(isOwnerSkillAttributedToTask(runIdOnly, assigned)).toBe(true);
    expect(isOwnerSkillAttributedToTask(runConflicts, assigned)).toBe(false);
    expect(isOwnerSkillAttributedToTask(taskConflicts, assigned)).toBe(false);
    expect(isOwnerSkillAttributedToTask(nearby, assigned)).toBe(false);
  });

  it("leaves criticals unset when the owner has no attributed skill events", () => {
    const attributed = attributeOwnerSkillInvocations({
      task: task(),
      events: [
        completed({
          agentId: "bot-other",
          taskId: "task-1",
          runId: "run-1",
        }),
      ],
      windowTenantScope: TENANT,
    });
    expect(attributed.invocationRefs).toEqual([]);
    expect(attributed.securityViolation).toBeUndefined();
    expect(attributed.crossTenantContamination).toBeUndefined();
    expect(attributed.conflicting).toBe(false);
  });

  it("does not pick the latest event when tenant or run ids conflict", () => {
    const attributed = attributeOwnerSkillInvocations({
      task: task(),
      events: [
        completed({ tenantId: TENANT, runId: "run-1", taskId: "task-1", invocationId: "inv-a" }),
        completed({
          tenantId: "tenant-other",
          runId: "run-1",
          taskId: "task-1",
          invocationId: "inv-b",
          completedAt: Date.parse("2026-09-06T10:00:00.030Z"),
        }),
      ],
      windowTenantScope: TENANT,
    });
    expect(attributed.conflicting).toBe(true);
    expect(attributed.securityViolation).toBeUndefined();
    expect(attributed.crossTenantContamination).toBeUndefined();
    expect(attributed.invocationRefs).toEqual(["inv-a", "inv-b"]);
  });

  it("reads tenant and confirmed security only from attributed events", () => {
    const clean = attributeOwnerSkillInvocations({
      task: task(),
      events: [completed({ failureCategory: null, tenantId: TENANT })],
      windowTenantScope: TENANT,
    });
    expect(clean.securityViolation).toBe(false);
    expect(clean.crossTenantContamination).toBe(false);
    const contaminated = attributeOwnerSkillInvocations({
      task: task(),
      events: [completed({ failureCategory: "security", tenantId: "tenant-other" })],
      windowTenantScope: TENANT,
    });
    expect(contaminated.securityViolation).toBe(true);
    expect(contaminated.crossTenantContamination).toBe(true);
  });
});

describe("organization task observation collection", () => {
  it("keeps unlabeled baseline tasks and drops in-flight work", () => {
    const rows = collectOrganizationTaskOutcomes({
      tasks: [
        task({ id: "task-ok", runId: "run-ok" }),
        task({
          id: "task-running",
          status: "running",
          completedAt: undefined,
          runId: "run-running",
        }),
        task({
          id: "task-other-exp",
          experimentId: "exp-other",
          applicationId: "app-other",
          runId: "run-other",
        }),
      ],
      events: [],
      window: window(),
      groupId: GROUP_ID,
    });
    expect(rows.map((row) => row.taskId)).toEqual(["task-ok"]);
    expect(rows.every((row) => row.securityViolation === undefined)).toBe(true);
  });

  it("excludes pre-canary tasks from treatment even if they complete later", () => {
    const rows = collectOrganizationTaskOutcomes({
      tasks: [
        task({
          id: "task-old",
          createdAt: "2026-09-06T10:00:00.000Z",
          completedAt: "2026-09-06T11:30:00.000Z",
          experimentId: "exp-org",
          applicationId: "app-a",
          cohortRef: "cohort-org",
          runId: "run-old",
        }),
        task({
          id: "task-new",
          createdAt: "2026-09-06T11:20:00.000Z",
          completedAt: "2026-09-06T11:20:00.040Z",
          experimentId: "exp-org",
          applicationId: "app-a",
          cohortRef: "cohort-org",
          runId: "run-new",
        }),
      ],
      events: [],
      window: window({
        phase: "treatment",
        startedAt: "2026-09-06T11:10:00.000Z",
        endedAt: "2026-09-06T11:40:00.000Z",
      }),
      groupId: GROUP_ID,
      appliedAt: "2026-09-06T11:10:00.000Z",
    });
    expect(rows.map((row) => row.taskId)).toEqual(["task-new"]);
  });

  it("does not infer tenant or experiment ids from the task title", () => {
    const rows = collectOrganizationTaskOutcomes({
      tasks: [
        task({
          id: "task-named",
          title: `tenant ${TENANT} experiment exp-org`,
          tenantId: undefined,
          experimentId: undefined,
          applicationId: undefined,
          runId: undefined,
        }),
      ],
      events: [],
      window: window(),
      groupId: GROUP_ID,
    });
    expect(rows[0]?.tenantId).toBeUndefined();
    expect(rows[0]?.experimentId).toBeUndefined();
    expect(rows[0]?.applicationId).toBeUndefined();
  });

  it("does not let one task without owner-skill pretend the cohort is complete", () => {
    const tasks = [
      ...Array.from({ length: 2 }, (_, i) =>
        task({
          id: `task-skill-${i}`,
          runId: `run-skill-${i}`,
          completedAt: "2026-09-06T10:00:00.040Z",
        }),
      ),
      task({
        id: "task-bare",
        runId: "run-bare",
        completedAt: "2026-09-06T10:00:00.040Z",
      }),
    ];
    const events = [
      completed({ taskId: "task-skill-0", runId: "run-skill-0", invocationId: "inv-0" }),
      completed({ taskId: "task-skill-1", runId: "run-skill-1", invocationId: "inv-1" }),
    ];
    const rows = collectOrganizationTaskOutcomes({
      tasks,
      events,
      window: window(),
      groupId: GROUP_ID,
    });
    expect(rows).toHaveLength(3);
    expect(rows.filter((row) => row.securityViolation === undefined)).toHaveLength(1);
    const observed = observationsFromCohort({
      events: rows,
      windowRef: "w",
      primary: {
        metricId: "first_delivery_pass_rate",
        value: (cohort) => cohort.filter((row) => row.succeeded).length / cohort.length,
      },
    });
    expect(observed.find((row) => row.metricId === "first_delivery_pass_rate")?.sampleSize).toBe(3);
    expect(observed.find((row) => row.metricId === "security_violations")).toBeUndefined();
    expect(observed.find((row) => row.metricId === "cross_tenant_contamination")).toBeUndefined();
  });
});
