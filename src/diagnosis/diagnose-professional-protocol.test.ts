import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CronJobCreate } from "../cron/types.js";
import type { DiagnoseGrowthAssessment } from "./diagnose-growth-assessment.js";
import {
  DIAGNOSIS_ZERO_FINDINGS_TEXT,
  EVOLUTION_PRESCRIPTION_PAYLOAD_VERSION,
  EVOLUTION_PRESCRIPTION_SCHEMA_VERSION,
  IDENTITY_PRESCRIPTION_WAKE_TEXT,
  NO_ACTIVITY_MEMORY_TEXT,
  evolutionPrescriptionId,
  normalizeEvolutionSchedule,
} from "./diagnose-professional-protocol.js";
import {
  buildProfessionalDiagnosisReport,
  formatDiagnoseReportText,
  formatProfessionalDiagnosisReport,
} from "./diagnose-report-text.js";
import {
  buildDiagnoseEvolutionPrescriptions,
  confirmDiagnoseEvolutionPrescription,
  diagnosisEvolutionJobName,
  evolutionJobCreate,
  recoverEvolutionPrescriptionAfterCron,
  type EvolutionPrescription,
} from "./diagnose-self-evolution.js";

const liveSource = readFileSync(
  fileURLToPath(new URL("./diagnose-live-request.ts", import.meta.url)),
  "utf8",
);
const growthSource = readFileSync(
  fileURLToPath(new URL("./diagnose-growth-assessment.ts", import.meta.url)),
  "utf8",
);
const gatewaySource = readFileSync(
  fileURLToPath(new URL("./report-query-gateway.ts", import.meta.url)),
  "utf8",
);
const apiSource = readFileSync(
  fileURLToPath(new URL("./report-query-api.ts", import.meta.url)),
  "utf8",
);

function gapAssessment(agentId = "bot-2"): DiagnoseGrowthAssessment {
  return {
    agentId,
    tenantId: "tenant-a",
    agentAssetId: "asset-bot-2",
    targetOwnerId: "employee-9",
    groupId: null,
    objectLabel: agentId,
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
    unstable: ["ops"],
    unused: ["briefing"],
    baselineGapCandidates: ["sales-brief"],
    existingJobNames: [],
    identityMissingFields: ["name", "vibe"],
    userMissingFields: ["name", "timezone"],
    installedSkillIds: ["briefing"],
    memoryFileCount: 0,
    reportFileCount: 0,
    freshArtifactCount: 0,
    sessionRoster: { main: 1, cron: 0, other: 0, freshCron: 0, freshMain: 0 },
    activitySources: [],
    roleBaselineInjected: true,
    skillLastSeenMs: {},
  };
}

function savedRows() {
  const rows = new Map<string, EvolutionPrescription>();
  return {
    rows,
    loadRecord: (_tenantId: string, prescriptionId: string) => rows.get(prescriptionId) ?? null,
    saveRecord: (record: EvolutionPrescription) => {
      rows.set(record.prescriptionId, record);
    },
  };
}

