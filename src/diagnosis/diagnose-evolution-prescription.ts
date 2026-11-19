/**
 * Server-persisted evolution prescriptions.
 * Confirm loads this object. It does not trust a model-resubmitted schedule,
 * wake text, or target. Both kinds are cron jobs on the existing CronService.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  DIAGNOSIS_SKILL_GOAL,
  DIAGNOSIS_SKILL_ACCEPTANCE,
} from "../cron/diagnosis-skill-contract.js";
import type { CronJobCreate } from "../cron/types.js";
import type { AuthorizationGrant } from "./delegation.js";
import {
  evolutionPrescriptionContentHash,
  matchPrescriptionContentHash,
} from "./diagnose-evolution-content-hash.js";
import {
  isDiagnosisEvolutionProductionRuntime,
  noteEvolutionRecoverAudit,
} from "./diagnose-evolution-recover-seal.js";
import type {
  DiagnoseGrowthAssessment,
  DiagnoseGrowthJobRef,
} from "./diagnose-growth-assessment.js";
import {
  DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED,
  EVOLUTION_PRESCRIPTION_PAYLOAD_VERSION,
  EVOLUTION_PRESCRIPTION_SCHEMA_VERSION,
  IDENTITY_PRESCRIPTION_WAKE_TEXT,
  evolutionPrescriptionId,
  normalizeEvolutionSchedule,
  type EvolutionCronKind,
  type EvolutionPrescriptionState,
} from "./diagnose-professional-protocol.js";

export const DIAGNOSIS_EVOLUTION_NAME_PREFIX = "diagnosis-evolution:";
export const SCHEDULE_DIAGNOSIS_PRESCRIPTION_ACTION = "schedule_diagnosis_prescription";

export type PrescriptionGrantView = {
  status: string;
  tenantId?: string | null;
  targetPrincipal?: string | null;
  targetAgent?: string | null;
  allowedActions?: readonly string[];
  purpose?: string | null;
  surfaceId?: string | null;
};

export type PrescriptionGrantInspector = (grantId: string) => PrescriptionGrantView;

const EVOLUTION_GRANT_PURPOSE_PREFIX = "evolution-grant:";

export function prescriptionGrantViewFromAuthorization(
  grant: AuthorizationGrant | null | undefined,
): PrescriptionGrantView {
  if (!grant) {
    return { status: "missing" };
  }
  const targetType = grant.targetScope?.targetType;
  const targetId = grant.targetScope?.targetId;
  return {
    status: grant.status,
    tenantId: grant.targetTenant ?? grant.sourceTenant ?? null,
    targetPrincipal: grant.targetPrincipal ?? null,
    targetAgent: targetType === "agent" && typeof targetId === "string" ? targetId : null,
    allowedActions: [...grant.allowedActions],
    purpose: grant.purpose,
    surfaceId: surfaceIdFromGrantPurpose(grant.purpose),
  };
}

function surfaceIdFromGrantPurpose(purpose: string): string | null {
  if (!purpose.startsWith(EVOLUTION_GRANT_PURPOSE_PREFIX)) {
    return null;
  }
  const encoded = purpose.slice(EVOLUTION_GRANT_PURPOSE_PREFIX.length);
  try {
    const parsed = JSON.parse(encoded) as { surfaceId?: unknown };
    return typeof parsed.surfaceId === "string" ? parsed.surfaceId : "agent.working-dna";
  } catch {
    return "agent.working-dna";
  }
}

export const DIAGNOSE_EVOLUTION_PURPOSES = [
  "identity",
  "memory",
  "learn_capability",
  "review_tasks",
] as const;
export type DiagnoseEvolutionPurpose = (typeof DIAGNOSE_EVOLUTION_PURPOSES)[number];

export type EvolutionPrescription = {
  prescriptionId: string;
  professionalReportId: string;
  tenantId: string;
  targetAgentAssetId: string;
  targetAgentId: string;
  targetOwnerId: string;
  purpose: DiagnoseEvolutionPurpose;
  purposeLabel: string;
  kind: EvolutionCronKind;
  normalizedSchedule: string;
  scheduleExpr: string;
  cadenceLabel: string;
  expectedEffect: string;
  wakeText: string;
  payloadVersion: number;
  schemaVersion: number;
  state: EvolutionPrescriptionState;
  confirmable: boolean;
  authorizationRef: string | null;
  expiresAt: string;
  appliedJobId: string | null;
  /** sha256 of the canonical prescription content. Confirm must resubmit it. */
  prescriptionContentHash?: string;
  /** Written only after confirm authorization. Recover cannot invent one. */
  confirmReceipt?: EvolutionConfirmReceipt | null;
};

