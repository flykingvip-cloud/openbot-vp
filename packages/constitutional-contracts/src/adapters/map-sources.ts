import type {
  ConstitutionalContract,
  ContractDomain,
  ContractProfile,
} from "../schemas/contract.js";
import { ConstitutionalContractSchema } from "../schemas/contract.js";
import type { ConstitutionalEvidence } from "../schemas/evidence.js";
import { ConstitutionalEvidenceSchema } from "../schemas/evidence.js";
import type { ConstitutionalIdentity } from "../schemas/identity.js";
import { ConstitutionalIdentitySchema } from "../schemas/identity.js";
import {
  EVOLUTION_LEDGER,
  EXECUTION_TRACE_LEDGER,
  PLUGIN_REGISTRY_LEDGER,
  VALIDATION_RECEIPT_LEDGER,
  type CapabilityGrantSource,
  type EvolutionLedgerSourceEvent,
  type ExecutionTraceSource,
  type PluginInstallSource,
  type ValidationReceiptSource,
} from "./source-records.js";

/**
 * Receipt-only evolution event names.
 * The first nine mirror `ledgerEventIsReceiptNotProof` in
 * `packages/evolution-core/src/lineage.ts`. `receipt.created` is classified
 * receipt-only here so this shadow copy does not promote it to proof.
 * This set is a read-only classifier, not a second ledger.
 */
export const EVOLUTION_RECEIPT_ONLY_EVENT_TYPES = [
  "application.applied",
  "application.rolled_back",
  "rollback_drill.started",
  "rollback_drill.completed",
  "rollback.started",
  "rollback.completed",
  "legacy.imported",
  "observation.excluded",
  "external_effect.recorded",
  "receipt.created",
] as const;

const RECEIPT_ONLY = new Set<string>(EVOLUTION_RECEIPT_ONLY_EVENT_TYPES);

/**
 * Domain-local writer labels copied from the discovery authority matrix.
 * Chat has no single owner, so the label is `unassigned`.
 * These strings are not import paths this package calls.
 */
export const DOMAIN_WRITE_AUTHORITY_LABELS: Record<ContractDomain, string> = {
  skill_delivery: "src/agents/execution-preflight",
  chat_turn: "unassigned",
  collaboration_task: "packages/collaboration-core",
  evolution: "packages/evolution-core",
  release: "deploy/production/scripts/verify-forward-only.sh",
};

