import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { diagnose } from "./diagnose.js";
import { loadGoldenDiagnosticRunGraph as loadGraph } from "./fixture-graph.js";
import { createProductionCompositeReportReader } from "./report-query-production-adapters.js";
import {
  buildCompositeDiagnosisReportFromDiagnoseOutput,
  createFileProjectionAuthoritySource,
  persistCompositeDiagnosisProjectionSnapshot,
  projectionSnapshotPath,
  resolveDiagnosisProjectionsDir,
} from "./report-query-projection-snapshot.js";
import { stripRunCompletion } from "./runner.js";
import type { TrustedTenantContext } from "./types.js";

const TRUSTED: TrustedTenantContext = { tenantId: "tenant-fixture-a" };
const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("composite diagnosis projection snapshots", () => {
  it("persists validated reports under tenant-scoped directories", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "diag-proj-"));
    tmpDirs.push(root);
    const output = await diagnose({
      schemaVersion: 1,
      run: stripRunCompletion(loadGraph("agent-not-started.json").run),
      evidences: loadGraph("agent-not-started.json").evidences,
      trusted: TRUSTED,
    });
    const report = buildCompositeDiagnosisReportFromDiagnoseOutput(output, TRUSTED, {
      generatedAt: "2026-09-08T06:00:00.000Z",
    });
    const persisted = persistCompositeDiagnosisProjectionSnapshot(report, TRUSTED, {
      rootDir: root,
    });
    expect(fs.existsSync(persisted.filePath)).toBe(true);
    expect(persisted.filePath).toBe(
      projectionSnapshotPath(root, TRUSTED.tenantId, report.reportId),
    );
    const foreignDir = path.join(root, "tenant-fixture-b");
    expect(fs.existsSync(foreignDir)).toBe(false);
  });

  it("returns empty list for missing directories without throwing", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "diag-proj-missing-"));
    tmpDirs.push(root);
    const source = createFileProjectionAuthoritySource(root);
    await expect(source.list({ tenantId: TRUSTED.tenantId, mode: "report" })).resolves.toEqual([]);
  });

  it("drops schema-incompatible rows and enforces tenant isolation", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "diag-proj-filter-"));
    tmpDirs.push(root);
    const output = await diagnose({
      schemaVersion: 1,
      run: stripRunCompletion(loadGraph("agent-not-started.json").run),
      evidences: loadGraph("agent-not-started.json").evidences,
      trusted: TRUSTED,
    });
    const report = buildCompositeDiagnosisReportFromDiagnoseOutput(output, TRUSTED, {
      generatedAt: "2026-09-08T06:05:00.000Z",
    });
    persistCompositeDiagnosisProjectionSnapshot(report, TRUSTED, { rootDir: root });
    const badDir = path.join(root, TRUSTED.tenantId ?? "_local");
    fs.writeFileSync(path.join(badDir, "bad.json"), JSON.stringify({ schemaVersion: 2 }), "utf8");

    const reader = createProductionCompositeReportReader(
      createFileProjectionAuthoritySource(root),
      {
        trustedTenantId: TRUSTED.tenantId,
        maxAgeMs: 7 * 24 * 60 * 60 * 1000,
        now: () => Date.parse("2026-09-08T07:00:00.000Z"),
      },
    );
    const rows = await reader.list({ tenantId: TRUSTED.tenantId, mode: "report" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({ reportId: report.reportId }));

    const foreign = await reader.list({ tenantId: "tenant-fixture-b", mode: "report" });
    expect(foreign).toEqual([]);
  });

  it("keeps persistCompositeDiagnosisProjectionSnapshot as the only persist callsite", () => {
    const diagnoseSource = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "diagnose.ts"),
      "utf8",
    );
    expect(diagnoseSource).toContain("persistCompositeDiagnosisProjectionSnapshot");
    const repoDiagnosisDir = path.dirname(fileURLToPath(import.meta.url));
    const offenders: string[] = [];
    for (const file of fs.readdirSync(repoDiagnosisDir)) {
      if (
        !file.endsWith(".ts") ||
        file.endsWith(".test.ts") ||
        file === "report-query-projection-snapshot.ts"
      ) {
        continue;
      }
      const body = fs.readFileSync(path.join(repoDiagnosisDir, file), "utf8");
      if (body.includes("persistCompositeDiagnosisProjectionSnapshot(")) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual(["diagnose.ts"]);
    expect(resolveDiagnosisProjectionsDir).toBeTypeOf("function");
  });
});
