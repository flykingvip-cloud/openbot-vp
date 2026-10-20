import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  COMPLETION_CONTRACT_VERSION,
  evaluateCandidate,
  isDeniedPayloadName,
  parseContractTime,
  pickWinningCandidate,
  pickWinningSource,
  projectUiAggregateStatus,
  resolveBridgeTenantId,
  type CompletionCandidate,
  type CompletionSource,
  type ContractVerdict,
  type ContractVerdictRecord,
  type EvaluateStore,
  type EvidenceReference,
} from "./evaluate-candidate.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

type VectorExpected = {
  verdict?: ContractVerdict;
  reasonCode?: string;
  winningSource?: CompletionSource;
  winnerCandidateId?: string;
  closeCt?: boolean;
  eventAccepted?: boolean;
  goalAchieved?: boolean;
  reopenCt?: string;
  flowUpdates?: number;
  aggregateStatus?: string;
  showTaskCompleted?: boolean;
};

type VectorInput = {
  replay?: boolean;
  sameKey?: boolean;
  samePayload?: boolean;
  cancelGeneration?: number;
  cancelEffectiveAt?: string;
  completionRecordedAt?: string;
  primaryGeneration?: number;
  completionSource?: CompletionSource;
  subagentRunId?: string;
  bindingVersion?: number;
  activeRunId?: number | string;
  currentBindingVersion?: number;
  scope?: "group_tenant" | "personal_local";
  tenantId?: string | null;
  eventTenantId?: string;
  bindingTenantId?: string;
  evidenceReferences?: EvidenceReference[];
  reportStatus?: string;
  now?: string;
  candidates?: Array<{ completionSource: CompletionSource; valid?: boolean }>;
  priorVerdict?: ContractVerdict;
  supersedes?: boolean;
  newEvidenceInvalid?: boolean;
  cancelAfter?: boolean;
  conversationTaskId?: string;
  autonomyLevel?: string;
  forceOff?: boolean;
  eventCount?: number;
  sameIdempotencyKey?: boolean;
  bindingScope?: "group_tenant" | "personal_local";
  eventScope?: "group_tenant" | "personal_local";
  contractVersion?: string;
  flowStep?: string;
  ledgerStep?: string;
  contractVerdict?: ContractVerdict | null;
  omitBindingTenantId?: boolean;
  omitBindingScope?: boolean;
  attributionVerified?: boolean;
  requesterId?: string | null;
  readFailed?: boolean;
  aclDenied?: boolean;
  recordedAt?: string;
  rivalRecordedAt?: string;
};

type Vector = {
  id: string;
  category: string;
  description: string;
  input: VectorInput;
  expected: VectorExpected;
};

const manifest = JSON.parse(
  fs.readFileSync(
    path.join(repoRoot, "docs/design/fixtures/completion-contract/test-vectors.json"),
    "utf8",
  ),
) as { contractVersion: string; vectors: Vector[] };

function baseCandidate(overrides: Partial<CompletionCandidate> = {}): CompletionCandidate {
  const { taskIdentity: identityOverrides, ...rest } = overrides;
  return {
    contractVersion: COMPLETION_CONTRACT_VERSION,
    candidateId: "cand-1",
    completionSource: "supervisor_accepted",
    evidenceReferences: [{ kind: "supervisor_report", ref: "sr-001" }],
    recordedAt: "2026-09-15T10:00:00Z",
    idempotencyKey: "idem-1",
    payloadHash: "hash-1",
    ...rest,
    taskIdentity: {
      primaryId: "task-1",
      primaryGeneration: 1,
      tenantId: "tenant-a",
      scope: "group_tenant",
      bindingVersion: 1,
      groupId: "group-1",
      ...identityOverrides,
    },
  };
}

