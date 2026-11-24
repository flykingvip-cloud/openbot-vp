import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import { describe, expect, it } from "vitest";
import { coreGatewayHandlers } from "../gateway/server-methods.js";
import { GATEWAY_METHOD_PACKS } from "../gateway/server-methods/packs/registry.js";
import {
  DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
  DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED,
} from "./production-cutover.js";
import {
  DIAGNOSIS_POST_CUTOVER_INCREMENT,
  assertDiagnosisPostCutoverClosed,
  evaluateDiagnosisPostCutover,
  renderDiagnosisPostCutoverMarkdown,
} from "./production-post-cutover.js";
import { DIAGNOSIS_REPORT_API_DEPLOYED } from "./report-query-deploy.js";
import { DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED } from "./report-query-production-adapters.js";

const SHA_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const here = path.dirname(fileURLToPath(import.meta.url));

describe("P24.4 post-cutover re-evaluation", () => {
  it("verifies dark ship and invalidates a P22 signature when LIVE or candidate moved", () => {
    const report = evaluateDiagnosisPostCutover({
      candidateSha: SHA_A,
      originMainSha: SHA_A,
      liveSha: SHA_B,
      liveSource: "container",
      publishedWindowSha: SHA_B,
      signedCandidateSha: SHA_A,
      signedLiveSha: SHA_A,
      livePackRegistered: false,
      coreHandlerHasDiagnosis: false,
    });
    expect(report.increment).toBe(DIAGNOSIS_POST_CUTOVER_INCREMENT);
    expect(report.darkShipVerified).toBe(true);
    expect(report.p22Reusable).toBe(false);
    expect(report.p22Invalidated).toBe(true);
    expect(report.p22RequiresResign).toBe(true);
    expect(report.gatesOpened).toBe(false);
    expect(report.daibaiUnconnected).toBe(true);
    expect(report.conversationUnconnected).toBe(true);
    expect(report.remediationUnconnected).toBe(true);
    expect(report.p25Started).toBe(false);
    expect(report.diagnosisPlatformComplete).toBe(false);
    expect(renderDiagnosisPostCutoverMarkdown(report)).toContain(
      "统一窗口暗发布已验证，功能保持关闭",
    );
    expect(() => assertDiagnosisPostCutoverClosed(report)).not.toThrow();
  });

  it("reuses P22 only when both candidate and LIVE still match exactly", () => {
    const report = evaluateDiagnosisPostCutover({
      candidateSha: SHA_A,
      originMainSha: SHA_A,
      liveSha: SHA_A,
      liveSource: "container",
      publishedWindowSha: SHA_A,
      signedCandidateSha: SHA_A,
      signedLiveSha: SHA_A,
    });
    expect(report.p22Reusable).toBe(true);
    expect(report.p22Invalidated).toBe(false);
    expect(report.p22RequiresResign).toBe(false);
    expect(report.gatesOpened).toBe(false);
  });

  it("does not scan as a live enablement or P25 start", () => {
    const source = fs.readFileSync(path.join(here, "production-post-cutover.ts"), "utf8");
    expect(source).not.toContain("DIAGNOSIS_DAIBAI_DELIVERY_ENABLED = true");
    expect(source).not.toContain("DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED = true");
    expect(source).not.toContain("DIAGNOSIS_REPORT_API_DEPLOYED = true");
    expect(source).not.toContain("GATEWAY_METHOD_PACKS.push");
    expect(GATEWAY_METHOD_PACKS.find((pack) => pack.id === "diagnosis-reports")).toBeDefined();
    expect(coreGatewayHandlers["diagnosis.reports.query"]).toBeDefined();
    expect(DIAGNOSIS_REPORT_API_DEPLOYED).toBe(true);
    expect(DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED).toBe(true);
    expect(DIAGNOSIS_DAIBAI_DELIVERY_ENABLED).toBe(true);
    expect(DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED).toBe(false);
  });
});

// These historical cutover / functional rehearsals explicitly opt into writes
// against injected local ports. Default-closed behavior is covered separately
// in write-policy.test.ts; this is not production enablement.
vi.mock("./write-policy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./write-policy.js")>();
  return {
    ...actual,
    DIAGNOSIS_WRITE_POLICY: {
      selfEvolutionConfirm: true,
      conversationDelivery: true,
      daibaiDelivery: true,
    },
  };
});