describe("frozen professional diagnosis protocol", () => {
  it("keeps diagnose read-only and growth off the legacy workspace resolver", () => {
    expect(liveSource).not.toContain("upsertDiagnosisSchedule");
    expect(liveSource).not.toContain("resolveAgentWorkspaceDir");
    expect(growthSource).not.toContain("resolveAgentWorkspaceDir");
    expect(growthSource).not.toContain("loadCronStore");
    expect(gatewaySource).not.toContain("persistSchedule");
    expect(gatewaySource).not.toContain("record.grant");
    expect(gatewaySource).not.toContain("params.grant");
    expect(apiSource).toContain("diagnosis.schedule.apply");
    expect(apiSource).toContain("diagnosis.self-evolution.confirm");
  });

  it("does not collide prescription ids across tenants or payload versions", () => {
    const base = {
      schemaVersion: EVOLUTION_PRESCRIPTION_SCHEMA_VERSION,
      agentAssetId: "asset-bot-2",
      purpose: "identity",
      normalizedSchedule: normalizeEvolutionSchedule("next_heartbeat_cron", "0 8 * * *"),
      payloadVersion: EVOLUTION_PRESCRIPTION_PAYLOAD_VERSION,
    };
    const tenantA = evolutionPrescriptionId({ ...base, tenantId: "tenant-a" });
    const tenantB = evolutionPrescriptionId({ ...base, tenantId: "tenant-b" });
    const upgraded = evolutionPrescriptionId({
      ...base,
      tenantId: "tenant-a",
      payloadVersion: EVOLUTION_PRESCRIPTION_PAYLOAD_VERSION + 1,
    });
    expect(tenantA).not.toBe(tenantB);
    expect(tenantA).not.toBe(upgraded);
  });

  it("marks tick prescriptions not confirmable", () => {
    const rows = buildDiagnoseEvolutionPrescriptions({
      assessment: gapAssessment(),
      professionalReportId: "pdr-tick",
      confirmable: false,
      authorizationRef: "grant-1",
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => !row.confirmable)).toBe(true);
    expect(rows.every((row) => row.state === "NOT_CONFIRMABLE")).toBe(true);
  });

  it("asks the owner to fill identity instead of inventing it", () => {
    const rows = buildDiagnoseEvolutionPrescriptions({
      assessment: gapAssessment(),
      professionalReportId: "pdr-id",
      confirmable: true,
      authorizationRef: "grant-1",
    });
    const identity = rows.find((row) => row.purpose === "identity");
    expect(identity?.wakeText?.startsWith(IDENTITY_PRESCRIPTION_WAKE_TEXT)).toBe(true);
    expect(identity?.wakeText).toContain(
      "缺字段：IDENTITY.name、IDENTITY.vibe、USER.name、USER.timezone",
    );
    expect(identity?.wakeText).not.toContain("补全 IDENTITY");
    expect(identity?.kind).toBe("next_heartbeat_cron");
    expect(rows.some((row) => row.purpose === "memory")).toBe(false);
  });

  it("allows the owner to confirm without a grant", async () => {
    const store = savedRows();
    const [identity] = buildDiagnoseEvolutionPrescriptions({
      assessment: gapAssessment(),
      professionalReportId: "pdr-own",
      confirmable: true,
      authorizationRef: null,
    });
    store.saveRecord(identity);
    let created: CronJobCreate | undefined;
    const result = await confirmDiagnoseEvolutionPrescription({
      prescriptionId: identity.prescriptionId,
      tenantId: "tenant-a",
      professionalReportId: "pdr-own",
      prescriptionContentHash: identity.prescriptionContentHash,
      callerUserId: "employee-9",
      enabled: true,
      loadRecord: store.loadRecord,
      saveRecord: store.saveRecord,
      cron: {
        async list() {
          return [];
        },
        async add(job) {
          created = job;
          return { id: "job-owner" };
        },
      },
    });
    expect(result.ok).toBe(true);
    expect(created?.ownership).toEqual({ tenantId: "tenant-a", ownerId: "employee-9" });
    expect(created?.agentId).toBe("bot-2");
    expect(created?.wakeMode).toBe("next-heartbeat");
  });

  it("rejects an admin without a dedicated prescription grant", async () => {
    const store = savedRows();
    const [identity] = buildDiagnoseEvolutionPrescriptions({
      assessment: gapAssessment(),
      professionalReportId: "pdr-admin",
      confirmable: true,
      authorizationRef: "grant-admin",
    });
    store.saveRecord(identity);
    const result = await confirmDiagnoseEvolutionPrescription({
      prescriptionId: identity.prescriptionId,
      tenantId: "tenant-a",
      professionalReportId: "pdr-admin",
      callerUserId: "admin-1",
      enabled: true,
      inspectGrant: () => ({ status: "APPROVED" }),
      loadRecord: store.loadRecord,
      saveRecord: store.saveRecord,
      cron: {
        async list() {
          return [];
        },
        async add() {
          throw new Error("must not write");
        },
      },
    });
    expect(result).toMatchObject({ ok: false, reason: "grant_binding_mismatch" });
  });

  it("rejects a Working DNA evolution-grant for prescription confirm", async () => {
    const store = savedRows();
    const [identity] = buildDiagnoseEvolutionPrescriptions({
      assessment: gapAssessment(),
      professionalReportId: "pdr-wdna",
      confirmable: true,
      authorizationRef: "evolution-grant:wdna-1",
    });
    store.saveRecord(identity);
    const result = await confirmDiagnoseEvolutionPrescription({
      prescriptionId: identity.prescriptionId,
      tenantId: "tenant-a",
      professionalReportId: "pdr-wdna",
      callerUserId: "admin-1",
      enabled: true,
      inspectGrant: () => ({
        status: "APPROVED",
        tenantId: "tenant-a",
        targetPrincipal: "employee-9",
        targetAgent: "bot-2",
        purpose: "evolution-grant:diagnose",
        surfaceId: "agent.working-dna",
        allowedActions: ["diagnose", "suggest", "apply"],
      }),
      loadRecord: store.loadRecord,
      saveRecord: store.saveRecord,
      cron: {
        async list() {
          return [];
        },
        async add() {
          throw new Error("must not write");
        },
      },
    });
    expect(result).toMatchObject({ ok: false, reason: "wdna_grant_forbidden" });
  });

  it("allows a dedicated schedule_diagnosis_prescription grant to confirm for the owner", async () => {
    const store = savedRows();
    const [identity] = buildDiagnoseEvolutionPrescriptions({
      assessment: gapAssessment(),
      professionalReportId: "pdr-proxy",
      confirmable: true,
      authorizationRef: "grant-prescription",
    });
    store.saveRecord(identity);
    let created: CronJobCreate | undefined;
    const result = await confirmDiagnoseEvolutionPrescription({
      prescriptionId: identity.prescriptionId,
      tenantId: "tenant-a",
      professionalReportId: "pdr-proxy",
      prescriptionContentHash: identity.prescriptionContentHash,
      callerUserId: "admin-1",
      enabled: true,
      inspectGrant: () => ({
        status: "APPROVED",
        tenantId: "tenant-a",
        targetPrincipal: "employee-9",
        targetAgent: "bot-2",
        allowedActions: ["schedule_diagnosis_prescription"],
      }),
      loadRecord: store.loadRecord,
      saveRecord: store.saveRecord,
      cron: {
        async list() {
          return [];
        },
        async add(job) {
          created = job;
          return { id: "job-proxy" };
        },
      },
    });
    expect(result.ok).toBe(true);
    expect(created?.ownership).toEqual({ tenantId: "tenant-a", ownerId: "employee-9" });
    expect(created?.ownership?.ownerId).not.toBe("admin-1");
  });

  it("rejects a missing callerUserId", async () => {
    const store = savedRows();
    const [identity] = buildDiagnoseEvolutionPrescriptions({
      assessment: gapAssessment(),
      professionalReportId: "pdr-caller",
      confirmable: true,
      authorizationRef: "grant-1",
    });
    store.saveRecord(identity);
    const result = await confirmDiagnoseEvolutionPrescription({
      prescriptionId: identity.prescriptionId,
      tenantId: "tenant-a",
      professionalReportId: "pdr-caller",
      enabled: true,
      inspectGrant: () => ({
        status: "APPROVED",
        tenantId: "tenant-a",
        targetPrincipal: "employee-9",
        targetAgent: "bot-2",
        allowedActions: ["schedule_diagnosis_prescription"],
      }),
      loadRecord: store.loadRecord,
      saveRecord: store.saveRecord,
      cron: {
        async list() {
          return [];
        },
        async add() {
          throw new Error("must not write");
        },
      },
    });
    expect(result).toMatchObject({ ok: false, reason: "caller_required" });
  });

  it("rejects revoked, expired, and cross-report confirms", async () => {
    const store = savedRows();
    const [identity] = buildDiagnoseEvolutionPrescriptions({
      assessment: gapAssessment(),
      professionalReportId: "pdr-auth",
      confirmable: true,
      authorizationRef: "grant-1",
      nowMs: Date.parse("2026-09-19T00:00:00.000Z"),
    });
    store.saveRecord(identity);
    const cron = {
      async list() {
        return [];
      },
      async add() {
        throw new Error("must not write");
      },
    };
    const revoked = await confirmDiagnoseEvolutionPrescription({
      prescriptionId: identity.prescriptionId,
      tenantId: "tenant-a",
      professionalReportId: "pdr-auth",
      callerUserId: "admin-1",
      enabled: true,
      nowMs: Date.parse("2026-09-19T01:00:00.000Z"),
      inspectGrant: () => ({ status: "REVOKED" }),
      loadRecord: store.loadRecord,
      saveRecord: store.saveRecord,
      cron,
    });
    expect(revoked).toMatchObject({ ok: false, reason: "revoked" });
    store.saveRecord({ ...identity, state: "PENDING_CONFIRMATION", confirmable: true });
    const expired = await confirmDiagnoseEvolutionPrescription({
      prescriptionId: identity.prescriptionId,
      tenantId: "tenant-a",
      professionalReportId: "pdr-auth",
      callerUserId: "employee-9",
      enabled: true,
      nowMs: Date.parse("2026-09-21T00:00:00.000Z"),
      inspectGrant: () => ({ status: "APPROVED" }),
      loadRecord: store.loadRecord,
      saveRecord: store.saveRecord,
      cron,
    });
    expect(expired).toMatchObject({ ok: false, reason: "expired" });
    store.saveRecord(identity);
    const cross = await confirmDiagnoseEvolutionPrescription({
      prescriptionId: identity.prescriptionId,
      tenantId: "tenant-a",
      professionalReportId: "pdr-other",
      enabled: true,
      nowMs: Date.parse("2026-09-19T01:00:00.000Z"),
      inspectGrant: () => ({ status: "APPROVED" }),
      loadRecord: store.loadRecord,
      saveRecord: store.saveRecord,
      cron,
    });
    expect(cross).toMatchObject({ ok: false, reason: "cross_report" });
  });

  it("creates one job when two confirms race", async () => {
    const store = savedRows();
    const [identity] = buildDiagnoseEvolutionPrescriptions({
      assessment: gapAssessment(),
      professionalReportId: "pdr-race",
      confirmable: true,
      authorizationRef: "grant-1",
    });
    store.saveRecord(identity);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let adds = 0;
    const pending = confirmDiagnoseEvolutionPrescription({
      prescriptionId: identity.prescriptionId,
      tenantId: "tenant-a",
      professionalReportId: "pdr-race",
      prescriptionContentHash: identity.prescriptionContentHash,
      callerUserId: "employee-9",
      enabled: true,
      inspectGrant: () => ({ status: "APPROVED" }),
      loadRecord: store.loadRecord,
      saveRecord: store.saveRecord,
      cron: {
        async list() {
          return [];
        },
        async add() {
          adds += 1;
          await gate;
          return { id: "job-race" };
        },
      },
    });
    const second = confirmDiagnoseEvolutionPrescription({
      prescriptionId: identity.prescriptionId,
      tenantId: "tenant-a",
      professionalReportId: "pdr-race",
      prescriptionContentHash: identity.prescriptionContentHash,
      callerUserId: "employee-9",
      enabled: true,
      inspectGrant: () => ({ status: "APPROVED" }),
      loadRecord: store.loadRecord,
      saveRecord: store.saveRecord,
      cron: {
        async list() {
          return [];
        },
        async add() {
          adds += 1;
          return { id: "job-race-2" };
        },
      },
    });
    release();
    const [firstResult, secondResult] = await Promise.all([pending, second]);
    expect(adds).toBe(1);
    expect(firstResult.ok && secondResult.ok).toBe(true);
    if (firstResult.ok && secondResult.ok) {
      expect(secondResult.jobId).toBe(firstResult.jobId);
    }
  });

  it("recovers when cron.add succeeds and prescription persist fails", async () => {
    const store = savedRows();
    const [identity] = buildDiagnoseEvolutionPrescriptions({
      assessment: gapAssessment(),
      professionalReportId: "pdr-recover",
      confirmable: true,
      authorizationRef: "grant-1",
    });
    store.saveRecord(identity);
    let failApplied = true;
    const jobs: Array<{ id: string; name: string; agentId?: string; ownerId?: string }> = [];
    const saveRecord = (record: EvolutionPrescription) => {
      if (record.state === "APPLIED" && failApplied) {
        failApplied = false;
        throw new Error("disk");
      }
      store.rows.set(record.prescriptionId, record);
    };
    const cron = {
      async list() {
        return jobs;
      },
      async add(job: { name: string; agentId?: string; ownership?: { ownerId?: string } }) {
        const created = {
          id: "job-recover",
          name: job.name,
          agentId: job.agentId,
          ownerId: job.ownership?.ownerId,
        };
        jobs.push(created);
        return created;
      },
    };
    const failed = await confirmDiagnoseEvolutionPrescription({
      prescriptionId: identity.prescriptionId,
      tenantId: "tenant-a",
      professionalReportId: "pdr-recover",
      prescriptionContentHash: identity.prescriptionContentHash,
      callerUserId: "employee-9",
      enabled: true,
      inspectGrant: () => ({ status: "APPROVED" }),
      loadRecord: store.loadRecord,
      saveRecord,
      cron,
    });
    expect(failed).toMatchObject({ ok: false, reason: "persist_failed", jobId: "job-recover" });
    const recovered = await recoverEvolutionPrescriptionAfterCron({
      prescriptionId: identity.prescriptionId,
      tenantId: "tenant-a",
      loadRecord: store.loadRecord,
      saveRecord,
      cron,
    });
    expect(recovered.ok).toBe(true);
    expect(store.rows.get(identity.prescriptionId)?.state).toBe("APPLIED");
    expect(store.rows.get(identity.prescriptionId)?.appliedJobId).toBe("job-recover");
  });
});

