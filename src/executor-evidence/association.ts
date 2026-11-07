/**
 * Links a real model-call evidence row to a real budget command receipt.
 * Built only after ResultService returns. Does not inherit across corrections
 * and does not replace an existing row on replay or conflict.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { scopeIdOf } from "../task-outcome/transitions.js";
import type { TaskOutcomeRecord, TrustedScope } from "../task-outcome/types.js";
import type { CostColumns } from "./cost-columns.js";
import {
  type ModelCallEvidence,
  type ModelCallUsage,
  usageFingerprint,
} from "./model-call-evidence.js";

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
  cost: CostColumns;
  scopeId: string;
  agentId: string;
};

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
  return (
    call.agentId === agentId &&
    call.taskId === taskId &&
    scopeIdOf(call.scope) === scopeIdOf(scope) &&
    call.scope.kind === scope.kind &&
    call.scope.subjectRef === scope.subjectRef
  );
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
    finalOutcomeVersion: params.record?.outcomeVersion ?? params.budget.chargeOutcomeVersion,
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
    completeness: missing.length === 0 ? "complete" : "partial",
    missing,
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
    cost: params.cost,
    scopeId: scopeIdOf(params.scope),
    agentId: params.agentId,
  };
  if (!params.storeRoot || process.env.OPENBOT_EXECUTOR_EVIDENCE === "0") {
    return association;
  }
  try {
    const dir = associationsDir(params.storeRoot);
    fs.mkdirSync(dir, { recursive: true });
    const key = association.callId ?? `budget-${association.budgetCommandId ?? "none"}`;
    const file = path.join(dir, `${encodeURIComponent(key)}.json`);
    if (fs.existsSync(file)) {
      const existing = JSON.parse(fs.readFileSync(file, "utf8")) as EvidenceAssociation;
      if (association.disposition === "conflict" || association.disposition === "replayed") {
        return existing;
      }
    }
    fs.writeFileSync(file, `${JSON.stringify(association, null, 2)}\n`);
  } catch {
    // Association persistence must not change the budget or reply result.
  }
  return association;
}

export function loadPersistedAssociations(storeRoot: string): EvidenceAssociation[] {
  const dir = associationsDir(storeRoot);
  if (!fs.existsSync(dir)) {
    return [];
  }
  const loaded: EvidenceAssociation[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      loaded.push(JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as EvidenceAssociation);
    } catch {
      // Corrupt association is a gap.
    }
  }
  return loaded;
}
