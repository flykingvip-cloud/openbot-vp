import { adaptDomainContract } from "./adapters/map-sources.js";
import type { ConstitutionalSourceSnapshot } from "./read-model/ledger-view.js";

/** Sample rows shaped like existing ledgers. Used by unit tests. */
export const sampleSourceSnapshot = {
  evolutionEvents: [
    {
      eventId: "evt-applied",
      type: "application.applied",
      proposalId: "prop-1",
      surfaceId: "surface-1",
      tenantScope: "tenant-a",
      principalRef: "principal-1",
      effectProof: "verified",
    },
    {
      eventId: "evt-verified",
      type: "verification.completed",
      proposalId: "prop-1",
      surfaceId: "surface-1",
      tenantScope: "tenant-a",
      principalRef: "principal-1",
      effectProof: "verified",
    },
  ],
  validationReceipts: [
    {
      taskId: "task-1",
      artifactHash: "abc123",
      validatorId: "validator-1",
      timestamp: "2026-09-25T00:00:00.000Z",
      result: "passed",
    },
  ],
  executionTraces: [
    {
      taskId: "task-1",
      sessionId: "session-1",
      decisionCode: "allow",
      decisionStage: "preflight",
    },
  ],
  pluginInstalls: [
    {
      id: "plugin.demo",
      name: "Demo",
      version: "0.0.1",
      enabled: true,
      status: "loaded",
      source: "npm",
    },
  ],
  capabilityGrants: [
    {
      grantId: "grant-1",
      capabilityId: "web_read",
      principalRef: "principal-1",
      tenantScope: "tenant-a",
      status: "granted",
      sourceLedger: "capability-grants",
    },
  ],
  contracts: [
    {
      domain: "skill_delivery",
      subjectRef: "task-1",
      obligation: "validation receipt stays a receipt",
      sourceLedger: "execution-preflight-validation-receipt",
      profile: "personal_local",
    },
  ],
} as const satisfies ConstitutionalSourceSnapshot;

export function sampleContract() {
  return adaptDomainContract(sampleSourceSnapshot.contracts[0]);
}
