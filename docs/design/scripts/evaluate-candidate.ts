export const COMPLETION_CONTRACT_VERSION = "2026-09-15.rev2" as const;

export type ContractVerdict =
  | "pending"
  | "accepted"
  | "rejected"
  | "stale"
  | "cancelled"
  | "needs_human";

export type ReasonCode =
  | "RC_OK"
  | "RC_PENDING_EVIDENCE"
  | "RC_PENDING_HUMAN"
  | "RC_EVIDENCE_MISSING"
  | "RC_EVIDENCE_NOT_FOUND"
  | "RC_EVIDENCE_EXPIRED"
  | "RC_EVIDENCE_TAMPERED"
  | "RC_SOURCE_NOT_ALLOWED"
  | "RC_SOURCE_CONFLICT"
  | "RC_TENANT_MISMATCH"
  | "RC_BINDING_STALE"
  | "RC_RUN_STALE"
  | "RC_CANCELLED"
  | "RC_FORCE_OFF"
  | "RC_RACE_LOST_TO_CANCEL"
  | "RC_DUPLICATE_REPLAY"
  | "RC_SUPERSEDED"
  | "RC_ROLLBACK"
  | "RC_CONTRACT_VERSION";

export type CompletionSource =
  | "supervisor_accepted"
  | "ledger_verified"
  | "ledger_completed"
  | "round_converged"
  | "flow_step_done"
  | "taskcard_done"
  | "autopilot_candidate"
  | "llm_summary";

export type TaskIdentity = {
  primaryId: string;
  primaryGeneration: number;
  tenantId: string;
  scope: "group_tenant" | "personal_local";
  bindingVersion?: number;
  groupId?: string;
};

export type EvidenceReference = {
  kind: string;
  ref: string;
  validUntil?: string;
};

export type CompletionCandidate = {
  contractVersion: string;
  candidateId: string;
  taskIdentity: TaskIdentity;
  completionSource: CompletionSource;
  evidenceReferences: EvidenceReference[];
  recordedAt: string;
  idempotencyKey: string;
  payloadHash?: string;
  supersedes?: string;
};

export type ContractVerdictRecord = {
  contractVersion: string;
  candidateId: string;
  idempotencyKey: string;
  verdict: ContractVerdict;
  reasonCode: ReasonCode;
  winningSource?: CompletionSource;
  evaluatedAt: string;
  replayOf?: string;
  closeCt: boolean;
};

export type EvidenceLookup = {
  exists: boolean;
  status?: string;
  expired?: boolean;
};

export type EvaluateStore = {
  idempotency?: Map<string, { record: ContractVerdictRecord; payloadHash: string }>;
  currentBindingVersion?: number;
  activeRunId?: string;
  candidateRunId?: string;
  bindingTenantId?: string;
  bindingScope?: "group_tenant" | "personal_local";
  cancelGeneration?: number;
  cancelEffectiveAt?: string;
  forceOff?: boolean;
  evidence?: Record<string, EvidenceLookup>;
  priorVerdict?: ContractVerdict;
  requireHuman?: boolean;
  /** Gateway/MCP already verified serverAttribution. Missing/false is fail-closed for group_tenant. */
  attributionVerified?: boolean;
};

/** Default TTL from completion-contract.md §6.3. `null` = no clock TTL (status-based). */
export const EVIDENCE_DEFAULT_TTL_MS: Record<string, number | null> = {
  supervisor_report: 7 * 24 * 60 * 60 * 1000,
  ledger_step: null,
  argv_exit: 24 * 60 * 60 * 1000,
  artifact: null,
  round_snapshot: 60 * 60 * 1000,
};

/**
 * BR-T2: never derive tenant from requesterId.
 * Prefix `gateway:` / `mcp-server:` on an envelope is not proof of issuance.
 */
export function resolveBridgeTenantId(input: {
  tenantId?: string | null;
  requesterId?: string | null;
}): string | null {
  const trusted = typeof input.tenantId === "string" ? input.tenantId.trim() : "";
  return trusted || null;
}

/** ISO-8601 date-time with timezone. Date-only / missing offset / unparsable / invalid calendar → null. */
const CONTRACT_TIME_RE =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(\.\d+)?(?<offset>Z|[+-]\d{2}:\d{2})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export function parseContractTime(value: string | undefined | null): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  const match = CONTRACT_TIME_RE.exec(trimmed);
  const parts = match?.groups;
  if (!parts) {
    return null;
  }
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  if (!isValidCalendarDate(year, month, day) || hour > 23 || minute > 59 || second > 59) {
    return null;
  }
  if (parts.offset !== "Z") {
    const offsetHour = Number(parts.offset.slice(1, 3));
    const offsetMinute = Number(parts.offset.slice(4, 6));
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) {
      return null;
    }
  }
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? ms : null;
}

