/**
 * A12 receipt contract for a diagnosis M1 recheck.
 * Verification, recheck, and promotion stay separate facts.
 * Completion is decided only by decideEvolutionCompletion.
 * payloadHash checks file integrity. It is not an authenticity signature.
 * This module does not Promote and does not write promotion.completed.
 * A stored receipt is readable only after schema, hash, and ledger checks.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  decideEvolutionCompletion,
  decideEvolutionCompletionFromLedger,
  emptyServerPromotionEvents,
  evolutionTargetKey,
  type CompletionLedgerQuery,
  type CompletionLedgerReader,
  type DiagnosisRecheckOutcome,
  type DiagnosisRecheckResult,
  type EvaluationAction,
  type EvaluationDecision,
  type EvolutionCompletionEvidence,
  type EvolutionCompletionTarget,
} from "@openbot/evolution-core";
import {
  recommendDiagnosisApplyFollowUp,
  type DiagnosisApplyFollowUp,
} from "./diagnosis-apply-gate.js";
import {
  appendReceiptCreatedEvent,
  assertNotForgedPromotion,
  assertReceiptLedgerBinding,
  DiagnosisReceiptFailClosedError,
  evidenceForDiagnosisReceipt,
  openDiagnosisLedger,
  type DiagnosisReceiptAuditRecord,
  rejectDeclaredBuildSha,
  resetDiagnosisReceiptBuildInfoForTests,
  resolveDiagnosisReceiptBuildSha,
} from "./diagnosis-m1-completion.js";
import type { EvolutionLedger } from "./evolution-ledger.js";

export {
  DiagnosisReceiptFailClosedError,
  setDiagnosisReceiptBuildInfoForTests,
  type DiagnosisReceiptFailCode,
} from "./diagnosis-m1-completion.js";

export const DIAGNOSIS_M1_RECEIPT_SCHEMA_VERSION = 1 as const;

export type DiagnosisM1PromotionStatus = "ineligible" | "eligible" | "completed";

export type DiagnosisM1Closure = {
  applicationVerified: boolean;
  diagnosisRecheckOutcome: DiagnosisRecheckOutcome | null;
  promotionEligible: boolean;
  promotionStatus: DiagnosisM1PromotionStatus;
  recommendation: DiagnosisApplyFollowUp;
  userVisibleStatus: string;
  recordsPromotionCompleted: false;
};

export type DiagnosisPromotionEventBinding = {
  type: string;
  tenantScope: string | null;
  proposalId: string;
  applicationId?: string;
  verificationId?: string;
};

export type DiagnosisReceiptBinding = {
  tenantId: string;
  proposalId: string;
  applicationId: string;
  verificationId: string;
};

export type DiagnosisM1ClosureInput = {
  applicationVerified: boolean;
  diagnosisRecheckOutcome: DiagnosisRecheckOutcome | null;
  sotReadable: boolean;
  guardrailRegressed?: boolean;
  promotionEvent?: DiagnosisPromotionEventBinding | null;
  receiptBinding?: DiagnosisReceiptBinding | null;
  /** Full chain without caller-supplied promotion events. */
  completionEvidence?: Omit<EvolutionCompletionEvidence, "promotionEvents">;
  /** Server ledger query. Caller promotion events are not read from here. */
  completionLedger?: {
    reader: CompletionLedgerReader;
    query: CompletionLedgerQuery;
    target: EvolutionCompletionTarget;
    surfaceId: string;
    candidateVersion: string;
    authorityOk: boolean;
    guardrailDegraded: boolean;
    evaluation?: EvaluationDecision | null;
  };
};

const VERIFIED_NOT_EVOLVED = "已验证，进化未完成";
const EVOLUTION_COMPLETED = "已完成进化";

function followUpAction(followUp: DiagnosisApplyFollowUp): EvaluationAction {
  return followUp === "fail-closed" ? "block" : followUp;
}

/**
 * Thin receipt calls do not carry the full chain. They still go through the
 * shared judge, and a partial promotion event cannot complete.
 */
