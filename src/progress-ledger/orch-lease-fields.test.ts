import { describe, expect, it } from "vitest";
import {
  ORCH_LEASE_FIELDS_SCHEMA_VERSION,
  orchLeaseRecordToLedgerFields,
  parseOrchLeaseLedgerFields,
  validateOrchLeaseLedgerFields,
} from "./orch-lease-fields.js";

describe("WP-06 orch-lease-fields", () => {
  it("exposes schema version 1 and accepts empty object", () => {
    expect(ORCH_LEASE_FIELDS_SCHEMA_VERSION).toBe(1);
    const parsed = parseOrchLeaseLedgerFields({});
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toEqual({});
    }
  });

  it("parses a full provisional field bag", () => {
    const parsed = parseOrchLeaseLedgerFields({
      leaseHolder: "worker-a",
      fencingToken: 3,
      heartbeatAtMs: 1_000,
      deadlineAtMs: 5_000,
      cancelRequested: false,
      attempt: 1,
      budgetRemaining: 42.5,
      resultRef: "envelope:abc",
      logicalActionId: "action.memory.search",
      ignoredExtra: true,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.value).toEqual({
      leaseHolder: "worker-a",
      fencingToken: 3,
      heartbeatAtMs: 1_000,
      deadlineAtMs: 5_000,
      cancelRequested: false,
      attempt: 1,
      budgetRemaining: 42.5,
      resultRef: "envelope:abc",
      logicalActionId: "action.memory.search",
    });
  });

  it("allows null for nullable holder/heartbeat/deadline/resultRef", () => {
    const parsed = parseOrchLeaseLedgerFields({
      leaseHolder: null,
      heartbeatAtMs: null,
      deadlineAtMs: null,
      resultRef: null,
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.leaseHolder).toBeNull();
      expect(parsed.value.heartbeatAtMs).toBeNull();
      expect(parsed.value.deadlineAtMs).toBeNull();
      expect(parsed.value.resultRef).toBeNull();
    }
  });

  it("rejects invalid fencingToken / attempt / heartbeat-after-deadline", () => {
    expect(parseOrchLeaseLedgerFields({ fencingToken: -1 }).ok).toBe(false);
    expect(parseOrchLeaseLedgerFields({ fencingToken: 1.5 }).ok).toBe(false);
    expect(parseOrchLeaseLedgerFields({ attempt: -2 }).ok).toBe(false);
    expect(parseOrchLeaseLedgerFields({ heartbeatAtMs: 10, deadlineAtMs: 5 }).ok).toBe(false);
    expect(parseOrchLeaseLedgerFields({ leaseHolder: "  " }).ok).toBe(false);
    expect(parseOrchLeaseLedgerFields("nope").ok).toBe(false);
    expect(validateOrchLeaseLedgerFields({ fencingToken: 0 })).toBe(true);
    expect(validateOrchLeaseLedgerFields({ cancelRequested: "yes" })).toBe(false);
  });

  it("maps OrchLeaseRecord shape onto ledger field names", () => {
    const fields = orchLeaseRecordToLedgerFields({
      leaseHolder: "worker-b",
      fencingToken: 2,
      heartbeatAt: 100,
      deadlineAt: 200,
      cancelRequested: true,
      attempt: 0,
      budgetRemaining: 1,
      resultRef: null,
      logicalActionId: "action.web_read",
    });
    expect(fields).toEqual({
      leaseHolder: "worker-b",
      fencingToken: 2,
      heartbeatAtMs: 100,
      deadlineAtMs: 200,
      cancelRequested: true,
      attempt: 0,
      budgetRemaining: 1,
      resultRef: null,
      logicalActionId: "action.web_read",
    });
    expect(validateOrchLeaseLedgerFields(fields)).toBe(true);
  });
});
