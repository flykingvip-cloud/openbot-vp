/**
 * Skill installation read-after-write verifier.
 *
 * Reads Skill Lifecycle SoT only. Does not call SkillAdapter
 * apply/install/promote/rollback and does not treat an application receipt
 * as proof.
 */
import type { EvolutionVerifierRecord, ExternalEffectVerifier } from "@openbot/evolution-core";
import { bindExternalEffectResult, codeIdentityCredentialRef } from "@openbot/evolution-core";

export const SKILL_INSTALLATION_RAW_VERIFIER_ID = "skill-installation-read-after-write";
export const SKILL_INSTALLATION_RAW_VERIFIER_KIND = "skill-lifecycle-store-readonly";
export const SKILL_INSTALLATION_RAW_VERIFIER_VERSION = "1";

export const SKILL_INSTALLATION_RAW_VERIFIER_RECORD: EvolutionVerifierRecord = {
  verifierId: SKILL_INSTALLATION_RAW_VERIFIER_ID,
  verifierKind: SKILL_INSTALLATION_RAW_VERIFIER_KIND,
  supportedTargetDomains: ["capability"],
  supportedEffectKinds: ["skill-installation"],
  tenantScope: null,
  credentialRef: codeIdentityCredentialRef(SKILL_INSTALLATION_RAW_VERIFIER_ID),
  trustedBy: "code-identity",
  status: "active",
  expiresAt: "2099-01-01T00:00:00.000Z",
  independentFromAdapterIds: ["skill-installation", "skill"],
  authorityGrantRef: codeIdentityCredentialRef(SKILL_INSTALLATION_RAW_VERIFIER_ID),
};

export const skillInstallationReadAfterWriteVerifier: ExternalEffectVerifier = {
  verifierId: SKILL_INSTALLATION_RAW_VERIFIER_ID,
  verifierKind: SKILL_INSTALLATION_RAW_VERIFIER_KIND,
  implementationVersion: SKILL_INSTALLATION_RAW_VERIFIER_VERSION,
  supportedDomains: ["capability"],
  supportedEffectKinds: ["skill-installation"],
  async verify(request, context) {
    void context.resolveCredential;
    if (request.target.domain !== "capability") {
      return bindExternalEffectResult({
        request,
        outcome: "inconclusive",
        observedAt: context.now,
        evidenceRefs: [],
        observationReceiptRef: "fail-closed:target-mismatch",
        verifierImplementationVersion: SKILL_INSTALLATION_RAW_VERIFIER_VERSION,
      });
    }
    if (
      !request.expectedEffect.field &&
      request.expectedEffect.expectedValue == null &&
      !request.expectedEffect.expectedVersion
    ) {
      return bindExternalEffectResult({
        request,
        outcome: "not_observed",
        observedAt: context.now,
        evidenceRefs: [request.applicationReceiptRef],
        observationReceiptRef: `receipt-only:${request.applicationReceiptRef}`,
        verifierImplementationVersion: SKILL_INSTALLATION_RAW_VERIFIER_VERSION,
      });
    }
    const agentId = request.expectedEffect.agentId?.trim();
    if (!agentId) {
      return bindExternalEffectResult({
        request,
        outcome: "inconclusive",
        observedAt: context.now,
        evidenceRefs: [],
        observationReceiptRef: "fail-closed:missing-agent",
        verifierImplementationVersion: SKILL_INSTALLATION_RAW_VERIFIER_VERSION,
      });
    }
    if (request.tenantScope) {
      const tenant = await context.readDomain.readAgentTenantEvidence?.(agentId);
      if (!tenant || tenant.status === "unavailable") {
        return bindExternalEffectResult({
          request,
          outcome: "inconclusive",
          observedAt: context.now,
          evidenceRefs: [],
          observationReceiptRef: `tenant-unavailable:${agentId}`,
          verifierImplementationVersion: SKILL_INSTALLATION_RAW_VERIFIER_VERSION,
        });
      }
      if (
        tenant.status === "conflict" ||
        tenant.tenantId !== request.tenantScope ||
        (context.trustedTenantId != null && tenant.tenantId !== context.trustedTenantId)
      ) {
        return bindExternalEffectResult({
          request,
          outcome: "contradicted",
          observedAt: context.now,
          evidenceRefs: [],
          observationReceiptRef: `tenant-mismatch:${agentId}`,
          verifierImplementationVersion: SKILL_INSTALLATION_RAW_VERIFIER_VERSION,
        });
      }
    }
    const snapshot = await context.readDomain.readSkillInstallation?.({
      agentId,
      skillId: request.target.skillId,
    });
    if (!snapshot || snapshot.status === "unreadable") {
      return bindExternalEffectResult({
        request,
        outcome: "inconclusive",
        observedAt: context.now,
        evidenceRefs: [],
        observationReceiptRef: `skill-unreadable:${request.target.skillId}`,
        verifierImplementationVersion: SKILL_INSTALLATION_RAW_VERIFIER_VERSION,
      });
    }
    if (snapshot.status === "missing") {
      return bindExternalEffectResult({
        request,
        outcome: "contradicted",
        observedAt: context.now,
        evidenceRefs: [],
        observationReceiptRef: `skill-missing:${agentId}:${request.target.skillId}`,
        verifierImplementationVersion: SKILL_INSTALLATION_RAW_VERIFIER_VERSION,
      });
    }
    const expectedVersion =
      request.expectedEffect.expectedValue ?? request.expectedEffect.expectedVersion;
    const versionMatches =
      snapshot.installedVersion === expectedVersion || snapshot.skillVersion === expectedVersion;
    const enabledMatches =
      typeof request.expectedEffect.expectedEnabled !== "boolean" ||
      snapshot.enabled === request.expectedEffect.expectedEnabled;
    const agentMatches =
      snapshot.agentId === agentId && snapshot.skillId === request.target.skillId;
    if (!versionMatches || !enabledMatches || !agentMatches) {
      return bindExternalEffectResult({
        request,
        outcome: "contradicted",
        observedAt: context.now,
        evidenceRefs: [`skill:${snapshot.skillId}:${snapshot.installedVersion}`],
        observationReceiptRef: `skill-mismatch:${snapshot.installedVersion}`,
        verifierImplementationVersion: SKILL_INSTALLATION_RAW_VERIFIER_VERSION,
        observedTargetVersion: snapshot.skillVersion,
      });
    }
    return bindExternalEffectResult({
      request,
      outcome: "verified",
      observedAt: context.now,
      evidenceRefs: [`skill:${snapshot.skillId}:${snapshot.installedVersion}`],
      observationReceiptRef: `skill-verified:${agentId}:${snapshot.installedVersion}`,
      verifierImplementationVersion: SKILL_INSTALLATION_RAW_VERIFIER_VERSION,
      observedTargetVersion: snapshot.skillVersion,
    });
  },
};