export type EvolutionConfirmReceipt = {
  callerUserId: string;
  confirmedAt: string;
  prescriptionContentHash: string;
};

/** @deprecated Use EvolutionPrescription. Kept for existing imports. */
export type DiagnoseEvolutionPrescription = EvolutionPrescription;

export type EvolutionCronPort = {
  add(job: CronJobCreate): Promise<{ id: string }>;
  list(): Promise<DiagnoseGrowthJobRef[]>;
};

type Spec = {
  purpose: DiagnoseEvolutionPurpose;
  purposeLabel: string;
  kind: EvolutionCronKind;
  scheduleExpr: string;
  cadenceLabel: string;
  expectedEffect: string;
  wakeText: string;
  when: (assessment: DiagnoseGrowthAssessment) => boolean;
};

const SPECS: readonly Spec[] = [
  {
    purpose: "identity",
    purposeLabel: "补身份",
    kind: "next_heartbeat_cron",
    scheduleExpr: "0 8 * * *",
    cadenceLabel: "每天 08:00，下次心跳触发",
    expectedEffect: "向主人收集未确认字段",
    wakeText: IDENTITY_PRESCRIPTION_WAKE_TEXT,
    when: (assessment) =>
      !assessment.identity.readable ||
      assessment.identity.bootstrapPending ||
      !assessment.identity.identityInitialized ||
      !assessment.identity.userInitialized,
  },
  {
    purpose: "memory",
    purposeLabel: "补记忆",
    kind: "scheduled_agent_turn",
    scheduleExpr: "0 21 * * *",
    cadenceLabel: "每天 21:00",
    expectedEffect: "有任务活动但近窗记忆未落盘",
    wakeText: "把今日可核对的工作要点写入 memory/ 当日文件，不复制聊天正文。不要等待用户再派任务。",
    when: (assessment) => assessment.memoryJudgedMissing,
  },
  {
    purpose: "learn_capability",
    purposeLabel: "学能力",
    kind: "next_heartbeat_cron",
    scheduleExpr: "0 10 * * *",
    cadenceLabel: "每天 10:00，下次心跳触发",
    expectedEffect: "练习已装未观察技能",
    wakeText: "用空闲时间练习已安装但本窗未观察到使用的技能。只记录技能名与结果，不安装新技能。",
    when: (assessment) =>
      assessment.unused.length > 0 || assessment.baselineGapCandidates.length > 0,
  },
  {
    purpose: "review_tasks",
    purposeLabel: "复盘任务",
    kind: "scheduled_agent_turn",
    scheduleExpr: "30 9 * * *",
    cadenceLabel: "每天 09:30",
    expectedEffect: "不稳定技能进入定时复盘",
    wakeText: "复盘近窗失败或超时的技能与工具，写出下一次可执行的改进步骤。不要等待用户再派任务。",
    when: (assessment) => assessment.unstable.length > 0,
  },
];

const CONFIRM_TTL_MS = 24 * 60 * 60 * 1000;
const inflight = new Map<string, Promise<ConfirmResult>>();
let registeredCron: EvolutionCronPort | null = null;
let registeredGrantInspector: PrescriptionGrantInspector | null = null;

export type ConfirmResult =
  | { ok: true; jobId: string; already: boolean; prescription: EvolutionPrescription }
  | { ok: false; reason: string; jobId?: string; prescription?: EvolutionPrescription };

