/**
 * Links a real model-call evidence row to a real budget command receipt.
 * Built only after ResultService returns. Does not inherit across corrections
 * and does not replace an existing row on replay or conflict.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { boundedOutcomePathSegment } from "../task-outcome/store.js";
import { scopeIdOf } from "../task-outcome/transitions.js";
import type { TaskOutcomeRecord, TrustedScope } from "../task-outcome/types.js";
import type { CostColumns } from "./cost-columns.js";
import { fullScopeEqual, snapshotIdentityFingerprint } from "./identity.js";
import {
  executorEvidenceCollectionEnabled,
  writeBoundedEvidenceFile,
  type ModelCallEvidence,
  type ModelCallUsage,
  usageFingerprint,
} from "./model-call-evidence.js";

export const ASSOCIATION_FILE_CAP = 64;

export const FINAL_METADATA_FINGERPRINT_SCHEMA_VERSION = 1 as const;

export type BudgetCommandDisposition =
  | "applied"
  | "replayed"
  | "no_effect"
  | "conflict"
  | "evidence_missing"
  | "absent";

export type BudgetCommandReport = {
  commandId: string;
  requestDigest: string | null;
  disposition: BudgetCommandDisposition;
  commitId: string | null;
  chargeOutcomeVersion: number | null;
  closeOutcomeVersion: number | null;
  committedCostUsd: number | null;
  costStatus: "known" | "unknown" | "not_committed";
};

export type EvidenceAssociation = {
  schemaVersion: 1;
  callEvidenceId: string | null;
  callId: string | null;
  budgetCommandId: string | null;
  requestDigest: string | null;
  disposition: BudgetCommandDisposition;
  commitId: string | null;
  chargeOutcomeVersion: number | null;
  closeOutcomeVersion: number | null;
  finalOutcomeVersion: number | null;
  runId: string;
  attemptId: string | null;
  capabilityCallId: string | null;
  deliveryId: string | null;
  deliveryTruth: "absent" | "enqueue_only" | "recorded" | "unknown";
  finalMetadataFingerprint: string | null;
  finalMetadataFingerprintSchemaVersion: number | null;
  usageFingerprint: string;
  completeness: "complete" | "partial";
  missing: string[];
  coverage: string;
  correctionInherited: false;
  taskJudgement: TaskOutcomeRecord["taskJudgement"] | null;
  chain: {
    taskId: string;
    outcomeVersion: number | null;
    runId: string;
    attemptId: string | null;
    capabilityCallId: string | null;
    deliveryId: string | null;
    source: "receipt" | "absent";
  };
  /** This callback's estimate. It is not the committed budget attribution. */
  callEstimate: CostColumns | null;
  committedAttribution: {
    status: "known" | "unknown" | "not_committed";
    amount: number | null;
    usageFingerprint: string | null;
  };
  candidateAttemptId: string | null;
  taskAttemptId: string | null;
  trustedScope: TrustedScope | null;
  finalSnapshotFingerprint: string | null;
  cost: CostColumns;
  scopeId: string;
  agentId: string;
};

const memoryAssociations: EvidenceAssociation[] = [];

export function listMemoryAssociations(): EvidenceAssociation[] {
  return [...memoryAssociations];
}

export function resetEvidenceAssociations(): void {
  memoryAssociations.length = 0;
}

function associationsDir(storeRoot: string): string {
  return path.join(storeRoot, "executor-evidence", "associations");
}

export function finalMetadataFingerprint(record: TaskOutcomeRecord): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: FINAL_METADATA_FINGERPRINT_SCHEMA_VERSION,
        taskId: record.taskId,
        outcomeVersion: record.outcomeVersion,
        lifecycle: record.lifecycle,
        taskJudgement: record.taskJudgement,
        deliveryStatus: record.delivery.status,
        deliveryId: record.deliveryId ?? null,
        reasonCode: record.reasonCode ?? null,
        revisionKind: record.revisionKind ?? null,
      }),
    )
    .digest("hex");
}

function sameScope(
  call: ModelCallEvidence,
  scope: TrustedScope,
  taskId: string,
  agentId: string,
): boolean {
  return call.agentId === agentId && call.taskId === taskId && fullScopeEqual(call.scope, scope);
}

