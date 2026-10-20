import { describe, expect, it } from "vitest";
import { listInvocationAuditEvents, recordInvocationAudit } from "./audit-runtime.js";
import { normalizeEnterpriseDataStore } from "./store.js";

const tenantId = "tenant-acme";
const seatId = "seat-sales-mgr-east";
const nowIso = "2026-06-05T12:00:00.000Z";

function seedSeatHandoverAudits() {
  const store = normalizeEnterpriseDataStore(null);
  recordInvocationAudit({
    store,
    traceId: "trace-former-001",
    tenantId,
    seatId,
    employeeId: "emp-former-holder",
    connectorId: "crm-salesforce",
    actionKey: "crm.customer.read_summary",
    version: "v1",
    riskLevel: "LOW",
    scopeType: "SELF",
    status: "SUCCESS",
    nowIso,
  });
  recordInvocationAudit({
    store,
    traceId: "trace-current-001",
    tenantId,
    seatId,
    employeeId: "emp-current-holder",
    connectorId: "crm-salesforce",
    actionKey: "crm.customer.read_summary",
    version: "v1",
    riskLevel: "LOW",
    scopeType: "SELF",
    status: "SUCCESS",
    nowIso: "2026-06-05T13:00:00.000Z",
  });
  return store;
}

describe("listInvocationAuditEvents", () => {
  it("isolates member visibility by employeeId on a shared seat", () => {
    const store = seedSeatHandoverAudits();
    const formerEvents = listInvocationAuditEvents({
      store,
      tenantId,
      employeeId: "emp-former-holder",
    });
    const currentEvents = listInvocationAuditEvents({
      store,
      tenantId,
      employeeId: "emp-current-holder",
    });
    expect(formerEvents).toHaveLength(1);
    expect(formerEvents[0]?.traceId).toBe("trace-former-001");
    expect(currentEvents).toHaveLength(1);
    expect(currentEvents[0]?.traceId).toBe("trace-current-001");
  });

  it("keeps admin seat-level queries across seat holders", () => {
    const store = seedSeatHandoverAudits();
    const seatEvents = listInvocationAuditEvents({
      store,
      tenantId,
      seatId,
    });
    expect(seatEvents).toHaveLength(2);
    const employeeIds = seatEvents
      .map((event) => event.employeeId)
      .filter((value): value is string => typeof value === "string");
    expect(employeeIds.toSorted((a, b) => a.localeCompare(b))).toEqual([
      "emp-current-holder",
      "emp-former-holder",
    ]);
  });

  it("returns only records for the requested employeeId", () => {
    const store = seedSeatHandoverAudits();
    const memberEvents = listInvocationAuditEvents({
      store,
      tenantId,
      employeeId: "emp-current-holder",
    });
    expect(memberEvents.every((event) => event.employeeId === "emp-current-holder")).toBe(true);
    expect(memberEvents.some((event) => event.employeeId === "emp-former-holder")).toBe(false);
  });
});
