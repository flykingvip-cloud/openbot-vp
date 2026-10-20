import { describe, expect, it } from "vitest";
import type { EnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import type { UsageRecord } from "./types.ts";
import {
  extractAorRunIdFromEventId,
  extractCreditTaskIdFromEventId,
  inferUsageAttributionForRecord,
} from "./usage-attribution-backfill.ts";

function makeSeatStore(): EnterpriseSeatAssetsStore {
  return {
    version: 4,
    seats: {
      "seat-1": {
        seatId: "seat-1",
        tenantId: "ent-a",
        title: "销售",
        status: "occupied",
        defaultSpaceIds: [],
        defaultAgentAssetIds: ["bot-sales"],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    },
    bindings: {},
    accessPolicies: {},
    assetBindings: {},
    credentialBindings: {},
    handovers: {},
    offers: {},
    auditEvents: {},
    enterpriseIdentities: {},
    identityUsagePolicies: {},
    dataSourceIdentityBindings: {},
    employeeIdentityEnrollments: {},
  };
}

function usage(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    id: "usage-1",
    enterpriseId: "ent-a",
    userId: "alice@example.com",
    eventId: "credit:run-abc",
    key: "ai_credits",
    quantity: 5,
    occurredAt: "2026-03-10T00:00:00.000Z",
    ingestedAt: "2026-03-10T00:00:00.000Z",
    ...overrides,
  };
}

describe("usage-attribution-backfill", () => {
  it("parses credit and aor event id prefixes", () => {
    expect(extractCreditTaskIdFromEventId("credit:run-1")).toBe("run-1");
    expect(extractCreditTaskIdFromEventId("provider-cost:run-2")).toBe("run-2");
    expect(extractAorRunIdFromEventId("aor:run-3:scan:tokens")).toBe("run-3");
  });

  it("infers agentId from run index and orgSeatId from seat store", () => {
    const runIndex = new Map([["run-abc", { agentId: "bot-sales" }]]);
    const patch = inferUsageAttributionForRecord({
      record: usage(),
      seatStore: makeSeatStore(),
      runIndex,
    });
    expect(patch).toEqual({ agentId: "bot-sales", orgSeatId: "seat-1" });
  });

  it("fills only orgSeatId when agentId already present", () => {
    const patch = inferUsageAttributionForRecord({
      record: usage({ agentId: "bot-sales", orgSeatId: undefined }),
      seatStore: makeSeatStore(),
      runIndex: new Map(),
    });
    expect(patch).toEqual({ orgSeatId: "seat-1" });
  });

  it("returns null when record is fully tagged", () => {
    const patch = inferUsageAttributionForRecord({
      record: usage({ agentId: "bot-sales", orgSeatId: "seat-1" }),
      seatStore: makeSeatStore(),
      runIndex: new Map(),
    });
    expect(patch).toBeNull();
  });
});
