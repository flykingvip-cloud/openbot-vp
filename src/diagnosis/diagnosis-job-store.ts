/**
 * Per-tenant Diagnosis Job files.
 *
 * Layout (one default definition, capped runs):
 *   $CONFIG_DIR/diagnosis-jobs/<tenantHash16>/definition.json
 *   $CONFIG_DIR/diagnosis-jobs/<tenantHash16>/binding.json
 *   $CONFIG_DIR/diagnosis-jobs/<tenantHash16>/runs/<runId>.json
 *   $CONFIG_DIR/diagnosis-jobs/<tenantHash16>/reports/<reportId>.json
 *
 * Verified against diagnose-schedule.ts: the live schedule stays one JSON per
 * tenant under diagnosis-schedules/. This store does not write that directory,
 * conversation-evaluations, projections, or evolution prescriptions.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  DIAGNOSIS_JOB_BINDING_KIND,
  DIAGNOSIS_JOB_DEFINITION_KIND,
  DIAGNOSIS_JOB_FORBIDDEN_WRITE_DIRS,
  DIAGNOSIS_JOB_REPORT_KIND,
  DIAGNOSIS_JOB_RUN_KIND,
  DIAGNOSIS_JOBS_DIR,
  type DiagnosisJobCompositeReport,
  type DiagnosisJobDefinition,
  type DiagnosisJobRun,
  type DiagnosisScheduleBinding,
} from "./diagnosis-job-model.js";

const SAFE_ID = /^[A-Za-z0-9_-]{8,80}$/;

export function diagnosisJobTenantHash16(tenantId: string): string {
  return createHash("sha256").update(tenantId).digest("hex").slice(0, 16);
}

export function diagnosisJobsRoot(configDir: string): string {
  return path.join(configDir, DIAGNOSIS_JOBS_DIR);
}

export function assertDiagnosisJobWritePath(filePath: string): void {
  const parts = filePath.split(/[/\\]/);
  if (!parts.includes(DIAGNOSIS_JOBS_DIR)) {
    throw new Error("diagnosis job write must stay under diagnosis-jobs");
  }
  for (const forbidden of DIAGNOSIS_JOB_FORBIDDEN_WRITE_DIRS) {
    if (parts.includes(forbidden)) {
      throw new Error(`diagnosis job refused path segment ${forbidden}`);
    }
  }
}

export function readDiagnosisJobDefinition(
  tenantId: string,
  configDir: string,
): DiagnosisJobDefinition | null {
  return readKind(
    definitionPath(tenantId, configDir),
    DIAGNOSIS_JOB_DEFINITION_KIND,
    tenantId,
  ) as DiagnosisJobDefinition | null;
}

export function writeDiagnosisJobDefinition(
  record: DiagnosisJobDefinition,
  configDir: string,
): void {
  writeJson(definitionPath(record.tenantId, configDir), record);
}

export function readDiagnosisScheduleBinding(
  tenantId: string,
  configDir: string,
): DiagnosisScheduleBinding | null | "corrupt" {
  const filePath = bindingPath(tenantId, configDir);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const parsed = readKind(filePath, DIAGNOSIS_JOB_BINDING_KIND, tenantId);
  if (!parsed) {
    return "corrupt";
  }
  return parsed as DiagnosisScheduleBinding;
}

export function writeDiagnosisScheduleBinding(
  record: DiagnosisScheduleBinding,
  configDir: string,
): void {
  writeJson(bindingPath(record.tenantId, configDir), record);
}

export function isDiagnosisJobPaused(tenantId: string, configDir: string): boolean {
  const binding = readDiagnosisScheduleBinding(tenantId, configDir);
  if (binding === "corrupt") {
    return true;
  }
  return binding?.paused === true;
}

export function listDiagnosisJobRuns(tenantId: string, configDir: string): DiagnosisJobRun[] {
  const dir = runsDir(tenantId, configDir);
  if (!fs.existsSync(dir)) {
    return [];
  }
  const runs: DiagnosisJobRun[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const parsed = readKind(path.join(dir, name), DIAGNOSIS_JOB_RUN_KIND, tenantId);
    if (parsed) {
      runs.push(parsed as DiagnosisJobRun);
    }
  }
  runs.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.runId.localeCompare(b.runId));
  return runs;
}

export function readDiagnosisJobRun(
  tenantId: string,
  runId: string,
  configDir: string,
): DiagnosisJobRun | null {
  const filePath = runPath(tenantId, runId, configDir);
  if (!filePath) {
    return null;
  }
  return readKind(filePath, DIAGNOSIS_JOB_RUN_KIND, tenantId) as DiagnosisJobRun | null;
}

export function writeDiagnosisJobRun(record: DiagnosisJobRun, configDir: string): void {
  const filePath = runPath(record.tenantId, record.runId, configDir);
  if (!filePath) {
    throw new Error("diagnosis job run id rejected");
  }
  writeJson(filePath, record);
}

export function deleteDiagnosisJobRun(tenantId: string, runId: string, configDir: string): void {
  unlinkGuarded(runPath(tenantId, runId, configDir));
}

export function unlinkDiagnosisJobReport(
  tenantId: string,
  reportId: string,
  configDir: string,
): void {
  unlinkGuarded(reportPath(tenantId, reportId, configDir));
}

export function readDiagnosisJobReport(
  tenantId: string,
  reportId: string,
  configDir: string,
): DiagnosisJobCompositeReport | null {
  const filePath = reportPath(tenantId, reportId, configDir);
  if (!filePath) {
    return null;
  }
  return readKind(
    filePath,
    DIAGNOSIS_JOB_REPORT_KIND,
    tenantId,
  ) as DiagnosisJobCompositeReport | null;
}

export function writeDiagnosisJobReport(
  record: DiagnosisJobCompositeReport,
  configDir: string,
): void {
  const filePath = reportPath(record.tenantId, record.reportId, configDir);
  if (!filePath) {
    throw new Error("diagnosis job report id rejected");
  }
  writeJson(filePath, record);
}

function definitionPath(tenantId: string, configDir: string): string {
  return path.join(tenantDir(tenantId, configDir), "definition.json");
}

function bindingPath(tenantId: string, configDir: string): string {
  return path.join(tenantDir(tenantId, configDir), "binding.json");
}

function runsDir(tenantId: string, configDir: string): string {
  return path.join(tenantDir(tenantId, configDir), "runs");
}

function reportsDir(tenantId: string, configDir: string): string {
  return path.join(tenantDir(tenantId, configDir), "reports");
}

function tenantDir(tenantId: string, configDir: string): string {
  return path.join(diagnosisJobsRoot(configDir), diagnosisJobTenantHash16(tenantId));
}

function runPath(tenantId: string, runId: string, configDir: string): string | null {
  if (!SAFE_ID.test(runId)) {
    return null;
  }
  return path.join(runsDir(tenantId, configDir), `${runId}.json`);
}

function reportPath(tenantId: string, reportId: string, configDir: string): string | null {
  if (!SAFE_ID.test(reportId)) {
    return null;
  }
  return path.join(reportsDir(tenantId, configDir), `${reportId}.json`);
}

function readKind(
  filePath: string,
  kind: string,
  tenantId: string,
): Record<string, unknown> | null {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    return null;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
    if (parsed.kind !== kind || parsed.tenantId !== tenantId) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function unlinkGuarded(filePath: string | null): void {
  if (!filePath || !fs.existsSync(filePath)) {
    return;
  }
  assertDiagnosisJobWritePath(filePath);
  if (fs.lstatSync(filePath).isSymbolicLink()) {
    return;
  }
  fs.unlinkSync(filePath);
}

function writeJson(filePath: string, value: unknown): void {
  assertDiagnosisJobWritePath(filePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, filePath);
}
