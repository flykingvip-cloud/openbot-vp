import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeConfirmDiagnosePrescription } from "../agents/tools/confirm-diagnose-evolution-tool.js";
import type { GatewayRequestHandler } from "../gateway/server-methods/types.js";
import {
  isDiagnosisEvolutionProductionRuntime,
  readEvolutionRecoverAudits,
  resetEvolutionRecoverAuditForTests,
} from "./diagnose-evolution-recover-seal.js";
import type { DiagnoseGrowthAssessment } from "./diagnose-growth-assessment.js";
import { DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED } from "./diagnose-professional-protocol.js";
import {
  buildDiagnoseEvolutionPrescriptions,
  confirmDiagnoseEvolutionPrescription,
  readEvolutionPrescription,
  recoverEvolutionPrescriptionAfterCron,
  saveEvolutionPrescription,
  type EvolutionCronPort,
} from "./diagnose-self-evolution.js";
import { createDiagnosisIssueQueueHandlers } from "./diagnosis-issue-gateway.js";
import {
  DIAGNOSIS_FINDING_KIND,
  DIAGNOSIS_ISSUE_KIND,
  listDiagnosisFindings,
  listDiagnosisIssues,
  openDiagnosisIssue,
  recordDiagnosisFinding,
  runDiagnosisIssuePipeline,
  transitionOpsQueue,
  type DiagnosisIssueEvaluationRef,
} from "./diagnosis-issue-queue.js";
import {
  createDefaultDiagnosisReportApiDeps,
  createDiagnosisReportGatewayHandlers,
  type DiagnosisGatewayAuthClient,
} from "./report-query-gateway.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.OPENBOT_DIAGNOSIS_RUNTIME;
});

beforeEach(() => {
  resetEvolutionRecoverAuditForTests();
  delete process.env.OPENBOT_DIAGNOSIS_RUNTIME;
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "diag-m2-"));
  tempDirs.push(dir);
  return dir;
}

function gapAssessment(): DiagnoseGrowthAssessment {
  return {
    agentId: "bot-2",
    tenantId: "tenant-a",
    agentAssetId: "asset-bot-2",
    targetOwnerId: "employee-9",
    groupId: null,
    objectLabel: "bot-2",
    displayName: null,
    identity: {
      readable: true,
      bootstrapPending: true,
      identityInitialized: false,
      userInitialized: false,
    },
    memory: { present: false, fresh: false },
    hadTaskActivity: false,
    memoryJudgedMissing: false,
    capable: [],
    unstable: [],
    unused: [],
    baselineGapCandidates: [],
    existingJobNames: [],
    identityMissingFields: ["name"],
    userMissingFields: [],
    installedSkillIds: [],
    memoryFileCount: 0,
    reportFileCount: 0,
    freshArtifactCount: 0,
    sessionRoster: { main: 1, cron: 0, other: 0, freshCron: 0, freshMain: 0 },
    activitySources: [],
    roleBaselineInjected: false,
    skillLastSeenMs: {},
  };
}

function evaluation(eventId: string, tenantId = "tenant-a"): DiagnosisIssueEvaluationRef {
  return {
    tenantId,
    conversationId: "conv-1",
    eventId,
    agentId: "bot-2",
    failureAttribution: "tool",
    correctness: "fail",
    usability: "degraded",
  };
}

function cronPort(): { cron: EvolutionCronPort; added: number } {
  const jobs: Array<{ id: string; name: string; agentId?: string; ownerId?: string }> = [];
  let added = 0;
  const cron: EvolutionCronPort = {
    async list() {
      return jobs;
    },
    async add(job) {
      added += 1;
      const created = {
        id: `job-${added}`,
        name: job.name,
        agentId: job.agentId,
        ownerId: job.ownership?.ownerId,
      };
      jobs.push(created);
      return created;
    },
  };
  return {
    cron,
    get added() {
      return added;
    },
  };
}

function client(userId = "employee-9"): DiagnosisGatewayAuthClient {
  return {
    user: `${userId}@example.com`,
    platformUserId: userId,
    sessionDomain: "enterprise",
    sessionKind: "member",
  };
}

