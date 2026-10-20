import { describe, expect, it } from "vitest";
import {
  DIAGNOSIS_P26_5_FROZEN_CANDIDATE_SHA,
  DIAGNOSIS_P26_5_FROZEN_LIVE_SHA,
  DIAGNOSIS_P26_5_NEXT_OFFICIAL_STEP,
  assertDiagnosisProductionP26_5Evaluated,
  evaluateDiagnosisProductionP26_5,
} from "./production-p26.5.js";

describe("P26.5 readonly diagnosis admission", () => {
  it("requires live pack, snapshot reader, and keeps cutover false", () => {
    const report = evaluateDiagnosisProductionP26_5({
      candidateSha: DIAGNOSIS_P26_5_FROZEN_CANDIDATE_SHA,
      liveSha: DIAGNOSIS_P26_5_FROZEN_LIVE_SHA,
    });
    expect(report.readonlyAdmissionReady).toBe(true);
    expect(report.packRegistered).toBe(true);
    expect(report.queryHandlerPresent).toBe(true);
    expect(report.getHandlerPresent).toBe(true);
    expect(report.snapshotReaderWired).toBe(true);
    expect(report.liveExecutorUndeployed).toBe(true);
    expect(report.doctorFixBound).toBe(false);
    expect(report.channelRestartBound).toBe(false);
    expect(report.approvedForProductionCutover).toBe(false);
    expect(report.nextOfficialStep).toBe(DIAGNOSIS_P26_5_NEXT_OFFICIAL_STEP);
    assertDiagnosisProductionP26_5Evaluated(report);
  });
});
