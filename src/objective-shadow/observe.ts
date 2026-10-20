import { createHash } from "node:crypto";
import { isSourceAllowed } from "./allowlist.js";
import { OBJECTIVE_SHADOW_SCHEMA } from "./types.js";
import type {
  FrozenSnapshot,
  ObjectiveSource,
  ProposedWorkUnitDefinition,
  ResolveStatus,
  ShadowCandidate,
  ShadowIngress,
  ShadowMetrics,
  ShadowObserveInput,
  ShadowObserveRecord,
} from "./types.js";

export function deriveWorkUnitId(objectiveId: string, revision: number, runId: string): string {
  return createHash("sha256")
    .update(`${objectiveId}\0${revision}\0${runId}\0execute`, "utf8")
    .digest("hex")
    .slice(0, 16);
}

export function validateProposedWorkUnits(
  units: ProposedWorkUnitDefinition[],
  ingress: ShadowIngress,
): string[] {
  const codes: string[] = [];
  for (const unit of units) {
    const covers = unit.coversWorkUnitIds ?? [];
    if (
      (unit.contributionKind === "execute" || unit.contributionKind === "research") &&
      covers.length > 0
    ) {
      codes.push("i25_execute_covers_not_empty");
    }
    if (
      (unit.contributionKind === "review" || unit.contributionKind === "synthesis") &&
      covers.length === 0
    ) {
      codes.push("i25_review_covers_invalid");
    }
    if (ingress !== "collaboration_turn" && unit.createdByKind !== "runtime") {
      codes.push("actor_matrix_violation");
    }
    if (ingress === "collaboration_turn" && unit.createdByKind === "runtime") {
      codes.push("actor_matrix_violation");
    }
    if (
      unit.coordinationPolicy === "exclusive" &&
      (unit.minContributors !== 1 || unit.maxContributors !== 1)
    ) {
      codes.push("policy_cardinality");
    }
    if (unit.coordinationPolicy === "shared" && unit.maxContributors < unit.minContributors) {
      codes.push("policy_cardinality");
    }
  }
  return [...new Set(codes)];
}

function uniqueCode(codes: string[], code: string): void {
  if (!codes.includes(code)) {
    codes.push(code);
  }
}

function snapshotKey(id: string, revision: number): string {
  return `${id}#${revision}`;
}

function pickSnapshot(allowed: ShadowCandidate[]): {
  snapshot?: FrozenSnapshot;
  conflict: boolean;
  missing: boolean;
} {
  const complete = allowed.filter(
    (
      c,
    ): c is ShadowCandidate & { objectiveId: string; revision: number; source: ObjectiveSource } =>
      typeof c.objectiveId === "string" &&
      c.objectiveId.length > 0 &&
      typeof c.revision === "number",
  );
  const missing = allowed.length > 0 && complete.length !== allowed.length;
  const keys = new Set(complete.map((c) => snapshotKey(c.objectiveId, c.revision)));
  if (keys.size > 1) {
    return { conflict: true, missing };
  }
  if (complete.length === 0) {
    return { conflict: false, missing };
  }
  const first = complete[0];
  return {
    snapshot: { objectiveId: first.objectiveId, revision: first.revision, source: first.source },
    conflict: false,
    missing,
  };
}

function proposeExecuteUnit(snapshot: FrozenSnapshot, runId: string): ProposedWorkUnitDefinition {
  return {
    workUnitId: deriveWorkUnitId(snapshot.objectiveId, snapshot.revision, runId),
    objectiveId: snapshot.objectiveId,
    objectiveRevision: snapshot.revision,
    coordinationPolicy: "exclusive",
    contributionKind: "execute",
    required: true,
    acceptanceIds: [],
    dependsOnWorkUnitIds: [],
    coversWorkUnitIds: [],
    minContributors: 1,
    maxContributors: 1,
    createdByKind: "runtime",
    definitionEpoch: 0,
  };
}

export type ObserveContext = {
  tenantHash: string;
  groupHash?: string;
  nowMs: number;
  parentSnapshot?: FrozenSnapshot;
  redactionDropped?: boolean;
  forbiddenWriteAttempts?: 0 | 1;
};

