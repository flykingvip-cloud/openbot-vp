/**
 * Working DNA read-after-write verifier.
 *
 * Proves only that the independent working-style.json matches the expected
 * field/version. It does not call the Working DNA adapter apply/rollback and
 * does not treat an application receipt as proof. Business improvement remains
 * an Evolution Verification statistical concern.
 *
 * Trusted by code identity only. No external credential is resolved.
 */
import type {
  EvolutionVerifierRecord,
  ExpectedExternalEffect,
  ExternalEffectOutcome,
  ExternalEffectVerifier,
} from "@openbot/evolution-core";
import { bindExternalEffectResult, codeIdentityCredentialRef } from "@openbot/evolution-core";
import type { OpenBotConfig } from "../../../config/config.js";
import { createReadonlyEvolutionDomainReader } from "./readonly-domain.js";

export const WORKING_DNA_RAW_VERIFIER_ID = "working-dna-read-after-write";
export const WORKING_DNA_RAW_VERIFIER_KIND = "working-style-store-readonly";
export const WORKING_DNA_RAW_VERIFIER_VERSION = "1";

export const WORKING_DNA_RAW_VERIFIER_RECORD: EvolutionVerifierRecord = {
  verifierId: WORKING_DNA_RAW_VERIFIER_ID,
  verifierKind: WORKING_DNA_RAW_VERIFIER_KIND,
  supportedTargetDomains: ["agent"],
  supportedEffectKinds: ["working-style-field"],
  tenantScope: null,
  credentialRef: codeIdentityCredentialRef(WORKING_DNA_RAW_VERIFIER_ID),
  trustedBy: "code-identity",
  status: "active",
  expiresAt: "2099-01-01T00:00:00.000Z",
  independentFromAdapterIds: ["working-dna"],
  authorityGrantRef: codeIdentityCredentialRef(WORKING_DNA_RAW_VERIFIER_ID),
};

export type WorkingDnaRawObservation = {
  outcome: ExternalEffectOutcome;
  evidenceRefs: string[];
  observationReceiptRef: string;
  observedTargetVersion?: string;
  observedTargetHash?: string;
};

export const workingDnaReadAfterWriteVerifier: ExternalEffectVerifier = {
  verifierId: WORKING_DNA_RAW_VERIFIER_ID,
  verifierKind: WORKING_DNA_RAW_VERIFIER_KIND,
  implementationVersion: WORKING_DNA_RAW_VERIFIER_VERSION,
  supportedDomains: ["agent"],
  supportedEffectKinds: ["working-style-field"],
  async verify(request, context) {
    void context.resolveCredential;
    if (request.target.domain !== "agent") {
      return bindExternalEffectResult({
        request,
        outcome: "inconclusive",
        observedAt: context.now,
        evidenceRefs: [],
        observationReceiptRef: "fail-closed:target-mismatch",
        verifierImplementationVersion: WORKING_DNA_RAW_VERIFIER_VERSION,
      });
    }
    const snapshot = await context.readDomain.readWorkingStyle?.(request.target.agentId);
    if (!snapshot || snapshot.status === "unreadable") {
      return bindExternalEffectResult({
        request,
        outcome: "inconclusive",
        observedAt: context.now,
        evidenceRefs: [],
        observationReceiptRef: `raw-unreadable:${request.target.agentId}`,
        verifierImplementationVersion: WORKING_DNA_RAW_VERIFIER_VERSION,
      });
    }
    if (snapshot.status === "missing") {
      return bindExternalEffectResult({
        request,
        outcome: "inconclusive",
        observedAt: context.now,
        evidenceRefs: [],
        observationReceiptRef: `raw-missing:${request.target.agentId}`,
        verifierImplementationVersion: WORKING_DNA_RAW_VERIFIER_VERSION,
      });
    }
    const field = request.expectedEffect.field;
    const style = snapshot.fieldValue as Record<string, unknown> | undefined;
    const actualValue = field && style ? style[field] : undefined;
    const evidenceRefs = [
      `working-style:${request.target.agentId}:${snapshot.hash}`,
      `bytes:${snapshot.rawLength}`,
    ];
    if (field && actualValue !== request.expectedEffect.expectedValue) {
      return bindExternalEffectResult({
        request,
        outcome: "contradicted",
        observedAt: context.now,
        evidenceRefs,
        observationReceiptRef: `raw-mismatch:${request.target.agentId}:${String(actualValue)}`,
        verifierImplementationVersion: WORKING_DNA_RAW_VERIFIER_VERSION,
        observedTargetVersion: snapshot.version,
        observedTargetHash: snapshot.hash,
      });
    }
    if (
      request.expectedEffect.expectedVersion &&
      snapshot.version !== request.expectedEffect.expectedVersion
    ) {
      return bindExternalEffectResult({
        request,
        outcome: "contradicted",
        observedAt: context.now,
        evidenceRefs,
        observationReceiptRef: `raw-version-mismatch:${snapshot.version}`,
        verifierImplementationVersion: WORKING_DNA_RAW_VERIFIER_VERSION,
        observedTargetVersion: snapshot.version,
        observedTargetHash: snapshot.hash,
      });
    }
    if (!field && !request.expectedEffect.expectedVersion) {
      return bindExternalEffectResult({
        request,
        outcome: "not_observed",
        observedAt: context.now,
        evidenceRefs: [request.applicationReceiptRef],
        observationReceiptRef: `receipt-only:${request.applicationReceiptRef}`,
        verifierImplementationVersion: WORKING_DNA_RAW_VERIFIER_VERSION,
      });
    }
    return bindExternalEffectResult({
      request,
      outcome: "verified",
      observedAt: context.now,
      evidenceRefs,
      observationReceiptRef: `raw-verified:${request.target.agentId}:${snapshot.version}`,
      verifierImplementationVersion: WORKING_DNA_RAW_VERIFIER_VERSION,
      observedTargetVersion: snapshot.version,
      observedTargetHash: snapshot.hash,
    });
  },
};

export async function verifyWorkingDnaReadAfterWrite(input: {
  cfg: OpenBotConfig;
  agentId: string;
  expectedEffect: ExpectedExternalEffect;
  applicationReceiptRef: string;
}): Promise<WorkingDnaRawObservation> {
  const result = await workingDnaReadAfterWriteVerifier.verify(
    {
      requestId: "legacy",
      proposalId: "legacy",
      experimentId: "legacy",
      applicationId: "legacy",
      target: { domain: "agent", agentId: input.agentId },
      expectedEffect: input.expectedEffect,
      applicationReceiptRef: input.applicationReceiptRef,
      tenantScope: null,
      verifierId: WORKING_DNA_RAW_VERIFIER_ID,
      evidenceRefs: [],
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
    {
      trustedTenantId: null,
      now: new Date().toISOString(),
      readDomain: createReadonlyEvolutionDomainReader({ styleConfig: input.cfg }),
      resolveCredential: async () => null,
      verifyReceipt: () => true,
    },
  );
  return {
    outcome: result.outcome,
    evidenceRefs: result.evidenceRefs,
    observationReceiptRef: result.observationReceiptRef,
    ...(result.observedTargetVersion
      ? { observedTargetVersion: result.observedTargetVersion }
      : {}),
    ...(result.observedTargetHash ? { observedTargetHash: result.observedTargetHash } : {}),
  };
}