describe("professional diagnosis report", () => {
  it("keeps every source report and does not use the last locator id as the group id", () => {
    const report = buildProfessionalDiagnosisReport({
      completion: "INCONCLUSIVE",
      findingCount: 0,
      findings: [],
      windowId: "24h",
      mode: "TARGETED",
      scope: "target",
      scanned: 2,
      skipped: 0,
      reportId: "cdr-last",
      reportIds: ["cdr-a", "cdr-b"],
      tenantId: "tenant-a",
    });
    expect(report.sourceReportIds).toEqual(["cdr-a", "cdr-b"]);
    expect(report.professionalReportId).not.toBe("cdr-last");
    expect(report.professionalReportId).not.toBe("cdr-b");
    expect(report.professionalReportId.startsWith("pdr-")).toBe(true);
  });

  it("renders Path A and Path B from the same formatter text", () => {
    const growth = gapAssessment();
    const prescriptions = buildDiagnoseEvolutionPrescriptions({
      assessment: growth,
      professionalReportId: "pdr-text",
      confirmable: false,
    });
    const input = {
      completion: "INCONCLUSIVE",
      findingCount: 0,
      findings: [],
      windowId: "24h",
      mode: "TARGETED",
      scope: "target",
      scanned: 1,
      skipped: 0,
      reportId: "cdr-1",
      reportIds: ["cdr-1"],
      tenantId: "tenant-a",
      locators: [{ agentId: "bot-2", sessionKey: "agent:bot-2:main" }],
      growths: [growth],
      prescriptions,
    };
    const pathA = formatDiagnoseReportText(input);
    const pathB = formatProfessionalDiagnosisReport(buildProfessionalDiagnosisReport(input));
    expect(pathA).toBe(pathB);
    expect(pathA).toContain(DIAGNOSIS_ZERO_FINDINGS_TEXT);
    expect(pathA).toContain("有成功证据");
    expect(pathA).toContain("已安装但本窗未观察到使用");
    expect(pathA).toContain("预期能力缺口候选：sales-brief");
    expect(pathA).toContain(NO_ACTIVITY_MEMORY_TEXT);
    expect(pathA).toContain("IDENTITY 未确认（缺 name、vibe）");
    expect(pathA).toContain("USER 未确认（缺 name、timezone）");
    expect(pathA).toContain("IDENTITY.name");
    expect(pathA).toContain("已扫 1 · 跳过 0 · 发现 0");
    expect(pathA).toContain("综述：运行面证据不足；身份或主人字段未齐");
    expect(pathA).toContain("已装未观察：briefing");
    expect(pathA).toContain("入职引导：未完成");
    expect(pathA).toContain("九、可执行建议");
    expect(pathA).toContain("六、自我管理处方");
    expect(pathA).toContain("七、结构性进化候选");
    expect(pathA).toContain("preview only");
    expect(pathA).toContain("未提交统一控制面");
    expect(pathA).not.toContain("已进入进化流程");
    expect(pathA).not.toContain("proposalId");
    expect(pathA).toContain("练未观察技能");
    expect(pathA).toContain("工作区：可读");
    expect(pathA).toContain("扫描范围");
    expect(pathA).toContain("主会话：1（近窗 0）");
    expect(pathA).toContain("优先处理：");
    expect(pathA).toContain("\n\n一、结论与窗口\n");
    expect(pathA).toContain("证据：");
    expect(pathA).not.toContain("已会");
    expect(pathA).not.toContain("缺失：");
    const job = evolutionJobCreate(prescriptions[0]);
    expect(diagnosisEvolutionJobName(prescriptions[0].prescriptionId)).toBe(job.name);
  });

  it("shows A1 structural preview as preview only / 未提交 / 需确认后提交", () => {
    const text = formatDiagnoseReportText({
      completion: "INCONCLUSIVE",
      findingCount: 1,
      findings: [{ findingId: "finding-1", severity: "P2", status: "open" }],
      windowId: "24h",
      mode: "TARGETED",
      scope: "target",
      scanned: 1,
      skipped: 0,
      reportId: "cdr-1",
      reportIds: ["cdr-1"],
      tenantId: "tenant-a",
      growths: [gapAssessment()],
      prescriptions: [],
      structuralFacts: [
        {
          structuralIntent: "adjust_reporting_cadence",
          proposedChange: { field: "reportingCadence", value: "milestone" },
          surfaceId: "agent.working-dna",
          targetHint: "bot-2",
          baselineHash: "wdna-style-on_completion",
          observationRef: "obs:task-result:run-1",
          evidenceRefs: ["evidence:task-result-1"],
          snapshotRef: "a".repeat(64),
          reportRef: "cdr-1",
          findingRef: "finding-1",
          observedWindow: {
            startedAt: "2026-09-18T00:00:00.000Z",
            endedAt: "2026-09-19T00:00:00.000Z",
          },
        },
      ],
    });
    expect(text).toContain("preview only");
    expect(text).toContain("未提交");
    expect(text).toContain("需确认后提交统一控制面");
    expect(text).toContain("变更：reportingCadence=milestone");
    expect(text).not.toContain("已进入进化流程");
    expect(text).not.toContain("proposalId");
  });

  it("shows A1 skill installation preview as preview only / 未提交 / 需确认后提交", () => {
    const text = formatDiagnoseReportText({
      completion: "INCONCLUSIVE",
      findingCount: 1,
      findings: [{ findingId: "finding-1", severity: "P2", status: "open" }],
      windowId: "24h",
      mode: "TARGETED",
      scope: "target",
      scanned: 1,
      skipped: 0,
      reportId: "cdr-1",
      reportIds: ["cdr-1"],
      tenantId: "tenant-a",
      growths: [gapAssessment()],
      prescriptions: [],
      skillInstallationFacts: [
        {
          structuralIntent: "install_existing_skill",
          proposedChange: { field: "skillId", operation: "install", skillId: "briefing" },
          surfaceId: "capability.skill-installation",
          targetHint: "bot-2",
          baselineHash: "skill-install-baseline-aaa",
          observationRef: "obs:explicit-install:briefing",
          evidenceRefs: ["evidence:task-result-1"],
          snapshotRef: "a".repeat(64),
          reportRef: "cdr-1",
          findingRef: "finding-1",
          observedWindow: {
            startedAt: "2026-09-18T00:00:00.000Z",
            endedAt: "2026-09-19T00:00:00.000Z",
          },
          installed: false,
        },
      ],
    });
    expect(text).toContain("preview only");
    expect(text).toContain("未提交");
    expect(text).toContain("需确认后提交统一控制面");
    expect(text).toContain("变更：install briefing");
    expect(text).not.toContain("已进入进化流程");
    expect(text).not.toContain("proposalId");
  });

  it("names a collaboration group instead of the coordinator", () => {
    const text = formatDiagnoseReportText({
      completion: "INCONCLUSIVE",
      findingCount: 0,
      findings: [],
      windowId: "24h",
      mode: "TARGETED",
      scope: "target",
      scanned: 1,
      skipped: 0,
      reportId: null,
      reportIds: [],
      locators: [{ agentId: "main", sessionKey: "agent:main:space:grp-1" }],
    });
    expect(text).toContain("对象：协作小组 grp-1");
    expect(text).not.toContain("对象：main");
  });
});
