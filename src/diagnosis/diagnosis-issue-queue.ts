/**
 * M2 ops queue. An Issue is the queue unit. A Finding is evidence and cannot
 * carry queue state.
 *
 * Pipeline: Evaluation → Issue → RootCause → Prescription → confirm →
 * evolution cron → recheck → writeback.
 *
 * Depends on the existing prescription store, not on the M1 Diagnosis Job
 * model. Merge M1 first; this module does not import diagnosis-job*.
 * DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED stays false. Evolution apply runs
 * only when a caller passes enabled: true (tests). Gateway handlers ignore
 * any client-supplied enabled flag.
 *
 * Evaluation bodies stay out of diagnosis-schedules, diagnosis-projections,
 * and diagnosis-evolution-prescriptions. This store keeps ids only.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DiagnoseGrowthAssessment } from "./diagnose-growth-assessment.js";
import {
  buildDiagnoseEvolutionPrescriptions,
  confirmDiagnoseEvolutionPrescription,
  readEvolutionPrescription,
  type EvolutionCronPort,
  type EvolutionPrescription,
  type PrescriptionGrantInspector,
} from "./diagnose-self-evolution.js";

export const DIAGNOSIS_ISSUE_KIND = "diagnosis-issue" as const;
export const DIAGNOSIS_FINDING_KIND = "diagnosis-finding" as const;
export const DIAGNOSIS_ISSUE_RULE_VERSION = "m2.issue.v1" as const;

export const DIAGNOSIS_ISSUE_STATES = [
  "open",
  "triaged",
  "prescribed",
  "confirmed",
  "applied",
  "rechecked",
  "closed",
] as const;
export type DiagnosisIssueState = (typeof DIAGNOSIS_ISSUE_STATES)[number];

export type DiagnosisIssueEvaluationRef = {
  tenantId: string;
  conversationId: string;
  eventId: string;
  agentId?: string | null;
  failureAttribution?: string;
  correctness?: string;
  usability?: string;
};

export type DiagnosisRootCause = {
  summary: string;
  ruleVersion: string;
  source: "evaluation";
};

export type DiagnosisIssueWriteback = {
  at: string;
  prescriptionContentHash: string;
  evolutionJobId: string;
  summary: string;
};

export type DiagnosisIssue = {
  kind: typeof DIAGNOSIS_ISSUE_KIND;
  issueId: string;
  tenantId: string;
  state: DiagnosisIssueState;
  bucket: string;
  evaluationRefs: DiagnosisIssueEvaluationRef[];
  findingRefs: string[];
  rootCause: DiagnosisRootCause | null;
  prescriptionId: string | null;
  prescriptionContentHash: string | null;
  evolutionJobId: string | null;
  recheck: { outcome: "pass" | "fail"; at: string } | null;
  writeback: DiagnosisIssueWriteback | null;
};

export type DiagnosisFinding = {
  kind: typeof DIAGNOSIS_FINDING_KIND;
  findingId: string;
  tenantId: string;
  summary: string;
};

type IssueStoreFile = {
  issues: DiagnosisIssue[];
  findings: DiagnosisFinding[];
};

export type IssueQueueFailure = { ok: false; reason: string; issue?: DiagnosisIssue };

function tenantFile(configDir: string, tenantId: string): string {
  const digest = createHash("sha256").update(tenantId).digest("hex").slice(0, 16);
  return path.join(configDir, "diagnosis-issues", `${digest}.json`);
}

function emptyStore(): IssueStoreFile {
  return { issues: [], findings: [] };
}

function readStore(configDir: string, tenantId: string): IssueStoreFile {
  const file = tenantFile(configDir, tenantId);
  if (!fs.existsSync(file)) {
    return emptyStore();
  }
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<IssueStoreFile>;
  return {
    issues: Array.isArray(parsed.issues) ? parsed.issues : [],
    findings: Array.isArray(parsed.findings) ? parsed.findings : [],
  };
}

function writeStore(configDir: string, tenantId: string, store: IssueStoreFile): void {
  const file = tenantFile(configDir, tenantId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

export function evaluationBucket(ref: DiagnosisIssueEvaluationRef): string {
  return [
    ref.agentId?.trim() ?? "",
    ref.failureAttribution?.trim() ?? "unknown",
    ref.correctness?.trim() ?? "unassessed",
  ].join("\n");
}

function issueIdFor(tenantId: string, bucket: string): string {
  return `iss-${createHash("sha256").update(`${tenantId}\n${bucket}`).digest("hex").slice(0, 24)}`;
}

function refsMatchTenant(tenantId: string, refs: readonly DiagnosisIssueEvaluationRef[]): boolean {
  return refs.every((ref) => ref.tenantId === tenantId);
}

export function listDiagnosisIssues(tenantId: string, configDir: string): DiagnosisIssue[] {
  return readStore(configDir, tenantId).issues.filter((row) => row.kind === DIAGNOSIS_ISSUE_KIND);
}

export function listDiagnosisFindings(tenantId: string, configDir: string): DiagnosisFinding[] {
  return readStore(configDir, tenantId).findings.filter(
    (row) => row.kind === DIAGNOSIS_FINDING_KIND,
  );
}

export function recordDiagnosisFinding(input: {
  tenantId: string;
  configDir: string;
  findingId: string;
  summary: string;
}): DiagnosisFinding | IssueQueueFailure {
  const findingId = input.findingId.trim();
  if (!input.tenantId.trim() || !findingId) {
    return { ok: false, reason: "finding_required" };
  }
  if (findingId.startsWith("iss-")) {
    return { ok: false, reason: "finding_not_queue" };
  }
  const store = readStore(input.configDir, input.tenantId);
  const finding: DiagnosisFinding = {
    kind: DIAGNOSIS_FINDING_KIND,
    findingId,
    tenantId: input.tenantId,
    summary: input.summary.trim() || "finding",
  };
  store.findings = store.findings.filter((row) => row.findingId !== findingId);
  store.findings.push(finding);
  writeStore(input.configDir, input.tenantId, store);
  return finding;
}

export function openDiagnosisIssue(input: {
  tenantId: string;
  configDir: string;
  evaluations: readonly DiagnosisIssueEvaluationRef[];
  findingRefs?: readonly string[];
}): { ok: true; issue: DiagnosisIssue } | IssueQueueFailure {
  const tenantId = input.tenantId.trim();
  if (!tenantId || input.evaluations.length === 0) {
    return { ok: false, reason: "evaluation_required" };
  }
  if (!refsMatchTenant(tenantId, input.evaluations)) {
    return { ok: false, reason: "cross_tenant" };
  }
  const bucket = evaluationBucket(input.evaluations[0]);
  if (input.evaluations.some((ref) => evaluationBucket(ref) !== bucket)) {
    return { ok: false, reason: "bucket_mismatch" };
  }
  const store = readStore(input.configDir, tenantId);
  const issueId = issueIdFor(tenantId, bucket);
  const existing = store.issues.find((row) => row.issueId === issueId);
  const findingRefs = [
    ...new Set((input.findingRefs ?? []).map((id) => id.trim()).filter(Boolean)),
  ];
  if (existing) {
    const seen = new Set(existing.evaluationRefs.map((ref) => ref.eventId));
    for (const ref of input.evaluations) {
      if (!seen.has(ref.eventId)) {
        existing.evaluationRefs.push(ref);
        seen.add(ref.eventId);
      }
    }
    existing.findingRefs = [...new Set([...existing.findingRefs, ...findingRefs])];
    writeStore(input.configDir, tenantId, store);
    return { ok: true, issue: existing };
  }
  const issue: DiagnosisIssue = {
    kind: DIAGNOSIS_ISSUE_KIND,
    issueId,
    tenantId,
    state: "open",
    bucket,
    evaluationRefs: [...input.evaluations],
    findingRefs,
    rootCause: null,
    prescriptionId: null,
    prescriptionContentHash: null,
    evolutionJobId: null,
    recheck: null,
    writeback: null,
  };
  store.issues.push(issue);
  writeStore(input.configDir, tenantId, store);
  return { ok: true, issue };
}

export function attachDiagnosisRootCause(input: {
  tenantId: string;
  configDir: string;
  issueId: string;
  summary: string;
}): { ok: true; issue: DiagnosisIssue } | IssueQueueFailure {
  const store = readStore(input.configDir, input.tenantId);
  const issue = store.issues.find((row) => row.issueId === input.issueId);
  if (!issue || issue.kind !== DIAGNOSIS_ISSUE_KIND) {
    return { ok: false, reason: "issue_not_found" };
  }
  if (issue.tenantId !== input.tenantId) {
    return { ok: false, reason: "cross_tenant" };
  }
  issue.rootCause = {
    summary: input.summary.trim() || rootCauseSummary(issue),
    ruleVersion: DIAGNOSIS_ISSUE_RULE_VERSION,
    source: "evaluation",
  };
  if (issue.state === "open") {
    issue.state = "triaged";
  }
  writeStore(input.configDir, input.tenantId, store);
  return { ok: true, issue };
}

function rootCauseSummary(issue: DiagnosisIssue): string {
  const first = issue.evaluationRefs[0];
  const attribution = first?.failureAttribution ?? "unknown";
  const correctness = first?.correctness ?? "unassessed";
  return `evaluation ${attribution} / ${correctness}`;
}

export function prescribeDiagnosisIssue(input: {
  tenantId: string;
  configDir: string;
  issueId: string;
  assessment: DiagnoseGrowthAssessment;
  professionalReportId: string;
  confirmable: boolean;
  authorizationRef?: string | null;
  nowMs?: number;
}): { ok: true; issue: DiagnosisIssue; prescription: EvolutionPrescription } | IssueQueueFailure {
  const store = readStore(input.configDir, input.tenantId);
  const issue = store.issues.find((row) => row.issueId === input.issueId);
  if (!issue) {
    return { ok: false, reason: "issue_not_found" };
  }
  if (issue.tenantId !== input.tenantId || input.assessment.tenantId !== input.tenantId) {
    return { ok: false, reason: "cross_tenant" };
  }
  const [prescription] = buildDiagnoseEvolutionPrescriptions({
    assessment: input.assessment,
    professionalReportId: input.professionalReportId,
    authorizationRef: input.authorizationRef ?? null,
    confirmable: input.confirmable,
    nowMs: input.nowMs,
    configDir: input.configDir,
  });
  if (!prescription?.prescriptionContentHash) {
    return { ok: false, reason: "prescription_unavailable", issue };
  }
  issue.prescriptionId = prescription.prescriptionId;
  issue.prescriptionContentHash = prescription.prescriptionContentHash;
  issue.state = "prescribed";
  writeStore(input.configDir, input.tenantId, store);
  return { ok: true, issue, prescription };
}

export async function confirmDiagnosisIssue(input: {
  tenantId: string;
  configDir: string;
  issueId: string;
  professionalReportId: string;
  callerUserId: string;
  prescriptionContentHash: string;
  enabled?: boolean;
  nowMs?: number;
  cron: EvolutionCronPort;
  inspectGrant?: PrescriptionGrantInspector;
}): Promise<{ ok: true; issue: DiagnosisIssue; jobId: string } | IssueQueueFailure> {
  const store = readStore(input.configDir, input.tenantId);
  const issue = store.issues.find((row) => row.issueId === input.issueId);
  if (!issue) {
    return { ok: false, reason: "issue_not_found" };
  }
  if (issue.tenantId !== input.tenantId) {
    return { ok: false, reason: "cross_tenant" };
  }
  if (input.enabled !== true) {
    return { ok: false, reason: "confirm_not_enabled", issue };
  }
  if (!issue.prescriptionId || !issue.prescriptionContentHash) {
    return { ok: false, reason: "prescription_required", issue };
  }
  if (input.prescriptionContentHash.trim() !== issue.prescriptionContentHash) {
    return { ok: false, reason: "prescription_hash_mismatch", issue };
  }
  const result = await confirmDiagnoseEvolutionPrescription({
    prescriptionId: issue.prescriptionId,
    tenantId: input.tenantId,
    professionalReportId: input.professionalReportId,
    callerUserId: input.callerUserId,
    prescriptionContentHash: input.prescriptionContentHash,
    enabled: true,
    nowMs: input.nowMs,
    configDir: input.configDir,
    cron: input.cron,
    ...(input.inspectGrant ? { inspectGrant: input.inspectGrant } : {}),
  });
  if (!result.ok) {
    return { ok: false, reason: result.reason, issue };
  }
  issue.state = "applied";
  issue.evolutionJobId = result.jobId;
  writeStore(input.configDir, input.tenantId, store);
  return { ok: true, issue, jobId: result.jobId };
}

export function recheckDiagnosisIssue(input: {
  tenantId: string;
  configDir: string;
  issueId: string;
  nowMs?: number;
  outcome?: "pass" | "fail";
}): { ok: true; issue: DiagnosisIssue } | IssueQueueFailure {
  const store = readStore(input.configDir, input.tenantId);
  const issue = store.issues.find((row) => row.issueId === input.issueId);
  if (!issue) {
    return { ok: false, reason: "issue_not_found" };
  }
  if (issue.state !== "applied" || !issue.evolutionJobId) {
    return { ok: false, reason: "not_applied", issue };
  }
  const prescription = issue.prescriptionId
    ? readEvolutionPrescription(input.tenantId, issue.prescriptionId, input.configDir)
    : null;
  if (!prescription || prescription.state !== "APPLIED") {
    return { ok: false, reason: "not_applied", issue };
  }
  const outcome = input.outcome ?? "pass";
  issue.recheck = {
    outcome,
    at: new Date(input.nowMs ?? Date.now()).toISOString(),
  };
  if (outcome === "fail") {
    writeStore(input.configDir, input.tenantId, store);
    return { ok: false, reason: "recheck_failed", issue };
  }
  issue.state = "rechecked";
  writeStore(input.configDir, input.tenantId, store);
  return { ok: true, issue };
}

export function writebackDiagnosisIssue(input: {
  tenantId: string;
  configDir: string;
  issueId: string;
  nowMs?: number;
}): { ok: true; issue: DiagnosisIssue } | IssueQueueFailure {
  const store = readStore(input.configDir, input.tenantId);
  const issue = store.issues.find((row) => row.issueId === input.issueId);
  if (!issue) {
    return { ok: false, reason: "issue_not_found" };
  }
  if (issue.state !== "rechecked" || !issue.evolutionJobId || !issue.prescriptionContentHash) {
    return { ok: false, reason: "recheck_required", issue };
  }
  issue.writeback = {
    at: new Date(input.nowMs ?? Date.now()).toISOString(),
    prescriptionContentHash: issue.prescriptionContentHash,
    evolutionJobId: issue.evolutionJobId,
    summary: "recheck passed; no config, route, or skill mutation",
  };
  issue.state = "closed";
  writeStore(input.configDir, input.tenantId, store);
  return { ok: true, issue };
}

export type DiagnosisIssuePipelineResult = {
  ok: true;
  issue: DiagnosisIssue;
  applied: boolean;
  stoppedAt: DiagnosisIssueState | "confirm_not_enabled";
  trace: string[];
  jobId?: string;
};

export async function runDiagnosisIssuePipeline(input: {
  tenantId: string;
  configDir: string;
  evaluations: readonly DiagnosisIssueEvaluationRef[];
  findingRefs?: readonly string[];
  assessment: DiagnoseGrowthAssessment;
  professionalReportId: string;
  callerUserId: string;
  cron: EvolutionCronPort;
  enabled?: boolean;
  nowMs?: number;
  authorizationRef?: string | null;
  inspectGrant?: PrescriptionGrantInspector;
}): Promise<DiagnosisIssuePipelineResult | IssueQueueFailure> {
  const trace = ["evaluation"];
  const opened = openDiagnosisIssue({
    tenantId: input.tenantId,
    configDir: input.configDir,
    evaluations: input.evaluations,
    findingRefs: input.findingRefs,
  });
  if (!opened.ok) {
    return opened;
  }
  trace.push("issue");
  const triaged = attachDiagnosisRootCause({
    tenantId: input.tenantId,
    configDir: input.configDir,
    issueId: opened.issue.issueId,
    summary: rootCauseSummary(opened.issue),
  });
  if (!triaged.ok) {
    return triaged;
  }
  trace.push("root-cause");
  const enabled = input.enabled === true;
  const prescribed = prescribeDiagnosisIssue({
    tenantId: input.tenantId,
    configDir: input.configDir,
    issueId: opened.issue.issueId,
    assessment: input.assessment,
    professionalReportId: input.professionalReportId,
    confirmable: enabled,
    authorizationRef: input.authorizationRef ?? null,
    nowMs: input.nowMs,
  });
  if (!prescribed.ok) {
    return prescribed;
  }
  trace.push("prescription");
  if (!enabled) {
    const confirmed = await confirmDiagnosisIssue({
      tenantId: input.tenantId,
      configDir: input.configDir,
      issueId: opened.issue.issueId,
      professionalReportId: input.professionalReportId,
      callerUserId: input.callerUserId,
      prescriptionContentHash: prescribed.prescription.prescriptionContentHash ?? "",
      enabled: false,
      nowMs: input.nowMs,
      cron: input.cron,
    });
    return {
      ok: true,
      issue: confirmed.issue ?? prescribed.issue,
      applied: false,
      stoppedAt: "confirm_not_enabled",
      trace,
    };
  }
  const confirmed = await confirmDiagnosisIssue({
    tenantId: input.tenantId,
    configDir: input.configDir,
    issueId: opened.issue.issueId,
    professionalReportId: input.professionalReportId,
    callerUserId: input.callerUserId,
    prescriptionContentHash: prescribed.prescription.prescriptionContentHash ?? "",
    enabled: true,
    nowMs: input.nowMs,
    cron: input.cron,
    ...(input.inspectGrant ? { inspectGrant: input.inspectGrant } : {}),
  });
  if (!confirmed.ok) {
    return confirmed;
  }
  trace.push("confirmed", "applied");
  const rechecked = recheckDiagnosisIssue({
    tenantId: input.tenantId,
    configDir: input.configDir,
    issueId: opened.issue.issueId,
    nowMs: input.nowMs,
  });
  if (!rechecked.ok) {
    return rechecked;
  }
  trace.push("recheck");
  const written = writebackDiagnosisIssue({
    tenantId: input.tenantId,
    configDir: input.configDir,
    issueId: opened.issue.issueId,
    nowMs: input.nowMs,
  });
  if (!written.ok) {
    return written;
  }
  trace.push("writeback");
  return {
    ok: true,
    issue: written.issue,
    applied: true,
    stoppedAt: "closed",
    trace,
    jobId: confirmed.jobId,
  };
}

export function transitionOpsQueue(input: {
  tenantId: string;
  configDir: string;
  targetKind: string;
  targetId: string;
}): { ok: false; reason: "finding_not_queue" } | { ok: true; issue: DiagnosisIssue } {
  if (input.targetKind !== DIAGNOSIS_ISSUE_KIND) {
    return { ok: false, reason: "finding_not_queue" };
  }
  const store = readStore(input.configDir, input.tenantId);
  const finding = store.findings.find((row) => row.findingId === input.targetId);
  if (finding) {
    return { ok: false, reason: "finding_not_queue" };
  }
  const issue = store.issues.find((row) => row.issueId === input.targetId);
  if (!issue || issue.kind !== DIAGNOSIS_ISSUE_KIND) {
    return { ok: false, reason: "finding_not_queue" };
  }
  return { ok: true, issue };
}
