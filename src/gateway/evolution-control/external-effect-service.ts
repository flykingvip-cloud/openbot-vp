import type {
  EvolutionApplication,
  EvolutionProposal,
  EvolutionTarget,
  ExpectedExternalEffect,
  ExternalEffectDomainReader,
  ExternalEffectVerificationRequest,
  ExternalEffectVerificationResult,
} from "@openbot/evolution-core";
import {
  applicationReceiptIsNotEffectProof,
  assertExternalEffectBinding,
  bindExternalEffectResult,
  observationReceiptMatchesRequest,
} from "@openbot/evolution-core";
import type { OpenBotConfig } from "../../config/config.js";
import { writeEffectVerificationAudit } from "./effect-verification-audit.js";
import {
  assertVerifierMaySubmit,
  createVerifierRegistry,
  type VerifierRegistry,
} from "./external-effect-registry.js";
import { createDurableMap } from "./persistent-store.js";
import { createReadonlyEvolutionDomainReader } from "./verifiers/readonly-domain.js";

class VerifierTimeoutError extends Error {
  constructor() {
    super("verifier-timeout");
    this.name = "VerifierTimeoutError";
  }
}

function withVerifierTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new VerifierTimeoutError()), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export type ExternalEffectService = {
  registry: VerifierRegistry;
  requestVerification(input: {
    proposal: EvolutionProposal;
    application: EvolutionApplication;
    target: EvolutionTarget;
    expectedEffect: ExpectedExternalEffect;
    verifierId: string;
    now: string;
    expiresAt: string;
  }): ExternalEffectVerificationRequest;
  verifyBoundRequest(input: {
    requestId: string;
    proposal: EvolutionProposal;
    application: EvolutionApplication;
    now: string;
    trustedTenantId?: string | null;
    runId?: string;
  }): Promise<ExternalEffectVerificationResult>;
  submitResult(input: unknown): never;
  getResultForApplication(applicationId: string): ExternalEffectVerificationResult | undefined;
  listResults(): ExternalEffectVerificationResult[];
  listConflicts(): ExternalEffectVerificationResult[];
};

function failClosedResult(
  request: ExternalEffectVerificationRequest,
  now: string,
  code: string,
): ExternalEffectVerificationResult {
  return bindExternalEffectResult({
    request,
    outcome: "inconclusive",
    observedAt: now,
    evidenceRefs: [],
    observationReceiptRef: `fail-closed:${code}`,
    verifierImplementationVersion: "none",
  });
}

