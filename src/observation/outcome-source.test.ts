import { describe, it, expect } from "vitest";
import type { OutcomeRecordMetadata } from "./outcome-reader.js";
import { createOutcomeSourceStore } from "./outcome-source.js";
const scope = {
  kind: "personal",
  personalDomainId: "domain",
  subjectRef: "subject:a",
  authzScopeRef: "auth",
} as const;
const record = (): OutcomeRecordMetadata => ({
  scope,
  taskId: "task",
  outcomeVersion: 2,
  decidedAt: "2026-11-06T00:00:00Z",
  taskJudgement: "incomplete",
  lifecycle: "active",
  acceptance: { status: "pending" },
  delivery: { status: "pending" },
  runs: [
    { runId: "run", attemptIds: ["attempt"], effectiveAttemptId: "attempt", status: "succeeded" },
  ],
  attempts: [
    { attemptId: "attempt", runId: "run", status: "succeeded", observedAt: "2026-11-06T00:00:00Z" },
  ],
});
const input = () => ({
  agentId: "bot",
  record: record(),
  runId: "run",
  attemptId: "attempt",
  provenance: "injected" as const,
  collector: "runner_outcome_commit" as const,
  observedAt: 100,
});
describe("exact outcome version source declarations", () => {
  it("matches canonical fields, rejects wrong run/attempt, and does not expose prior-process sources", () => {
    const store = createOutcomeSourceStore({ enabled: () => true, now: () => 100 });
    expect(store.record({ ...input(), runId: "other" })).toBe(false);
    expect(store.record({ ...input(), attemptId: "other" })).toBe(false);
    store.record(input());
    expect(
      store.query("bot", { ...record(), scope: { ...scope, subjectRef: "other" } }).provenance,
    ).toBe("unknown");
    expect(
      createOutcomeSourceStore({ enabled: () => true, now: () => 100 }).query("bot", record())
        .provenance,
    ).toBe("unknown");
    expect(store.query("bot", record()).productionValidated).toBe(false);
  });
  it("keeps old versions unknown and preserves injected source only on exact metadata match", () => {
    const store = createOutcomeSourceStore({ enabled: () => true, now: () => 100 });
    expect(store.query("bot", record()).provenance).toBe("unknown");
    expect(store.record(input())).toBe(true);
    expect(store.query("bot", record()).provenance).toBe("injected");
    expect(store.query("other", record()).provenance).toBe("unknown");
    expect(store.query("bot", { ...record(), taskJudgement: "failure" }).provenance).toBe(
      "unknown",
    );
    expect(store.query("bot", { ...record(), outcomeVersion: 3 }).provenance).toBe("unknown");
  });
  it("does not inherit correction provenance and invalidates conflicting declarations", () => {
    const store = createOutcomeSourceStore({ enabled: () => true, now: () => 100 });
    expect(store.record({ ...input(), record: { ...record(), revisionKind: "correction" } })).toBe(
      false,
    );
    store.record(input());
    expect(store.record({ ...input(), provenance: "live" })).toBe(false);
    expect(store.query("bot", record()).provenance).toBe("unknown");
  });
  it("is bounded, expires and clears on flag withdrawal without synthesizing history", () => {
    let at = 100;
    let on = true;
    const store = createOutcomeSourceStore({
      enabled: () => on,
      now: () => at,
      capacity: 1,
      ttlMs: 10,
    });
    store.record(input());
    store.record({ ...input(), agentId: "other" });
    expect(store.query("bot", record()).provenance).toBe("unknown");
    at = 110;
    expect(store.query("other", record()).provenance).toBe("unknown");
    on = false;
    expect(store.record(input())).toBe(false);
    expect(store.query("bot", record()).provenance).toBe("unknown");
  });
});