function emptyMetrics(candidateCount: number): ShadowMetrics {
  return {
    candidateCount,
    allowedCandidateCount: 0,
    forbiddenCandidateCount: 0,
    sourceConflict: 0,
    allowlistRejected: 0,
    allowlistIgnoredForbidden: 0,
    inheritViolation: 0,
    proposedGenerated: 0,
    proposedRejected: 0,
    proposedDiscarded: 0,
    forbiddenWriteAttempts: 0,
  };
}

function recordIdFor(runId: string, ingress: ShadowIngress, snapshot?: FrozenSnapshot): string {
  return createHash("sha256")
    .update(
      `${runId}\0${ingress}\0${snapshot?.objectiveId ?? ""}\0${snapshot?.revision ?? ""}`,
      "utf8",
    )
    .digest("hex")
    .slice(0, 24);
}

export function observeObjective(
  input: ShadowObserveInput,
  ctx: ObserveContext,
): ShadowObserveRecord {
  const conflictCodes: string[] = [];
  const rejectOrDiscardCodes: string[] = [];
  const metrics = emptyMetrics(input.candidates.length);
  metrics.forbiddenWriteAttempts = ctx.forbiddenWriteAttempts === 1 ? 1 : 0;
  if (ctx.redactionDropped) {
    uniqueCode(conflictCodes, "redaction_dropped");
  }
  for (const code of input.inputErrors ?? []) {
    uniqueCode(conflictCodes, code);
  }

  let resolveStatus: ResolveStatus = "skipped";
  let snapshot: FrozenSnapshot | undefined;
  if ((input.inputErrors ?? []).includes("invalid_input")) {
    resolveStatus = "skipped";
    uniqueCode(rejectOrDiscardCodes, "no_frozen_snapshot");
    metrics.proposedDiscarded = 1;
    const runId = input.runId;
    return {
      schemaVersion: OBJECTIVE_SHADOW_SCHEMA,
      recordId: recordIdFor(runId, input.ingress),
      observedAtMs: ctx.nowMs,
      correlation: {
        runId,
        parentRunId: input.parentRunId,
        cronOccurrenceId: input.ingress === "cron_isolated" ? input.cronOccurrenceId : undefined,
        ingress: input.ingress,
        tenantHash: ctx.tenantHash,
        groupHash: ctx.groupHash,
      },
      resolveStatus,
      conflictCodes,
      proposed: [],
      proposedDisposition: "discarded",
      rejectOrDiscardCodes,
      metrics,
    };
  }

  if (input.ingress === "acp") {
    resolveStatus = "out_of_scope";
    uniqueCode(rejectOrDiscardCodes, "no_frozen_snapshot");
  } else if (input.candidates.length === 0 && input.ingress !== "subagent") {
    resolveStatus = "skipped";
    uniqueCode(rejectOrDiscardCodes, "no_frozen_snapshot");
  } else if (input.ingress === "subagent") {
    const allowed = input.candidates.filter((c) => isSourceAllowed("chat", c.source));
    const picked = pickSnapshot(allowed.length > 0 ? allowed : input.candidates);
    if (!input.parentRunId || !ctx.parentSnapshot) {
      resolveStatus = "conflict";
      uniqueCode(conflictCodes, "inherit_violation");
      metrics.inheritViolation = 1;
      uniqueCode(rejectOrDiscardCodes, "inherit_only");
    } else if (
      picked.snapshot &&
      (picked.snapshot.objectiveId !== ctx.parentSnapshot.objectiveId ||
        picked.snapshot.revision !== ctx.parentSnapshot.revision)
    ) {
      resolveStatus = "conflict";
      uniqueCode(conflictCodes, "inherit_violation");
      uniqueCode(conflictCodes, "source_conflict");
      metrics.inheritViolation = 1;
      metrics.sourceConflict = 1;
      uniqueCode(rejectOrDiscardCodes, "inherit_only");
    } else {
      resolveStatus = "resolved";
      snapshot = ctx.parentSnapshot;
      uniqueCode(rejectOrDiscardCodes, "inherit_only");
    }
  } else {
    const allowed = input.candidates.filter((c) => isSourceAllowed(input.ingress, c.source));
    const forbidden = input.candidates.filter((c) => !isSourceAllowed(input.ingress, c.source));
    metrics.allowedCandidateCount = allowed.length;
    metrics.forbiddenCandidateCount = forbidden.length;

    if (forbidden.length > 0 && allowed.length > 0) {
      uniqueCode(conflictCodes, "allowlist_ignored_forbidden");
      metrics.allowlistIgnoredForbidden = 1;
    }
    if (forbidden.length > 0 && allowed.length === 0) {
      resolveStatus = "allowlist_rejected";
      uniqueCode(conflictCodes, "allowlist_rejected");
      metrics.allowlistRejected = 1;
      uniqueCode(rejectOrDiscardCodes, "no_frozen_snapshot");
    } else if (allowed.length === 0) {
      resolveStatus = "skipped";
      uniqueCode(rejectOrDiscardCodes, "no_frozen_snapshot");
    } else {
      const picked = pickSnapshot(allowed);
      if (picked.missing) {
        uniqueCode(conflictCodes, "missing_id_or_revision");
      }
      if (picked.conflict) {
        resolveStatus = "conflict";
        uniqueCode(conflictCodes, "source_conflict");
        metrics.sourceConflict = 1;
        uniqueCode(rejectOrDiscardCodes, "no_frozen_snapshot");
      } else if (!picked.snapshot) {
        resolveStatus = "skipped";
        uniqueCode(rejectOrDiscardCodes, "no_frozen_snapshot");
      } else {
        resolveStatus = "resolved";
        snapshot = picked.snapshot;
      }
    }
  }

  let proposed: ProposedWorkUnitDefinition[] = [];
  let proposedDisposition: ShadowObserveRecord["proposedDisposition"] = "discarded";

  if (input.ingress === "collaboration_turn") {
    proposed = [];
    proposedDisposition = "discarded";
    uniqueCode(rejectOrDiscardCodes, "collab_deferred_phase3b");
    metrics.proposedDiscarded = 1;
  } else if (input.ingress === "subagent" || input.ingress === "acp") {
    proposed = [];
    proposedDisposition = "discarded";
    metrics.proposedDiscarded = 1;
  } else if (resolveStatus === "resolved" && snapshot) {
    const canGenerate =
      input.ingress === "chat" ||
      input.ingress === "cron_isolated" ||
      ((input.ingress === "heartbeat" || input.ingress === "gateway_agent") &&
        (snapshot.source === "inbound_turn" ||
          (input.ingress === "gateway_agent" && snapshot.source === "legacy_context")));
    if (canGenerate) {
      const unit = proposeExecuteUnit(snapshot, input.runId);
      const rejectCodes = validateProposedWorkUnits([unit], input.ingress);
      if (rejectCodes.length > 0) {
        proposed = [];
        proposedDisposition = "rejected";
        for (const code of rejectCodes) {
          uniqueCode(rejectOrDiscardCodes, code);
        }
        metrics.proposedRejected = 1;
      } else {
        proposed = [unit];
        proposedDisposition = "generated";
        metrics.proposedGenerated = 1;
      }
    } else {
      uniqueCode(rejectOrDiscardCodes, "no_frozen_snapshot");
      metrics.proposedDiscarded = 1;
    }
  } else {
    metrics.proposedDiscarded = 1;
  }

  const runId = input.runId;
  return {
    schemaVersion: OBJECTIVE_SHADOW_SCHEMA,
    recordId: recordIdFor(runId, input.ingress, snapshot),
    observedAtMs: ctx.nowMs,
    correlation: {
      runId,
      parentRunId: input.parentRunId,
      cronOccurrenceId: input.ingress === "cron_isolated" ? input.cronOccurrenceId : undefined,
      ingress: input.ingress,
      tenantHash: ctx.tenantHash,
      groupHash: ctx.groupHash,
      objectiveId: snapshot?.objectiveId,
      revision: snapshot?.revision,
      source: snapshot?.source,
    },
    resolveStatus,
    conflictCodes,
    proposed,
    proposedDisposition,
    rejectOrDiscardCodes,
    metrics,
  };
}