export function associateBudgetCharge(params: {
  storeRoot?: string;
  call: ModelCallEvidence | null;
  budget: BudgetCommandReport;
  record?: TaskOutcomeRecord;
  scope: TrustedScope;
  agentId: string;
  taskId: string;
  runId: string;
  attemptId?: string | null;
  usage: ModelCallUsage;
  cost: CostColumns;
  capabilityCallId?: string | null;
  deliveryAttempts?: ReadonlyArray<{ source: string }>;
  candidateAttemptId?: string | null;
  taskAttemptId?: string | null;
}): EvidenceAssociation | null {
  if (params.call && !sameScope(params.call, params.scope, params.taskId, params.agentId)) {
    return null;
  }
  const enqueueOnly =
    params.deliveryAttempts?.some((attempt) => attempt.source === "enqueue_only") === true;
  const missing: string[] = [];
  if (!params.call) {
    missing.push("call_evidence");
  }
  if (!params.record) {
    missing.push("tip");
  }
  if (
    params.budget.disposition === "conflict" ||
    params.budget.disposition === "evidence_missing"
  ) {
    missing.push(params.budget.disposition);
  }
  if (params.budget.commitId == null && params.budget.disposition === "applied") {
    missing.push("commit_id");
  }
  if (enqueueOnly) {
    missing.push("delivery_receipt");
  }
  const association: EvidenceAssociation = {
    schemaVersion: 1,
    callEvidenceId: params.call?.evidenceId ?? null,
    callId: params.call?.callId ?? null,
    budgetCommandId: params.budget.commandId,
    requestDigest: params.budget.requestDigest,
    disposition: params.budget.disposition,
    commitId: params.budget.commitId,
    chargeOutcomeVersion: params.budget.chargeOutcomeVersion,
    closeOutcomeVersion: params.budget.closeOutcomeVersion,
    // The charge record is not the final business version.
    finalOutcomeVersion: null,
    runId: params.runId,
    attemptId: params.attemptId ?? params.call?.attemptId ?? null,
    capabilityCallId: params.capabilityCallId ?? null,
    deliveryId: enqueueOnly ? null : (params.record?.deliveryId ?? null),
    deliveryTruth: enqueueOnly ? "enqueue_only" : params.record ? "recorded" : "absent",
    finalMetadataFingerprint: params.record ? finalMetadataFingerprint(params.record) : null,
    finalMetadataFingerprintSchemaVersion: params.record
      ? FINAL_METADATA_FINGERPRINT_SCHEMA_VERSION
      : null,
    usageFingerprint: usageFingerprint(params.usage),
    completeness: "partial",
    missing: [...missing, "final_receipt"],
    coverage: params.call
      ? `call ${params.call.callId} attempt ${params.call.attemptId}`
      : "budget command without a preceding model-call identity",
    correctionInherited: false,
    taskJudgement: params.record?.taskJudgement ?? null,
    chain: {
      taskId: params.taskId,
      outcomeVersion: params.record?.outcomeVersion ?? null,
      runId: params.runId,
      attemptId: params.attemptId ?? params.call?.attemptId ?? null,
      capabilityCallId: params.capabilityCallId ?? null,
      deliveryId: enqueueOnly ? null : (params.record?.deliveryId ?? null),
      source: params.budget.disposition === "absent" || !params.record ? "absent" : "receipt",
    },
    callEstimate: params.cost,
    committedAttribution:
      params.budget.disposition === "applied" && params.budget.costStatus === "known"
        ? {
            status: "known",
            amount: params.budget.committedCostUsd,
            usageFingerprint: usageFingerprint(params.usage),
          }
        : {
            status: "not_committed",
            amount: null,
            usageFingerprint: null,
          },
    candidateAttemptId: params.candidateAttemptId ?? params.call?.attemptId ?? null,
    taskAttemptId: params.taskAttemptId ?? null,
    trustedScope: params.scope,
    finalSnapshotFingerprint: null,
    cost: unattributable(params.budget.disposition) ? scrubKnownTotal(params.cost) : params.cost,
    scopeId: scopeIdOf(params.scope),
    agentId: params.agentId,
  };
  if (!missing.includes("final_receipt")) {
    association.missing.push("final_receipt");
  }
  rememberAssociation(association);
  if (!params.storeRoot || !executorEvidenceCollectionEnabled()) {
    return association;
  }
  const key =
    association.disposition === "conflict"
      ? `conflict-${association.budgetCommandId ?? "none"}-${association.usageFingerprint}`
      : (association.callId ?? `budget-${association.budgetCommandId ?? "none"}`);
  const wrote = writeBoundedEvidenceFile(
    params.storeRoot,
    `${encodeURIComponent(key)}.json`,
    association,
    "associations",
  );
  if (wrote === "replayed" || wrote === "conflict") {
    const idx = memoryAssociations.lastIndexOf(association);
    if (idx >= 0) {
      memoryAssociations.splice(idx, 1);
    }
  }
  if (wrote === "conflict") {
    return null;
  }
  return association;
}

