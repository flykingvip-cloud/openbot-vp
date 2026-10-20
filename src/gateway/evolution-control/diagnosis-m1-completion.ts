import fs from "node:fs";
/**
 * A12 binds a diagnosis recheck receipt to the shared completion judge.
 * payloadHash checks file integrity only. It is not an authenticity signature.
 * Promotion completion is read from the ledger by event id.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  decideEvolutionCompletion,
  decideEvaluationOutcome,
  evaluationPolicyFor,
  sealServerPromotionEvents,
  type DiagnosisRecheckResult,
  type ExternalEffectOutcome,
  type EvolutionApplication,
  type EvolutionCompletionEvidence,
  type EvolutionCompletionPromotionEvent,
  type EvolutionExperiment,
  type EvolutionLedgerEvent,
  type EvolutionProposal,
  type EvolutionVerification,
} from "@openbot/evolution-core";
import { type EvolutionLedger } from "./evolution-ledger.js";
import { createFileEvolutionLedger } from "./persistent-store.js";

export type DiagnosisReceiptFailCode =
  | "corrupt"
  | "truncated"
  | "unknown_schema"
  | "hash_mismatch"
  | "binding_mismatch"
  | "duplicate_command"
  | "atomic_write_failed"
  | "declared_build_sha"
  | "build_sha_unavailable"
  | "ledger_missing"
  | "forged_promotion";

export class DiagnosisReceiptFailClosedError extends Error {
  readonly code: DiagnosisReceiptFailCode;

  constructor(code: DiagnosisReceiptFailCode, message: string) {
    super(message);
    this.name = "DiagnosisReceiptFailClosedError";
    this.code = code;
  }
}

export type DiagnosisReceiptAuditRecord = {
  receiptId: string;
  createdAt: string;
  payloadHash: string;
  tenantId: string;
  proposalId: string;
  experimentId: string;
  applicationId: string;
  verificationId: string;
  operatorId: string;
  commandId: string;
  candidateVersion: string;
  recheckEvidenceRefs: string[];
  result: DiagnosisRecheckResult;
};

const PAYLOAD_HASH_PREFIX = "payloadHash:";

let buildInfoReader: (() => { commit?: string | null } | null) | undefined;

export function setDiagnosisReceiptBuildInfoForTests(
  read?: () => { commit?: string | null } | null,
): void {
  const flag = process.env.VITEST;
  if (flag !== "1" && flag !== "true") {
    buildInfoReader = undefined;
    return;
  }
  buildInfoReader = read;
}

export function resetDiagnosisReceiptBuildInfoForTests(): void {
  buildInfoReader = undefined;
}

export function resolveDiagnosisReceiptBuildSha(): string {
  const info = buildInfoReader ? buildInfoReader() : readRuntimeBuildInfo();
  const fromInfo = info?.commit?.trim() ?? "";
  if (fromInfo) {
    return fromInfo;
  }
  const fromEnv =
    process.env.OPENBOT_DIAGNOSIS_BUILD_SHA?.trim() || process.env.OPENBOT_BUILD_SHA?.trim() || "";
  if (fromEnv) {
    return fromEnv;
  }
  throw new DiagnosisReceiptFailClosedError(
    "build_sha_unavailable",
    "runtime build-info commit is missing (tried dist/build-info.json and OPENBOT_BUILD_SHA / OPENBOT_DIAGNOSIS_BUILD_SHA)",
  );
}

export function rejectDeclaredBuildSha(draft: object): void {
  if (!("buildSha" in draft)) {
    return;
  }
  const declared = (draft as { buildSha?: unknown }).buildSha;
  if (declared !== undefined) {
    throw new DiagnosisReceiptFailClosedError(
      "declared_build_sha",
      "buildSha must come from runtime build-info",
    );
  }
}

export function assertNotForgedPromotion(source: unknown): void {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return;
  }
  const record = source as Record<string, unknown>;
  if (
    record.type === "promotion.completed" ||
    "promotionEvent" in record ||
    "promotionCompleted" in record
  ) {
    throw new DiagnosisReceiptFailClosedError(
      "forged_promotion",
      "promotion completion must be read from the ledger by eventId",
    );
  }
}

export function payloadHashRef(payloadHash: string): string {
  return `${PAYLOAD_HASH_PREFIX}${payloadHash}`;
}

export function receiptCreatedEventId(receiptId: string): string {
  return `receipt.created:${receiptId}`;
}

export function openDiagnosisLedger(persistDir: string): EvolutionLedger {
  const filePath = path.join(persistDir, "ledger.jsonl");
  if (!fs.existsSync(filePath)) {
    throw new DiagnosisReceiptFailClosedError("ledger_missing", "evolution ledger is missing");
  }
  try {
    return createFileEvolutionLedger(filePath);
  } catch (error) {
    throw new DiagnosisReceiptFailClosedError(
      "corrupt",
      error instanceof Error ? error.message : "evolution ledger is unreadable",
    );
  }
}

export function appendReceiptCreatedEvent(input: {
  ledger: EvolutionLedger;
  record: DiagnosisReceiptAuditRecord;
  surfaceId: string;
}): void {
  const existing = input.ledger
    .list({ proposalId: input.record.proposalId })
    .filter(
      (event) =>
        event.type === "receipt.created" && event.domainReceiptRef === input.record.receiptId,
    );
  if (existing.length > 1) {
    throw new DiagnosisReceiptFailClosedError(
      "binding_mismatch",
      "receipt.created events disagree",
    );
  }
  const current = existing[0];
  if (current) {
    assertReceiptCreatedEvent(current, input.record);
    return;
  }
  input.ledger.append({
    eventId: receiptCreatedEventId(input.record.receiptId),
    type: "receipt.created",
    timestamp: input.record.createdAt,
    proposalId: input.record.proposalId,
    target: input.record.result.target,
    surfaceId: input.surfaceId,
    tenantScope: input.record.tenantId,
    principalRef: input.record.operatorId,
    grantId: input.record.commandId,
    evidenceRefs: [payloadHashRef(input.record.payloadHash), ...input.record.recheckEvidenceRefs],
    experimentId: input.record.experimentId,
    applicationId: input.record.applicationId,
    verificationId: input.record.verificationId,
    domainReceiptRef: input.record.receiptId,
  });
}

export function assertReceiptLedgerBinding(
  ledger: EvolutionLedger,
  record: DiagnosisReceiptAuditRecord,
): void {
  const events = ledger
    .list({ proposalId: record.proposalId })
    .filter(
      (event) => event.type === "receipt.created" && event.domainReceiptRef === record.receiptId,
    );
  if (events.length !== 1) {
    throw new DiagnosisReceiptFailClosedError(
      "ledger_missing",
      "receipt.created audit event is missing or duplicated",
    );
  }
  const event = events[0];
  if (!event) {
    throw new DiagnosisReceiptFailClosedError(
      "ledger_missing",
      "receipt.created audit event is missing",
    );
  }
  assertReceiptCreatedEvent(event, record);
}

export function evidenceForDiagnosisReceipt(input: {
  persistDir: string;
  record: DiagnosisReceiptAuditRecord;
  ledger: EvolutionLedger;
  promotionEventId?: string;
}): EvolutionCompletionEvidence {
  const proposal = readRecord<EvolutionProposal>(
    input.persistDir,
    "proposals.json",
    input.record.proposalId,
  );
  const experiment = readRecord<EvolutionExperiment>(
    input.persistDir,
    "experiments.json",
    input.record.experimentId,
  );
  const application = readRecord<EvolutionApplication>(
    input.persistDir,
    "applications.json",
    input.record.applicationId,
  );
  const verification = readRecord<EvolutionVerification>(
    input.persistDir,
    "verifications.json",
    input.record.verificationId,
  );
  if (!proposal || !experiment || !application || !verification) {
    throw new DiagnosisReceiptFailClosedError(
      "binding_mismatch",
      "recorded proposal, experiment, application, or verification is missing",
    );
  }
  const promotionEvents = promotionEventsForRead(
    input.ledger,
    input.record,
    proposal.candidateRef,
    input.promotionEventId,
  );
  const guardrailDegraded = (verification.guardrailResults ?? []).some((row) => row.degraded);
  const authorityOk = input.ledger
    .list({ proposalId: input.record.proposalId })
    .some(
      (event) =>
        event.type === "application.approved" &&
        event.applicationId === input.record.applicationId &&
        event.tenantScope === input.record.tenantId,
    );
  const rollbackDrillPassed = input.ledger
    .list({ proposalId: input.record.proposalId })
    .some((event) => event.type === "rollback_drill.completed");
  const policy = evaluationPolicyFor({
    surfaceId: proposal.surfaceId,
    producerKind: "diagnosis-origin",
  });
  const evaluation =
    "ok" in policy
      ? { action: "block" as const, reasonCode: "unknown_surface" }
      : decideEvaluationOutcome(policy, {
          experimentResult: experiment.result === "pending" ? "inconclusive" : experiment.result,
          guardrailDegraded,
          authorityOk,
          domainVerified: true,
          externalEffectOutcome: externalEffectFor(input.ledger, input.record),
          recheck: input.record.result.outcome,
          sampleSize: verification.sampleSize,
          confidence: verification.confidence,
          rollbackDrillPassed,
        });
  return {
    tenantId: input.record.tenantId,
    target: proposal.target,
    surfaceId: proposal.surfaceId,
    candidateVersion: input.record.candidateVersion,
    proposal,
    experiment,
    application,
    verification,
    recheck: input.record.result,
    recheckRecordedAt: input.record.createdAt,
    evaluation,
    promotionEvents: sealServerPromotionEvents(promotionEvents),
    authorityOk,
    guardrailDegraded,
  };
}

export function completionForEvidence(evidence: EvolutionCompletionEvidence) {
  return decideEvolutionCompletion(evidence);
}

function promotionEventsForRead(
  ledger: EvolutionLedger,
  record: DiagnosisReceiptAuditRecord,
  candidateRef: string,
  promotionEventId: string | undefined,
): EvolutionCompletionPromotionEvent[] {
  const events = ledger
    .list({ proposalId: record.proposalId })
    .filter((event) => event.type === "promotion.completed")
    .map((event) => toPromotionEvent(event, candidateRef));
  if (!promotionEventId?.trim()) {
    return events;
  }
  const selected = events.find((event) => event.eventId === promotionEventId);
  if (!selected) {
    throw new DiagnosisReceiptFailClosedError(
      "ledger_missing",
      "promotion event id is not in the ledger",
    );
  }
  return events;
}

function externalEffectFor(
  ledger: EvolutionLedger,
  record: DiagnosisReceiptAuditRecord,
): ExternalEffectOutcome | null {
  const latest = ledger
    .list({ proposalId: record.proposalId })
    .filter(
      (event) =>
        event.type === "external_effect.recorded" && event.applicationId === record.applicationId,
    )
    .at(-1);
  const outcome = latest?.externalEffectOutcome;
  if (
    outcome === "verified" ||
    outcome === "not_observed" ||
    outcome === "contradicted" ||
    outcome === "inconclusive"
  ) {
    return outcome;
  }
  return null;
}

function toPromotionEvent(
  event: EvolutionLedgerEvent,
  candidateRef: string,
): EvolutionCompletionPromotionEvent {
  return {
    eventId: event.eventId,
    type: event.type,
    tenantScope: event.tenantScope,
    proposalId: event.proposalId,
    experimentId: event.experimentId ?? null,
    applicationId: event.applicationId ?? null,
    verificationId: event.verificationId ?? null,
    target: event.target,
    surfaceId: event.surfaceId,
    candidateRef,
    principalRef: event.principalRef,
    timestamp: event.timestamp,
  };
}

function assertReceiptCreatedEvent(
  event: EvolutionLedgerEvent,
  record: DiagnosisReceiptAuditRecord,
): void {
  const hash = payloadHashRef(record.payloadHash);
  if (
    event.tenantScope !== record.tenantId ||
    event.proposalId !== record.proposalId ||
    event.applicationId !== record.applicationId ||
    event.verificationId !== record.verificationId ||
    event.domainReceiptRef !== record.receiptId ||
    !event.evidenceRefs.includes(hash)
  ) {
    throw new DiagnosisReceiptFailClosedError(
      "binding_mismatch",
      "receipt.created event does not match the receipt hash or binding",
    );
  }
}

function readRecord<T>(persistDir: string, fileName: string, id: string): T | null {
  const filePath = path.join(persistDir, fileName);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    throw new DiagnosisReceiptFailClosedError("corrupt", `${fileName} is unreadable`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new DiagnosisReceiptFailClosedError("corrupt", `${fileName} is unreadable`);
  }
  const row = (parsed as Record<string, T>)[id];
  return row ?? null;
}

function readRuntimeBuildInfo(): { commit?: string | null } | null {
  const require = createRequire(import.meta.url);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "../../../dist/build-info.json"),
    path.join(process.cwd(), "dist/build-info.json"),
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    try {
      return require(candidate) as { commit?: string | null };
    } catch {
      // try next candidate / env fallback
    }
  }
  const fromEnv =
    process.env.OPENBOT_DIAGNOSIS_BUILD_SHA?.trim() || process.env.OPENBOT_BUILD_SHA?.trim() || "";
  if (fromEnv) {
    return { commit: fromEnv };
  }
  return null;
}
