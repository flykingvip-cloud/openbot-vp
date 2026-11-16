/**
 * Derive RPC-run case summaries from recorded RPC assertions.
 *
 * Honesty rule: a case whose original under-test call failed must not be
 * marked pass, unless that failure is an explicit expected failure (timeout
 * simulation, auth deny, missing-session inject). Official "accepted" is not
 * enough for a write path; persistence must be observed. chat.inject ok does
 * not by itself prove history grew.
 */
export type RpcPhase = "preparation" | "under_test" | "verification";

export type MessageDiff = {
  beforeCount?: number;
  afterCount?: number;
  added?: unknown[];
};

export type RpcRecord = {
  phase?: string;
  caseName: string;
  method: string;
  ok?: boolean | null;
  error?: unknown;
  messages?: { diff?: MessageDiff; before?: unknown[]; after?: unknown[] };
  returnSummary?: Record<string, unknown> | null;
};

export type ExpectedFailure = {
  method: string;
  phase?: RpcPhase;
};

export type CaseHonestySpec = {
  caseName: string;
  /** under_test records whose ok=false is the expected setup, not a pass criterion. */
  expectedFailures?: readonly ExpectedFailure[];
  /** Write paths must show a growing history; "accepted" alone is not enough. */
  requirePersistence?: boolean;
  /** If official outcome is accepted, still require persistence when this is set. */
  officialOutcome?: string | null;
};

export type CaseHonestyResult = {
  caseName: string;
  result: "pass" | "fail";
  reasons: string[];
  underTest: Array<{
    method: string;
    ok: boolean | null;
    error: unknown;
    expectedFailure: boolean;
  }>;
  persistence: {
    observed: boolean;
    beforeCount: number | null;
    afterCount: number | null;
    addedCount: number | null;
  };
};

function isExpectedFailure(
  record: RpcRecord,
  expected: readonly ExpectedFailure[] | undefined,
): boolean {
  if (!expected || expected.length === 0) {
    return false;
  }
  return expected.some(
    (item) => item.method === record.method && (item.phase == null || item.phase === record.phase),
  );
}

function diffOf(record: RpcRecord): MessageDiff | undefined {
  return record.messages?.diff;
}

export function persistenceFromRecords(
  records: readonly RpcRecord[],
): CaseHonestyResult["persistence"] {
  let beforeCount: number | null = null;
  let afterCount: number | null = null;
  let addedCount: number | null = null;
  let observed = false;
  for (const record of records) {
    const diff = diffOf(record);
    if (!diff) {
      continue;
    }
    if (typeof diff.beforeCount === "number") {
      beforeCount =
        beforeCount == null ? diff.beforeCount : Math.min(beforeCount, diff.beforeCount);
    }
    if (typeof diff.afterCount === "number") {
      afterCount = afterCount == null ? diff.afterCount : Math.max(afterCount, diff.afterCount);
    }
    if (Array.isArray(diff.added)) {
      addedCount = addedCount == null ? diff.added.length : Math.max(addedCount, diff.added.length);
    }
  }
  if (
    (typeof beforeCount === "number" &&
      typeof afterCount === "number" &&
      afterCount > beforeCount) ||
    (typeof addedCount === "number" && addedCount > 0)
  ) {
    observed = true;
  }
  return { observed, beforeCount, afterCount, addedCount };
}

export function recordsFromJsonl(text: string): RpcRecord[] {
  const records: RpcRecord[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const parsed = JSON.parse(line) as RpcRecord;
    if (parsed && typeof parsed.caseName === "string" && typeof parsed.method === "string") {
      records.push(parsed);
    }
  }
  return records;
}

export function deriveCaseHonesty(
  spec: CaseHonestySpec,
  records: readonly RpcRecord[],
): CaseHonestyResult {
  const scoped = records.filter((record) => record.caseName === spec.caseName);
  const underTest = scoped.filter((record) => record.phase === "under_test");
  const reasons: string[] = [];
  const underTestSummary = underTest.map((record) => {
    const expectedFailure = isExpectedFailure(record, spec.expectedFailures);
    const ok = typeof record.ok === "boolean" ? record.ok : null;
    if (ok === false && !expectedFailure) {
      reasons.push(
        `original under-test call ${record.method} failed and is not an expected failure`,
      );
    }
    if (ok === false && expectedFailure && record.error != null) {
      // recorded for evidence; does not fail the case by itself
    }
    return {
      method: record.method,
      ok,
      error: record.error ?? null,
      expectedFailure,
    };
  });

  const persistence = persistenceFromRecords(scoped);
  if (spec.requirePersistence && !persistence.observed) {
    reasons.push(
      "write path has no observed persistence (afterCount did not grow; inject/send ok is not sufficient)",
    );
  }
  if (spec.requirePersistence && spec.officialOutcome === "accepted" && !persistence.observed) {
    reasons.push("official outcome was accepted but the target session history did not grow");
  }

  return {
    caseName: spec.caseName,
    result: reasons.length === 0 ? "pass" : "fail",
    reasons,
    underTest: underTestSummary,
    persistence,
  };
}

export function deriveSummaryCases(
  records: readonly RpcRecord[],
  specs: readonly CaseHonestySpec[],
  extras: Record<string, Record<string, unknown>> = {},
): Record<string, Record<string, unknown>> {
  const cases: Record<string, Record<string, unknown>> = {};
  for (const spec of specs) {
    const honesty = deriveCaseHonesty(spec, records);
    cases[spec.caseName] = {
      ...extras[spec.caseName],
      honesty,
      result: honesty.result,
    };
  }
  return cases;
}

/** Specs that re-evaluate the t20 isolated diagnosis RPC run honestly. */
export const T20_DIAGNOSIS_RPC_SPECS: readonly CaseHonestySpec[] = [
  {
    caseName: "duplicate-delivery",
    requirePersistence: true,
  },
  {
    caseName: "timeout-fallback",
    requirePersistence: true,
    expectedFailures: [{ method: "chat.send", phase: "under_test" }],
  },
  {
    caseName: "auth-deny",
    requirePersistence: false,
    expectedFailures: [{ method: "chat.send", phase: "under_test" }],
  },
  {
    caseName: "reset-boundary",
    requirePersistence: false,
    expectedFailures: [{ method: "chat.inject", phase: "under_test" }],
  },
  {
    caseName: "concurrency",
    requirePersistence: true,
  },
  {
    caseName: "concurrency-a",
    requirePersistence: true,
  },
  {
    caseName: "concurrency-b",
    requirePersistence: true,
  },
  {
    caseName: "boundary-deny",
    requirePersistence: false,
  },
];

/** Fold concurrency-a / concurrency-b records into a combined "concurrency" case. */
export function withCombinedConcurrency(records: readonly RpcRecord[]): RpcRecord[] {
  const combined = records
    .filter((record) => record.caseName === "concurrency-a" || record.caseName === "concurrency-b")
    .map((record) => ({ ...record, caseName: "concurrency" }));
  return [...records, ...combined];
}