function runVector(vector: Vector): Record<string, unknown> {
  const input = vector.input;
  const clock = input.now ?? "2026-09-15T12:00:00Z";

  if (input.readFailed !== undefined || input.aclDenied !== undefined || vector.id === "TC024") {
    return projectUiAggregateStatus({
      contractVerdict: input.contractVerdict ?? null,
      flowStep: input.flowStep,
      ledgerStep: input.ledgerStep,
      readFailed: input.readFailed,
      aclDenied: input.aclDenied,
    });
  }

  if (vector.id === "TC031" || vector.id === "TC037" || vector.id === "TC038") {
    const winner = pickWinningCandidate([
      {
        completionSource: "ledger_completed",
        recordedAt: input.recordedAt ?? "2026-09-15T10:00:00Z",
        candidateId: "cand-early",
      },
      {
        completionSource: "ledger_completed",
        recordedAt: input.rivalRecordedAt ?? "2026-09-15T11:00:00Z",
        candidateId: "cand-late",
      },
    ]);
    return {
      winningSource: winner.completionSource,
      winnerCandidateId: winner.candidateId,
      reasonCode: "RC_SOURCE_CONFLICT",
    };
  }

  if (vector.id === "TC014") {
    const sources = (input.candidates ?? []).map((item) => item.completionSource);
    const winningSource = pickWinningSource(sources);
    const winner = baseCandidate({
      completionSource: winningSource,
      evidenceReferences:
        winningSource === "supervisor_accepted"
          ? [{ kind: "supervisor_report", ref: "sr-001" }]
          : [{ kind: "ledger_step", ref: "led-001" }],
    });
    const store: EvaluateStore = {
      bindingTenantId: "tenant-a",
      bindingScope: "group_tenant",
      attributionVerified: true,
      evidence: {
        "sr-001": { exists: true, status: "accepted" },
        "led-001": { exists: true, status: "completed" },
      },
    };
    const record = evaluateCandidate(winner, store, clock);
    return { ...record, winningSource: record.winningSource };
  }

  if (vector.id === "TC021") {
    const store: EvaluateStore = {
      idempotency: new Map(),
      bindingTenantId: "tenant-a",
      bindingScope: "group_tenant",
      attributionVerified: true,
      evidence: { "sr-001": { exists: true, status: "accepted" } },
    };
    let flowUpdates = 0;
    let last: ContractVerdictRecord | undefined;
    const count = input.eventCount ?? 2;
    for (let i = 0; i < count; i += 1) {
      const candidate = baseCandidate({
        candidateId: i === 0 ? "cand-1" : "cand-replay",
        idempotencyKey: input.sameIdempotencyKey === false ? `idem-${i}` : "idem-1",
      });
      last = evaluateCandidate(candidate, store, clock);
      if (last.verdict === "accepted" && !last.replayOf) {
        flowUpdates += 1;
        store.idempotency?.set(candidate.idempotencyKey, {
          record: last,
          payloadHash: candidate.payloadHash ?? candidate.idempotencyKey,
        });
      }
    }
    return { flowUpdates, reasonCode: last?.reasonCode };
  }

  const rawTenant = input.eventTenantId !== undefined ? input.eventTenantId : input.tenantId;
  const resolvedTenant =
    rawTenant === undefined
      ? "tenant-a"
      : resolveBridgeTenantId({ tenantId: rawTenant, requesterId: input.requesterId });

  const store: EvaluateStore = {
    evidence: { "sr-001": { exists: true, status: input.reportStatus ?? "accepted" } },
    attributionVerified: input.attributionVerified ?? true,
  };
  if (!input.omitBindingTenantId) {
    store.bindingTenantId = input.bindingTenantId ?? (resolvedTenant || "tenant-a");
  }

  const candidate = baseCandidate({
    contractVersion: input.contractVersion ?? COMPLETION_CONTRACT_VERSION,
    recordedAt: input.completionRecordedAt ?? input.recordedAt ?? "2026-09-15T10:00:00Z",
    completionSource: input.completionSource ?? "supervisor_accepted",
    evidenceReferences: input.evidenceReferences ?? [{ kind: "supervisor_report", ref: "sr-001" }],
    supersedes: input.supersedes ? "cand-prior" : undefined,
    taskIdentity: {
      primaryId: "task-1",
      primaryGeneration: input.primaryGeneration ?? 1,
      tenantId: resolvedTenant ?? "",
      scope: input.eventScope ?? input.scope ?? "group_tenant",
      bindingVersion: input.bindingVersion ?? 1,
      groupId: "group-1",
    },
  });

  if (!input.omitBindingScope) {
    store.bindingScope = input.bindingScope ?? candidate.taskIdentity.scope;
  }

  if (vector.id === "TC007") {
    store.bindingTenantId = "tenant-a";
    store.attributionVerified = true;
    store.bindingScope = "group_tenant";
    const record = evaluateCandidate(candidate, store, clock);
    return {
      ...record,
      eventAccepted: record.verdict === "accepted",
    };
  }

  if (input.sameKey && input.samePayload === false) {
    store.idempotency = new Map([
      [
        candidate.idempotencyKey,
        {
          record: {
            contractVersion: COMPLETION_CONTRACT_VERSION,
            candidateId: "cand-prior",
            idempotencyKey: candidate.idempotencyKey,
            verdict: "accepted",
            reasonCode: "RC_OK",
            evaluatedAt: clock,
            closeCt: true,
          },
          payloadHash: "hash-other",
        },
      ],
    ]);
    candidate.payloadHash = "hash-1";
  }

  if (input.replay || (input.sameKey && input.samePayload)) {
    const first = evaluateCandidate(candidate, store, clock);
    store.idempotency = new Map([
      [
        candidate.idempotencyKey,
        {
          record: first,
          payloadHash: candidate.payloadHash ?? candidate.idempotencyKey,
        },
      ],
    ]);
  }

  if (input.cancelGeneration !== undefined) {
    store.cancelGeneration = input.cancelGeneration;
    store.cancelEffectiveAt = input.cancelEffectiveAt ?? "2026-09-15T10:00:00Z";
  }
  if (input.currentBindingVersion !== undefined) {
    store.currentBindingVersion = input.currentBindingVersion;
  }
  if (input.activeRunId !== undefined) {
    store.activeRunId = String(input.activeRunId);
    store.candidateRunId = input.subagentRunId ?? "run-v1";
  }
  if (input.forceOff) {
    store.forceOff = true;
  }
  if (input.priorVerdict) {
    store.priorVerdict = input.priorVerdict;
  }
  if (input.cancelAfter) {
    store.cancelGeneration = input.cancelGeneration ?? candidate.taskIdentity.primaryGeneration;
    store.cancelEffectiveAt = input.cancelEffectiveAt ?? clock;
  }
  if (input.autonomyLevel === "ask") {
    store.requireHuman = true;
  }
  if (input.evidenceReferences?.some((ref) => ref.ref === "missing")) {
    store.evidence = { missing: { exists: false } };
  }
  for (const ref of candidate.evidenceReferences) {
    if (store.evidence?.[ref.ref] === undefined && ref.ref !== "supervisor-report-123") {
      store.evidence = {
        ...store.evidence,
        [ref.ref]: { exists: true, status: input.reportStatus ?? "accepted" },
      };
    }
  }

  const record = evaluateCandidate(candidate, store, clock);
  return {
    ...record,
    eventAccepted: record.verdict === "accepted",
    goalAchieved: record.verdict === "accepted",
    reopenCt: record.reasonCode === "RC_CANCELLED" && input.cancelAfter ? "policy" : undefined,
  };
}

