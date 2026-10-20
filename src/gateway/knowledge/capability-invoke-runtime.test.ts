// @vitest-environment node
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listDataCapabilities } from "../enterprise-data/data-capability-store.js";
import { seedEnterpriseDataCatalog } from "../enterprise-data/seeds.js";
import { normalizeEnterpriseDataStore } from "../enterprise-data/store.js";
import type { EnterpriseDataStore } from "../enterprise-data/types.js";
import { invokeKnowledgeCapability } from "./capability-invoke-runtime.js";
import { grantDataCapabilityToSeat } from "./seat-capability-access.js";
import type { KnowledgeSourceContext } from "./sources/types.js";

const tenantId = "tenant-acme";
const nowIso = "2026-06-25T00:00:00.000Z";
let auditStorePath: string;

function seededStore(): EnterpriseDataStore {
  const store = normalizeEnterpriseDataStore(null);
  seedEnterpriseDataCatalog({ store, tenantId, nowIso });
  return store;
}

function context(seatId: string | null): KnowledgeSourceContext {
  return { tenantId, seatId, userId: "user-1", hasEnterpriseScope: true };
}

function firstCapabilityId(store: EnterpriseDataStore): string {
  const caps = listDataCapabilities({ store, tenantId });
  const cap = caps[0];
  if (!cap) {
    throw new Error("expected at least one seeded data capability");
  }
  return cap.capabilityId;
}

beforeEach(() => {
  auditStorePath = `/tmp/openbot-cap-invoke-${Math.random().toString(36).slice(2)}.json`;
});

afterEach(() => {
  fs.rmSync(auditStorePath, { force: true });
});

describe("governed capability invoke (boundary-preserving)", () => {
  it("denies invoke without a seat grant and records the denial", async () => {
    const store = seededStore();
    const capabilityId = firstCapabilityId(store);
    const outcome = await invokeKnowledgeCapability({
      capabilityId,
      context: context("seat-1"),
      store,
      auditStorePath,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("not-authorized");
    expect(outcome.accessState).not.toBe("granted");
    expect(outcome.auditId).toBeTruthy();
  });

  it("returns materialized capability data once the seat is granted", async () => {
    const store = seededStore();
    const capabilityId = firstCapabilityId(store);
    grantDataCapabilityToSeat({ store, tenantId, seatId: "seat-1", capabilityId, nowIso });
    const outcome = await invokeKnowledgeCapability({
      capabilityId,
      context: context("seat-1"),
      store,
      auditStorePath,
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.accessState).toBe("granted");
    expect(outcome.data?.title).toBeTruthy();
    expect(Array.isArray(outcome.data?.sourceSystems)).toBe(true);
    expect(outcome.data?.freshness).toBe("unknown");
    expect(outcome.auditId).toBeTruthy();
  });

  it("enforces a per-seat invocation quota", async () => {
    const store = seededStore();
    const capabilityId = firstCapabilityId(store);
    grantDataCapabilityToSeat({ store, tenantId, seatId: "seat-1", capabilityId, nowIso });
    const first = await invokeKnowledgeCapability({
      capabilityId,
      context: context("seat-1"),
      store,
      quotaLimit: 1,
      auditStorePath,
    });
    expect(first.ok).toBe(true);
    const second = await invokeKnowledgeCapability({
      capabilityId,
      context: context("seat-1"),
      store,
      quotaLimit: 1,
      auditStorePath,
    });
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("quota-exceeded");
  });

  it("rejects when seat context is missing", async () => {
    const store = seededStore();
    const capabilityId = firstCapabilityId(store);
    const outcome = await invokeKnowledgeCapability({
      capabilityId,
      context: context(null),
      store,
      auditStorePath,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("no-seat");
  });
});
