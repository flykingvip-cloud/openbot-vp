import { describe, expect, it } from "vitest";
import {
  capsuleEligibilityFromStoredFields,
  composeTrustedMechanismClusterRef,
  evaluateCapsuleObservationEligibility,
  nativeMechanismClusterMetadata,
  normalizeTrustedMechanismCause,
  projectCapsuleObservationView,
  uniqueTrustedMechanismCause,
} from "./capsule-eligibility.js";

describe("capsule observation eligibility", () => {
  it("treats a missing failureClusterRef as legacy unavailable", () => {
    const eligibility = evaluateCapsuleObservationEligibility({});
    expect(eligibility).toEqual({
      eligible: false,
      reason: "legacy_missing_failure_cluster",
    });
    expect(
      projectCapsuleObservationView({ eligibility, nativeRecurrenceRate: 0 }).recurrenceRate,
    ).toBeNull();
  });

  it("does not let matching sourceIds replace a native cluster", () => {
    expect(
      evaluateCapsuleObservationEligibility({
        inferredFromSourceIds: true,
        failureClusterRef: "task:g1:same",
      }),
    ).toEqual({ eligible: false, reason: "untrusted_cluster_reference" });
    expect(
      capsuleEligibilityFromStoredFields({
        metadata: {},
        structuredContent: { sourceIds: ["finding-1"] },
      }).eligible,
    ).toBe(false);
  });

  it("does not auto-cluster from similar text", () => {
    expect(
      evaluateCapsuleObservationEligibility({
        inferredFromText: true,
        failureClusterRef: "similar:retry timeouts",
      }),
    ).toEqual({ eligible: false, reason: "untrusted_cluster_reference" });
    expect(
      evaluateCapsuleObservationEligibility({
        failureClusterRef: "similar:retry timeouts",
      }),
    ).toEqual({ eligible: false, reason: "untrusted_cluster_reference" });
  });

  it("only composes native metadata from a unique trusted mechanism cause", () => {
    expect(normalizeTrustedMechanismCause("timeout")).toBe("timeout");
    expect(normalizeTrustedMechanismCause("security_violation")).toBe("security");
    expect(normalizeTrustedMechanismCause("tool_error")).toBeUndefined();
    expect(normalizeTrustedMechanismCause("run_failed")).toBeUndefined();
    expect(normalizeTrustedMechanismCause("task:g1:r1")).toBeUndefined();
    expect(uniqueTrustedMechanismCause(["timeout", "TIMEOUT"])).toBe("timeout");
    expect(uniqueTrustedMechanismCause(["timeout", "security"])).toBeUndefined();
    expect(uniqueTrustedMechanismCause(["tool_error"])).toBeUndefined();
    expect(
      nativeMechanismClusterMetadata({
        diagnoserOrDomain: "skill-invocation",
        cause: "timeout",
        mechanismVersion: "v1",
      }),
    ).toEqual({
      failureClusterRef: "failure:skill-invocation:timeout:v1",
      clusterProvenance: "native",
    });
    expect(
      nativeMechanismClusterMetadata({
        diagnoserOrDomain: "skill-invocation",
        cause: "tool_error",
        mechanismVersion: "v1",
      }),
    ).toBeUndefined();
  });

  it("accepts a native mechanism cluster written at creation", () => {
    expect(
      composeTrustedMechanismClusterRef({ diagnoserOrDomain: "task", cause: "r1" }),
    ).toBeUndefined();
    expect(
      composeTrustedMechanismClusterRef({
        diagnoserOrDomain: "collaboration",
        cause: "timeout",
        mechanismVersion: "v1",
      }),
    ).toBe("failure:collaboration:timeout:v1");
    expect(
      evaluateCapsuleObservationEligibility({
        failureClusterRef: "failure:collaboration:timeout:v1",
        clusterProvenance: "native",
      }),
    ).toEqual({
      eligible: true,
      failureClusterRef: "failure:collaboration:timeout:v1",
      provenance: "native",
    });
  });

  it("keeps tool_error and run_failed clusters permanently unavailable", () => {
    expect(
      evaluateCapsuleObservationEligibility({
        failureClusterRef: "failure:skill-invocation:tool_error:v1",
        clusterProvenance: "native",
      }),
    ).toEqual({ eligible: false, reason: "untrusted_cluster_reference" });
    expect(
      evaluateCapsuleObservationEligibility({
        failureClusterRef: "failure:skill-invocation:run_failed:v1",
        clusterProvenance: "native",
      }),
    ).toEqual({ eligible: false, reason: "untrusted_cluster_reference" });
  });

  it("does not upgrade a cluster ref without provenance to native", () => {
    expect(
      evaluateCapsuleObservationEligibility({
        failureClusterRef: "failure:collaboration:timeout:v1",
      }),
    ).toEqual({ eligible: false, reason: "insufficient_lineage" });
    expect(
      evaluateCapsuleObservationEligibility({
        failureClusterRef: "failure:collaboration:timeout:v1",
        clusterProvenance: "imported",
      }),
    ).toEqual({ eligible: false, reason: "untrusted_cluster_reference" });
    expect(
      evaluateCapsuleObservationEligibility({
        failureClusterRef: "task:g1:legacy-ref",
        clusterProvenance: "native",
      }),
    ).toEqual({ eligible: false, reason: "untrusted_cluster_reference" });
    expect(
      evaluateCapsuleObservationEligibility({
        failureClusterRef: "timeout",
        clusterProvenance: "native",
      }),
    ).toEqual({ eligible: false, reason: "untrusted_cluster_reference" });
  });

  it("does not map unavailable to improved or 0% recurrence", () => {
    const view = projectCapsuleObservationView({
      eligibility: { eligible: false, reason: "legacy_missing_failure_cluster" },
      nativeRecurrenceRate: 0,
    });
    expect(view.availability).toBe("unavailable");
    expect(view.label).toContain("unavailable");
    expect(view.recurrenceRate).toBeNull();
    expect(view.recurrenceRate).not.toBe(0);
  });

  it("keeps the same decision after a stored-object reload", () => {
    const stored = {
      metadata: {
        failureClusterRef: "failure:collaboration:timeout:v1",
        clusterProvenance: "native",
      },
      structuredContent: { summary: "retry timeouts before escalating" },
    };
    const first = capsuleEligibilityFromStoredFields(stored);
    const reloaded = capsuleEligibilityFromStoredFields(JSON.parse(JSON.stringify(stored)));
    expect(reloaded).toEqual(first);
    expect(reloaded).toEqual({
      eligible: true,
      failureClusterRef: "failure:collaboration:timeout:v1",
      provenance: "native",
    });
    const missingProvenance = {
      metadata: { failureClusterRef: "failure:collaboration:timeout:v1" },
      structuredContent: { summary: "retry timeouts before escalating" },
    };
    expect(capsuleEligibilityFromStoredFields(missingProvenance)).toEqual({
      eligible: false,
      reason: "insufficient_lineage",
    });
  });
});
