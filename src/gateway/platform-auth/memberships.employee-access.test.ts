import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";

const listOwnershipRecordsMock = vi.hoisted(() =>
  vi.fn(() => [] as Array<Record<string, unknown>>),
);

vi.mock("../ownership-store.js", () => ({
  listOwnershipRecords: () => listOwnershipRecordsMock(),
}));

import { buildPlatformEmployeeAccess } from "./memberships.js";

function emptySeatStore(): EnterpriseSeatAssetsStore {
  return {
    version: 1,
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
    organizationDepartments: {},
    organizationChildOrders: {},
  } as EnterpriseSeatAssetsStore;
}

describe("buildPlatformEmployeeAccess", () => {
  beforeEach(() => {
    listOwnershipRecordsMock.mockReset();
    listOwnershipRecordsMock.mockReturnValue([]);
  });

  it("unions ownership agent ids into agentIds when seat snapshot has no binding", () => {
    listOwnershipRecordsMock.mockReturnValue([
      {
        tenantId: "001",
        subjectKind: "agent",
        subjectId: "panda",
        currentManagerUserId: "user-ceo",
        bindingStatus: "active",
      },
      {
        tenantId: "001",
        subjectKind: "agent",
        subjectId: "bot-2",
        currentManagerUserId: "user-ceo",
        bindingStatus: "active",
      },
      {
        tenantId: "001",
        subjectKind: "agent",
        subjectId: "ghost",
        currentManagerUserId: "user-ceo",
        bindingStatus: "revoked",
      },
    ]);

    const access = buildPlatformEmployeeAccess({
      seatStore: emptySeatStore(),
      enterpriseId: "001",
      employeeId: "user-ceo",
      employeeEmail: "daniel.hhd@gmail.com",
    });

    expect(access?.ownedAgentIds?.toSorted()).toEqual(["bot-2", "panda"]);
    expect(access?.agentIds?.toSorted()).toEqual(["bot-2", "panda"]);
    expect(access?.employeeUserId).toBe("user-ceo");
  });
});
