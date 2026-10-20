import crypto from "node:crypto";
import { toSummaryAgentStatus, type HealthReport } from "./health-report.js";

const REDACTED = "redacted";
const ABSOLUTE_PATH_STRING = /^([A-Za-z]:[\\/]|\/)/;

function redactString(value: string): string {
  return ABSOLUTE_PATH_STRING.test(value) ? REDACTED : value;
}

function redactChangedPaths(paths: string[] | undefined): string[] | undefined {
  if (!paths || paths.length === 0) {
    return undefined;
  }
  return paths.map(() => REDACTED);
}

function redactRecord(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = redactUnknown(entry);
  }
  return out;
}

function redactUnknown(value: unknown): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactUnknown(entry));
  }
  if (value && typeof value === "object") {
    return redactRecord(value as Record<string, unknown>);
  }
  return value;
}

export function sha256Utf8(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function collectAbsolutePathStrings(value: unknown): string[] {
  const found: string[] = [];
  const walk = (entry: unknown) => {
    if (typeof entry === "string") {
      if (ABSOLUTE_PATH_STRING.test(entry)) {
        found.push(entry);
      }
      return;
    }
    if (Array.isArray(entry)) {
      for (const child of entry) {
        walk(child);
      }
      return;
    }
    if (entry && typeof entry === "object") {
      for (const child of Object.values(entry)) {
        walk(child);
      }
    }
  };
  walk(value);
  return found;
}

export function assertNoAbsolutePathLeak(value: unknown): void {
  const leaked = collectAbsolutePathStrings(value);
  if (leaked.length > 0) {
    throw new Error(`redacted health report still contains absolute paths (${leaked.length})`);
  }
}

/**
 * Archive-safe HealthReport: strip workspace/index/runtime/transcript paths.
 * Fail closed if any absolute path string remains.
 */
export function redactHealthReportForArchive(report: HealthReport): HealthReport {
  let redacted: HealthReport;
  if (report.status === "denied") {
    redacted = { ...report };
  } else if (report.status === "invalid") {
    redacted = {
      ...report,
      reason: redactString(report.reason),
      probeIntegrity: report.probeIntegrity
        ? {
            ...report.probeIntegrity,
            changedPaths: redactChangedPaths(report.probeIntegrity.changedPaths),
          }
        : undefined,
    };
  } else if (report.reportKind === "summary") {
    redacted = {
      ...report,
      agents: report.agents.map((agent) => ({
        ...agent,
        reason: redactString(agent.reason),
      })),
      groups: report.groups?.map((group) => ({ ...group })),
    };
  } else {
    redacted = {
      ...report,
      runtime: {
        stateDir: REDACTED,
        ...(report.runtime.tenantsRoot === undefined
          ? {}
          : { tenantsRoot: report.runtime.tenantsRoot == null ? null : REDACTED }),
      },
      agents: report.agents.map((agent) => ({
        ...toSummaryAgentStatus(agent),
        workspaceFingerprint: agent.workspaceFingerprint,
        sqliteInstanceId: agent.sqliteInstanceId,
        sidecarFingerprintCount: agent.sidecarFingerprintCount,
        guardIndexStatus: agent.guardIndexStatus,
        guardReason: agent.guardReason,
        lastSyncAt: agent.lastSyncAt,
        lastRebuildAt: agent.lastRebuildAt,
        reason: redactString(agent.reason),
      })),
      groups: report.groups.map((group) => ({
        groupId: group.groupId,
        memoryMdCount: group.memoryMdCount,
        mirrorDivergence: group.mirrorDivergence,
      })),
      probeIntegrity: {
        ...report.probeIntegrity,
        changedPaths: redactChangedPaths(report.probeIntegrity.changedPaths),
      },
    } as HealthReport;
  }

  const scanned = redactUnknown(redacted);
  assertNoAbsolutePathLeak(scanned);
  return scanned as HealthReport;
}