function evidenceFromDiagnosisClosure(input: DiagnosisM1ClosureInput): EvolutionCompletionEvidence {
  const outcome = input.diagnosisRecheckOutcome;
  const sotReadable = input.sotReadable && outcome !== null;
  const followUp = recommendDiagnosisApplyFollowUp({
    recheckOutcome: outcome ?? "BLOCKED",
    guardrailRegressed: input.guardrailRegressed,
    sotReadable,
  });
  const binding = input.receiptBinding;
  const event = input.promotionEvent;
  const tenantId = binding?.tenantId ?? event?.tenantScope ?? "legacy";
  const proposalId = binding?.proposalId ?? event?.proposalId ?? "legacy-proposal";
  const applicationId = binding?.applicationId ?? event?.applicationId ?? "legacy-application";
  const verificationId = binding?.verificationId ?? event?.verificationId ?? "legacy-verification";
  const experimentId = "legacy-experiment";
  const surfaceId = "legacy.surface";
  const candidateVersion = "legacy-candidate";
  const target = { domain: "agent" as const, agentId: "legacy" };
  const verified = input.applicationVerified;
  const recheck =
    outcome == null
      ? null
      : {
          outcome,
          reasonCode: "legacy_projection",
          findingRefs: [] as string[],
          target,
          verificationRef: {
            schemaVersion: 1 as const,
            proposalId,
            experimentId,
            applicationId,
            verificationId,
          },
          observedEvidenceRefs: [] as string[],
        };
  return {
    tenantId,
    target,
    surfaceId,
    candidateVersion,
    proposal: {
      proposalId,
      status: verified ? "VERIFIED" : "APPROVED",
      tenantScope: tenantId,
      surfaceId,
      candidateRef: candidateVersion,
      target,
    },
    experiment: {
      experimentId,
      proposalId,
      surfaceId,
      tenantScope: tenantId,
      candidateRef: candidateVersion,
    },
    application: {
      applicationId,
      proposalId,
      experimentId,
      status: "applied",
    },
    verification: {
      verificationId,
      applicationId,
      outcome: verified ? "verified" : "pending",
      verifiedAt: "1970-01-01T00:00:00.000Z",
    },
    recheck,
    recheckRecordedAt: recheck ? "1970-01-01T00:00:01.000Z" : null,
    evaluation: { action: followUpAction(followUp), reasonCode: "legacy_projection" },
    promotionEvents: emptyServerPromotionEvents(),
    authorityOk: false,
    guardrailDegraded: input.guardrailRegressed === true,
  };
}

function closureFromDecision(
  decision: ReturnType<typeof decideEvolutionCompletion>,
): DiagnosisM1Closure {
  const promotionStatus: DiagnosisM1PromotionStatus = decision.promotionCompleted
    ? "completed"
    : decision.promotionEligible
      ? "eligible"
      : "ineligible";
  return {
    applicationVerified: decision.applicationVerified,
    diagnosisRecheckOutcome: decision.recheckOutcome,
    promotionEligible: decision.promotionEligible,
    promotionStatus,
    recommendation: decision.recommendation,
    userVisibleStatus: decision.userVisibleStatus,
    recordsPromotionCompleted: false,
  };
}

export function projectDiagnosisM1Closure(input: DiagnosisM1ClosureInput): DiagnosisM1Closure {
  if (input.promotionEvent) {
    return closureFromDecision({
      applicationVerified: false,
      recheckOutcome: input.diagnosisRecheckOutcome,
      promotionEligible: false,
      promotionCompleted: false,
      recommendation: "fail-closed",
      reasonCode: "caller_promotion_rejected",
      userVisibleStatus: "无法确认，已停止",
    });
  }
  if (input.completionLedger) {
    return closureFromDecision(
      decideEvolutionCompletionFromLedger({
        reader: input.completionLedger.reader,
        query: input.completionLedger.query,
        target: input.completionLedger.target,
        surfaceId: input.completionLedger.surfaceId,
        candidateVersion: input.completionLedger.candidateVersion,
        authorityOk: input.completionLedger.authorityOk,
        guardrailDegraded: input.completionLedger.guardrailDegraded,
        evaluation: input.completionLedger.evaluation,
      }),
    );
  }
  return closureFromDecision(
    decideEvolutionCompletion(
      input.completionEvidence
        ? { ...input.completionEvidence, promotionEvents: emptyServerPromotionEvents() }
        : evidenceFromDiagnosisClosure(input),
    ),
  );
}