const DENIED_PAYLOAD_NORMALIZED = new Set([
  "email",
  "employeeemail",
  "phone",
  "phonenumber",
  "password",
  "token",
  "accesstoken",
  "refreshtoken",
  "hmac",
  "hmacsecret",
  "rawidentity",
  "requesterid",
  "privatekey",
  "idcard",
  "ssn",
]);

/** Case-insensitive; `_` / `-` separators ignored. Matches envelope `$defs.deniedPayloadName`. */
export function isDeniedPayloadName(name: string): boolean {
  const normalized = name.trim().toLowerCase().replace(/[_-]+/g, "");
  return DENIED_PAYLOAD_NORMALIZED.has(normalized);
}

const DISPLAY_ONLY_SOURCES = new Set<CompletionSource>([
  "flow_step_done",
  "taskcard_done",
  "llm_summary",
]);

/** Higher rank wins. Matches completion-contract.md §7 (P1 > P2 completed > P2 verified). */
export const COMPLETION_SOURCE_RANK: Record<CompletionSource, number> = {
  supervisor_accepted: 100,
  ledger_completed: 80,
  ledger_verified: 70,
  round_converged: 40,
  autopilot_candidate: 30,
  flow_step_done: 10,
  taskcard_done: 10,
  llm_summary: 0,
};

function verdict(
  candidate: CompletionCandidate,
  clock: string,
  result: Pick<ContractVerdictRecord, "verdict" | "reasonCode" | "winningSource" | "replayOf">,
): ContractVerdictRecord {
  return {
    contractVersion: COMPLETION_CONTRACT_VERSION,
    candidateId: candidate.candidateId,
    idempotencyKey: candidate.idempotencyKey,
    verdict: result.verdict,
    reasonCode: result.reasonCode,
    winningSource: result.winningSource,
    evaluatedAt: clock,
    replayOf: result.replayOf,
    closeCt: result.verdict === "accepted",
  };
}