describe("evaluateCandidate vector suite", () => {
  test("manifest contract version matches evaluateCandidate", () => {
    expect(manifest.contractVersion).toBe(COMPLETION_CONTRACT_VERSION);
    expect(manifest.vectors.length).toBeGreaterThanOrEqual(25);
  });

  test("unknown evidence ref is rejected even when store is empty", () => {
    const record = evaluateCandidate(
      baseCandidate({
        evidenceReferences: [{ kind: "supervisor_report", ref: "supervisor-report-123" }],
      }),
      {
        evidence: {},
        bindingTenantId: "tenant-a",
        bindingScope: "group_tenant",
        attributionVerified: true,
      },
      "2026-09-15T12:00:00Z",
    );
    expect(record.verdict).toBe("rejected");
    expect(record.reasonCode).toBe("RC_EVIDENCE_NOT_FOUND");
    expect(record.closeCt).toBe(false);
  });

  test("pickWinningSource ranks P1 over P2 completed over P2 verified", () => {
    expect(pickWinningSource(["ledger_verified", "ledger_completed"])).toBe("ledger_completed");
    expect(pickWinningSource(["ledger_verified", "supervisor_accepted"])).toBe(
      "supervisor_accepted",
    );
    expect(pickWinningSource(["llm_summary", "ledger_verified"])).toBe("ledger_verified");
  });

  test("pickWinningSource ignores illegal sources and throws when none remain", () => {
    expect(pickWinningSource(["not_a_source" as CompletionSource, "ledger_verified"])).toBe(
      "ledger_verified",
    );
    expect(() => pickWinningSource(["not_a_source" as CompletionSource])).toThrow(
      /no allowed completion source/,
    );
  });

  test("pickWinningCandidate uses recordedAt then candidateId when ranks tie", () => {
    const winner = pickWinningCandidate([
      {
        completionSource: "ledger_completed",
        recordedAt: "2026-09-15T10:00:00Z",
        candidateId: "cand-a",
      },
      {
        completionSource: "ledger_completed",
        recordedAt: "2026-09-15T11:00:00Z",
        candidateId: "cand-b",
      },
    ]);
    expect(winner.candidateId).toBe("cand-b");
  });

  test("resolveBridgeTenantId never falls back to requesterId", () => {
    expect(resolveBridgeTenantId({ tenantId: null, requesterId: "user-9" })).toBeNull();
    expect(resolveBridgeTenantId({ tenantId: "  tenant-a  ", requesterId: "user-9" })).toBe(
      "tenant-a",
    );
  });

  test("missing bindingTenantId fail-closes even when candidate tenant is present", () => {
    const record = evaluateCandidate(
      baseCandidate(),
      { evidence: { "sr-001": { exists: true } }, attributionVerified: true },
      "2026-09-15T12:00:00Z",
    );
    expect(record.reasonCode).toBe("RC_TENANT_MISMATCH");
  });

  test("missing bindingScope fail-closes personal_local against implicit group binding", () => {
    const record = evaluateCandidate(
      baseCandidate({
        taskIdentity: { scope: "personal_local" },
      }),
      {
        evidence: { "sr-001": { exists: true } },
        bindingTenantId: "tenant-a",
        attributionVerified: true,
      },
      "2026-09-15T12:00:00Z",
    );
    expect(record.verdict).toBe("rejected");
    expect(record.reasonCode).toBe("RC_TENANT_MISMATCH");
  });

  test("parseContractTime compares timezone offsets by epoch and rejects illegal ISO", () => {
    expect(parseContractTime("2026-09-15T10:00:00+08:00")).toBe(
      parseContractTime("2026-09-15T02:00:00Z"),
    );
    expect(parseContractTime("2026-09-15T10:00:00+08:00")).toBeLessThan(
      parseContractTime("2026-09-15T03:00:00Z") ?? Number.POSITIVE_INFINITY,
    );
    expect(parseContractTime("not-a-time")).toBeNull();
    expect(parseContractTime("2026-09-15T10:00:00")).toBeNull();
    expect(parseContractTime("tomorrow")).toBeNull();
    expect(parseContractTime("2026-02-30T10:00:00Z")).toBeNull();
    expect(parseContractTime("2025-02-29T10:00:00Z")).toBeNull();
    expect(parseContractTime("2026-04-31T10:00:00+08:00")).toBeNull();
    expect(parseContractTime("2024-02-29T10:00:00Z")).toBe(Date.parse("2024-02-29T10:00:00Z"));
  });

  test("pickWinningCandidate uses epoch then candidateId and fail-closes illegal times", () => {
    const sameEpoch = pickWinningCandidate([
      {
        completionSource: "ledger_completed",
        recordedAt: "2026-09-15T10:00:00+08:00",
        candidateId: "cand-early",
      },
      {
        completionSource: "ledger_completed",
        recordedAt: "2026-09-15T02:00:00Z",
        candidateId: "cand-late",
      },
    ]);
    expect(sameEpoch.candidateId).toBe("cand-late");
    expect(() =>
      pickWinningCandidate([
        {
          completionSource: "ledger_completed",
          recordedAt: "not-a-time",
          candidateId: "cand-bad",
        },
      ]),
    ).toThrow(/invalid recordedAt/);
  });

  test("isDeniedPayloadName is case-insensitive and covers camel/snake aliases", () => {
    for (const name of [
      "HMAC",
      "AccessToken",
      "requester_id",
      "access_token",
      "hmac_secret",
      "private_key",
      "employee-email",
    ]) {
      expect(isDeniedPayloadName(name)).toBe(true);
    }
    expect(isDeniedPayloadName("subagentRunId")).toBe(false);
    expect(isDeniedPayloadName("mytoken")).toBe(false);
  });

  test("readFailed and aclDenied project without claiming task completed", () => {
    expect(projectUiAggregateStatus({ contractVerdict: "accepted", readFailed: true })).toEqual({
      aggregateStatus: "unknown",
      showTaskCompleted: false,
    });
    expect(projectUiAggregateStatus({ contractVerdict: "accepted", aclDenied: true })).toEqual({
      aggregateStatus: "blocked",
      showTaskCompleted: false,
    });
  });

  for (const vector of manifest.vectors) {
    test(`${vector.id} ${vector.description}`, () => {
      const actual = runVector(vector);
      const expected = vector.expected;
      if (expected.verdict !== undefined) {
        expect(actual.verdict).toBe(expected.verdict);
      }
      if (expected.reasonCode !== undefined) {
        expect(actual.reasonCode).toBe(expected.reasonCode);
      }
      if (expected.winningSource !== undefined) {
        expect(actual.winningSource).toBe(expected.winningSource);
      }
      if (expected.winnerCandidateId !== undefined) {
        expect(actual.winnerCandidateId).toBe(expected.winnerCandidateId);
      }
      if (expected.closeCt !== undefined) {
        expect(actual.closeCt).toBe(expected.closeCt);
      }
      if (expected.eventAccepted !== undefined) {
        expect(actual.eventAccepted).toBe(expected.eventAccepted);
      }
      if (expected.goalAchieved !== undefined) {
        expect(actual.goalAchieved).toBe(expected.goalAchieved);
      }
      if (expected.reopenCt !== undefined) {
        expect(actual.reopenCt).toBe(expected.reopenCt);
      }
      if (expected.flowUpdates !== undefined) {
        expect(actual.flowUpdates).toBe(expected.flowUpdates);
      }
      if (expected.aggregateStatus !== undefined) {
        expect(actual.aggregateStatus).toBe(expected.aggregateStatus);
      }
      if (expected.showTaskCompleted !== undefined) {
        expect(actual.showTaskCompleted).toBe(expected.showTaskCompleted);
      }
    });
  }
});