function budgetIdentityMatches(params: {
  storeRoot?: string;
  taskId: string;
  scope: TrustedScope;
  budgetCommandId?: string | null;
  chargeCommitId?: string | null;
  requestDigest?: string | null;
  chargeOutcomeVersion: number | null;
  finalOutcomeVersion: number | null;
  callId?: string | null;
  callEvidenceId?: string | null;
  usageFingerprint?: string | null;
}): boolean {
  if (
    !params.storeRoot ||
    !params.budgetCommandId ||
    !params.chargeCommitId ||
    !params.requestDigest ||
    !params.callId ||
    !params.callEvidenceId ||
    !params.usageFingerprint ||
    params.chargeOutcomeVersion == null ||
    params.finalOutcomeVersion == null ||
    params.chargeOutcomeVersion >= params.finalOutcomeVersion
  ) {
    return false;
  }
  try {
    const logPath = path.join(
      params.storeRoot,
      "command-log",
      `${boundedOutcomePathSegment(params.budgetCommandId)}.json`,
    );
    const log = JSON.parse(fs.readFileSync(logPath, "utf8")) as {
      digest?: string;
      commitId?: string;
      outcomeVersion?: number;
      snapshotFingerprint?: string;
      commandDisposition?: string;
      callBinding?: { callId?: string; evidenceId?: string; usageFingerprint?: string };
    };
    const bundle = JSON.parse(
      fs.readFileSync(
        path.join(params.storeRoot, "commits", `${params.chargeCommitId}.json`),
        "utf8",
      ),
    ) as {
      commitId?: string;
      commandLog?: {
        digest?: string;
        commandId?: string;
        callBinding?: { callId?: string; evidenceId?: string; usageFingerprint?: string };
      };
      record?: TaskOutcomeRecord;
    };
    const snapshot = JSON.parse(
      fs.readFileSync(
        path.join(
          params.storeRoot,
          "versions",
          `${boundedOutcomePathSegment(params.taskId)}__v${params.chargeOutcomeVersion}.json`,
        ),
        "utf8",
      ),
    ) as TaskOutcomeRecord;
    const binding = log.callBinding;
    if (
      log.digest !== params.requestDigest ||
      log.commitId !== params.chargeCommitId ||
      log.outcomeVersion !== params.chargeOutcomeVersion ||
      log.commandDisposition !== "applied" ||
      bundle.commitId !== params.chargeCommitId ||
      bundle.commandLog?.digest !== params.requestDigest ||
      bundle.commandLog?.commandId !== params.budgetCommandId ||
      bundle.record?.outcomeVersion !== params.chargeOutcomeVersion ||
      bundle.record?.taskId !== params.taskId ||
      snapshot.taskId !== params.taskId ||
      snapshot.outcomeVersion !== params.chargeOutcomeVersion ||
      !snapshot.scope ||
      !fullScopeEqual(snapshot.scope, params.scope) ||
      !log.snapshotFingerprint ||
      !binding ||
      binding.callId !== params.callId ||
      binding.evidenceId !== params.callEvidenceId ||
      binding.usageFingerprint !== params.usageFingerprint ||
      bundle.commandLog?.callBinding?.callId !== binding.callId ||
      bundle.commandLog?.callBinding?.evidenceId !== binding.evidenceId ||
      bundle.commandLog?.callBinding?.usageFingerprint !== binding.usageFingerprint ||
      snapshotIdentityFingerprint(snapshot) !== log.snapshotFingerprint
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function unattributable(disposition: BudgetCommandDisposition): boolean {
  return disposition !== "applied";
}

function scrubKnownTotal(cost: CostColumns): CostColumns {
  return {
    ...cost,
    estimatedUsd: {
      amount: null,
      status: "unknown",
      basis: "unknown",
      pricingFingerprint: null,
      pricingSchemaVersion: null,
    },
    total: { amount: null, status: "unknown" },
  };
}

function rememberAssociation(association: EvidenceAssociation): void {
  if (!executorEvidenceCollectionEnabled()) {
    return;
  }
  memoryAssociations.push(association);
  while (memoryAssociations.length > ASSOCIATION_FILE_CAP) {
    memoryAssociations.shift();
  }
}

export function loadPersistedAssociations(storeRoot: string): EvidenceAssociation[] {
  return readAssociationFiles(storeRoot).rows;
}

export function readAssociationFiles(storeRoot: string): {
  rows: EvidenceAssociation[];
  gaps: string[];
} {
  const dir = associationsDir(storeRoot);
  const gaps: string[] = [];
  if (!fs.existsSync(dir)) {
    return { rows: [], gaps };
  }
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return { rows: [], gaps: ["association_read_failed"] };
  }
  const rows: EvidenceAssociation[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      rows.push(JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as EvidenceAssociation);
    } catch {
      gaps.push("corrupt_association");
    }
  }
  return { rows, gaps };
}

export function publishFinalEvidenceLink(params: {
  storeRoot?: string;
  call?: ModelCallEvidence | null;
  scope: TrustedScope;
  agentId: string;
  taskId: string;
  runId: string;
  candidateAttemptId: string | null;
  taskAttemptId: string | null;
  chargeOutcomeVersion: number | null;
  finalOutcomeVersion: number | null;
  recordRuns: ReadonlyArray<{ runId: string; attemptIds: readonly string[] }>;
  recordAttempts: readonly string[];
  receiptReturned: boolean;
  usageFingerprint?: string | null;
  snapshotFingerprint?: string | null;
  budgetCommandId?: string | null;
  chargeCommitId?: string | null;
  requestDigest?: string | null;
}): EvidenceAssociation | null {
  if (!params.receiptReturned || params.finalOutcomeVersion == null) {
    return null;
  }
  const callIdentityOk =
    params.call != null &&
    params.call.agentId === params.agentId &&
    params.call.taskId === params.taskId &&
    params.call.runId === params.runId &&
    params.call.attemptId === params.candidateAttemptId &&
    params.call.callId.length > 0 &&
    params.call.evidenceId.length > 0 &&
    fullScopeEqual(params.call.scope, params.scope);
  const usageBound =
    typeof params.usageFingerprint === "string" && params.usageFingerprint.length > 0;
  const usageOk =
    params.call != null &&
    (!usageBound || usageFingerprint(params.call.usage) === params.usageFingerprint);
  const callOk = callIdentityOk && usageOk;
  const snapshotBound =
    typeof params.snapshotFingerprint === "string" && params.snapshotFingerprint.length > 0;
  const run = params.recordRuns.find((item) => item.runId === params.runId);
  const attemptOnRun = run?.attemptIds.includes(params.taskAttemptId ?? "") === true;
  const attemptOnRecord = params.recordAttempts.includes(params.taskAttemptId ?? "");
  const membershipOk =
    Boolean(params.runId) &&
    Boolean(params.taskAttemptId) &&
    Boolean(params.candidateAttemptId) &&
    Boolean(run) &&
    attemptOnRun &&
    attemptOnRecord &&
    params.candidateAttemptId !== params.taskAttemptId &&
    params.chargeOutcomeVersion != null &&
    params.finalOutcomeVersion !== params.chargeOutcomeVersion;
  const budgetFieldsPresent = Boolean(
    params.budgetCommandId || params.chargeCommitId || params.requestDigest,
  );
  const budgetOk = budgetIdentityMatches({
    ...params,
    callId: params.call?.callId ?? null,
    callEvidenceId: params.call?.evidenceId ?? null,
    usageFingerprint: usageBound ? params.usageFingerprint : null,
  });
  const mapped = membershipOk && callOk && usageBound && snapshotBound && budgetOk;
  const finalVersion =
    membershipOk &&
    (params.call == null || (callIdentityOk && usageOk)) &&
    (!budgetFieldsPresent || budgetOk)
      ? params.finalOutcomeVersion
      : null;
  const missing = mapped ? [] : ["task_attempt_membership"];
  if (!params.call) {
    missing.push("call_evidence");
  }
  const association: EvidenceAssociation = {
    schemaVersion: 1,
    callEvidenceId: params.call?.evidenceId ?? null,
    callId: params.call?.callId ?? null,
    budgetCommandId: params.budgetCommandId ?? null,
    requestDigest: params.requestDigest ?? null,
    disposition: budgetOk ? "applied" : "absent",
    commitId: params.chargeCommitId ?? null,
    chargeOutcomeVersion: params.chargeOutcomeVersion,
    closeOutcomeVersion: null,
    finalOutcomeVersion: finalVersion,
    runId: params.runId,
    attemptId: params.taskAttemptId,
    capabilityCallId: null,
    deliveryId: null,
    deliveryTruth: "unknown",
    finalMetadataFingerprint: null,
    finalMetadataFingerprintSchemaVersion: null,
    usageFingerprint: usageBound
      ? (params.usageFingerprint ?? "")
      : usageFingerprint(
          params.call?.usage ?? {
            input: null,
            output: null,
            cacheRead: null,
            cacheWrite: null,
          },
        ),
    completeness: mapped && params.call ? "complete" : "partial",
    missing,
    coverage: mapped
      ? `final ${params.finalOutcomeVersion}`
      : "final receipt without attempt membership",
    correctionInherited: false,
    taskJudgement: null,
    chain: {
      taskId: params.taskId,
      outcomeVersion: finalVersion,
      runId: params.runId,
      attemptId: params.taskAttemptId,
      capabilityCallId: null,
      deliveryId: null,
      source: mapped ? "receipt" : "absent",
    },
    callEstimate: null,
    committedAttribution: { status: "not_committed", amount: null, usageFingerprint: null },
    candidateAttemptId: params.candidateAttemptId,
    taskAttemptId: params.taskAttemptId,
    trustedScope: params.scope,
    finalSnapshotFingerprint: params.snapshotFingerprint ?? null,
    cost: {
      schemaVersion: 1,
      tokens: {
        input: null,
        output: null,
        cacheRead: null,
        cacheWrite: null,
        completeness: "absent",
      },
      estimatedUsd: {
        amount: null,
        status: "unknown",
        basis: "unknown",
        pricingFingerprint: null,
        pricingSchemaVersion: null,
      },
      providerProcurementCost: { amount: null, currency: null, status: "unknown" },
      credits: { amount: null, status: "unknown" },
      total: { amount: null, status: "unknown" },
      billingCorrelation: { businessTaskId: params.taskId, runId: params.runId },
      rollup: { role: "own", includeInFamilyTotal: true },
    },
    scopeId: scopeIdOf(params.scope),
    agentId: params.agentId,
  };
  rememberAssociation(association);
  if (!params.storeRoot || !executorEvidenceCollectionEnabled()) {
    return association;
  }
  const fileName = `${encodeURIComponent(`final-${params.taskId}-${params.finalOutcomeVersion}-${params.runId}-${params.call?.callId ?? "none"}`)}.json`;
  const wrote = writeBoundedEvidenceFile(params.storeRoot, fileName, association);
  if (wrote === "replayed" || wrote === "conflict") {
    const index = memoryAssociations.lastIndexOf(association);
    if (index >= 0) {
      memoryAssociations.splice(index, 1);
    }
  }
  if (wrote === "conflict") {
    return null;
  }
  return association;
}