export function diagnosisEvolutionJobName(id: string): string {
  return `${DIAGNOSIS_EVOLUTION_NAME_PREFIX}${id}`;
}

export function registerDiagnoseEvolutionCron(port: EvolutionCronPort | null): void {
  registeredCron = port;
}

export function registerDiagnosePrescriptionGrantInspector(
  inspector: PrescriptionGrantInspector | null,
): void {
  registeredGrantInspector = inspector;
}

export function buildDiagnoseEvolutionPrescriptions(input: {
  assessment: DiagnoseGrowthAssessment;
  professionalReportId: string;
  authorizationRef?: string | null;
  confirmable?: boolean;
  existingJobs?: readonly DiagnoseGrowthJobRef[];
  nowMs?: number;
  configDir?: string;
}): EvolutionPrescription[] {
  const tenantId = input.assessment.tenantId?.trim() ?? "";
  const agentAssetId = input.assessment.agentAssetId?.trim() ?? "";
  const targetOwnerId = input.assessment.targetOwnerId?.trim() ?? "";
  if (!tenantId || !agentAssetId || !targetOwnerId || !input.professionalReportId.trim()) {
    return [];
  }
  const jobs = input.existingJobs ?? jobsFromNames(input.assessment);
  const nowMs = input.nowMs ?? Date.now();
  const allowConfirm = input.confirmable !== false;
  const out: EvolutionPrescription[] = [];
  for (const spec of SPECS) {
    if (!spec.when(input.assessment)) {
      continue;
    }
    const normalizedSchedule = normalizeEvolutionSchedule(spec.kind, spec.scheduleExpr);
    const prescriptionId = evolutionPrescriptionId({
      schemaVersion: EVOLUTION_PRESCRIPTION_SCHEMA_VERSION,
      tenantId,
      agentAssetId,
      purpose: spec.purpose,
      normalizedSchedule,
      payloadVersion: EVOLUTION_PRESCRIPTION_PAYLOAD_VERSION,
    });
    const name = diagnosisEvolutionJobName(prescriptionId);
    const existing = jobs.find(
      (job) => job.name === name && (!job.agentId || job.agentId === input.assessment.agentId),
    );
    const state: EvolutionPrescriptionState = existing
      ? "ALREADY_SCHEDULED"
      : allowConfirm
        ? "PENDING_CONFIRMATION"
        : "NOT_CONFIRMABLE";
    const row: EvolutionPrescription = {
      prescriptionId,
      professionalReportId: input.professionalReportId.trim(),
      tenantId,
      targetAgentAssetId: agentAssetId,
      targetAgentId: input.assessment.agentId,
      targetOwnerId,
      purpose: spec.purpose,
      purposeLabel: spec.purposeLabel,
      kind: spec.kind,
      normalizedSchedule,
      scheduleExpr: spec.scheduleExpr,
      cadenceLabel: spec.cadenceLabel,
      expectedEffect: enrichExpectedEffect(spec.purpose, spec.expectedEffect, input.assessment),
      wakeText: enrichWakeText(spec.purpose, spec.wakeText, input.assessment),
      payloadVersion: EVOLUTION_PRESCRIPTION_PAYLOAD_VERSION,
      schemaVersion: EVOLUTION_PRESCRIPTION_SCHEMA_VERSION,
      state,
      confirmable: allowConfirm && state === "PENDING_CONFIRMATION",
      authorizationRef: input.authorizationRef ?? null,
      expiresAt: new Date(nowMs + CONFIRM_TTL_MS).toISOString(),
      appliedJobId: existing?.id ?? null,
      confirmReceipt: null,
    };
    row.prescriptionContentHash = evolutionPrescriptionContentHash(row);
    out.push(row);
    if (input.configDir) {
      saveEvolutionPrescription(row, input.configDir);
    }
  }
  return out;
}

