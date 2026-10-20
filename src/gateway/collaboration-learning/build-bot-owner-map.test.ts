import { describe, expect, it, vi } from "vitest";
import type { EnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import { buildBotOwnerUserIdMap } from "./space-store.js";

vi.mock("../../config/config.js", () => ({
  loadConfig: vi.fn(() => ({
    agents: {
      list: [
        {
          id: "agt-hrqb-163-com-n1yna7bk",
          scope: "shared",
          ownerType: "position",
          ownerId: "b6ade47f-b9a0-4204-84c5-effe657a5877",
          ownerName: "产品体验-王老师",
        },
        {
          id: "agt-bound",
          scope: "shared",
          ownerType: "position",
          ownerId: "b6ade47f-b9a0-4204-84c5-effe657a5877",
          ownerName: "产品体验-王老师",
        },
      ],
    },
  })),
}));

vi.mock("../ownership-store.js", () => ({
  listOwnershipRecords: vi.fn(() => [
    {
      id: "001:agent:agt-from-ownership",
      tenantId: "001",
      subjectKind: "agent",
      subjectId: "agt-from-ownership",
      positionId: "b6ade47f-b9a0-4204-84c5-effe657a5877",
      positionLabel: "产品体验-王老师",
      createdByUserId: "c6862233-2e3e-4c89-a942-ce813e782637",
      createdByUserLabel: "王军",
      currentManagerUserId: "c6862233-2e3e-4c89-a942-ce813e782637",
      currentManagerLabel: "王军",
      bindingStatus: "active",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
  ]),
  transferOwnershipRecord: vi.fn(),
  upsertOwnershipRecord: vi.fn(),
}));

describe("buildBotOwnerUserIdMap", () => {
  it("resolves position-owned agents without assetBindings via seat current employee", () => {
    const seatStore = {
      seats: {
        "b6ade47f-b9a0-4204-84c5-effe657a5877": {
          currentEmployeeId: "c6862233-2e3e-4c89-a942-ce813e782637",
          title: "产品体验-王老师",
          status: "occupied",
        },
      },
      assetBindings: {
        bound: {
          tenantId: "001",
          assetType: "agent",
          assetId: "agt-bound",
          seatId: "b6ade47f-b9a0-4204-84c5-effe657a5877",
          status: "active",
        },
      },
    } as unknown as EnterpriseSeatAssetsStore;

    const map = buildBotOwnerUserIdMap(seatStore, "001");
    expect(map.get("agt-bound")).toBe("c6862233-2e3e-4c89-a942-ce813e782637");
    expect(map.get("agt-hrqb-163-com-n1yna7bk")).toBe("c6862233-2e3e-4c89-a942-ce813e782637");
    expect(map.get("agt-from-ownership")).toBe("c6862233-2e3e-4c89-a942-ce813e782637");
  });
});
