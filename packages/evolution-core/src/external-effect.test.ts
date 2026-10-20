import { describe, expect, it } from "vitest";
import {
  applicationReceiptIsNotEffectProof,
  assertExternalEffectBinding,
  bindExternalEffectResult,
  canEnterOutcomeVerification,
  canPromoteWithExternalEffect,
  classifyEvolutionLifecycleStage,
  isCodeIdentityCredentialRef,
  isResolvedVerifierCredential,
  isTrustedCredentialRef,
  observationReceiptMatchesRequest,
} from "./external-effect.js";

const target = { domain: "agent" as const, agentId: "bot-1" };
const request = {
  requestId: "req-1",
  proposalId: "p1",
  experimentId: "e1",
  applicationId: "a1",
  target,
  expectedEffect: {
    kind: "working-style-field",
    field: "riskPreference",
    expectedValue: "conservative",
  },
  applicationReceiptRef: "app:a1",
  tenantScope: "tenant-a",
  verifierId: "working-dna-read-after-write",
  evidenceRefs: ["ev-a"],
  expiresAt: "2026-09-06T12:00:00.000Z",
};

describe("external effect contract", () => {
  it("keeps APPLIED, EFFECT_VERIFIED, OUTCOME_VERIFIED, and PROMOTED distinct", () => {
    expect(
      classifyEvolutionLifecycleStage({
        applicationApplied: true,
        externalEffectOutcome: null,
        proposalStatus: "CANARY",
      }),
    ).toBe("APPLIED");
    expect(
      classifyEvolutionLifecycleStage({
        applicationApplied: true,
        externalEffectOutcome: "verified",
        proposalStatus: "CANARY",
      }),
    ).toBe("EFFECT_VERIFIED");
    expect(
      classifyEvolutionLifecycleStage({
        applicationApplied: true,
        externalEffectOutcome: "verified",
        proposalStatus: "VERIFIED",
      }),
    ).toBe("OUTCOME_VERIFIED");
    expect(
      classifyEvolutionLifecycleStage({
        applicationApplied: true,
        externalEffectOutcome: "verified",
        proposalStatus: "PROMOTED",
      }),
    ).toBe("PROMOTED");
  });

  it("does not treat an application receipt as effect proof", () => {
    expect(applicationReceiptIsNotEffectProof("app:a1")).toBe(true);
  });

  it("rejects a mismatched proposal, experiment, application, target, or tenant", () => {
    expect(
      assertExternalEffectBinding({
        request,
        proposalId: "other",
        experimentId: "e1",
        applicationId: "a1",
        target,
        tenantScope: "tenant-a",
      }).ok,
    ).toBe(false);
    expect(
      assertExternalEffectBinding({
        request,
        proposalId: "p1",
        experimentId: "e1",
        applicationId: "a1",
        target: { domain: "agent", agentId: "other" },
        tenantScope: "tenant-a",
      }).ok,
    ).toBe(false);
    expect(
      assertExternalEffectBinding({
        request,
        proposalId: "p1",
        experimentId: "e1",
        applicationId: "a1",
        target,
        tenantScope: "tenant-b",
      }).ok,
    ).toBe(false);
  });

  it("rejects plaintext credential tokens and does not treat a key-ref prefix as resolved", () => {
    expect(isTrustedCredentialRef("super-secret-token")).toBe(false);
    expect(isTrustedCredentialRef("key-ref:platform/working-dna-raw")).toBe(true);
    expect(isResolvedVerifierCredential("key-ref:platform/working-dna-raw")).toBe(false);
    expect(
      isCodeIdentityCredentialRef(
        "code-identity:working-dna-read-after-write",
        "working-dna-read-after-write",
      ),
    ).toBe(true);
  });

  it("does not let EFFECT_VERIFIED alone enter PROMOTED", () => {
    expect(
      canPromoteWithExternalEffect({
        proposalStatus: "CANARY",
        verificationId: undefined,
        riskLevel: "medium",
        requireExternalEffect: true,
        externalEffectOutcome: "verified",
      }),
    ).toMatchObject({ ok: false, code: "not_verified" });
  });

  it("binds observation receipts to request, application, target, and tenant", () => {
    const result = bindExternalEffectResult({
      request,
      outcome: "verified",
      observedAt: "2026-09-06T11:00:00.000Z",
      evidenceRefs: ["ev-a"],
      observationReceiptRef: "raw-verified:bot-1:v1",
      verifierImplementationVersion: "1",
      observedTargetVersion: "style-v1",
      observedTargetHash: "abc",
    });
    expect(result.requestId).toBe(request.requestId);
    expect(result.verifierId).toBe(request.verifierId);
    expect(result.verifierImplementationVersion).toBe("1");
    expect(result.observedTargetVersion).toBe("style-v1");
    expect(observationReceiptMatchesRequest(result.receipt, request)).toBe(true);
    expect(
      observationReceiptMatchesRequest(result.receipt, { ...request, requestId: "req-other" }),
    ).toBe(false);
    expect(
      observationReceiptMatchesRequest(result.receipt, { ...request, applicationId: "a-other" }),
    ).toBe(false);
    expect(
      observationReceiptMatchesRequest(result.receipt, {
        ...request,
        target: { domain: "agent", agentId: "other" },
      }),
    ).toBe(false);
    expect(
      observationReceiptMatchesRequest(result.receipt, { ...request, tenantScope: "tenant-b" }),
    ).toBe(false);
  });

  it("blocks promote when statistics improved but the external effect is contradicted", () => {
    expect(
      canEnterOutcomeVerification({
        statisticalImproved: true,
        sampleSize: 40,
        minimumSampleSize: 20,
        rollbackDrillPassed: true,
        grantActive: true,
        requireExternalEffect: true,
        externalEffectOutcome: "contradicted",
      }),
    ).toMatchObject({ ok: false, code: "external_effect_contradicted" });
    expect(
      canPromoteWithExternalEffect({
        proposalStatus: "VERIFIED",
        verificationId: "ver-1",
        riskLevel: "medium",
        requireExternalEffect: true,
        externalEffectOutcome: "contradicted",
      }),
    ).toMatchObject({ ok: false, code: "external_effect_contradicted" });
  });
});
