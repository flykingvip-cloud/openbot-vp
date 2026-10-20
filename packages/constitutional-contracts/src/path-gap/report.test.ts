import { describe, expect, it } from "vitest";
import {
  LEGAL_CONSTITUTIONAL_PATHS,
  NO_VALID_PATH,
  PATH_GAP_REPORT_ENV,
  PHASE_D_P8A_SCOPE,
  isPathGapReportEnabled,
  isValidConstitutionalPath,
  reportPathGap,
  samplePathGapInput,
} from "../index.js";

describe("P8a path-gap report", () => {
  it("stays inert unless naming is explicitly requested", () => {
    const input = structuredClone(samplePathGapInput);
    const before = JSON.stringify(input);
    const previous = process.env[PATH_GAP_REPORT_ENV];
    process.env[PATH_GAP_REPORT_ENV] = "true";
    try {
      const report = reportPathGap(input);
      expect(JSON.stringify(input)).toBe(before);
      expect(report.scope).toBe(PHASE_D_P8A_SCOPE);
      expect(report.mode).toBe("report_only");
      expect(report.invoked).toBe(false);
      expect(report.gapCode).toBeNull();
      expect(report.selectedPath).toBeNull();
      expect(report.executed).toBe(false);
      expect(report.sideEffects).toEqual([]);
      expect(report.enforce).toBe(false);
      expect(report.liveInvoke).toBe(false);
      expect(report.fabricDefaultOn).toBe(false);
      expect(report.readyToTighten).toBe(false);
      expect(report.pathUnsetIsTighteningGate).toBe(false);
      expect(report.mutated).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env[PATH_GAP_REPORT_ENV];
      } else {
        process.env[PATH_GAP_REPORT_ENV] = previous;
      }
    }
  });

  it("names no_valid_path for an unset path and records no execution", () => {
    const input = structuredClone(samplePathGapInput);
    const before = JSON.stringify(input);
    const report = reportPathGap(input, { report: true });
    expect(JSON.stringify(input)).toBe(before);
    expect(report.invoked).toBe(true);
    expect(report.gapCode).toBe(NO_VALID_PATH);
    expect(report.gapCode).toBe("no_valid_path");
    expect(report.selectedPath).toBeNull();
    expect(report.candidatePresent).toBe(false);
    expect(report.candidateAccepted).toBe(false);
    expect(report.c5Pass).toBe(false);
    expect(report.readyToTighten).toBe(false);
    expect(report.pathUnsetIsTighteningGate).toBe(false);
    expect(report.legalPathSelectable).toBe(false);
    expect(report.shadowCompared).toBe(false);
    expect(report.paintedAliasUsedAsPath).toBe(false);
    expect(report.executed).toBe(false);
    expect(report.sideEffects).toEqual([]);
    expect(report.enforce).toBe(false);
    expect(report.liveInvoke).toBe(false);
    expect(report.fabricDefaultOn).toBe(false);
    expect(report.mutated).toBe(false);
    expect(JSON.stringify(report)).not.toContain("lobster");
    expect(JSON.stringify(report)).not.toContain("agent:main:main");
    expect(JSON.stringify(report)).not.toContain("aor-graph");
    expect(JSON.stringify(report)).not.toContain("fabric-graph");
    expect(JSON.stringify(report)).not.toContain("dormant-orchestration");
  });

  it("refuses a painted candidate without selecting or executing it", () => {
    const input = {
      ...samplePathGapInput,
      selectedPath: "session:main",
    };
    const before = JSON.stringify(input);
    expect(isValidConstitutionalPath(input.selectedPath)).toBe(false);
    expect(LEGAL_CONSTITUTIONAL_PATHS).toEqual([]);
    const report = reportPathGap(input, { report: true });
    expect(JSON.stringify(input)).toBe(before);
    expect(report.gapCode).toBe("no_valid_path");
    expect(report.selectedPath).toBeNull();
    expect(report.candidatePresent).toBe(true);
    expect(report.candidateAccepted).toBe(false);
    expect(report.executed).toBe(false);
    expect(report.sideEffects).toEqual([]);
    expect(report.paintedAliasUsedAsPath).toBe(false);
    expect(report.readyToTighten).toBe(false);
    expect(report.legalPathSelectable).toBe(false);
    expect(JSON.stringify(report)).not.toContain("session:main");
  });

  it("treats a blank candidate as unset and still does not execute", () => {
    const report = reportPathGap({ selectedPath: "   " }, { report: true });
    expect(report.gapCode).toBe("no_valid_path");
    expect(report.candidatePresent).toBe(false);
    expect(report.selectedPath).toBeNull();
    expect(report.executed).toBe(false);
    expect(report.sideEffects).toEqual([]);
  });

  it("lets an explicit env snapshot name the gap without reading process.env or executing", () => {
    expect(isPathGapReportEnabled({})).toBe(false);
    expect(isPathGapReportEnabled({ [PATH_GAP_REPORT_ENV]: "true" })).toBe(true);
    expect(isPathGapReportEnabled({ [PATH_GAP_REPORT_ENV]: "off" })).toBe(false);

    const named = reportPathGap(samplePathGapInput, {
      env: { [PATH_GAP_REPORT_ENV]: "true" },
    });
    expect(named.invoked).toBe(true);
    expect(named.gapCode).toBe("no_valid_path");
    expect(named.executed).toBe(false);
    expect(named.enforce).toBe(false);
    expect(named.liveInvoke).toBe(false);
    expect(named.fabricDefaultOn).toBe(false);
    expect(named.readyToTighten).toBe(false);
    expect(named.shadowCompared).toBe(false);

    const quiet = reportPathGap(samplePathGapInput, {
      env: { [PATH_GAP_REPORT_ENV]: "false" },
    });
    expect(quiet.invoked).toBe(false);
    expect(quiet.gapCode).toBeNull();
    expect(quiet.executed).toBe(false);
  });
});