export function createExternalEffectService(options?: {
  persistDir?: string;
  styleConfig?: OpenBotConfig;
  skillEventsConfigDir?: string;
  registry?: VerifierRegistry;
  domainReader?: ExternalEffectDomainReader;
  verifyTimeoutMs?: number;
}): ExternalEffectService {
  const persistDir = options?.persistDir?.trim();
  const verifyTimeoutMs = options?.verifyTimeoutMs ?? 8_000;
  const registry =
    options?.registry ??
    createVerifierRegistry(persistDir ? `${persistDir}/verifier-registry.json` : undefined);
  const requests = createDurableMap<ExternalEffectVerificationRequest>(
    persistDir ? `${persistDir}/external-effect-requests.json` : undefined,
  );
  const results = createDurableMap<ExternalEffectVerificationResult>(
    persistDir ? `${persistDir}/external-effect-results.json` : undefined,
  );
  const conflicts = createDurableMap<ExternalEffectVerificationResult>(
    persistDir ? `${persistDir}/external-effect-conflicts.json` : undefined,
  );
  const readDomain =
    options?.domainReader ??
    createReadonlyEvolutionDomainReader({
      styleConfig: options?.styleConfig,
      skillEventsConfigDir: options?.skillEventsConfigDir,
    });

  const putResult = (
    result: ExternalEffectVerificationResult,
  ): ExternalEffectVerificationResult => {
    const existing = results.get(result.requestId);
    if (existing) {
      if (existing.outcome === result.outcome) {
        return existing;
      }
      conflicts.set(result.requestId, result);
      return existing;
    }
    results.set(result.requestId, result);
    return result;
  };

  return {
    registry,
    requestVerification(input) {
      const requestId = `eef:${input.application.applicationId}`;
      const existing = requests.get(requestId);
      if (existing) {
        return existing;
      }
      const request: ExternalEffectVerificationRequest = {
        requestId,
        proposalId: input.proposal.proposalId,
        experimentId: input.application.experimentId,
        applicationId: input.application.applicationId,
        target: input.target,
        expectedEffect: input.expectedEffect,
        applicationReceiptRef: `app-receipt:${input.application.applicationId}`,
        tenantScope: input.proposal.tenantScope,
        verifierId: input.verifierId,
        evidenceRefs: input.proposal.sourceEvidenceRefs,
        expiresAt: input.expiresAt,
      };
      void applicationReceiptIsNotEffectProof(request.applicationReceiptRef);
      requests.set(requestId, request);
      return request;
    },
    async verifyBoundRequest(input) {
      const request = requests.get(input.requestId);
      if (!request) {
        throw new Error(`external effect request not found: ${input.requestId}`);
      }
      const bound = assertExternalEffectBinding({
        request,
        proposalId: input.proposal.proposalId,
        experimentId: input.application.experimentId,
        applicationId: input.application.applicationId,
        target: input.proposal.target,
        tenantScope: input.proposal.tenantScope,
      });
      if (!bound.ok) {
        throw new Error(bound.reason);
      }
      if (Date.parse(request.expiresAt) <= Date.parse(input.now)) {
        throw new Error("external effect request expired");
      }
      const implementation = registry.resolve(request.verifierId);
      if (!implementation) {
        return putResult(failClosedResult(request, input.now, "verifier-unimplemented"));
      }
      const allowed = assertVerifierMaySubmit({
        verifier: registry.get(request.verifierId),
        now: input.now,
        adapterId: input.application.adapterId,
        tenantScope: input.proposal.tenantScope,
        effectKind: request.expectedEffect.kind,
        targetDomain: input.proposal.target.domain,
      });
      if (!allowed.ok) {
        return putResult(failClosedResult(request, input.now, allowed.code));
      }
      let produced: ExternalEffectVerificationResult;
      try {
        produced = await withVerifierTimeout(
          implementation.verify(request, {
            trustedTenantId: input.trustedTenantId ?? input.proposal.tenantScope,
            now: input.now,
            readDomain,
            resolveCredential: async () => null,
            verifyReceipt: observationReceiptMatchesRequest,
          }),
          verifyTimeoutMs,
        );
      } catch (error) {
        const code = error instanceof VerifierTimeoutError ? "verifier-timeout" : "verifier-error";
        const failed = putResult(failClosedResult(request, input.now, code));
        writeEffectVerificationAudit({
          runId: input.runId ?? input.application.applicationId,
          agentId:
            input.proposal.target.domain === "agent" ? input.proposal.target.agentId : undefined,
          tenantId: input.proposal.tenantScope,
          surfaceId: input.proposal.surfaceId,
          target: input.proposal.target,
          beforeState: input.application.targetVersionBefore,
          afterState: null,
          outcome: failed.outcome,
          verifierVersion: implementation.implementationVersion,
          reason: code,
          persistDir,
          now: input.now,
        });
        return failed;
      }
      if (!observationReceiptMatchesRequest(produced.receipt, request)) {
        return putResult(failClosedResult(request, input.now, "receipt-replay"));
      }
      const result = putResult(
        bindExternalEffectResult({
          request,
          outcome: produced.outcome,
          observedAt: input.now,
          evidenceRefs: produced.evidenceRefs,
          observationReceiptRef: produced.observationReceiptRef,
          verifierImplementationVersion: implementation.implementationVersion,
          observedTargetVersion: produced.observedTargetVersion,
          observedTargetHash: produced.observedTargetHash,
        }),
      );
      writeEffectVerificationAudit({
        runId: input.runId ?? input.application.applicationId,
        agentId:
          input.proposal.target.domain === "agent" ? input.proposal.target.agentId : undefined,
        tenantId: input.proposal.tenantScope,
        surfaceId: input.proposal.surfaceId,
        target: input.proposal.target,
        beforeState: input.application.targetVersionBefore,
        afterState: {
          version: produced.observedTargetVersion ?? null,
          hash: produced.observedTargetHash ?? null,
          receipt: produced.observationReceiptRef,
        },
        outcome: result.outcome,
        verifierVersion: implementation.implementationVersion,
        reason: result.outcome,
        persistDir,
        now: input.now,
      });
      return result;
    },
    submitResult(_input: unknown): never {
      throw new Error("external effect results can only be produced by verifyBoundRequest");
    },
    getResultForApplication(applicationId) {
      return results.get(`eef:${applicationId}`);
    },
    listResults() {
      return [...results.values()];
    },
    listConflicts() {
      return [...conflicts.values()];
    },
  };
}

export type { ExternalEffectOutcome } from "@openbot/evolution-core";