export function evolutionJobCreate(prescription: EvolutionPrescription): CronJobCreate {
  return {
    agentId: prescription.targetAgentId,
    name: diagnosisEvolutionJobName(prescription.prescriptionId),
    description:
      `diagnosis-evolution-purpose:${prescription.purpose}` +
      (prescription.purpose === "learn_capability"
        ? `\n<!--openbot-task-meta:${encodeURIComponent(JSON.stringify({ goal: DIAGNOSIS_SKILL_GOAL, acceptanceRules: DIAGNOSIS_SKILL_ACCEPTANCE }))}-->`
        : ""),
    enabled: true,
    schedule: { kind: "cron", expr: prescription.scheduleExpr },
    sessionTarget: "isolated",
    wakeMode: prescription.kind === "next_heartbeat_cron" ? "next-heartbeat" : "now",
    payload: {
      kind: "agentTurn",
      message: prescription.wakeText,
      lightContext: true,
      deliver: false,
    },
    delivery: { mode: "none" },
    ownership: {
      tenantId: prescription.tenantId,
      ownerId: prescription.targetOwnerId,
    },
  };
}

export async function confirmDiagnoseEvolutionPrescription(input: {
  prescriptionId: string;
  tenantId: string;
  professionalReportId: string;
  callerUserId?: string;
  prescriptionContentHash?: string;
  enabled?: boolean;
  nowMs?: number;
  configDir?: string;
  cron?: EvolutionCronPort;
  inspectGrant?: PrescriptionGrantInspector;
  loadRecord?: (tenantId: string, prescriptionId: string) => EvolutionPrescription | null;
  saveRecord?: (record: EvolutionPrescription) => void;
}): Promise<ConfirmResult> {
  const key = `${input.tenantId.trim()}:${input.prescriptionId.trim()}`;
  const existing = inflight.get(key);
  if (existing) {
    return existing;
  }
  let resolveOuter: (value: ConfirmResult) => void = () => {};
  const outer = new Promise<ConfirmResult>((resolve) => {
    resolveOuter = resolve;
  });
  inflight.set(key, outer);
  void runConfirm(input).then(
    (value) => {
      inflight.delete(key);
      resolveOuter(value);
    },
    () => {
      inflight.delete(key);
      resolveOuter({ ok: false, reason: "failed" });
    },
  );
  return outer;
}

export async function recoverEvolutionPrescriptionAfterCron(input: {
  prescriptionId: string;
  tenantId: string;
  configDir?: string;
  cron: EvolutionCronPort;
  loadRecord?: (tenantId: string, prescriptionId: string) => EvolutionPrescription | null;
  saveRecord?: (record: EvolutionPrescription) => void;
}): Promise<ConfirmResult> {
  const production = isDiagnosisEvolutionProductionRuntime();
  const audit = (outcome: "rejected" | "applied", reason: string) => {
    noteEvolutionRecoverAudit(
      {
        tenantId: input.tenantId,
        prescriptionId: input.prescriptionId,
        outcome,
        reason,
        productionRuntime: production,
      },
      input.configDir,
    );
  };
  // Production cannot mark APPLIED through this helper, even with a receipt.
  if (production) {
    audit("rejected", "recover_sealed");
    return { ok: false, reason: "recover_sealed" };
  }
  const loaded = readRecord(input);
  if (!loaded) {
    audit("rejected", "prescription_gone");
    return { ok: false, reason: "prescription_gone" };
  }
  const fingerprint = evolutionPrescriptionContentHash(loaded);
  const receipt = loaded.confirmReceipt;
  if (
    !receipt ||
    receipt.prescriptionContentHash !== fingerprint ||
    loaded.prescriptionContentHash !== fingerprint
  ) {
    const reason = receipt ? "prescription_hash_mismatch" : "recover_requires_confirm";
    audit("rejected", reason);
    return { ok: false, reason };
  }
  if (loaded.state === "APPLIED" && loaded.appliedJobId) {
    audit("applied", "already_applied");
    return { ok: true, jobId: loaded.appliedJobId, already: true, prescription: loaded };
  }
  const name = diagnosisEvolutionJobName(loaded.prescriptionId);
  const landed = (await input.cron.list()).find((job) => job.name === name);
  if (!landed) {
    audit("rejected", "prescription_gone");
    return { ok: false, reason: "prescription_gone" };
  }
  if (landed.ownerId && landed.ownerId !== loaded.targetOwnerId) {
    audit("rejected", "owner_mismatch");
    return { ok: false, reason: "owner_mismatch" };
  }
  const applied: EvolutionPrescription = {
    ...loaded,
    state: "APPLIED",
    appliedJobId: landed.id,
    confirmable: false,
    prescriptionContentHash: fingerprint,
    confirmReceipt: receipt,
  };
  writeRecord(input, applied);
  audit("applied", "confirm_receipt");
  return { ok: true, jobId: landed.id, already: true, prescription: applied };
}

