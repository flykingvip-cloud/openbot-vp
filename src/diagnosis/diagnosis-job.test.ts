import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import { afterEach, describe, expect, it } from "vitest";
import { isConversationEvaluationEnabled } from "../conversation-evaluation/feature.js";
import { evaluationFilePath } from "../conversation-evaluation/store.js";
import { parseDiagnoseRequest } from "./diagnose-policy.js";
import { DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED } from "./diagnose-professional-protocol.js";
import { readDiagnosisSchedule, upsertDiagnosisSchedule } from "./diagnose-schedule.js";
import { createDiagnosisJobGatewayHandlers } from "./diagnosis-job-gateway.js";
import {
  DIAGNOSIS_JOB_BINDING_KIND,
  DIAGNOSIS_JOB_DEFINITION_KIND,
  DIAGNOSIS_JOB_REPORT_KIND,
  DIAGNOSIS_JOB_RULE_VERSION,
  DIAGNOSIS_JOB_RUN_KIND,
  type DiagnosisJobEvidenceRow,
} from "./diagnosis-job-model.js";
import {
  diagnosisJobTenantHash16,
  diagnosisJobsRoot,
  writeDiagnosisJobReport,
} from "./diagnosis-job-store.js";
import {
  applyDiagnosisMonitorTask,
  cancelDiagnosisJobRun,
  confirmDiagnosisJobEvolutionPreview,
  describeDiagnosisJob,
  finishDiagnosisJobRun,
  getDiagnosisJobReport,
  killDiagnosisJobRun,
  listSchedulesAdmittingNewJobRuns,
  pauseDiagnosisJob,
  resumeDiagnosisJob,
  startDiagnosisJobRun,
  DIAGNOSIS_JOB_RUN_CAP,
} from "./diagnosis-job.js";

const tmpDir = path.join(os.tmpdir(), `openbot-diag-job-${process.pid}-${Date.now()}`);

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function caller(tenantId: string, claimedTenantId?: string) {
  return {
    membershipTenantId: tenantId,
    ...(claimedTenantId !== undefined ? { claimedTenantId } : {}),
  };
}

function row(patch: Partial<DiagnosisJobEvidenceRow> = {}): DiagnosisJobEvidenceRow {
  return {
    tenantId: "tenant-a",
    runId: "conv-run-1",
    eventId: "evt-1",
    agentId: "agent-a",
    groupId: "group-1",
    execution: "errored",
    correctness: "unassessed",
    failureAttribution: "tool",
    totalMs: 5_000,
    ttftMs: 800,
    evidenceRefs: ["evidence:evt-1"],
    ...patch,
  };
}

