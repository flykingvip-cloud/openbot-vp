import { afterEach, describe, expect, it } from "vitest";
import {
  getMemoryGovernanceEpoch,
  resetMemoryGovernanceEpochForTests,
} from "../memory/memory-search-governance.js";
import { invalidateCogniWeaveManagersForGovernanceChangeSync } from "../memory/search-manager.js";
import {
  assignSeatToEmployee,
  ensureSeatForProvision,
  releaseSeatToVacant,
  startSeatHandover,
  startSeatHandoverForEmployee,
  type EnterpriseSeatAssetsStore,
} from "./enterprise-seat-assets-store.js";

function emptyStore(): EnterpriseSeatAssetsStore {
  return {
    version: 2,
    seats: {},
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

afterEach(() => {
  invalidateCogniWeaveManagersForGovernanceChangeSync();
  resetMemoryGovernanceEpochForTests();
});

describe("Seat production entries bump CogniWeave governance epoch (P1-2 round 5)", () => {
  it("assignSeatToEmployee bumps epoch before return", () => {
    const store = emptyStore();
    const seat = ensureSeatForProvision({
      store,
      tenantId: "tenant-1",
      seatTitle: "Ops",
      defaultAgentId: "agent-ops",
      defaultSpaceIds: ["space-ops"],
      nowIso: "2026-08-12T00:00:00.000Z",
      actorEmployeeId: "admin-1",
    });
    const before = getMemoryGovernanceEpoch();
    assignSeatToEmployee({
      store,
      tenantId: "tenant-1",
      seatId: seat.seatId,
      employeeId: "employee-a",
      nowIso: "2026-08-12T00:01:00.000Z",
      actorEmployeeId: "admin-1",
    });
    expect(getMemoryGovernanceEpoch()).toBe(before + 1);
  });

  it("startSeatHandoverForEmployee bumps epoch before return on revoke path", () => {
    const store = emptyStore();
    const seat = ensureSeatForProvision({
      store,
      tenantId: "tenant-1",
      seatTitle: "Ops",
      defaultAgentId: "agent-ops",
      defaultSpaceIds: ["space-ops"],
      nowIso: "2026-08-12T00:00:00.000Z",
      actorEmployeeId: "admin-1",
    });
    assignSeatToEmployee({
      store,
      tenantId: "tenant-1",
      seatId: seat.seatId,
      employeeId: "employee-out",
      nowIso: "2026-08-12T00:01:00.000Z",
      actorEmployeeId: "admin-1",
    });
    const before = getMemoryGovernanceEpoch();
    const cases = startSeatHandoverForEmployee({
      store,
      tenantId: "tenant-1",
      employeeId: "employee-out",
      nowIso: "2026-08-12T00:02:00.000Z",
      actorEmployeeId: "admin-1",
    });
    expect(cases.length).toBeGreaterThan(0);
    expect(getMemoryGovernanceEpoch()).toBe(before + 1);
  });

  it("startSeatHandover bumps epoch before return on revoke path", () => {
    const store = emptyStore();
    const seat = ensureSeatForProvision({
      store,
      tenantId: "tenant-1",
      seatTitle: "Ops",
      defaultAgentId: "agent-ops",
      defaultSpaceIds: ["space-ops"],
      nowIso: "2026-08-12T00:00:00.000Z",
      actorEmployeeId: "admin-1",
    });
    assignSeatToEmployee({
      store,
      tenantId: "tenant-1",
      seatId: seat.seatId,
      employeeId: "employee-out",
      nowIso: "2026-08-12T00:01:00.000Z",
      actorEmployeeId: "admin-1",
    });
    const before = getMemoryGovernanceEpoch();
    const handover = startSeatHandover({
      store,
      tenantId: "tenant-1",
      seatId: seat.seatId,
      initiatedByEmployeeId: "employee-out",
      nowIso: "2026-08-12T00:02:00.000Z",
      actorEmployeeId: "admin-1",
    });
    expect(handover.status).toBe("draft");
    expect(getMemoryGovernanceEpoch()).toBe(before + 1);
  });

  it("releaseSeatToVacant bumps epoch before return", () => {
    const store = emptyStore();
    const seat = ensureSeatForProvision({
      store,
      tenantId: "tenant-1",
      seatTitle: "Ops",
      defaultAgentId: "agent-ops",
      defaultSpaceIds: ["space-ops"],
      nowIso: "2026-08-12T00:00:00.000Z",
      actorEmployeeId: "admin-1",
    });
    assignSeatToEmployee({
      store,
      tenantId: "tenant-1",
      seatId: seat.seatId,
      employeeId: "employee-a",
      nowIso: "2026-08-12T00:01:00.000Z",
      actorEmployeeId: "admin-1",
    });
    const before = getMemoryGovernanceEpoch();
    releaseSeatToVacant({
      store,
      tenantId: "tenant-1",
      seatId: seat.seatId,
      nowIso: "2026-08-12T00:02:00.000Z",
      actorEmployeeId: "admin-1",
    });
    expect(getMemoryGovernanceEpoch()).toBe(before + 1);
    expect(store.seats[seat.seatId]?.status).toBe("vacant");
  });
});