export function evaluateCandidate(
  candidate: CompletionCandidate,
  store: EvaluateStore,
  clock: string,
): ContractVerdictRecord {
  if (candidate.contractVersion !== COMPLETION_CONTRACT_VERSION) {
    return verdict(candidate, clock, { verdict: "rejected", reasonCode: "RC_CONTRACT_VERSION" });
  }

  const recordedAtMs = parseContractTime(candidate.recordedAt);
  if (recordedAtMs == null || parseContractTime(clock) == null) {
    return verdict(candidate, clock, { verdict: "rejected", reasonCode: "RC_CONTRACT_VERSION" });
  }

  const prior = store.idempotency?.get(candidate.idempotencyKey);
  if (prior) {
    const incomingHash = candidate.payloadHash ?? candidate.idempotencyKey;
    if (incomingHash !== prior.payloadHash) {
      return verdict(candidate, clock, { verdict: "rejected", reasonCode: "RC_EVIDENCE_TAMPERED" });
    }
    return {
      ...prior.record,
      reasonCode: "RC_DUPLICATE_REPLAY",
      replayOf: prior.record.candidateId,
      evaluatedAt: clock,
    };
  }

  if (store.priorVerdict === "accepted" && candidate.supersedes) {
    return verdict(candidate, clock, { verdict: "rejected", reasonCode: "RC_ROLLBACK" });
  }

  if (
    store.priorVerdict === "accepted" &&
    store.cancelGeneration !== undefined &&
    !candidate.supersedes
  ) {
    return verdict(candidate, clock, { verdict: "cancelled", reasonCode: "RC_CANCELLED" });
  }

  if (store.priorVerdict === "accepted") {
    return verdict(candidate, clock, { verdict: "rejected", reasonCode: "RC_SOURCE_CONFLICT" });
  }

  const tenantId = resolveBridgeTenantId({ tenantId: candidate.taskIdentity.tenantId });
  if (!tenantId) {
    return verdict(candidate, clock, { verdict: "rejected", reasonCode: "RC_TENANT_MISMATCH" });
  }
  const bindingTenantId = store.bindingTenantId?.trim() ?? "";
  if (!bindingTenantId || bindingTenantId !== tenantId) {
    return verdict(candidate, clock, { verdict: "rejected", reasonCode: "RC_TENANT_MISMATCH" });
  }
  if (candidate.taskIdentity.scope === "group_tenant" && store.attributionVerified !== true) {
    return verdict(candidate, clock, { verdict: "rejected", reasonCode: "RC_TENANT_MISMATCH" });
  }
  if (!store.bindingScope?.trim() || store.bindingScope !== candidate.taskIdentity.scope) {
    return verdict(candidate, clock, { verdict: "rejected", reasonCode: "RC_TENANT_MISMATCH" });
  }
  if (candidate.taskIdentity.scope === "group_tenant" && !candidate.taskIdentity.groupId) {
    return verdict(candidate, clock, { verdict: "rejected", reasonCode: "RC_TENANT_MISMATCH" });
  }

  if (store.forceOff) {
    return verdict(candidate, clock, { verdict: "cancelled", reasonCode: "RC_FORCE_OFF" });
  }

  if (store.cancelGeneration !== undefined && store.cancelEffectiveAt) {
    const cancelMs = parseContractTime(store.cancelEffectiveAt);
    if (cancelMs == null) {
      return verdict(candidate, clock, { verdict: "rejected", reasonCode: "RC_CONTRACT_VERSION" });
    }
    if (
      store.cancelGeneration >= candidate.taskIdentity.primaryGeneration &&
      cancelMs <= recordedAtMs &&
      store.priorVerdict !== "accepted"
    ) {
      return verdict(candidate, clock, {
        verdict: "cancelled",
        reasonCode: "RC_RACE_LOST_TO_CANCEL",
      });
    }
  }

  if (
    store.currentBindingVersion !== undefined &&
    candidate.taskIdentity.bindingVersion !== undefined &&
    candidate.taskIdentity.bindingVersion < store.currentBindingVersion
  ) {
    return verdict(candidate, clock, { verdict: "stale", reasonCode: "RC_BINDING_STALE" });
  }

  if (store.activeRunId && store.candidateRunId && store.candidateRunId !== store.activeRunId) {
    return verdict(candidate, clock, { verdict: "stale", reasonCode: "RC_RUN_STALE" });
  }

  if (DISPLAY_ONLY_SOURCES.has(candidate.completionSource)) {
    return verdict(candidate, clock, { verdict: "rejected", reasonCode: "RC_SOURCE_NOT_ALLOWED" });
  }

  if (candidate.completionSource === "autopilot_candidate") {
    return verdict(candidate, clock, { verdict: "pending", reasonCode: "RC_PENDING_EVIDENCE" });
  }

  if (candidate.completionSource === "round_converged") {
    return verdict(candidate, clock, { verdict: "pending", reasonCode: "RC_PENDING_EVIDENCE" });
  }

  const evidenceResult = validateEvidence(candidate, store, clock);
  if (evidenceResult) {
    return verdict(candidate, clock, evidenceResult);
  }

  if (store.requireHuman) {
    return verdict(candidate, clock, { verdict: "needs_human", reasonCode: "RC_PENDING_HUMAN" });
  }

  if (candidate.completionSource === "supervisor_accepted") {
    return verdict(candidate, clock, {
      verdict: "accepted",
      reasonCode: "RC_OK",
      winningSource: "supervisor_accepted",
    });
  }

  if (
    candidate.completionSource === "ledger_verified" ||
    candidate.completionSource === "ledger_completed"
  ) {
    return verdict(candidate, clock, {
      verdict: "accepted",
      reasonCode: "RC_OK",
      winningSource: candidate.completionSource,
    });
  }

  return verdict(candidate, clock, { verdict: "rejected", reasonCode: "RC_EVIDENCE_MISSING" });
}

function validateEvidence(
  candidate: CompletionCandidate,
  store: EvaluateStore,
  clock: string,
): Pick<ContractVerdictRecord, "verdict" | "reasonCode"> | null {
  const needsEvidence =
    candidate.completionSource === "supervisor_accepted" ||
    candidate.completionSource === "ledger_verified" ||
    candidate.completionSource === "ledger_completed";
  if (!needsEvidence) {
    return null;
  }
  if (candidate.evidenceReferences.length === 0) {
    return { verdict: "rejected", reasonCode: "RC_EVIDENCE_MISSING" };
  }
  for (const ref of candidate.evidenceReferences) {
    const evidenceTime = evidenceTimeStatus(ref, candidate.recordedAt, clock);
    if (evidenceTime === "invalid") {
      return { verdict: "rejected", reasonCode: "RC_CONTRACT_VERSION" };
    }
    if (evidenceTime === "expired") {
      return { verdict: "stale", reasonCode: "RC_EVIDENCE_EXPIRED" };
    }
    const lookup = store.evidence?.[ref.ref];
    if (!lookup || !lookup.exists) {
      return { verdict: "rejected", reasonCode: "RC_EVIDENCE_NOT_FOUND" };
    }
    if (lookup.expired) {
      return { verdict: "stale", reasonCode: "RC_EVIDENCE_EXPIRED" };
    }
  }
  return null;
}