export function userVisibleStatus(input: {
  applicationVerified: boolean;
  promotionStatus: DiagnosisM1PromotionStatus;
  recommendation: DiagnosisApplyFollowUp;
  promotionEventBound?: boolean;
}): string {
  if (
    input.promotionStatus === "completed" &&
    input.promotionEventBound === true &&
    input.recommendation === "promote"
  ) {
    return EVOLUTION_COMPLETED;
  }
  if (input.applicationVerified) {
    return VERIFIED_NOT_EVOLVED;
  }
  if (input.recommendation === "rollback") {
    return "建议回滚";
  }
  if (input.recommendation === "observe") {
    return "继续观察";
  }
  if (input.recommendation === "hold") {
    return "保持现状";
  }
  if (input.recommendation === "fail-closed") {
    return "无法确认，已停止";
  }
  return "尚未验证";
}

export type DiagnosisM1ReceiptRecord = {
  schemaVersion: typeof DIAGNOSIS_M1_RECEIPT_SCHEMA_VERSION;
  receiptId: string;
  createdAt: string;
  payloadHash: string;
  tenantId: string;
  target: string;
  proposalId: string;
  experimentId: string;
  applicationId: string;
  verificationId: string;
  candidateVersion: string;
  operatorId: string;
  commandId: string;
  buildSha: string;
  recheckEvidenceRefs: string[];
  result: DiagnosisRecheckResult;
  closure: DiagnosisM1Closure;
};

export type DiagnosisRecheckReceiptDraft = {
  receiptId: string;
  tenantId: string;
  target: string;
  proposalId: string;
  experimentId: string;
  applicationId: string;
  verificationId: string;
  candidateVersion: string;
  operatorId: string;
  commandId: string;
  result: DiagnosisRecheckResult;
  applicationVerified?: boolean;
  closure?: DiagnosisM1Closure;
  recheckEvidenceRefs?: readonly string[];
  createdAt?: string;
};

export type DiagnosisReceiptQuery = {
  tenantId: string;
  proposalId: string;
  receiptId?: string;
  applicationId?: string;
  verificationId?: string;
};

type ReceiptFile = {
  schemaVersion: typeof DIAGNOSIS_M1_RECEIPT_SCHEMA_VERSION;
  receipts: Record<string, DiagnosisM1ReceiptRecord>;
};

const cache = new Map<string, DiagnosisM1ReceiptRecord>();
const receiptDirs = new Map<string, string>();

let atomicWriteOverride: ((filePath: string, body: string) => void) | undefined;

export function setDiagnosisReceiptAtomicWriteForTests(
  write?: (filePath: string, body: string) => void,
): void {
  const flag = process.env.VITEST;
  if (flag !== "1" && flag !== "true") {
    atomicWriteOverride = undefined;
    return;
  }
  atomicWriteOverride = write;
}

export function resetDiagnosisM1ReceiptsForTests(): void {
  cache.clear();
  receiptDirs.clear();
  atomicWriteOverride = undefined;
  resetDiagnosisReceiptBuildInfoForTests();
}

function requireText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new DiagnosisReceiptFailClosedError("binding_mismatch", `${label} is required`);
  }
  return trimmed;
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).toSorted()) {
      sorted[key] = canonicalize(source[key]);
    }
    return sorted;
  }
  return value;
}

export function hashDiagnosisM1ReceiptPayload(
  payload: Omit<DiagnosisM1ReceiptRecord, "payloadHash">,
): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(payload)))
    .digest("hex");
}

/**
 * Receipt freeze path: strip ledger promotion so a stored receipt never claims
 * promotion.completed (recordsPromotionCompleted stays false).
 */