describe("M1 Diagnosis Job", () => {
  it("M1-A1 separates definition, run, and binding and allows many runs", () => {
    const first = startDiagnosisJobRun({
      caller: caller("tenant-a"),
      configDir: tmpDir,
      now: Date.parse("2026-10-11T01:00:00.000Z"),
      evidenceRows: [row()],
    });
    const second = startDiagnosisJobRun({
      caller: caller("tenant-a"),
      configDir: tmpDir,
      now: Date.parse("2026-10-11T02:00:00.000Z"),
      evidenceRows: [row({ eventId: "evt-2", evidenceRefs: ["evidence:evt-2"] })],
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }
    expect(first.definition.kind).toBe(DIAGNOSIS_JOB_DEFINITION_KIND);
    expect(first.run.kind).toBe(DIAGNOSIS_JOB_RUN_KIND);
    expect(first.binding.kind).toBe(DIAGNOSIS_JOB_BINDING_KIND);
    expect(first.definition.definitionId).toBe(second.definition.definitionId);
    expect(first.run.runId).not.toBe(second.run.runId);
    expect(first.run.definitionId).toBe(first.definition.definitionId);
    expect(first.binding.definitionId).toBe(first.definition.definitionId);
    const definitions = fs
      .readdirSync(path.join(diagnosisJobsRoot(tmpDir), diagnosisJobTenantHash16("tenant-a")))
      .filter((name) => name === "definition.json");
    expect(definitions).toEqual(["definition.json"]);
  });

  it("M1-A2 keeps one default definition per tenant and does not leak across tenants", () => {
    upsertDiagnosisSchedule({
      tenantId: "tenant-a",
      request: parseDiagnoseRequest({ cadence: "tick", agentId: "agent-a" }),
      configDir: tmpDir,
      now: Date.parse("2026-10-11T00:00:00.000Z"),
    });
    const scheduleBefore = fs.readFileSync(scheduleFile("tenant-a"), "utf8");
    const started = startDiagnosisJobRun({
      caller: caller("tenant-a"),
      configDir: tmpDir,
      evidenceRows: [
        row(),
        row({ tenantId: "tenant-b", eventId: "evt-b", evidenceRefs: ["evidence:b"] }),
      ],
    });
    expect(started.ok).toBe(true);
    if (!started.ok || !started.report) {
      return;
    }
    expect(started.binding.scheduleRef.present).toBe(true);
    expect(started.binding.scheduleRef.cadence).toBe("tick");
    expect(started.binding.scheduleRef.tenantHash16).toBe(diagnosisJobTenantHash16("tenant-a"));
    expect(fs.readFileSync(scheduleFile("tenant-a"), "utf8")).toBe(scheduleBefore);
    expect(started.report.rejectedCrossTenant).toBe(1);
    expect(started.report.evidenceRefs.every((ref) => ref.tenantId === "tenant-a")).toBe(true);
    expect(started.report.matched.some((item) => item.eventId === "evt-b")).toBe(false);
    const other = getDiagnosisJobReport({
      caller: caller("tenant-b"),
      reportId: started.report.reportId,
      configDir: tmpDir,
    });
    expect(other.ok).toBe(false);
    if (!other.ok) {
      expect(other.reason).toBe("report_not_found");
    }
    expect(fs.existsSync(path.join(tmpDir, "diagnosis-projections"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "diagnosis-evolution-prescriptions"))).toBe(false);
  });

  it("M1-A3 pause blocks new runs, lets the in-flight run finish, and is not cancel", () => {
    upsertDiagnosisSchedule({
      tenantId: "tenant-a",
      request: parseDiagnoseRequest({ cadence: "tick", agentId: "agent-a" }),
      configDir: tmpDir,
    });
    expect(listSchedulesAdmittingNewJobRuns({ configDir: tmpDir })).toHaveLength(1);
    const inflight = startDiagnosisJobRun({
      caller: caller("tenant-a"),
      configDir: tmpDir,
      deferCompletion: true,
      evidenceRows: [row()],
    });
    expect(inflight.ok).toBe(true);
    if (!inflight.ok) {
      return;
    }
    expect(inflight.run.status).toBe("running");
    const paused = pauseDiagnosisJob({ caller: caller("tenant-a"), configDir: tmpDir });
    expect(paused.ok).toBe(true);
    if (paused.ok) {
      expect(paused.binding.paused).toBe(true);
      expect(paused.binding.scheduleRef.cadence).toBe("tick");
    }
    expect(readDiagnosisSchedule("tenant-a", tmpDir)?.cadence).toBe("tick");
    expect(listSchedulesAdmittingNewJobRuns({ configDir: tmpDir })).toHaveLength(0);
    const blocked = startDiagnosisJobRun({
      caller: caller("tenant-a"),
      configDir: tmpDir,
      evidenceRows: [row()],
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.reason).toBe("paused_blocks_new_run");
    }
    const cancelled = cancelDiagnosisJobRun({
      caller: caller("tenant-a"),
      runId: inflight.run.runId,
    });
    expect(cancelled.ok).toBe(false);
    expect(cancelled.reason).toBe("cancel_not_in_scope");
    const killed = killDiagnosisJobRun({ caller: caller("tenant-a"), runId: inflight.run.runId });
    expect(killed.reason).toBe("cancel_not_in_scope");
    const finished = finishDiagnosisJobRun({
      caller: caller("tenant-a"),
      runId: inflight.run.runId,
      configDir: tmpDir,
      evidenceRows: [row()],
    });
    expect(finished.ok).toBe(true);
    if (finished.ok) {
      expect(finished.run.status).toBe("completed");
      expect(finished.report.evidenceRefs.length).toBeGreaterThan(0);
    }
    const resumed = resumeDiagnosisJob({ caller: caller("tenant-a"), configDir: tmpDir });
    expect(resumed.ok).toBe(true);
    expect(listSchedulesAdmittingNewJobRuns({ configDir: tmpDir })).toHaveLength(1);
  });

  it("M1-A4 applies agent, group, failure, and efficiency filters", () => {
    writeEvaluation("tenant-a", "conv-slow", {
      tenantId: "tenant-a",
      runId: "conv-slow",
      eventId: "evt-slow",
      agentId: "agent-a",
      roundId: "group-1",
      execution: "completed",
      correctness: "unassessed",
      failureAttribution: "none",
      totalMs: 9_000,
      ttftMs: 100,
      evidenceRefs: ["evidence:slow"],
    });
    writeEvaluation("tenant-a", "conv-fail", {
      tenantId: "tenant-b",
      runId: "conv-foreign",
      eventId: "evt-foreign",
      agentId: "agent-a",
      roundId: "group-1",
      execution: "errored",
      failureAttribution: "tool",
      totalMs: 9_000,
      evidenceRefs: ["evidence:foreign"],
    });
    writeEvaluation("tenant-a", "conv-tool", {
      tenantId: "tenant-a",
      runId: "conv-tool",
      eventId: "evt-tool",
      agentId: "agent-a",
      roundId: "group-1",
      execution: "errored",
      correctness: "unassessed",
      failureAttribution: "tool",
      totalMs: 9_000,
      ttftMs: 100,
      evidenceRefs: ["evidence:tool"],
    });
    writeEvaluation("tenant-a", "conv-other", {
      tenantId: "tenant-a",
      runId: "conv-other",
      eventId: "evt-other",
      agentId: "agent-b",
      roundId: "group-2",
      execution: "errored",
      failureAttribution: "model",
      totalMs: 9_000,
      evidenceRefs: ["evidence:other"],
    });
    const started = startDiagnosisJobRun({
      caller: caller("tenant-a"),
      configDir: tmpDir,
      filters: {
        agentId: "agent-a",
        groupId: "group-1",
        failure: { enabled: true, minCount: 1 },
        efficiency: { maxTotalMs: 1_000, maxTtftMs: null },
      },
    });
    expect(started.ok).toBe(true);
    if (!started.ok || !started.report) {
      return;
    }
    expect(started.report.ruleVersion).toBe(DIAGNOSIS_JOB_RULE_VERSION);
    expect(started.report.matched.map((item) => item.eventId)).toEqual(["evt-tool"]);
    expect(started.report.thresholdMet).toBe(true);
    expect(started.report.matched.some((item) => item.eventId === "evt-foreign")).toBe(false);
  });

  it("M1-A5 returns a composite report whose evidence cannot be read across tenants", () => {
    const started = startDiagnosisJobRun({
      caller: caller("tenant-a"),
      configDir: tmpDir,
      evidenceRows: [row()],
    });
    expect(started.ok).toBe(true);
    if (!started.ok || !started.report) {
      return;
    }
    expect(started.report.kind).toBe(DIAGNOSIS_JOB_REPORT_KIND);
    expect(started.report.evidenceRefs).toEqual([
      {
        evidenceId: "evidence:evt-1",
        tenantId: "tenant-a",
        sourceEventId: "evt-1",
        sourceRunId: "conv-run-1",
        authority: "conversation-evaluation",
      },
    ]);
    expect(started.report.diagnosesConversationCorrectness).toBe(false);
    const tampered = {
      ...started.report,
      evidenceRefs: [{ ...started.report.evidenceRefs[0], tenantId: "tenant-b" }],
    };
    writeDiagnosisJobReport(tampered, tmpDir);
    const denied = getDiagnosisJobReport({
      caller: caller("tenant-a"),
      reportId: started.report.reportId,
      configDir: tmpDir,
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.reason).toBe("unauthorized_evidence");
    }
  });

  it("M1-A6 keeps the evolution preview read-only; job confirm stays non-confirmable", () => {
    const started = startDiagnosisJobRun({
      caller: caller("tenant-a"),
      configDir: tmpDir,
      evidenceRows: [row()],
    });
    expect(started.ok).toBe(true);
    if (!started.ok || !started.report) {
      return;
    }
    expect(started.report.evolutionPreview).toMatchObject({
      readOnly: true,
      confirmable: false,
      confirmLatchEnabled: false,
      previewKind: "evolution_projection_preview",
    });
    expect(DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED).toBe(true);
    expect(confirmDiagnosisJobEvolutionPreview()).toMatchObject({
      ok: false,
      reason: "preview_not_confirmable",
    });
    expect(fs.existsSync(path.join(tmpDir, "diagnosis-evolution-prescriptions"))).toBe(false);
  });

  it("M1-A7 refuses repair and does not apply a fix side effect", () => {
    const refused = startDiagnosisJobRun({
      caller: caller("tenant-a"),
      configDir: tmpDir,
      repair: true,
      evidenceRows: [row()],
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.reason).toBe("repair_not_in_scope");
    }
    expect(fs.existsSync(diagnosisJobsRoot(tmpDir))).toBe(false);
    const started = startDiagnosisJobRun({
      caller: caller("tenant-a"),
      configDir: tmpDir,
      fix: false,
      evidenceRows: [row()],
    });
    expect(started.ok).toBe(true);
    if (started.ok && started.report) {
      expect(started.report.repairApplied).toBe(false);
    }
    const source = fs.readFileSync(new URL("./diagnosis-job.ts", import.meta.url), "utf8");
    expect(source).not.toContain('from "./diagnose.js"');
    expect(source).not.toContain("--fix");
    expect(source).not.toContain("--repair");
    expect(source).not.toContain("doctor_repair");
  });

  it("M1-A8 does not regress M0 paths, flags, or tick confirmability", () => {
    expect(isConversationEvaluationEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED).toBe(true);
    const tick = fs.readFileSync(new URL("./diagnose-tick.ts", import.meta.url), "utf8");
    expect(tick).toContain("allowSelfEvolutionConfirm: false");
    expect(tick).not.toMatch(/allowSelfEvolutionConfirm:\s*true/);
    expect(tick).toContain("listSchedulesAdmittingNewJobRuns");
    writeEvaluation("tenant-a", "conv-run-1", {
      tenantId: "tenant-a",
      runId: "conv-run-1",
      eventId: "evt-1",
      agentId: "agent-a",
      execution: "errored",
      failureAttribution: "tool",
      evidenceRefs: ["evidence:evt-1"],
    });
    const evalFile = evaluationFilePath({
      configDir: tmpDir,
      tenantId: "tenant-a",
      runId: "conv-run-1",
      at: new Date("2026-10-11T00:00:00.000Z"),
    });
    const before = fs.readFileSync(evalFile, "utf8");
    const started = startDiagnosisJobRun({
      caller: caller("tenant-a"),
      configDir: tmpDir,
    });
    expect(started.ok).toBe(true);
    expect(fs.readFileSync(evalFile, "utf8")).toBe(before);
    expect(before).not.toContain("diagnosis-schedules");
    const store = fs.readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "../conversation-evaluation/store.ts",
      ),
      "utf8",
    );
    expect(store).toContain("diagnosis-schedules");
    expect(store).toContain("diagnosis-projections");
    expect(store).toContain("diagnosis-evolution-prescriptions");
    expect(fs.existsSync(path.join(tmpDir, "diagnosis-schedules"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "diagnosis-projections"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "diagnosis-evolution-prescriptions"))).toBe(false);
  });

  it("M1-N1 rejects a forged tenant on the service and the gateway", async () => {
    const forged = startDiagnosisJobRun({
      caller: caller("tenant-a", "tenant-b"),
      configDir: tmpDir,
      evidenceRows: [row()],
    });
    expect(forged.ok).toBe(false);
    if (!forged.ok) {
      expect(forged.reason).toBe("forged_tenant_rejected");
    }
    const handlers = createDiagnosisJobGatewayHandlers(
      { resolveMembership: async () => ({ tenantId: "tenant-a", userId: "user-a" }) },
      { configDir: tmpDir },
    );
    const captured = await invoke(handlers["diagnosis.job.run"], { tenantId: "tenant-b" });
    expect(captured.ok).toBe(false);
    expect(captured.payload).toMatchObject({ ok: false, reason: "forged_tenant_rejected" });
    expect(fs.existsSync(diagnosisJobsRoot(tmpDir))).toBe(false);
  });

  it("describe reads without creating files and platform operators select a tenant", () => {
    expect(describeDiagnosisJob({ caller: caller("tenant-a"), configDir: tmpDir }).ok).toBe(true);
    expect(fs.existsSync(diagnosisJobsRoot(tmpDir))).toBe(false);
    const described = describeDiagnosisJob({
      caller: { membershipTenantId: null, claimedTenantId: "tenant-b", platformOperator: true },
      configDir: tmpDir,
    });
    expect(described.ok).toBe(true);
    if (described.ok) {
      expect(described.cadence).toBe("off");
      expect(described.definition).toBeNull();
    }
    const saved = applyDiagnosisMonitorTask({
      caller: { membershipTenantId: null, claimedTenantId: "tenant-b", platformOperator: true },
      configDir: tmpDir,
      filters: {
        agentIds: ["agent-a", "agent-b"],
        groupId: "group-1",
        failure: { enabled: true, minCount: 2 },
      },
    });
    expect(saved.ok).toBe(true);
    const again = describeDiagnosisJob({
      caller: { membershipTenantId: null, claimedTenantId: "tenant-b", platformOperator: true },
      configDir: tmpDir,
    });
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.definition?.filters.agentIds).toEqual(["agent-a", "agent-b"]);
      expect(again.definition?.filters.groupId).toBe("group-1");
      expect(again.definition?.tenantId).toBe("tenant-b");
    }
    const forged = describeDiagnosisJob({
      caller: caller("tenant-a", "tenant-b"),
      configDir: tmpDir,
    });
    expect(forged.ok).toBe(false);
  });

  it("M1-N2 fails when a run is created while paused", () => {
    const paused = pauseDiagnosisJob({ caller: caller("tenant-a"), configDir: tmpDir });
    expect(paused.ok).toBe(true);
    const blocked = startDiagnosisJobRun({
      caller: caller("tenant-a"),
      configDir: tmpDir,
      evidenceRows: [row()],
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.reason).toBe("paused_blocks_new_run");
    }
    const runsDir = path.join(
      diagnosisJobsRoot(tmpDir),
      diagnosisJobTenantHash16("tenant-a"),
      "runs",
    );
    expect(fs.existsSync(runsDir)).toBe(false);
  });

  it("caps retained runs and refuses cancel without mutating an in-flight run", () => {
    for (let index = 0; index < DIAGNOSIS_JOB_RUN_CAP; index += 1) {
      const started = startDiagnosisJobRun({
        caller: caller("tenant-a"),
        configDir: tmpDir,
        now: Date.parse("2026-10-11T00:00:00.000Z") + index,
        deferCompletion: true,
        evidenceRows: [],
      });
      expect(started.ok).toBe(true);
    }
    const overflow = startDiagnosisJobRun({
      caller: caller("tenant-a"),
      configDir: tmpDir,
      deferCompletion: true,
      evidenceRows: [],
    });
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) {
      expect(overflow.reason).toBe("run_cap_exceeded");
    }
  });
});