export function saveEvolutionPrescription(record: EvolutionPrescription, configDir: string): void {
  const rows = readAll(configDir, record.tenantId).filter(
    (row) => row.prescriptionId !== record.prescriptionId,
  );
  rows.push(record);
  writeAll(configDir, record.tenantId, rows);
}

export function readEvolutionPrescription(
  tenantId: string,
  prescriptionId: string,
  configDir: string,
): EvolutionPrescription | null {
  return readAll(configDir, tenantId).find((row) => row.prescriptionId === prescriptionId) ?? null;
}

async function runConfirm(input: {
  prescriptionId: string;
  tenantId: string;
  professionalReportId: string;
  callerUserId?: string;
  prescriptionContentHash?: string;
  enabled?: boolean;
  nowMs?: number;
  configDir?: string;
  cron?: EvolutionCronPort;
  inspectGrant?: PrescriptionGrantInspector;
  loadRecord?: (tenantId: string, prescriptionId: string) => EvolutionPrescription | null;
  saveRecord?: (record: EvolutionPrescription) => void;
}): Promise<ConfirmResult> {
  const enabled = input.enabled ?? DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED;
  if (!enabled) {
    return { ok: false, reason: "confirm_not_enabled" };
  }
  const loaded = readRecord(input);
  if (!loaded) {
    return { ok: false, reason: "prescription_gone" };
  }
  if (loaded.professionalReportId !== input.professionalReportId.trim()) {
    return { ok: false, reason: "cross_report" };
  }
  if (loaded.state === "NOT_CONFIRMABLE") {
    return { ok: false, reason: "not_confirmable" };
  }
  const nowMs = input.nowMs ?? Date.now();
  if (loaded.state === "EXPIRED" || Date.parse(loaded.expiresAt) <= nowMs) {
    const expired = { ...loaded, state: "EXPIRED" as const, confirmable: false };
    writeRecord(input, expired);
    return { ok: false, reason: "expired" };
  }
  if (loaded.state === "REVOKED") {
    return { ok: false, reason: "revoked" };
  }
  const authorized = authorizePrescriptionConfirm(loaded, input);
  if (!authorized.ok) {
    if (authorized.reason === "revoked") {
      writeRecord(input, { ...loaded, state: "REVOKED", confirmable: false });
    }
    if (authorized.reason === "expired") {
      writeRecord(input, { ...loaded, state: "EXPIRED", confirmable: false });
    }
    return { ok: false, reason: authorized.reason };
  }
  if (!loaded.targetOwnerId || !loaded.tenantId || !loaded.targetAgentId) {
    return { ok: false, reason: "owner_required" };
  }
  const bound = matchPrescriptionContentHash(loaded, input.prescriptionContentHash);
  if (!bound.ok) {
    return { ok: false, reason: bound.reason };
  }
  const callerUserId = input.callerUserId?.trim() ?? "";
  const cron = input.cron ?? registeredCron;
  if (!cron) {
    return { ok: false, reason: "cron_unavailable" };
  }
  const name = diagnosisEvolutionJobName(loaded.prescriptionId);
  const landed = (await cron.list()).find((job) => job.name === name);
  if (loaded.state === "APPLIED" || loaded.state === "ALREADY_SCHEDULED" || landed) {
    const jobId = loaded.appliedJobId ?? landed?.id;
    if (!jobId) {
      return { ok: false, reason: "prescription_gone" };
    }
    const applied = {
      ...loaded,
      state: "APPLIED" as const,
      appliedJobId: jobId,
      confirmable: false,
      prescriptionContentHash: bound.fingerprint,
      confirmReceipt: loaded.confirmReceipt ?? {
        callerUserId,
        confirmedAt: new Date(nowMs).toISOString(),
        prescriptionContentHash: bound.fingerprint,
      },
    };
    writeRecord(input, applied);
    return { ok: true, jobId, already: true, prescription: applied };
  }
  const applying = {
    ...loaded,
    state: "APPLYING" as const,
    confirmable: false,
    prescriptionContentHash: bound.fingerprint,
    confirmReceipt: {
      callerUserId,
      confirmedAt: new Date(nowMs).toISOString(),
      prescriptionContentHash: bound.fingerprint,
    },
  };
  writeRecord(input, applying);
  let created: { id: string };
  try {
    const job = evolutionJobCreate(applying);
    if (job.ownership?.ownerId !== loaded.targetOwnerId || job.agentId !== loaded.targetAgentId) {
      return { ok: false, reason: "owner_required" };
    }
    created = await cron.add(job);
  } catch {
    writeRecord(input, { ...applying, state: "FAILED" });
    return { ok: false, reason: "cron_failed" };
  }
  const applied = {
    ...applying,
    state: "APPLIED" as const,
    appliedJobId: created.id,
    confirmable: false,
  };
  try {
    writeRecord(input, applied);
  } catch {
    return { ok: false, reason: "persist_failed", jobId: created.id, prescription: applied };
  }
  return { ok: true, jobId: created.id, already: false, prescription: applied };
}