function closureFromEvidence(evidence: EvolutionCompletionEvidence): DiagnosisM1Closure {
  const { promotionEvents: _promotionEvents, ...trustedEvidence } = evidence;
  return projectDiagnosisM1Closure({
    applicationVerified: false,
    diagnosisRecheckOutcome: evidence.recheck?.outcome ?? null,
    sotReadable: evidence.recheck != null,
    completionEvidence: trustedEvidence,
  });
}

/**
 * Live status path: honor server-queried ledger promotion.completed (and
 * application.approved via evidence.authorityOk) so post-promote projection
 * does not false-negative.
 */
function closureFromLiveEvidence(evidence: EvolutionCompletionEvidence): DiagnosisM1Closure {
  return closureFromDecision(decideEvolutionCompletion(evidence));
}

function assertResultBinding(draft: {
  tenantId: string;
  target: string;
  proposalId: string;
  experimentId: string;
  applicationId: string;
  verificationId: string;
  recheckEvidenceRefs: readonly string[];
  result: DiagnosisRecheckResult;
}): void {
  const ref = draft.result.verificationRef;
  if (
    ref.proposalId !== draft.proposalId ||
    ref.experimentId !== draft.experimentId ||
    ref.applicationId !== draft.applicationId ||
    ref.verificationId !== draft.verificationId
  ) {
    throw new DiagnosisReceiptFailClosedError(
      "binding_mismatch",
      "recheck verification ref does not match the receipt binding",
    );
  }
  if (evolutionTargetKey(draft.result.target) !== draft.target) {
    throw new DiagnosisReceiptFailClosedError(
      "binding_mismatch",
      "recheck target does not match the receipt binding",
    );
  }
  if (
    draft.recheckEvidenceRefs.length === 0 ||
    !sameList(draft.recheckEvidenceRefs, draft.result.observedEvidenceRefs)
  ) {
    throw new DiagnosisReceiptFailClosedError(
      "binding_mismatch",
      "recheck evidence refs do not match the receipt binding",
    );
  }
  requireText(draft.tenantId, "tenantId");
}

function assertStoredClosure(
  _persistDir: string,
  record: DiagnosisM1ReceiptRecord,
  _ledger: EvolutionLedger,
): void {
  // Historical receipts freeze closure at write time. Later ledger facts
  // (application.approved, promotion.completed) must not invalidate them.
  // Integrity remains via payloadHash + receipt.created ledger binding.
  if (
    record.closure.diagnosisRecheckOutcome !== record.result.outcome ||
    record.closure.recordsPromotionCompleted
  ) {
    throw new DiagnosisReceiptFailClosedError(
      "binding_mismatch",
      "stored closure does not match the recheck result",
    );
  }
}

function assertReceiptRecord(
  persistDir: string,
  value: unknown,
  ledger: EvolutionLedger,
): DiagnosisM1ReceiptRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DiagnosisReceiptFailClosedError("corrupt", "receipt record is not an object");
  }
  const record = value as Partial<DiagnosisM1ReceiptRecord>;
  if (record.schemaVersion !== DIAGNOSIS_M1_RECEIPT_SCHEMA_VERSION) {
    throw new DiagnosisReceiptFailClosedError("unknown_schema", "receipt schema is not supported");
  }
  const { payloadHash, ...payload } = record as DiagnosisM1ReceiptRecord;
  if (typeof payloadHash !== "string" || !payloadHash.trim()) {
    throw new DiagnosisReceiptFailClosedError("hash_mismatch", "receipt payload hash is missing");
  }
  const expected = hashDiagnosisM1ReceiptPayload(payload);
  if (expected !== payloadHash) {
    throw new DiagnosisReceiptFailClosedError(
      "hash_mismatch",
      "receipt payload hash does not match",
    );
  }
  assertResultBinding(record as DiagnosisM1ReceiptRecord);
  assertStoredClosure(persistDir, record as DiagnosisM1ReceiptRecord, ledger);
  assertReceiptLedgerBinding(ledger, record as DiagnosisM1ReceiptRecord);
  return record as DiagnosisM1ReceiptRecord;
}

function receiptPath(persistDir: string): string {
  return path.join(persistDir, "diagnosis-recheck-receipts.json");
}

