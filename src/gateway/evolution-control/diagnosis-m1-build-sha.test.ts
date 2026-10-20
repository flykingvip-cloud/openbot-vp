import { afterEach, describe, expect, it } from "vitest";
import {
  DiagnosisReceiptFailClosedError,
  resetDiagnosisReceiptBuildInfoForTests,
  resolveDiagnosisReceiptBuildSha,
  setDiagnosisReceiptBuildInfoForTests,
} from "./diagnosis-m1-completion.js";

describe("resolveDiagnosisReceiptBuildSha", () => {
  const prevBuild = process.env.OPENBOT_BUILD_SHA;
  const prevDiag = process.env.OPENBOT_DIAGNOSIS_BUILD_SHA;

  afterEach(() => {
    resetDiagnosisReceiptBuildInfoForTests();
    if (prevBuild === undefined) {
      delete process.env.OPENBOT_BUILD_SHA;
    } else {
      process.env.OPENBOT_BUILD_SHA = prevBuild;
    }
    if (prevDiag === undefined) {
      delete process.env.OPENBOT_DIAGNOSIS_BUILD_SHA;
    } else {
      process.env.OPENBOT_DIAGNOSIS_BUILD_SHA = prevDiag;
    }
  });

  it("prefers runtime build-info when present", () => {
    process.env.VITEST = "1";
    setDiagnosisReceiptBuildInfoForTests(() => ({ commit: "buildinfo-sha" }));
    process.env.OPENBOT_BUILD_SHA = "env-sha";
    expect(resolveDiagnosisReceiptBuildSha()).toBe("buildinfo-sha");
  });

  it("falls back to OPENBOT_DIAGNOSIS_BUILD_SHA then OPENBOT_BUILD_SHA", () => {
    process.env.VITEST = "1";
    setDiagnosisReceiptBuildInfoForTests(() => ({ commit: "" }));
    delete process.env.OPENBOT_DIAGNOSIS_BUILD_SHA;
    process.env.OPENBOT_BUILD_SHA = "env-build-sha";
    // Empty commit from reader still falls through to env in readRuntimeBuildInfo only when
    // buildInfoReader returns empty — resolveDiagnosisReceiptBuildSha reads reader first.
    // Force reader off and use env via null reader returning null.
    setDiagnosisReceiptBuildInfoForTests(() => null);
    expect(resolveDiagnosisReceiptBuildSha()).toBe("env-build-sha");
    process.env.OPENBOT_DIAGNOSIS_BUILD_SHA = "diag-sha";
    expect(resolveDiagnosisReceiptBuildSha()).toBe("diag-sha");
  });

  it("fails closed with an actionable message when no SHA source exists", () => {
    process.env.VITEST = "1";
    setDiagnosisReceiptBuildInfoForTests(() => null);
    delete process.env.OPENBOT_BUILD_SHA;
    delete process.env.OPENBOT_DIAGNOSIS_BUILD_SHA;
    try {
      resolveDiagnosisReceiptBuildSha();
      expect.unreachable("expected build_sha_unavailable");
    } catch (error) {
      expect(error).toBeInstanceOf(DiagnosisReceiptFailClosedError);
      expect((error as DiagnosisReceiptFailClosedError).code).toBe("build_sha_unavailable");
      expect((error as Error).message).toContain("OPENBOT_BUILD_SHA");
    }
  });
});
