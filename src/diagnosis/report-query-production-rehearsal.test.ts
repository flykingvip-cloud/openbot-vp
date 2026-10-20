import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { coreGatewayHandlers } from "../gateway/server-methods.js";
import { GATEWAY_METHOD_PACK_MANIFEST } from "../gateway/server-methods/packs/manifest.js";
import { GATEWAY_METHOD_PACKS } from "../gateway/server-methods/packs/registry.js";
import { DIAGNOSIS_REPORT_API_DEPLOYED } from "./report-query-deploy.js";
import { DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED } from "./report-query-production-adapters.js";
import { parseDiagnosisProductionAdapterConfig } from "./report-query-production-config.js";
import {
  DIAGNOSIS_LIVE_PACK_ID,
  DIAGNOSIS_PRODUCTION_API_STATUS_MAPPING,
  DIAGNOSIS_PRODUCTION_CANDIDATE_MANIFEST,
  assertDiagnosisProductionRehearsalUndeployed,
  evaluateDiagnosisProductionReadiness,
  isDiagnosisProductionRehearsalReady,
  liveDiagnosisPackIsRegistered,
  previewDiagnosisLivePackRegistration,
} from "./report-query-production-rehearsal.js";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("Phase 3.9 — production wiring rehearsal", () => {
  it("holds live-pack registration when the deploy flag or adapter gate is off", () => {
    const byDefault = previewDiagnosisLivePackRegistration();
    expect(byDefault).toMatchObject({
      outcome: "reject",
      reason: "auth_missing",
      wouldRegister: false,
      livePackUnchanged: true,
    });
    expect(byDefault.candidate).toBeUndefined();

    const adaptersOff = previewDiagnosisLivePackRegistration({
      deployFlag: true,
      adaptersEnabled: false,
      auth: {},
      reader: {},
      audit: {},
      quota: {},
    });
    expect(adaptersOff).toMatchObject({
      outcome: "hold",
      reason: "adapters_disabled",
      wouldRegister: false,
    });
  });

  it("rejects registration when adapters are enabled but a backend is missing", () => {
    const present = { auth: {}, reader: {}, audit: {}, quota: {} };
    expect(
      previewDiagnosisLivePackRegistration({
        deployFlag: true,
        adaptersEnabled: true,
        ...present,
        auth: null,
      }).reason,
    ).toBe("auth_missing");
    expect(
      previewDiagnosisLivePackRegistration({
        deployFlag: false,
        adaptersEnabled: true,
        ...present,
        reader: undefined,
      }).reason,
    ).toBe("deploy_flag_false");
    expect(
      previewDiagnosisLivePackRegistration({
        deployFlag: true,
        adaptersEnabled: true,
        ...present,
        reader: undefined,
      }).reason,
    ).toBe("reader_missing");
    expect(
      previewDiagnosisLivePackRegistration({
        deployFlag: true,
        adaptersEnabled: true,
        auth: {},
        reader: {},
        quota: {},
      }).reason,
    ).toBe("audit_missing");
    expect(
      previewDiagnosisLivePackRegistration({
        deployFlag: true,
        adaptersEnabled: true,
        auth: {},
        reader: {},
        audit: {},
      }).reason,
    ).toBe("quota_missing");
  });

  it("emits a registrable candidate without mutating live packs", () => {
    const before = GATEWAY_METHOD_PACKS.map((pack) => pack.id);
    const preview = previewDiagnosisLivePackRegistration({
      deployFlag: true,
      adaptersEnabled: true,
      auth: { trusted: { tenantId: "tenant-fixture-a" } },
      reader: { list() {}, get() {} },
      audit: { persist() {} },
      quota: { consumeWindow() {}, releaseWindow() {} },
    });
    expect(preview.outcome).toBe("candidate");
    expect(preview.wouldRegister).toBe(false);
    expect(preview.livePackUnchanged).toBe(true);
    expect(preview.candidate).toEqual({
      packId: DIAGNOSIS_LIVE_PACK_ID,
      methods: ["diagnosis.reports.query", "diagnosis.reports.get"],
      operatorScope: "operator.read",
      schemaVersion: 1,
      cursorPrefix: "pq1.",
    });
    expect(GATEWAY_METHOD_PACKS.map((pack) => pack.id)).toEqual(before);
    expect(liveDiagnosisPackIsRegistered(GATEWAY_METHOD_PACKS)).toBe(true);
    expect(
      GATEWAY_METHOD_PACK_MANIFEST.find((entry) => entry.id === DIAGNOSIS_LIVE_PACK_ID),
    ).toBeDefined();
    expect(coreGatewayHandlers["diagnosis.reports.query"]).toBeDefined();
    expect(coreGatewayHandlers["diagnosis.reports.get"]).toBeDefined();
  });

  it("reports rehearsal readiness and keeps production cutover closed", () => {
    const report = evaluateDiagnosisProductionReadiness({
      config: parseDiagnosisProductionAdapterConfig(),
      livePacks: GATEWAY_METHOD_PACKS,
    });
    expect(report.increment).toBe("P3.9");
    expect(report.rehearsalOnly).toBe(true);
    expect(report.readyForProductionCutover).toBe(false);
    expect(report.schemaVersion).toBe(1);
    expect(report.cursorPrefix).toBe("pq1.");
    expect(report.redactionProfiles).toEqual(["administrator", "user", "system_local"]);
    expect(report.apiStatusMapping).toEqual(DIAGNOSIS_PRODUCTION_API_STATUS_MAPPING);
    expect(report.permissionMatrix.map((row) => row.id)).toContain("enterprise-member");
    expect(report.rollback).toEqual({
      keepDeployFlagFalse: true,
      doNotRegisterLivePack: true,
      doNotRestart: true,
      doNotSwitchTraffic: true,
      doNotAutoRepair: true,
    });
    expect(report.candidateManifest).toEqual(DIAGNOSIS_PRODUCTION_CANDIDATE_MANIFEST);
    expect(isDiagnosisProductionRehearsalReady(report)).toBe(true);
    expect(() => assertDiagnosisProductionRehearsalUndeployed(report)).not.toThrow();

    const opened = evaluateDiagnosisProductionReadiness({
      config: parseDiagnosisProductionAdapterConfig({
        enabled: true,
        reportSourceBackend: { kind: "composite_diagnosis_projection_snapshot" },
        auditPersistBackend: {
          kind: "append_only_audit_sink",
          locator: "$CONFIG_DIR/diagnosis-audit/",
        },
        quotaBackend: { kind: "windowed_counter" },
      }),
      livePacks: GATEWAY_METHOD_PACKS,
      adaptersEnabled: true,
    });
    expect(isDiagnosisProductionRehearsalReady(opened)).toBe(false);
  });

  it("does not flip live registration, flags, or production hosts", () => {
    expect(DIAGNOSIS_REPORT_API_DEPLOYED).toBe(true);
    expect(DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED).toBe(true);
    for (const file of [
      "report-query-production-config.ts",
      "report-query-production-rehearsal.ts",
      "report-query-deploy.ts",
      path.join("..", "gateway", "server-methods", "packs", "registry.ts"),
      path.join("..", "gateway", "server-methods", "packs", "manifest.ts"),
    ]) {
      const source = fs.readFileSync(path.join(here, file), "utf8");
      if (file === "report-query-deploy.ts") {
        expect(source).toContain("DIAGNOSIS_REPORT_API_DEPLOYED = true");
      } else {
        expect(source).not.toContain("DIAGNOSIS_REPORT_API_DEPLOYED = true");
      }
      expect(source).not.toContain("DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED = true");
      expect(source).not.toContain("createReportDatabase");
      expect(source).not.toContain("appendSkillInvocationEvent");
    }
    const rehearsal = fs.readFileSync(
      path.join(here, "report-query-production-rehearsal.ts"),
      "utf8",
    );
    expect(rehearsal).toContain("Never mutates GATEWAY_METHOD_PACKS");
    expect(rehearsal).not.toContain("GATEWAY_METHOD_PACKS.push");
    expect(rehearsal).not.toContain("coreGatewayHandlers[");
  });
});