function authorizePrescriptionConfirm(
  loaded: EvolutionPrescription,
  input: {
    tenantId: string;
    callerUserId?: string;
    inspectGrant?: PrescriptionGrantInspector;
  },
): { ok: true } | { ok: false; reason: string } {
  const callerUserId = input.callerUserId?.trim() ?? "";
  if (!callerUserId) {
    return { ok: false, reason: "caller_required" };
  }
  if (input.tenantId.trim() !== loaded.tenantId) {
    return { ok: false, reason: "cross_tenant" };
  }
  if (callerUserId === loaded.targetOwnerId) {
    return { ok: true };
  }
  if (!loaded.authorizationRef) {
    return { ok: false, reason: "authorization_required" };
  }
  const grant = input.inspectGrant?.(loaded.authorizationRef) ??
    registeredGrantInspector?.(loaded.authorizationRef) ?? { status: "missing" };
  if (grant.status === "REVOKED" || grant.status === "DENIED") {
    return { ok: false, reason: "revoked" };
  }
  if (grant.status === "EXPIRED") {
    return { ok: false, reason: "expired" };
  }
  if (grant.status !== "APPROVED") {
    return { ok: false, reason: "authorization_required" };
  }
  if (isWorkingDnaGrant(grant)) {
    return { ok: false, reason: "wdna_grant_forbidden" };
  }
  if (
    grant.tenantId !== loaded.tenantId ||
    grant.targetPrincipal !== loaded.targetOwnerId ||
    grant.targetAgent !== loaded.targetAgentId
  ) {
    return { ok: false, reason: "grant_binding_mismatch" };
  }
  if (!(grant.allowedActions ?? []).includes(SCHEDULE_DIAGNOSIS_PRESCRIPTION_ACTION)) {
    return { ok: false, reason: "authorization_required" };
  }
  return { ok: true };
}

function isWorkingDnaGrant(grant: PrescriptionGrantView): boolean {
  const purpose = grant.purpose ?? "";
  return purpose.startsWith("evolution-grant:") || grant.surfaceId === "agent.working-dna";
}