describe("M2 issue queue and controlled self-evolution", () => {
  it("M2-A1 stops before apply unless pipeline enabled:true; completes when a test enables it", async () => {
    expect(DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED).toBe(true);
    const closed = cronPort();
    const closedDir = tempDir();
    const stopped = await runDiagnosisIssuePipeline({
      tenantId: "tenant-a",
      configDir: closedDir,
      evaluations: [evaluation("evt-1")],
      assessment: gapAssessment(),
      professionalReportId: "pdr-closed",
      callerUserId: "employee-9",
      cron: closed.cron,
    });
    expect(stopped.ok).toBe(true);
    if (!stopped.ok) {
      return;
    }
    expect(stopped.applied).toBe(false);
    expect(stopped.stoppedAt).toBe("confirm_not_enabled");
    expect(stopped.trace).toEqual(["evaluation", "issue", "root-cause", "prescription"]);
    expect(closed.added).toBe(0);
    expect(stopped.issue.state).toBe("prescribed");
    const drafted = readEvolutionPrescription(
      "tenant-a",
      stopped.issue.prescriptionId ?? "",
      closedDir,
    );
    expect(drafted?.state).not.toBe("APPLIED");
    expect(drafted?.confirmable).toBe(false);

    const open = cronPort();
    const openDir = tempDir();
    const ran = await runDiagnosisIssuePipeline({
      tenantId: "tenant-a",
      configDir: openDir,
      evaluations: [evaluation("evt-2")],
      assessment: gapAssessment(),
      professionalReportId: "pdr-open",
      callerUserId: "employee-9",
      cron: open.cron,
      enabled: true,
    });
    expect(ran.ok).toBe(true);
    if (!ran.ok) {
      return;
    }
    expect(ran.applied).toBe(true);
    expect(ran.issue.state).toBe("closed");
    expect(ran.trace).toEqual([
      "evaluation",
      "issue",
      "root-cause",
      "prescription",
      "confirmed",
      "applied",
      "recheck",
      "writeback",
    ]);
    expect(open.added).toBe(1);
    expect(ran.issue.writeback?.prescriptionContentHash).toBe(ran.issue.prescriptionContentHash);
    const applied = readEvolutionPrescription("tenant-a", ran.issue.prescriptionId ?? "", openDir);
    expect(applied?.state).toBe("APPLIED");
    expect(applied?.confirmReceipt?.prescriptionContentHash).toBe(applied?.prescriptionContentHash);
    expect(readdirSync(openDir).toSorted()).toEqual(
      ["diagnosis-evolution-prescriptions", "diagnosis-issues"].toSorted(),
    );
  });

  it("M2-A2 and M2-N2 reject a tampered prescription and a mismatched hash", async () => {
    const dir = tempDir();
    const port = cronPort();
    const prescribed = await runDiagnosisIssuePipeline({
      tenantId: "tenant-a",
      configDir: dir,
      evaluations: [evaluation("evt-tamper")],
      assessment: gapAssessment(),
      professionalReportId: "pdr-tamper",
      callerUserId: "employee-9",
      cron: port.cron,
      enabled: true,
    });
    expect(prescribed.ok).toBe(true);
    if (!prescribed.ok || !prescribed.issue.prescriptionId) {
      return;
    }
    const stored = readEvolutionPrescription("tenant-a", prescribed.issue.prescriptionId, dir);
    expect(stored).toBeTruthy();
    if (!stored) {
      return;
    }
    const original = stored.prescriptionContentHash ?? "";
    saveEvolutionPrescription({ ...stored, wakeText: `${stored.wakeText} tampered` }, dir);
    const tampered = await confirmDiagnoseEvolutionPrescription({
      prescriptionId: stored.prescriptionId,
      tenantId: "tenant-a",
      professionalReportId: "pdr-tamper",
      callerUserId: "employee-9",
      prescriptionContentHash: original,
      enabled: true,
      configDir: dir,
      cron: port.cron,
    });
    expect(tampered).toMatchObject({ ok: false, reason: "prescription_hash_mismatch" });
    const mismatched = await confirmDiagnoseEvolutionPrescription({
      prescriptionId: stored.prescriptionId,
      tenantId: "tenant-a",
      professionalReportId: "pdr-tamper",
      callerUserId: "employee-9",
      prescriptionContentHash: "f".repeat(64),
      enabled: true,
      loadRecord: () => stored,
      saveRecord: () => {
        throw new Error("must not write");
      },
      cron: port.cron,
    });
    expect(mismatched).toMatchObject({ ok: false, reason: "prescription_hash_mismatch" });
  });

  it("M2-A3 Path B: CONFIRM open for tool/gateway; tick stay non-confirmable", async () => {
    expect(DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED).toBe(true);
    expect(isDiagnosisEvolutionProductionRuntime({ NODE_ENV: "test" })).toBe(false);
    const tick = readFileSync(
      fileURLToPath(new URL("./diagnose-tick.ts", import.meta.url)),
      "utf8",
    );
    expect(tick).toContain("allowSelfEvolutionConfirm: false");
    expect(tick).not.toMatch(/allowSelfEvolutionConfirm:\s*true/);
    const tool = await executeConfirmDiagnosePrescription(
      { prescriptionId: "abc", professionalReportId: "pdr-1", prescriptionContentHash: "abc" },
      { tenantId: "tenant-a", callerUserId: "employee-9" },
    );
    expect(tool.details).toMatchObject({ ok: false });
    expect((tool.details as { reason?: string }).reason).not.toBe("confirm_not_enabled");

    const handlers = createDiagnosisReportGatewayHandlers(
      createDefaultDiagnosisReportApiDeps(),
      { resolveMembership: async () => ({ tenantId: "tenant-a", userId: "employee-9" }) },
      { configDir: tempDir() },
    );
    const handler = handlers["diagnosis.self-evolution.confirm"];
    let payload: { ok?: boolean; reason?: string } | undefined;
    await handler({
      req: { type: "req", id: "m2", method: "diagnosis.self-evolution.confirm" } as never,
      params: {
        prescriptionId: "missing",
        professionalReportId: "pdr-1",
      },
      client: client() as never,
      isWebchatConnect: () => false,
      respond: (_ok, body) => {
        payload = body as { ok?: boolean; reason?: string };
      },
      context: {
        cron: {
          add: async () => {
            throw new Error("must not write");
          },
          list: async () => [],
        },
      } as never,
    });
    expect(payload?.ok).toBe(false);
    expect(payload?.reason).not.toBe("confirm_not_enabled");
  });

  it("M2-A4 and M2-N5 expose Issues and reject a Finding as the queue", () => {
    const dir = tempDir();
    const first = openDiagnosisIssue({
      tenantId: "tenant-a",
      configDir: dir,
      evaluations: [evaluation("evt-a"), evaluation("evt-b")],
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    expect(first.issue.kind).toBe(DIAGNOSIS_ISSUE_KIND);
    expect(first.issue.evaluationRefs.map((ref) => ref.eventId)).toEqual(["evt-a", "evt-b"]);
    const finding = recordDiagnosisFinding({
      tenantId: "tenant-a",
      configDir: dir,
      findingId: "find-1",
      summary: "one observation",
    });
    expect(finding).toMatchObject({ kind: DIAGNOSIS_FINDING_KIND, findingId: "find-1" });
    expect(listDiagnosisIssues("tenant-a", dir).map((row) => row.kind)).toEqual([
      DIAGNOSIS_ISSUE_KIND,
    ]);
    expect(listDiagnosisFindings("tenant-a", dir)).toHaveLength(1);
    expect("state" in (finding as object)).toBe(false);
    expect(
      transitionOpsQueue({
        tenantId: "tenant-a",
        configDir: dir,
        targetKind: DIAGNOSIS_FINDING_KIND,
        targetId: "find-1",
      }),
    ).toEqual({ ok: false, reason: "finding_not_queue" });
  });

  it("M2-A5 and M2-N1 refuse recover without confirm, and seal it in production", async () => {
    const dir = tempDir();
    const port = cronPort();
    const drafted = await runDiagnosisIssuePipeline({
      tenantId: "tenant-a",
      configDir: dir,
      evaluations: [evaluation("evt-recover")],
      assessment: gapAssessment(),
      professionalReportId: "pdr-recover-seal",
      callerUserId: "employee-9",
      cron: port.cron,
    });
    expect(drafted.ok).toBe(true);
    if (!drafted.ok || !drafted.issue.prescriptionId) {
      return;
    }
    const stored = readEvolutionPrescription("tenant-a", drafted.issue.prescriptionId, dir);
    expect(stored?.state).not.toBe("APPLIED");
    if (!stored) {
      return;
    }
    const bypass = await recoverEvolutionPrescriptionAfterCron({
      prescriptionId: stored.prescriptionId,
      tenantId: "tenant-a",
      configDir: dir,
      cron: port.cron,
    });
    expect(bypass).toMatchObject({ ok: false, reason: "recover_requires_confirm" });
    expect(readEvolutionPrescription("tenant-a", stored.prescriptionId, dir)?.state).not.toBe(
      "APPLIED",
    );
    expect(
      readEvolutionRecoverAudits().some((row) => row.reason === "recover_requires_confirm"),
    ).toBe(true);

    saveEvolutionPrescription(
      {
        ...stored,
        state: "APPLYING",
        confirmReceipt: {
          callerUserId: "employee-9",
          confirmedAt: "2026-10-11T00:00:00.000Z",
          prescriptionContentHash: stored.prescriptionContentHash ?? "",
        },
      },
      dir,
    );
    process.env.OPENBOT_DIAGNOSIS_RUNTIME = "production";
    const sealed = await recoverEvolutionPrescriptionAfterCron({
      prescriptionId: stored.prescriptionId,
      tenantId: "tenant-a",
      configDir: dir,
      cron: port.cron,
    });
    expect(sealed).toMatchObject({ ok: false, reason: "recover_sealed" });
    expect(readEvolutionPrescription("tenant-a", stored.prescriptionId, dir)?.state).toBe(
      "APPLYING",
    );
    expect(readEvolutionRecoverAudits().some((row) => row.reason === "recover_sealed")).toBe(true);
    expect(isDiagnosisEvolutionProductionRuntime()).toBe(true);
  });

  it("M2-N3 rejects a cross-tenant confirm", async () => {
    const opened = openDiagnosisIssue({
      tenantId: "tenant-a",
      configDir: tempDir(),
      evaluations: [evaluation("evt-other", "tenant-b")],
    });
    expect(opened).toMatchObject({ ok: false, reason: "cross_tenant" });

    const [identity] = buildDiagnoseEvolutionPrescriptions({
      assessment: gapAssessment(),
      professionalReportId: "pdr-cross",
      confirmable: true,
    });
    let writes = 0;
    const result = await confirmDiagnoseEvolutionPrescription({
      prescriptionId: identity.prescriptionId,
      tenantId: "tenant-b",
      professionalReportId: "pdr-cross",
      callerUserId: "employee-9",
      prescriptionContentHash: identity.prescriptionContentHash,
      enabled: true,
      loadRecord: () => identity,
      saveRecord: () => {
        writes += 1;
      },
      cron: {
        async list() {
          return [];
        },
        async add() {
          throw new Error("must not write");
        },
      },
    });
    expect(result).toMatchObject({ ok: false, reason: "cross_tenant" });
    expect(writes).toBe(0);
  });

  it("gateway queue lists Issues and refuses Finding or confirm", async () => {
    const dir = tempDir();
    const handlers = createDiagnosisIssueQueueHandlers(
      { resolveMembership: async () => ({ tenantId: "tenant-a", userId: "employee-9" }) },
      { configDir: dir },
    );
    const advance = handlers["diagnosis.issues.advance"];
    const list = handlers["diagnosis.issues.list"];
    const call = async (handler: GatewayRequestHandler, params: Record<string, unknown>) => {
      let body: Record<string, unknown> | undefined;
      await handler({
        req: { type: "req", id: "q", method: "diagnosis.issues.advance" } as never,
        params,
        client: client() as never,
        isWebchatConnect: () => false,
        respond: (_ok, payload) => {
          body = payload as Record<string, unknown>;
        },
        context: {} as never,
      });
      return body;
    };
    const opened = await call(advance, {
      action: "open",
      evaluation: {
        tenantId: "tenant-b",
        conversationId: "conv-1",
        eventId: "evt-gw",
        agentId: "bot-2",
        failureAttribution: "tool",
        correctness: "fail",
      },
      enabled: true,
    });
    expect(opened).toMatchObject({ ok: true });
    const listed = await call(list, { tenantId: "tenant-b" });
    const issues = listed?.issues as Array<{ kind: string; tenantId: string }>;
    expect(issues).toHaveLength(1);
    expect(issues[0]?.kind).toBe(DIAGNOSIS_ISSUE_KIND);
    expect(issues[0]?.tenantId).toBe("tenant-a");
    expect(listed?.queue).toBe("issue");
    const finding = await call(advance, { kind: DIAGNOSIS_FINDING_KIND, findingId: "find-9" });
    expect(finding).toMatchObject({ ok: false, reason: "finding_not_queue" });
    const confirm = await call(advance, { action: "confirm", enabled: true, issueId: "iss-x" });
    expect(confirm).toMatchObject({
      ok: false,
      reason: "confirm_not_enabled",
      enabled: true,
    });
  });
});