function readStore(persistDir: string): ReceiptFile {
  const filePath = receiptPath(persistDir);
  if (!fs.existsSync(filePath)) {
    return { schemaVersion: DIAGNOSIS_M1_RECEIPT_SCHEMA_VERSION, receipts: {} };
  }
  const raw = fs.readFileSync(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    cache.clear();
    receiptDirs.clear();
    const code = raw.trim().endsWith("}") ? "corrupt" : "truncated";
    throw new DiagnosisReceiptFailClosedError(code, "diagnosis recheck receipt file is unreadable");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    cache.clear();
    receiptDirs.clear();
    throw new DiagnosisReceiptFailClosedError(
      "corrupt",
      "diagnosis recheck receipt file is unreadable",
    );
  }
  const schemaVersion = (parsed as { schemaVersion?: unknown }).schemaVersion;
  if (schemaVersion !== DIAGNOSIS_M1_RECEIPT_SCHEMA_VERSION) {
    cache.clear();
    receiptDirs.clear();
    throw new DiagnosisReceiptFailClosedError(
      "unknown_schema",
      "diagnosis recheck receipt file schema is not supported",
    );
  }
  const receipts = (parsed as { receipts?: unknown }).receipts;
  if (!receipts || typeof receipts !== "object" || Array.isArray(receipts)) {
    cache.clear();
    receiptDirs.clear();
    throw new DiagnosisReceiptFailClosedError(
      "corrupt",
      "diagnosis recheck receipt file is unreadable",
    );
  }
  try {
    const validated: Record<string, DiagnosisM1ReceiptRecord> = {};
    const ledger = Object.keys(receipts).length === 0 ? null : openDiagnosisLedger(persistDir);
    for (const [receiptId, receipt] of Object.entries(receipts)) {
      if (!ledger) {
        throw new DiagnosisReceiptFailClosedError("ledger_missing", "evolution ledger is missing");
      }
      const row = assertReceiptRecord(persistDir, receipt, ledger);
      if (row.receiptId !== receiptId) {
        throw new DiagnosisReceiptFailClosedError(
          "binding_mismatch",
          "receipt id does not match its file key",
        );
      }
      validated[receiptId] = row;
    }
    return { schemaVersion: DIAGNOSIS_M1_RECEIPT_SCHEMA_VERSION, receipts: validated };
  } catch (error) {
    cache.clear();
    receiptDirs.clear();
    throw error;
  }
}