function scheduleFile(tenantId: string): string {
  return path.join(tmpDir, "diagnosis-schedules", `${diagnosisJobTenantHash16(tenantId)}.json`);
}

function writeEvaluation(tenantId: string, runId: string, record: Record<string, unknown>): void {
  const filePath = evaluationFilePath({
    configDir: tmpDir,
    tenantId,
    runId,
    at: new Date("2026-10-11T00:00:00.000Z"),
  });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);
}

async function invoke(
  handler: ((...args: never[]) => Promise<void> | void) | undefined,
  params: Record<string, unknown>,
): Promise<{ ok: boolean; payload?: unknown }> {
  let captured: { ok: boolean; payload?: unknown } = { ok: false };
  if (!handler) {
    throw new Error("missing diagnosis job handler");
  }
  await handler({
    req: { type: "req", id: "m1", method: "diagnosis.job.run" },
    params,
    client: { user: "user-a", platformUserId: "user-a", sessionDomain: "enterprise" },
    isWebchatConnect: () => false,
    respond: (ok: boolean, payload?: unknown) => {
      captured = { ok, payload };
    },
    context: {},
  } as never);
  return captured;
}

// These historical cutover / functional rehearsals explicitly opt into writes
// against injected local ports. Default-closed behavior is covered separately
// in write-policy.test.ts; this is not production enablement.
vi.mock("./write-policy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./write-policy.js")>();
  return {
    ...actual,
    DIAGNOSIS_WRITE_POLICY: {
      selfEvolutionConfirm: true,
      conversationDelivery: true,
      daibaiDelivery: true,
    },
  };
});
