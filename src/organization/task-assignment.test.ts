import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildMeetingTaskAssignment,
  createTaskAssignment,
  meetingTaskAssignmentId,
  readManagedOrganizationTaskAssignments,
  readOrganizationTaskAssignments,
  transitionTaskAssignment,
  upsertManagedOrganizationTaskAssignment,
  upsertOrganizationTaskAssignment,
  writeOrganizationTaskAssignments,
} from "./task-assignment.js";

describe("organization task assignments", () => {
  it("persists task assignment acknowledgements in organization memory", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-org-tasks-"));
    const cfg = { collaboration: { defaults: { workspace: root } } };
    const pending = createTaskAssignment({
      organizationId: "upbeyond",
      title: "策划5个公众号备选主题",
      ownerAgentId: "bot--agent",
      createdByAgentId: "main",
      now: "2026-05-11T00:00:00.000Z",
    });
    await upsertOrganizationTaskAssignment({
      cfg,
      workspaceDir: root,
      assignment: transitionTaskAssignment(pending, "accepted", {
        now: "2026-05-11T00:01:00.000Z",
      }),
    });

    const assignments = await readOrganizationTaskAssignments({
      cfg,
      workspaceDir: root,
      organizationId: "upbeyond",
    });

    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({
      title: "策划5个公众号备选主题",
      ownerAgentId: "bot--agent",
      status: "accepted",
      acknowledgedAt: "2026-05-11T00:01:00.000Z",
    });
  });
});

describe("buildMeetingTaskAssignment (Phase C4)", () => {
  it("builds a per-attendee task with a deterministic id, assignee, dueAt, and sourceRef", () => {
    const task = buildMeetingTaskAssignment({
      meetingId: "m1",
      organizationId: "space-a",
      assigneeUserId: "user-2",
      title: "  draft spec  ",
      dueAt: "2026-07-10T00:00:00.000Z",
      now: "2026-07-01T00:00:00.000Z",
    });
    expect(task.id).toBe(meetingTaskAssignmentId("m1", "user-2", "draft spec"));
    expect(task.title).toBe("draft spec");
    expect(task.assigneeUserId).toBe("user-2");
    expect(task.dueAt).toBe("2026-07-10T00:00:00.000Z");
    expect(task.ownerAgentId).toBe("main");
    expect(task.status).toBe("pending");
    expect(task.ackRequired).toBe(true);
    expect(task.sourceRef).toEqual({ kind: "meeting", id: "m1" });
    expect(task.tenantId).toBeUndefined();
  });

  it("does not infer tenant or experiment ids from the task title", () => {
    const created = createTaskAssignment({
      organizationId: "space-a",
      title: "tenant tenant-a experiment exp-1",
      ownerAgentId: "bot-owner",
      createdByAgentId: "bot-owner",
    });
    expect(created.tenantId).toBeUndefined();
    expect(created.experimentId).toBeUndefined();
    expect(created.applicationId).toBeUndefined();
    expect(created.cohortRef).toBeUndefined();
    expect(created.runId).toBeUndefined();
  });

  it("stamps tenantId only when the meeting writer provides one", () => {
    const task = buildMeetingTaskAssignment({
      meetingId: "m1",
      organizationId: "space-a",
      assigneeUserId: "user-2",
      title: "draft spec",
      tenantId: "  tenant-a  ",
    });
    expect(task.tenantId).toBe("tenant-a");
  });

  it("is idempotent for the same (meeting, assignee, title)", () => {
    const a = buildMeetingTaskAssignment({
      meetingId: "m1",
      organizationId: "o",
      assigneeUserId: "u",
      title: "X",
    });
    const b = buildMeetingTaskAssignment({
      meetingId: "m1",
      organizationId: "o",
      assigneeUserId: "u",
      title: "X",
    });
    expect(a.id).toBe(b.id);
  });
});