function evidenceTimeStatus(
  ref: EvidenceReference,
  recordedAt: string,
  clock: string,
): "valid" | "expired" | "invalid" {
  const nowMs = parseContractTime(clock);
  if (nowMs == null) {
    return "invalid";
  }
  if (ref.validUntil) {
    const untilMs = parseContractTime(ref.validUntil);
    if (untilMs == null) {
      return "invalid";
    }
    return untilMs < nowMs ? "expired" : "valid";
  }
  const ttl = Object.hasOwn(EVIDENCE_DEFAULT_TTL_MS, ref.kind)
    ? EVIDENCE_DEFAULT_TTL_MS[ref.kind]
    : undefined;
  if (ttl == null) {
    return "valid";
  }
  const startMs = parseContractTime(recordedAt);
  if (startMs == null) {
    return "invalid";
  }
  return nowMs - startMs > ttl ? "expired" : "valid";
}

export type RankedCandidate = {
  completionSource: CompletionSource;
  recordedAt: string;
  candidateId?: string;
};

/** §7: higher rank wins; same rank → later recordedAt epoch; then candidateId lexicographic. */
export function pickWinningCandidate(items: RankedCandidate[]): RankedCandidate {
  const ranked = items.filter((item) =>
    Object.hasOwn(COMPLETION_SOURCE_RANK, item.completionSource),
  );
  if (ranked.length === 0) {
    throw new Error("pickWinningCandidate: no allowed completion source");
  }
  if (ranked.some((item) => parseContractTime(item.recordedAt) == null)) {
    throw new Error("pickWinningCandidate: invalid recordedAt");
  }
  return ranked.reduce((best, current) => {
    const bestRank = COMPLETION_SOURCE_RANK[best.completionSource];
    const currentRank = COMPLETION_SOURCE_RANK[current.completionSource];
    if (currentRank !== bestRank) {
      return currentRank > bestRank ? current : best;
    }
    const bestMs = parseContractTime(best.recordedAt);
    const currentMs = parseContractTime(current.recordedAt);
    if (bestMs == null || currentMs == null) {
      throw new Error("pickWinningCandidate: invalid recordedAt");
    }
    if (currentMs !== bestMs) {
      return currentMs > bestMs ? current : best;
    }
    const bestId = best.candidateId ?? "";
    const currentId = current.candidateId ?? "";
    return currentId > bestId ? current : best;
  });
}

export function pickWinningSource(sources: CompletionSource[]): CompletionSource {
  return pickWinningCandidate(
    sources.map((completionSource, index) => ({
      completionSource,
      recordedAt: "1970-01-01T00:00:00Z",
      candidateId: String(index).padStart(4, "0"),
    })),
  ).completionSource;
}

export type AggregateStatus =
  | "running"
  | "waiting"
  | "pending_evidence"
  | "needs_human"
  | "step_done"
  | "task_completed"
  | "failed"
  | "cancelled"
  | "stale"
  | "blocked"
  | "unknown";

export function projectUiAggregateStatus(input: {
  contractVerdict: ContractVerdict | null;
  flowStep?: string;
  ledgerStep?: string;
  readFailed?: boolean;
  aclDenied?: boolean;
}): { aggregateStatus: AggregateStatus; showTaskCompleted: boolean } {
  if (input.readFailed) {
    return { aggregateStatus: "unknown", showTaskCompleted: false };
  }
  if (input.aclDenied) {
    return { aggregateStatus: "blocked", showTaskCompleted: false };
  }
  if (input.contractVerdict === "accepted") {
    return { aggregateStatus: "task_completed", showTaskCompleted: true };
  }
  if (input.contractVerdict === "cancelled") {
    return { aggregateStatus: "cancelled", showTaskCompleted: false };
  }
  if (input.contractVerdict === "stale") {
    return { aggregateStatus: "stale", showTaskCompleted: false };
  }
  if (input.contractVerdict === "needs_human") {
    return { aggregateStatus: "needs_human", showTaskCompleted: false };
  }
  if (input.contractVerdict === "pending") {
    return { aggregateStatus: "pending_evidence", showTaskCompleted: false };
  }
  if (input.ledgerStep === "failed") {
    return { aggregateStatus: "failed", showTaskCompleted: false };
  }
  if (input.ledgerStep === "blocked") {
    return { aggregateStatus: "blocked", showTaskCompleted: false };
  }
  if (input.flowStep === "done" && input.contractVerdict !== "accepted") {
    return { aggregateStatus: "step_done", showTaskCompleted: false };
  }
  if (input.flowStep === "in_progress" || input.ledgerStep === "in_progress") {
    return { aggregateStatus: "running", showTaskCompleted: false };
  }
  return { aggregateStatus: "waiting", showTaskCompleted: false };
}