function readRecord(input: {
  tenantId: string;
  prescriptionId: string;
  configDir?: string;
  loadRecord?: (tenantId: string, prescriptionId: string) => EvolutionPrescription | null;
}): EvolutionPrescription | null {
  if (input.loadRecord) {
    return input.loadRecord(input.tenantId, input.prescriptionId);
  }
  if (!input.configDir) {
    return null;
  }
  return readEvolutionPrescription(input.tenantId, input.prescriptionId, input.configDir);
}

function writeRecord(
  input: { configDir?: string; saveRecord?: (record: EvolutionPrescription) => void },
  record: EvolutionPrescription,
): void {
  if (input.saveRecord) {
    input.saveRecord(record);
    return;
  }
  if (!input.configDir) {
    throw new Error("prescription store required");
  }
  saveEvolutionPrescription(record, input.configDir);
}

function enrichExpectedEffect(
  purpose: DiagnoseEvolutionPurpose,
  base: string,
  assessment: DiagnoseGrowthAssessment,
): string {
  if (purpose === "identity") {
    const fields = [
      ...(assessment.identityMissingFields ?? []).map((name) => `IDENTITY.${name}`),
      ...(assessment.userMissingFields ?? []).map((name) => `USER.${name}`),
    ];
    return fields.length > 0 ? `${base}：${fields.join("、")}` : base;
  }
  if (purpose === "learn_capability") {
    const unused = uniqueNames(assessment.unused ?? []);
    const baseline = assessment.roleBaselineInjected
      ? uniqueNames(assessment.baselineGapCandidates ?? [])
      : [];
    if (unused.length > 0 && baseline.length > 0) {
      return `练习已装未观察技能：${unused.join("、")}；角色基线缺口候选：${baseline.join("、")}`;
    }
    if (unused.length > 0) {
      return `练习已装未观察技能：${unused.join("、")}`;
    }
    if (baseline.length > 0) {
      return `补角色基线缺口候选：${baseline.join("、")}`;
    }
    return base;
  }
  if (purpose === "review_tasks" && (assessment.unstable ?? []).length > 0) {
    return `${base}：${assessment.unstable.join("、")}`;
  }
  return base;
}

function enrichWakeText(
  purpose: DiagnoseEvolutionPurpose,
  base: string,
  assessment: DiagnoseGrowthAssessment,
): string {
  if (purpose === "identity") {
    const fields = [
      ...(assessment.identityMissingFields ?? []).map((name) => `IDENTITY.${name}`),
      ...(assessment.userMissingFields ?? []).map((name) => `USER.${name}`),
    ];
    return fields.length > 0 ? `${base}缺字段：${fields.join("、")}。` : base;
  }
  if (purpose === "learn_capability") {
    const unused = uniqueNames(assessment.unused ?? []);
    const baseline = assessment.roleBaselineInjected
      ? uniqueNames(assessment.baselineGapCandidates ?? [])
      : [];
    const skills = uniqueNames([...unused, ...baseline]);
    return skills.length > 0 ? `${base}对象：${skills.join("、")}。` : base;
  }
  return base;
}

function uniqueNames(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function jobsFromNames(assessment: DiagnoseGrowthAssessment): DiagnoseGrowthJobRef[] {
  return assessment.existingJobNames.map((name) => ({
    id: name,
    name,
    agentId: assessment.agentId,
  }));
}

function filePath(configDir: string, tenantId: string): string {
  const digest = createHash("sha256").update(tenantId).digest("hex").slice(0, 16);
  return path.join(configDir, "diagnosis-evolution-prescriptions", `${digest}.json`);
}

function readAll(configDir: string, tenantId: string): EvolutionPrescription[] {
  const file = filePath(configDir, tenantId);
  if (!fs.existsSync(file)) {
    return [];
  }
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  return Array.isArray(parsed) ? (parsed as EvolutionPrescription[]) : [];
}

function writeAll(configDir: string, tenantId: string, rows: EvolutionPrescription[]): void {
  const file = filePath(configDir, tenantId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(rows, null, 2)}\n`);
  fs.renameSync(tmp, file);
}
