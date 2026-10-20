/**
 * Per-tenant diagnosis schedule records. Tick/daily cadence only.
 * Does not enable Da Bai delivery or remediation.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../utils.js";
import {
  DIAGNOSIS_ALL_TARGET_CAP,
  parseDiagnoseRequest,
  type DiagnosisLocator,
  type DiagnosisScheduleCadence,
  type ParsedDiagnoseRequest,
} from "./diagnose-policy.js";

export type DiagnosisScheduleRecord = {
  tenantId: string;
  scope: "target" | "all";
  window: ParsedDiagnoseRequest["windowId"];
  mode: ParsedDiagnoseRequest["mode"];
  cadence: Exclude<DiagnosisScheduleCadence, "off">;
  locators: DiagnosisLocator[];
  deliverTo: ParsedDiagnoseRequest["deliverTo"];
  updatedAt: string;
  lastRunAt: string | null;
};

export function diagnosisSchedulesDir(configDir: string = CONFIG_DIR): string {
  return path.join(configDir, "diagnosis-schedules");
}

function schedulePath(tenantId: string, configDir: string): string {
  const digest = createHash("sha256").update(tenantId).digest("hex").slice(0, 16);
  return path.join(diagnosisSchedulesDir(configDir), `${digest}.json`);
}

export function upsertDiagnosisSchedule(input: {
  tenantId: string;
  request: ParsedDiagnoseRequest;
  now?: number;
  configDir?: string;
}): DiagnosisScheduleRecord | null {
  if (input.request.cadence === "off") {
    deleteDiagnosisSchedule(input.tenantId, input.configDir);
    return null;
  }
  const configDir = input.configDir ?? CONFIG_DIR;
  fs.mkdirSync(diagnosisSchedulesDir(configDir), { recursive: true });
  const existing = readDiagnosisSchedule(input.tenantId, configDir);
  const record: DiagnosisScheduleRecord = {
    tenantId: input.tenantId,
    scope: input.request.scope,
    window: input.request.windowId,
    mode: input.request.mode,
    cadence: input.request.cadence,
    locators: input.request.locators.slice(0, DIAGNOSIS_ALL_TARGET_CAP),
    deliverTo: input.request.deliverTo,
    updatedAt: new Date(input.now ?? Date.now()).toISOString(),
    lastRunAt: existing?.lastRunAt ?? null,
  };
  fs.writeFileSync(schedulePath(input.tenantId, configDir), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

export function deleteDiagnosisSchedule(tenantId: string, configDir: string = CONFIG_DIR): void {
  const filePath = schedulePath(tenantId, configDir);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

export function readDiagnosisSchedule(
  tenantId: string,
  configDir: string = CONFIG_DIR,
): DiagnosisScheduleRecord | null {
  const filePath = schedulePath(tenantId, configDir);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as DiagnosisScheduleRecord;
    if (parsed.tenantId !== tenantId) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function listDueDiagnosisSchedules(input: {
  now?: number;
  configDir?: string;
}): DiagnosisScheduleRecord[] {
  const configDir = input.configDir ?? CONFIG_DIR;
  const dir = diagnosisSchedulesDir(configDir);
  if (!fs.existsSync(dir)) {
    return [];
  }
  const now = input.now ?? Date.now();
  const due: DiagnosisScheduleRecord[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      const parsed = JSON.parse(
        fs.readFileSync(path.join(dir, name), "utf8"),
      ) as DiagnosisScheduleRecord;
      if (!parsed.tenantId || (parsed.cadence !== "tick" && parsed.cadence !== "daily")) {
        continue;
      }
      if (parsed.cadence === "tick") {
        due.push(parsed);
        continue;
      }
      if (parsed.cadence === "daily" && !sameUtcDay(parsed.lastRunAt, now)) {
        due.push(parsed);
      }
    } catch {
      // skip corrupt schedule files
    }
  }
  return due;
}

export function markDiagnosisScheduleRun(input: {
  tenantId: string;
  now?: number;
  configDir?: string;
}): void {
  const configDir = input.configDir ?? CONFIG_DIR;
  const current = readDiagnosisSchedule(input.tenantId, configDir);
  if (!current) {
    return;
  }
  current.lastRunAt = new Date(input.now ?? Date.now()).toISOString();
  fs.writeFileSync(
    schedulePath(input.tenantId, configDir),
    `${JSON.stringify(current, null, 2)}\n`,
  );
}

/** Explicit cadence write. diagnosis.diagnose must not call this. */
export function applyDiagnosisSchedule(input: {
  tenantId: string;
  request: ParsedDiagnoseRequest;
  now?: number;
  configDir?: string;
}): DiagnosisScheduleRecord | null {
  return upsertDiagnosisSchedule(input);
}

export function requestFromSchedule(record: DiagnosisScheduleRecord): ParsedDiagnoseRequest {
  return parseDiagnoseRequest({
    scope: record.scope,
    window: record.window,
    mode: record.mode,
    cadence: record.cadence,
    deliverTo: record.deliverTo,
    targets: record.locators,
  });
}

function sameUtcDay(iso: string | null, nowMs: number): boolean {
  if (!iso) {
    return false;
  }
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return false;
  }
  return new Date(then).toISOString().slice(0, 10) === new Date(nowMs).toISOString().slice(0, 10);
}