function atomicWrite(filePath: string, body: string): void {
  if (atomicWriteOverride) {
    atomicWriteOverride(filePath, body);
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, body);
    fs.fsyncSync(fd);
  } catch (error) {
    fs.closeSync(fd);
    fs.rmSync(tmp, { force: true });
    throw error;
  }
  fs.closeSync(fd);
  try {
    fs.renameSync(tmp, filePath);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

function receiptKey(
  record: Pick<DiagnosisM1ReceiptRecord, "tenantId" | "proposalId" | "receiptId">,
): string {
  return `${record.tenantId}\0${record.proposalId}\0${record.receiptId}`;
}

function remember(record: DiagnosisM1ReceiptRecord, persistDir: string): void {
  const key = receiptKey(record);
  cache.set(key, record);
  receiptDirs.set(key, persistDir);
}

function requireQueryIdentity(query: DiagnosisReceiptQuery): void {
  requireText(query.tenantId, "tenantId");
  requireText(query.proposalId, "proposalId");
}

function matchesQuery(record: DiagnosisM1ReceiptRecord, query: DiagnosisReceiptQuery): boolean {
  if (record.tenantId !== query.tenantId || record.proposalId !== query.proposalId) {
    return false;
  }
  if (query.receiptId && record.receiptId !== query.receiptId) {
    return false;
  }
  if (query.applicationId && record.applicationId !== query.applicationId) {
    return false;
  }
  if (query.verificationId && record.verificationId !== query.verificationId) {
    return false;
  }
  return true;
}

function businessKey(record: Omit<DiagnosisM1ReceiptRecord, "payloadHash" | "createdAt">): string {
  return JSON.stringify(canonicalize(record));
}

export function persistDiagnosisRecheckReceipt(
  persistDir: string,
  draft: DiagnosisRecheckReceiptDraft,
  source?: { ledger?: EvolutionLedger },
): DiagnosisM1ReceiptRecord {
  rejectDeclaredBuildSha(draft);
  const buildSha = resolveDiagnosisReceiptBuildSha();
  const recheckEvidenceRefs = [...(draft.recheckEvidenceRefs ?? draft.result.observedEvidenceRefs)];
  const binding = {
    tenantId: requireText(draft.tenantId, "tenantId"),
    target: requireText(draft.target, "target"),
    proposalId: requireText(draft.proposalId, "proposalId"),
    experimentId: requireText(draft.experimentId, "experimentId"),
    applicationId: requireText(draft.applicationId, "applicationId"),
    verificationId: requireText(draft.verificationId, "verificationId"),
    recheckEvidenceRefs,
    result: draft.result,
  };
  assertResultBinding(binding);
  const createdAt = draft.createdAt ?? new Date().toISOString();
  const ledger = source?.ledger ?? openDiagnosisLedger(persistDir);
  const audit: DiagnosisReceiptAuditRecord = {
    receiptId: requireText(draft.receiptId, "receiptId"),
    createdAt,
    payloadHash: "pending",
    tenantId: binding.tenantId,
    proposalId: binding.proposalId,
    experimentId: binding.experimentId,
    applicationId: binding.applicationId,
    verificationId: binding.verificationId,
    operatorId: requireText(draft.operatorId, "operatorId"),
    commandId: requireText(draft.commandId, "commandId"),
    candidateVersion: requireText(draft.candidateVersion, "candidateVersion"),
    recheckEvidenceRefs,
    result: draft.result,
  };
  const evidence = evidenceForDiagnosisReceipt({ persistDir, record: audit, ledger });
  const closure = closureFromEvidence({
    ...evidence,
    promotionEvents: emptyServerPromotionEvents(),
  });
  if (
    draft.closure &&
    (draft.closure.recommendation !== closure.recommendation ||
      draft.closure.promotionEligible !== closure.promotionEligible ||
      draft.closure.applicationVerified !== closure.applicationVerified ||
      draft.closure.diagnosisRecheckOutcome !== closure.diagnosisRecheckOutcome)
  ) {
    throw new DiagnosisReceiptFailClosedError(
      "binding_mismatch",
      "caller closure does not match the recheck result",
    );
  }
  const payload = {
    schemaVersion: DIAGNOSIS_M1_RECEIPT_SCHEMA_VERSION,
    receiptId: audit.receiptId,
    createdAt,
    tenantId: binding.tenantId,
    target: binding.target,
    proposalId: binding.proposalId,
    experimentId: binding.experimentId,
    applicationId: binding.applicationId,
    verificationId: binding.verificationId,
    candidateVersion: audit.candidateVersion,
    operatorId: audit.operatorId,
    commandId: audit.commandId,
    buildSha,
    recheckEvidenceRefs,
    result: draft.result,
    closure,
  } satisfies Omit<DiagnosisM1ReceiptRecord, "payloadHash">;
  const record: DiagnosisM1ReceiptRecord = {
    ...payload,
    payloadHash: hashDiagnosisM1ReceiptPayload(payload),
  };
  let store: ReceiptFile;
  try {
    store = readStore(persistDir);
  } catch (error) {
    cache.clear();
    receiptDirs.clear();
    throw error;
  }
  const existingCommand = Object.values(store.receipts).find(
    (row) => row.commandId === record.commandId,
  );
  if (existingCommand) {
    const { payloadHash: _ignoredHash, createdAt: _ignoredAt, ...existingBody } = existingCommand;
    const { payloadHash: _nextHash, createdAt: _nextAt, ...nextBody } = record;
    if (businessKey(existingBody) === businessKey(nextBody)) {
      remember(existingCommand, persistDir);
      return existingCommand;
    }
    throw new DiagnosisReceiptFailClosedError(
      "duplicate_command",
      "commandId already bound to a different receipt",
    );
  }
  appendReceiptCreatedEvent({
    ledger,
    record: { ...audit, payloadHash: record.payloadHash },
    surfaceId: evidence.surfaceId,
  });
  store.receipts[record.receiptId] = record;
  const body = `${JSON.stringify({ schemaVersion: DIAGNOSIS_M1_RECEIPT_SCHEMA_VERSION, receipts: store.receipts }, null, 2)}\n`;
  try {
    atomicWrite(receiptPath(persistDir), body);
  } catch (error) {
    if (error instanceof DiagnosisReceiptFailClosedError) {
      throw error;
    }
    throw new DiagnosisReceiptFailClosedError(
      "atomic_write_failed",
      error instanceof Error ? error.message : "atomic receipt write failed",
    );
  }
  remember(record, persistDir);
  return record;
}

export function loadDiagnosisRecheckReceipt(
  persistDir: string,
  query: DiagnosisReceiptQuery,
): DiagnosisM1ReceiptRecord | null {
  requireQueryIdentity(query);
  if (!query.receiptId?.trim()) {
    throw new DiagnosisReceiptFailClosedError("binding_mismatch", "receiptId is required");
  }
  const store = readStore(persistDir);
  const receipt = store.receipts[query.receiptId];
  if (!receipt) {
    const proposalExists = Object.values(store.receipts).some(
      (row) => row.proposalId === query.proposalId,
    );
    if (proposalExists) {
      throw new DiagnosisReceiptFailClosedError(
        "binding_mismatch",
        "receipt is not bound to the requested tenant and proposal",
      );
    }
    return null;
  }
  if (!matchesQuery(receipt, query)) {
    throw new DiagnosisReceiptFailClosedError(
      "binding_mismatch",
      "receipt is not bound to the requested tenant and proposal",
    );
  }
  remember(receipt, persistDir);
  return receipt;
}

export function readDiagnosisM1Status(
  persistDir: string,
  query: DiagnosisReceiptQuery,
  source?: { promotionEventId?: string } | null,
): DiagnosisM1Closure | null {
  assertNotForgedPromotion(source);
  requireQueryIdentity(query);
  const store = readStore(persistDir);
  const proposalRows = Object.values(store.receipts).filter(
    (row) => row.proposalId === query.proposalId,
  );
  if (proposalRows.length === 0) {
    return null;
  }
  const matched = proposalRows.filter((row) => matchesQuery(row, query));
  if (matched.length === 0) {
    throw new DiagnosisReceiptFailClosedError(
      "binding_mismatch",
      "receipt is not bound to the requested tenant and proposal",
    );
  }
  const latest = matched
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt))
    .at(-1);
  if (!latest) {
    return null;
  }
  const ledger = openDiagnosisLedger(persistDir);
  const evidence = evidenceForDiagnosisReceipt({
    persistDir,
    record: latest,
    ledger,
    promotionEventId: source?.promotionEventId,
  });
  remember(latest, persistDir);
  return closureFromLiveEvidence(evidence);
}

export function hydrateDiagnosisM1Receipts(persistDir: string): void {
  const store = readStore(persistDir);
  for (const receipt of Object.values(store.receipts)) {
    remember(receipt, persistDir);
  }
}

export function lookupDiagnosisM1Closure(input: {
  tenantId: string;
  proposalId: string;
  promotionEventId?: string;
}): DiagnosisM1Closure | null {
  requireQueryIdentity(input);
  const matches = [...cache.values()].filter(
    (row) => row.tenantId === input.tenantId && row.proposalId === input.proposalId,
  );
  const latest = matches
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt))
    .at(-1);
  if (!latest) {
    return null;
  }
  const persistDir = receiptDirs.get(receiptKey(latest));
  if (!persistDir) {
    throw new DiagnosisReceiptFailClosedError("ledger_missing", "evolution ledger is missing");
  }
  const ledger = openDiagnosisLedger(persistDir);
  const evidence = evidenceForDiagnosisReceipt({
    persistDir,
    record: latest,
    ledger,
    promotionEventId: input.promotionEventId,
  });
  return closureFromLiveEvidence(evidence);
}
