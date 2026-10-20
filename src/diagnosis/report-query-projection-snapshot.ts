/**
 * P26.5 — composite diagnosis projection snapshot persist/read.
 * Single write point: diagnose() → persistCompositeDiagnosisProjectionSnapshot.
 * Not a Report DB. kind=composite_diagnosis_projection_snapshot.
 */
import fs from "node:fs";
import path from "node:path";
import { loadJsonFile } from "../infra/json-file.js";
import { CONFIG_DIR } from "../utils.js";
import { aggregateCrossTargetCases, type CrossTargetSlice } from "./cross-target.js";
import type { DiagnoseOutput } from "./diagnose.js";
import type { ProductionReportAuthoritySource } from "./report-query-production-adapters.js";
import { DIAGNOSIS_PRODUCTION_REPORT_SOURCE_KIND } from "./report-query-production-config.js";
import type { ReportReaderFilter } from "./report-query.js";
import {
  exportCompositeDiagnosisReportJson,
  validateCompositeDiagnosisReport,
} from "./report-validate.js";
import {
  buildCompositeDiagnosisReport,
  type CompositeDiagnosisReport,
  type CompositeDiagnosisReportOptions,
} from "./report.js";
import { DiagnosisContractError, type TrustedTenantContext } from "./types.js";

export const COMPOSITE_DIAGNOSIS_PROJECTION_SNAPSHOT_KIND = DIAGNOSIS_PRODUCTION_REPORT_SOURCE_KIND;

export const DIAGNOSIS_PROJECTION_SNAPSHOT_LOCATOR = "$CONFIG_DIR/diagnosis-projections/" as const;

const LOCAL_TENANT_DIR = "_local";

export function resolveDiagnosisProjectionsDir(configDir: string = CONFIG_DIR): string {
  return path.join(configDir, "diagnosis-projections");
}

export function buildCrossTargetSliceFromDiagnoseOutput(
  output: DiagnoseOutput,
  trusted: TrustedTenantContext,
): CrossTargetSlice {
  const sessionKeyHash =
    output.run.targets.find((target) => target.scope.sessionKeyHash)?.scope.sessionKeyHash ?? "";
  if (!sessionKeyHash) {
    throw new DiagnosisContractError(
      "session_key_required",
      "diagnose output requires sessionKeyHash on at least one target",
      "sessionKeyHash",
    );
  }
  const tenantId = trusted.tenantId ?? output.run.requestedBy.tenantId ?? null;
  const normalizedEvidences = output.collected.map((evidence) => ({
    ...evidence,
    target: {
      ...evidence.target,
      tenantId: evidence.target.tenantId ?? tenantId,
      scope: {
        ...evidence.target.scope,
        sessionKeyHash,
      },
    },
  }));
  return {
    runId: output.run.runId,
    tenantId,
    sessionKeyHash,
    targets: [...output.run.targets],
    evidences: normalizedEvidences,
    relations: [],
    missingEvidence: [...output.missing],
    completion: output.run.completion ?? "INCONCLUSIVE",
  };
}

export function buildCompositeDiagnosisReportFromDiagnoseOutput(
  output: DiagnoseOutput,
  trusted: TrustedTenantContext,
  options: CompositeDiagnosisReportOptions = {},
): CompositeDiagnosisReport {
  const diagnosis = aggregateCrossTargetCases([
    buildCrossTargetSliceFromDiagnoseOutput(output, trusted),
  ]);
  return buildCompositeDiagnosisReport(diagnosis, trusted, options);
}

export function encodeProjectionSnapshotFilename(reportId: string): string {
  return `${reportId.replaceAll(":", "_")}.json`;
}

export function decodeProjectionSnapshotFilename(filename: string): string | null {
  if (!filename.endsWith(".json")) {
    return null;
  }
  const stem = filename.slice(0, -".json".length);
  if (!stem.startsWith("cdr-")) {
    return null;
  }
  return stem.replace(/_(\d{4}-\d{2}-\d{2}T\d{2})_(\d{2})_(\d{2})/, "$1:$2:$3");
}

export function projectionSnapshotPath(
  rootDir: string,
  tenantId: string | null,
  reportId: string,
): string {
  const tenantDir = tenantId ?? LOCAL_TENANT_DIR;
  return path.join(rootDir, tenantDir, encodeProjectionSnapshotFilename(reportId));
}

export function persistCompositeDiagnosisProjectionSnapshot(
  report: CompositeDiagnosisReport,
  trusted: TrustedTenantContext,
  options: { rootDir?: string } = {},
): { reportId: string; filePath: string } {
  const validated = validateCompositeDiagnosisReport(report, trusted);
  const json = exportCompositeDiagnosisReportJson(validated, trusted);
  const rootDir = options.rootDir ?? resolveDiagnosisProjectionsDir();
  const tenantDir = path.join(rootDir, validated.tenantId ?? LOCAL_TENANT_DIR);
  fs.mkdirSync(tenantDir, { recursive: true });
  const filePath = path.join(tenantDir, encodeProjectionSnapshotFilename(validated.reportId));
  fs.writeFileSync(filePath, json, "utf8");
  return { reportId: validated.reportId, filePath };
}

function listTenantSnapshotFiles(rootDir: string, tenantId: string | null): string[] {
  const tenantDir = path.join(rootDir, tenantId ?? LOCAL_TENANT_DIR);
  if (!fs.existsSync(tenantDir) || !fs.statSync(tenantDir).isDirectory()) {
    return [];
  }
  return fs
    .readdirSync(tenantDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(tenantDir, name));
}

function matchesFilter(row: Record<string, unknown>, filter: ReportReaderFilter): boolean {
  if (filter.reportId && row.reportId !== filter.reportId) {
    return false;
  }
  if (filter.caseId) {
    const cases = Array.isArray(row.cases) ? row.cases : [];
    if (!cases.some((item) => isRecord(item) && item.caseId === filter.caseId)) {
      return false;
    }
  }
  if (filter.sessionKeyHash) {
    const cases = Array.isArray(row.cases) ? row.cases : [];
    if (!cases.some((item) => isRecord(item) && item.sessionKeyHash === filter.sessionKeyHash)) {
      return false;
    }
  }
  return true;
}

export function createFileProjectionAuthoritySource(
  rootDir: string = resolveDiagnosisProjectionsDir(),
): ProductionReportAuthoritySource {
  return {
    async list(filter) {
      if (!fs.existsSync(rootDir)) {
        return [];
      }
      const files = listTenantSnapshotFiles(rootDir, filter.tenantId);
      const rows: unknown[] = [];
      for (const filePath of files) {
        const row = loadJsonFile(filePath);
        if (row && isRecord(row) && matchesFilter(row, filter)) {
          rows.push(row);
        }
      }
      return rows;
    },
    async get(reportId) {
      if (!fs.existsSync(rootDir)) {
        return undefined;
      }
      const direct = projectionSnapshotPath(rootDir, null, reportId);
      if (fs.existsSync(direct)) {
        return loadJsonFile(direct);
      }
      const tenantDirs = fs.readdirSync(rootDir, { withFileTypes: true });
      for (const entry of tenantDirs) {
        if (!entry.isDirectory()) {
          continue;
        }
        const candidate = path.join(
          rootDir,
          entry.name,
          encodeProjectionSnapshotFilename(reportId),
        );
        if (fs.existsSync(candidate)) {
          return loadJsonFile(candidate);
        }
      }
      return undefined;
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