function requireId(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${field} is required`);
  }
  return trimmed;
}

export function adaptEvolutionLedgerEvent(
  event: EvolutionLedgerSourceEvent,
): ConstitutionalEvidence {
  const eventId = requireId(event.eventId, "eventId");
  const type = requireId(event.type, "type");
  const proposalId = requireId(event.proposalId, "proposalId");
  const receiptOnly = RECEIPT_ONLY.has(type);

  if (receiptOnly) {
    return ConstitutionalEvidenceSchema.parse({
      schemaVersion: 1,
      evidenceId: `evolution:${eventId}`,
      grade: "receipt",
      receiptOnly: true,
      proofGrade: "none",
      sourceLedger: EVOLUTION_LEDGER,
      sourceEventType: type,
      subjectRef: proposalId,
      tenantScope: event.tenantScope,
      claimLevel: "code-present",
    });
  }

  if (type === "verification.completed" && event.effectProof && event.effectProof !== "none") {
    return ConstitutionalEvidenceSchema.parse({
      schemaVersion: 1,
      evidenceId: `evolution:${eventId}`,
      grade: "proof",
      receiptOnly: false,
      proofGrade: event.effectProof,
      sourceLedger: EVOLUTION_LEDGER,
      sourceEventType: type,
      subjectRef: proposalId,
      tenantScope: event.tenantScope,
      claimLevel: "code-present",
    });
  }

  return ConstitutionalEvidenceSchema.parse({
    schemaVersion: 1,
    evidenceId: `evolution:${eventId}`,
    grade: "audit_chain",
    receiptOnly: false,
    proofGrade: "none",
    sourceLedger: EVOLUTION_LEDGER,
    sourceEventType: type,
    subjectRef: proposalId,
    tenantScope: event.tenantScope,
    claimLevel: "code-present",
  });
}

/** A passed validation receipt stays a receipt. It is not effect proof. */
export function adaptValidationReceipt(receipt: ValidationReceiptSource): ConstitutionalEvidence {
  const taskId = requireId(receipt.taskId, "taskId");
  return ConstitutionalEvidenceSchema.parse({
    schemaVersion: 1,
    evidenceId: `validation-receipt:${taskId}:${requireId(receipt.artifactHash, "artifactHash")}`,
    grade: "receipt",
    receiptOnly: true,
    proofGrade: "none",
    sourceLedger: VALIDATION_RECEIPT_LEDGER,
    sourceEventType: `validation.${receipt.result}`,
    subjectRef: taskId,
    tenantScope: null,
    claimLevel: "code-present",
  });
}

/** In-request preflight trace. Not replayable proof. */
export function adaptExecutionTrace(trace: ExecutionTraceSource): ConstitutionalEvidence {
  const taskId = requireId(trace.taskId, "taskId");
  return ConstitutionalEvidenceSchema.parse({
    schemaVersion: 1,
    evidenceId: `execution-trace:${taskId}:${requireId(trace.decisionCode, "decisionCode")}`,
    grade: "in_request_trace",
    receiptOnly: false,
    proofGrade: "none",
    sourceLedger: EXECUTION_TRACE_LEDGER,
    sourceEventType: requireId(trace.decisionStage, "decisionStage"),
    subjectRef: taskId,
    tenantScope: null,
    claimLevel: "code-present",
  });
}

/**
 * Plugin registry row → install identity.
 * `enabled` / `loaded` never sets `capabilityAuthorized`.
 * Extra caller fields are ignored.
 */
export function adaptPluginInstall(record: PluginInstallSource): ConstitutionalIdentity {
  const id = requireId(record.id, "id");
  // Registry presence is the install fact. Enabled/loaded is still not a grant.
  const installed = record.status === "loaded" || record.status === "disabled";
  return ConstitutionalIdentitySchema.parse({
    schemaVersion: 1,
    identityId: `plugin-install:${id}`,
    kind: "plugin_install",
    principalRef: id,
    tenantScope: null,
    sourceLedger: PLUGIN_REGISTRY_LEDGER,
    workflowRef: null,
    selectedPath: null,
    installed,
    capabilityAuthorized: false,
    authorizationSourceLedger: null,
    claimLevel: "code-present",
  });
}

/**
 * Grant ledger → authorization identity.
 * Refuses the plugin registry as the authorization source.
 */
export function adaptCapabilityGrant(grant: CapabilityGrantSource): ConstitutionalIdentity {
  const grantId = requireId(grant.grantId, "grantId");
  const sourceLedger = requireId(grant.sourceLedger, "sourceLedger");
  if (sourceLedger === PLUGIN_REGISTRY_LEDGER) {
    throw new Error("plugin registry is an install ledger, not a capability authorization ledger");
  }
  const authorized = grant.status === "granted";
  return ConstitutionalIdentitySchema.parse({
    schemaVersion: 1,
    identityId: `capability-grant:${grantId}`,
    kind: "principal",
    principalRef: requireId(grant.principalRef, "principalRef"),
    tenantScope: grant.tenantScope,
    sourceLedger,
    workflowRef: null,
    selectedPath: null,
    installed: null,
    capabilityAuthorized: authorized,
    authorizationSourceLedger: authorized ? sourceLedger : null,
    claimLevel: "code-present",
  });
}

/** Labels a domain obligation. Does not open a writer. */
export function adaptDomainContract(input: {
  domain: ContractDomain;
  subjectRef: string;
  obligation: string;
  sourceLedger: string;
  profile?: ContractProfile;
  status?: "draft" | "observed";
}): ConstitutionalContract {
  const subjectRef = requireId(input.subjectRef, "subjectRef");
  return ConstitutionalContractSchema.parse({
    schemaVersion: 1,
    contractId: `contract:${input.domain}:${subjectRef}`,
    domain: input.domain,
    subjectRef,
    obligation: requireId(input.obligation, "obligation"),
    domainWriteAuthority: DOMAIN_WRITE_AUTHORITY_LABELS[input.domain],
    profile: input.profile ?? "unspecified",
    sourceLedger: requireId(input.sourceLedger, "sourceLedger"),
    status: input.status ?? "observed",
    crossDomainWriter: false,
  });
}