describe("managed organization task store (Phase C4)", () => {
  let stateDir: string;
  let prevStateDir: string | undefined;

  beforeEach(async () => {
    prevStateDir = process.env.OPENBOT_STATE_DIR;
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "obx-managed-tasks-"));
    process.env.OPENBOT_STATE_DIR = stateDir;
  });

  afterEach(async () => {
    if (prevStateDir === undefined) {
      delete process.env.OPENBOT_STATE_DIR;
    } else {
      process.env.OPENBOT_STATE_DIR = prevStateDir;
    }
    await fs.rm(stateDir, { recursive: true, force: true });
  });

  it("upserts + reads a managed task; re-upsert by id replaces (idempotent)", async () => {
    const task = buildMeetingTaskAssignment({
      meetingId: "m1",
      organizationId: "space-a",
      assigneeUserId: "user-2",
      title: "draft",
    });
    await upsertManagedOrganizationTaskAssignment(task);
    await upsertManagedOrganizationTaskAssignment(task);
    const read = await readManagedOrganizationTaskAssignments("space-a");
    expect(read).toHaveLength(1);
    expect(read[0]).toMatchObject({
      id: task.id,
      assigneeUserId: "user-2",
      sourceRef: { kind: "meeting", id: "m1" },
    });
  });

  it("isolates managed tasks by organizationId", async () => {
    await upsertManagedOrganizationTaskAssignment(
      buildMeetingTaskAssignment({
        meetingId: "m1",
        organizationId: "space-a",
        assigneeUserId: "u",
        title: "A",
      }),
    );
    await upsertManagedOrganizationTaskAssignment(
      buildMeetingTaskAssignment({
        meetingId: "m2",
        organizationId: "space-b",
        assigneeUserId: "u",
        title: "B",
      }),
    );
    expect(await readManagedOrganizationTaskAssignments("space-a")).toHaveLength(1);
    expect(await readManagedOrganizationTaskAssignments("space-b")).toHaveLength(1);
  });

  it("stamps experiment IDs only from the persist writer, never from caller fields", async () => {
    const persistDir = await fs.mkdtemp(path.join(os.tmpdir(), "obx-org-writer-"));
    const createdAt = "2026-09-06T11:00:00.000Z";
    await fs.mkdir(persistDir, { recursive: true });
    await fs.writeFile(
      path.join(persistDir, "applications.json"),
      `${JSON.stringify({
        "app:bind": {
          schemaVersion: 1,
          applicationId: "app:bind",
          proposalId: "evo:bind",
          experimentId: "exp-bind",
          adapterId: "organization",
          idempotencyKey: "cmd-bind",
          targetVersionBefore: "a",
          targetVersionAfter: "b",
          rollbackRef: "rb:bind",
          scope: "canary",
          status: "applied",
          appliedToRuntime: true,
          appliedAt: createdAt,
        },
      })}\n`,
    );
    await fs.writeFile(
      path.join(persistDir, "proposals.json"),
      `${JSON.stringify({
        "evo:bind": {
          schemaVersion: 2,
          proposalId: "evo:bind",
          sourceEvidenceRefs: ["ev-a"],
          sourceMechanismRef: "case",
          target: { domain: "organization", groupId: "space-a" },
          candidateRef: "cand:bind",
          surfaceId: "organization.task-routing",
          expectedEffects: [],
          riskLevel: "medium",
          confidentialityScope: "enterprise",
          tenantScope: "tenant-a",
          grantId: "grant-1",
          status: "CANARY",
          createdAt,
          expiresAt: "2026-09-07T00:00:00.000Z",
          experimentId: "exp-bind",
        },
      })}\n`,
    );
    await fs.writeFile(
      path.join(persistDir, "experiments.json"),
      `${JSON.stringify({
        "exp-bind": {
          schemaVersion: 1,
          experimentId: "exp-bind",
          proposalId: "evo:bind",
          surfaceId: "organization.task-routing",
          target: { domain: "organization", groupId: "space-a" },
          tenantScope: "tenant-a",
          baselineRef: "org:v1",
          candidateRef: "cand:bind",
          configRef: "cfg",
          assignment: { strategy: "canary", treatmentRefs: ["t1"], controlRefs: ["c1"] },
          primaryMetric: { metricId: "first_delivery_pass_rate", kind: "primary" },
          guardrailMetrics: [],
          minimumSampleSize: 20,
          requiredConfidence: 0.9,
          expiresAt: "2026-09-07T00:00:00.000Z",
          result: "pending",
          frozen: {
            baselineVersion: "org:v1",
            candidateVersion: "cand:bind",
            codeSha: "sha",
            modelRef: "model",
            providerVersion: "p",
            configSnapshotRef: "cfg",
            datasetOrCohortRef: "cohort-bind",
            tenantScope: "tenant-a",
            confidentialityScope: "enterprise",
            expiresAt: "2026-09-07T00:00:00.000Z",
            maxResourceBudget: 1,
          },
        },
      })}\n`,
    );
    const pending = createTaskAssignment({
      organizationId: "space-a",
      title: "after canary",
      ownerAgentId: "bot-canary",
      createdByAgentId: "bot-canary",
      now: createdAt,
      tenantId: "tenant-a",
      runId: "run-writer",
    });
    expect(pending.experimentId).toBeUndefined();
    expect(pending.applicationId).toBeUndefined();
    const written = await upsertManagedOrganizationTaskAssignment(pending, { persistDir });
    expect(written.experimentId).toBe("exp-bind");
    expect(written.applicationId).toBe("app:bind");
    expect(written.cohortRef).toBe("cohort-bind");
    const forged = await upsertManagedOrganizationTaskAssignment(
      {
        ...createTaskAssignment({
          organizationId: "space-a",
          title: "forged",
          ownerAgentId: "bot-canary",
          createdByAgentId: "bot-canary",
          now: createdAt,
          tenantId: "tenant-a",
          runId: "run-forged",
        }),
        experimentId: "exp-forged",
        applicationId: "app:forged",
        cohortRef: "cohort-forged",
      },
      { persistDir },
    );
    expect(forged.experimentId).toBe("exp-bind");
    expect(forged.applicationId).toBe("app:bind");
    expect(forged.cohortRef).toBe("cohort-bind");
    const completed = await upsertManagedOrganizationTaskAssignment(
      transitionTaskAssignment(written, "completed", { now: "2026-09-06T11:00:00.040Z" }),
      { persistDir },
    );
    expect(completed.experimentId).toBe("exp-bind");
    expect(completed.applicationId).toBe("app:bind");

    const applications = JSON.parse(
      await fs.readFile(path.join(persistDir, "applications.json"), "utf8"),
    ) as Record<string, Record<string, unknown>>;
    applications["app:second"] = {
      ...applications["app:bind"],
      applicationId: "app:second",
      experimentId: "exp-second",
      proposalId: "evo:second",
      appliedAt: "2026-09-06T12:00:00.000Z",
    };
    await fs.writeFile(
      path.join(persistDir, "applications.json"),
      `${JSON.stringify(applications)}\n`,
    );
    const proposals = JSON.parse(
      await fs.readFile(path.join(persistDir, "proposals.json"), "utf8"),
    ) as Record<string, Record<string, unknown>>;
    proposals["evo:second"] = {
      ...proposals["evo:bind"],
      proposalId: "evo:second",
      experimentId: "exp-second",
    };
    await fs.writeFile(path.join(persistDir, "proposals.json"), `${JSON.stringify(proposals)}\n`);
    const experiments = JSON.parse(
      await fs.readFile(path.join(persistDir, "experiments.json"), "utf8"),
    ) as Record<string, Record<string, unknown>>;
    experiments["exp-second"] = {
      ...experiments["exp-bind"],
      experimentId: "exp-second",
      proposalId: "evo:second",
    };
    await fs.writeFile(
      path.join(persistDir, "experiments.json"),
      `${JSON.stringify(experiments)}\n`,
    );

    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "obx-org-ws-"));
    const cfg = { collaboration: { defaults: { workspace } } };
    const [workspaceWritten] = await writeOrganizationTaskAssignments({
      cfg,
      workspaceDir: workspace,
      organizationId: "space-a",
      assignments: [
        transitionTaskAssignment(written, "rejected", { now: "2026-09-06T12:00:00.040Z" }),
      ],
      persistDir,
    });
    expect(workspaceWritten?.experimentId).toBe("exp-bind");
    expect(workspaceWritten?.applicationId).toBe("app:bind");
    expect(workspaceWritten?.cohortRef).toBe("cohort-bind");
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(persistDir, { recursive: true, force: true });
  });
});
