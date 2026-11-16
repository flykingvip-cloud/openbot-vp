import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runControlledFaultDiagnosis } from "../batch1-capability-enablement/controlled-fault-diagnosis.js";
import {
  TOOL_TIMEOUT_UNCONFIRMED_ROOT_CAUSE_MISSING_ROUTE_TEXT,
  deriveDiagnoseObservationSummary,
} from "./diagnose-observation-summary.js";
import { DIAGNOSIS_ZERO_FINDINGS_TEXT } from "./diagnose-professional-protocol.js";
import { formatDiagnoseReportText } from "./diagnose-report-text.js";

describe("diagnose observation summary", () => {
  it("composes the required wording from tool timeout, unconfirmed root cause, and missing route", () => {
    const summary = deriveDiagnoseObservationSummary({
      collected: [
        {
          source: "tool_runtime",
          summary: { toolNameClass: "web_fetch", timeout: true, errorClass: "timeout" },
        },
      ],
      missing: [{ source: "route_resolution" }],
      hypotheses: [
        {
          schemaVersion: 1,
          hypothesisId: "hyp-1",
          code: "CONFIRMED",
          state: "confirmed",
          confidence: { evidence: 0.5, assessment: 0.5, rootCause: 0, impact: 0 },
          supportingEvidenceIds: [],
          contradictingEvidenceIds: [],
          missingEvidence: ["route_resolution"],
          scoringMethod: "rule_v1",
        },
      ],
      runnerCompletion: "CONFIRMED",
      reportCompletion: "INCONCLUSIVE",
    });
    expect(summary?.text).toBe(TOOL_TIMEOUT_UNCONFIRMED_ROOT_CAUSE_MISSING_ROUTE_TEXT);
    expect(summary?.observedToolTimeout).toBe(true);
    expect(summary?.rootCauseConfirmed).toBe(false);
    expect(summary?.routeResolutionMissing).toBe(true);
  });

  it("does not treat runner-confirmed hypotheses with zero root-cause confidence as a confirmed cause", () => {
    const summary = deriveDiagnoseObservationSummary({
      collected: [{ source: "tool_runtime", summary: { timeout: true } }],
      missing: [{ source: "route_resolution" }],
      hypotheses: [
        {
          schemaVersion: 1,
          hypothesisId: "hyp-1",
          code: "CONFIRMED",
          state: "confirmed",
          confidence: { evidence: 0.5, assessment: 0.5, rootCause: 0, impact: 0 },
          supportingEvidenceIds: [],
          contradictingEvidenceIds: [],
          missingEvidence: [],
          scoringMethod: "rule_v1",
        },
      ],
    });
    expect(summary?.rootCauseConfirmed).toBe(false);
  });
});

describe("controlled-fault diagnose conversion regression", () => {
  it("keeps findings empty, does not inflate completion, and presents the honest wording", async () => {
    const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "t20-diag-obs-"));
    const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "t20-diag-obs-ev-"));
    const result = (await runControlledFaultDiagnosis({ workRoot, evidenceRoot })) as {
      result?: string;
      completion?: string;
      runnerCompletion?: string;
      findings?: unknown[];
      observationSummary?: { text?: string; rootCauseConfirmed?: boolean };
      reportDisplayText?: string;
    };
    expect(result.result).toBe("pass");
    expect(result.findings ?? []).toEqual([]);
    expect(result.runnerCompletion).toBe("CONFIRMED");
    expect(result.completion).toBe("INCONCLUSIVE");
    expect(result.observationSummary?.text).toBe(
      TOOL_TIMEOUT_UNCONFIRMED_ROOT_CAUSE_MISSING_ROUTE_TEXT,
    );
    expect(result.observationSummary?.rootCauseConfirmed).toBe(false);
    expect(result.reportDisplayText).toContain(
      TOOL_TIMEOUT_UNCONFIRMED_ROOT_CAUSE_MISSING_ROUTE_TEXT,
    );
    expect(result.reportDisplayText).not.toContain(DIAGNOSIS_ZERO_FINDINGS_TEXT);

    const beforeFixDisplay = formatDiagnoseReportText({
      completion: result.completion ?? "INCONCLUSIVE",
      findingCount: 0,
      findings: [],
      windowId: "t20-before",
      mode: "TARGETED",
      scope: "session",
      scanned: 1,
      skipped: 0,
      reportId: "cdr-before",
      reportIds: [],
    });
    expect(beforeFixDisplay).toContain(DIAGNOSIS_ZERO_FINDINGS_TEXT);
    expect(beforeFixDisplay).not.toContain(TOOL_TIMEOUT_UNCONFIRMED_ROOT_CAUSE_MISSING_ROUTE_TEXT);
  });
});
