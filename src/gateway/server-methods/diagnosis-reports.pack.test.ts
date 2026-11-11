import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DIAGNOSIS_REPORT_API_DEPLOYED } from "../../diagnosis/report-query-api.js";
import {
  createDefaultDiagnosisReportApiDeps,
  createLiveDiagnosisReportApiDeps,
} from "../../diagnosis/report-query-gateway.js";
import { coreGatewayHandlers } from "../server-methods.js";
import { diagnosisReportsPack } from "./diagnosis-reports.pack.js";
import { mergePackHandlers, mergePackMethodNames } from "./pack-merge.js";
import { GATEWAY_METHOD_PACK_MANIFEST } from "./packs/manifest.js";
import { GATEWAY_METHOD_PACKS } from "./packs/registry.js";

describe("diagnosis-reports gateway method pack", () => {
  it("registers query/get on live packs when the deploy gate is true", () => {
    expect(DIAGNOSIS_REPORT_API_DEPLOYED).toBe(true);
    expect(diagnosisReportsPack.id).toBe("diagnosis-reports");
    expect(diagnosisReportsPack.methods).toEqual([
      "diagnosis.observation.query",
      "diagnosis.reports.query",
      "diagnosis.reports.get",
      "diagnosis.diagnose",
      "diagnosis.action.dispatch",
      "diagnosis.intervention.list",
      "diagnosis.intervention.get",
      "diagnosis.intervention.dispatch",
      "diagnosis.intervention.expand",
      "diagnosis.intervention.materialize",
      "diagnosis.schedule.apply",
      "diagnosis.self-evolution.confirm",
      "diagnosis.job.pause",
      "diagnosis.job.resume",
      "diagnosis.job.run",
      "diagnosis.job.report.get",
      "diagnosis.job.describe",
      "diagnosis.job.cancel",
      "diagnosis.handling.preview",
      "diagnosis.handling.submit",
      "diagnosis.handling.approve",
      "diagnosis.handling.reject",
      "diagnosis.handling.cancel",
      "diagnosis.handling.execute",
      "diagnosis.handling.recheck",
      "diagnosis.handling.get",
      "diagnosis.handling.list",
    ]);
    expect(GATEWAY_METHOD_PACKS.find((entry) => entry.id === "diagnosis-reports")).toBeDefined();
    expect(
      GATEWAY_METHOD_PACK_MANIFEST.find((entry) => entry.id === "diagnosis-reports"),
    ).toBeDefined();
    const merged = mergePackHandlers(GATEWAY_METHOD_PACKS);
    const names = mergePackMethodNames(GATEWAY_METHOD_PACKS);
    expect(names).toContain("diagnosis.observation.query");
    expect(typeof merged["diagnosis.observation.query"]).toBe("function");
    expect(names).toContain("diagnosis.reports.query");
    expect(names).toContain("diagnosis.reports.get");
    expect(names).toContain("diagnosis.diagnose");
    expect(names).toContain("diagnosis.action.dispatch");
    expect(names).toContain("diagnosis.intervention.list");
    expect(names).toContain("diagnosis.intervention.materialize");
    expect(names).toContain("diagnosis.schedule.apply");
    expect(names).toContain("diagnosis.self-evolution.confirm");
    expect(names).toContain("diagnosis.job.pause");
    expect(names).toContain("diagnosis.job.run");
    expect(names).toContain("diagnosis.job.report.get");
    expect(names).toContain("diagnosis.job.describe");
    expect(names).toContain("diagnosis.job.cancel");
    expect(names).toContain("diagnosis.handling.preview");
    expect(names).toContain("diagnosis.handling.execute");
    expect(names).toContain("diagnosis.handling.list");
    expect(typeof merged["diagnosis.reports.query"]).toBe("function");
    expect(typeof merged["diagnosis.reports.get"]).toBe("function");
    expect(typeof merged["diagnosis.diagnose"]).toBe("function");
    expect(coreGatewayHandlers["diagnosis.reports.query"]).toBeDefined();
    expect(coreGatewayHandlers["diagnosis.reports.get"]).toBeDefined();
    expect(coreGatewayHandlers["diagnosis.diagnose"]).toBeDefined();
    expect(coreGatewayHandlers["diagnosis.action.dispatch"]).toBeDefined();
    expect(coreGatewayHandlers["diagnosis.intervention.list"]).toBeDefined();
    expect(coreGatewayHandlers["diagnosis.intervention.materialize"]).toBeDefined();
    expect(coreGatewayHandlers["diagnosis.schedule.apply"]).toBeDefined();
    expect(coreGatewayHandlers["diagnosis.self-evolution.confirm"]).toBeDefined();
    expect(coreGatewayHandlers["diagnosis.job.pause"]).toBeDefined();
    expect(coreGatewayHandlers["diagnosis.job.run"]).toBeDefined();
    expect(coreGatewayHandlers["diagnosis.job.report.get"]).toBeDefined();
    expect(coreGatewayHandlers["diagnosis.job.describe"]).toBeDefined();
    expect(coreGatewayHandlers["diagnosis.job.cancel"]).toBeDefined();
    expect(coreGatewayHandlers["diagnosis.handling.preview"]).toBeDefined();
    expect(coreGatewayHandlers["diagnosis.handling.execute"]).toBeDefined();
    expect(typeof merged["chat.checkpoints.list"]).toBe("function");
    const packScopes = diagnosisReportsPack.scopes;
    expect(packScopes["operator.read"]).toContain("diagnosis.observation.query");
    expect(packScopes["operator.read"]).not.toContain("diagnosis.action.dispatch");
    expect(packScopes["operator.write"]).toEqual([
      "diagnosis.schedule.apply",
      "diagnosis.action.dispatch",
      "diagnosis.intervention.dispatch",
      "diagnosis.intervention.expand",
      "diagnosis.intervention.materialize",
      "diagnosis.job.pause",
      "diagnosis.job.resume",
      "diagnosis.job.run",
      "diagnosis.job.cancel",
      "diagnosis.handling.submit",
      "diagnosis.handling.cancel",
      "diagnosis.handling.execute",
      "diagnosis.handling.recheck",
    ]);
    expect(packScopes["operator.approvals"]).toEqual([
      "diagnosis.self-evolution.confirm",
      "diagnosis.handling.approve",
      "diagnosis.handling.reject",
    ]);
    expect(packScopes["operator.read"]).toContain("diagnosis.intervention.list");
    expect(packScopes["operator.read"]).toContain("diagnosis.intervention.get");
    expect(packScopes["operator.read"]).toContain("diagnosis.job.report.get");
    expect(packScopes["operator.read"]).toContain("diagnosis.job.describe");
    expect(packScopes["operator.read"]).toContain("diagnosis.handling.preview");
    expect(packScopes["operator.read"]).toContain("diagnosis.handling.list");
    const manifestEntry = GATEWAY_METHOD_PACK_MANIFEST.find(
      (entry) => entry.id === "diagnosis-reports",
    );
    expect(manifestEntry?.scopes["operator.read"]).not.toContain("diagnosis.action.dispatch");
    expect(manifestEntry?.scopes["operator.write"]).toContain("diagnosis.action.dispatch");
  });

  it("wires live handlers to projection snapshot deps instead of empty defaults", () => {
    const live = createLiveDiagnosisReportApiDeps();
    const defaults = createDefaultDiagnosisReportApiDeps();
    expect(live.reader).not.toBe(defaults.reader);
    expect(live.audit).not.toBe(defaults.audit);
    const packBody = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "diagnosis-reports.pack.ts"),
      "utf8",
    );
    expect(packBody).toContain("createLiveDiagnosisReportGatewayHandlers");
    expect(packBody).toContain("createDiagnoseGroupExpandDeps");
    expect(packBody).toContain("createInterventionGatewayHandlers({");
    expect(packBody).toContain("resolveExpandInput");
    expect(packBody).toContain("loadMembers: d.loadGroupMembers");
    expect(packBody).toContain("getSharedDiagnosisDelegationMachine");
    expect(packBody).toContain("prescriptionGrantViewFromAuthorization");
    expect(packBody).toContain(".getGrant(");
    expect(packBody).not.toContain(".inspectGrant(");
    expect(packBody).not.toContain("createDiagnosisReportGatewayHandlers()");
    expect(packBody).toContain("createDiagnosisHandlingGatewayHandlers()");
    expect(packBody).not.toContain("createDiagnosisHandlingGatewayHandlers({");
    expect(packBody).not.toContain("isolation: true");
  });

  it("has no write side effects", () => {
    const body = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "diagnosis-reports.pack.ts"),
      "utf8",
    );
    expect(body).toContain("createLiveDiagnosisReportGatewayHandlers");
    expect(body).toContain("Not a production cutover");
    expect(body).not.toContain("appendSkillInvocationEvent");
    expect(body).not.toContain("writeConfigFile");
    expect(body).not.toContain("doctorCommand");
    expect(body).not.toContain("startChannel");
    expect(body).not.toContain("--fix");
    expect(body).not.toContain("DiagnosisJournal");
  });
});
