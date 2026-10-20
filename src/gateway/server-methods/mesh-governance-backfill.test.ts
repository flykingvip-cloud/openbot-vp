// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "./types.js";

const tmpDir = path.join(os.tmpdir(), `openbot-mesh-backfill-${process.pid}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: tmpDir,
  };
});

const loadConfigMock = vi.hoisted(() => vi.fn(() => ({})));
const loadEnterpriseSeatAssetsStoreMock = vi.hoisted(() => vi.fn());
const listGatewayCollaborationSpacesMock = vi.hoisted(() => vi.fn(async () => ({ spaces: [] })));
const listAgentsForGatewayMock = vi.hoisted(() =>
  vi.fn(() => ({
    agents: [
      { id: "main", ownerName: "Daniel" },
      { id: "panda", ownerName: "Daniel" },
      { id: "bot", ownerName: "Daniel" },
    ],
  })),
);

vi.mock("../../config/config.js", () => ({
  loadConfig: loadConfigMock,
}));

vi.mock("../enterprise-seat-assets-store.js", () => ({
  loadEnterpriseSeatAssetsStore: loadEnterpriseSeatAssetsStoreMock,
}));

vi.mock("../collaboration-learning.js", () => ({
  listGatewayCollaborationSpaces: listGatewayCollaborationSpacesMock,
}));

vi.mock("../session-utils.js", () => ({
  listAgentsForGateway: listAgentsForGatewayMock,
}));

const { meshGovernanceHandlers } = await import("./mesh-governance.js");
const { getOwnershipRecord, revokeOwnershipRecord, upsertOwnershipRecord } =
  await import("../ownership-store.js");

function cleanStore() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmpDir, "organization"), { recursive: true });
}

async function callOwnershipList(tenantId = "001") {
  let result: { ok: boolean; payload?: unknown } = { ok: false };
  const respond = (ok: boolean, payload?: unknown) => {
    result = { ok, payload };
  };
  const handler = meshGovernanceHandlers["mesh.ownership.list"];
  await handler({
    req: { jsonrpc: "2.0", method: "mesh.ownership.list", params: { tenantId }, id: "1" },
    params: { tenantId },
    client: null,
    isWebchatConnect: () => false,
    respond,
    context: {} as GatewayRequestHandlerOptions["context"],
  } as unknown as GatewayRequestHandlerOptions);
  return result;
}

describe("mesh.ownership.list backfill", () => {
  const managerUserId = "user-daniel";
  const seatId = "seat-ceo-daniel-main";

  beforeEach(() => {
    cleanStore();
    loadEnterpriseSeatAssetsStoreMock.mockResolvedValue({
      assetBindings: {},
      seats: {
        [seatId]: {
          seatId,
          tenantId: "001",
          title: "CEO",
          currentEmployeeId: managerUserId,
          defaultAgentAssetIds: ["main", "panda"],
          defaultSpaceIds: [],
        },
      },
    });
  });

  afterEach(() => {
    cleanStore();
  });

  it("does not revive revoked agent ownership during backfill", async () => {
    upsertOwnershipRecord({
      tenantId: "001",
      subjectKind: "agent",
      subjectId: "bot",
      positionId: seatId,
      positionLabel: "CEO",
      createdByUserId: managerUserId,
      createdByUserLabel: "Daniel",
      currentManagerUserId: managerUserId,
      currentManagerLabel: "Daniel",
    });
    revokeOwnershipRecord({
      tenantId: "001",
      subjectKind: "agent",
      subjectId: "bot",
      revokedByUserId: managerUserId,
      revokedByUserLabel: "Daniel",
      notes: "manual cleanup",
    });

    loadEnterpriseSeatAssetsStoreMock.mockResolvedValue({
      assetBindings: {},
      seats: {
        [seatId]: {
          seatId,
          tenantId: "001",
          title: "CEO",
          currentEmployeeId: managerUserId,
          defaultAgentAssetIds: ["main", "panda", "bot"],
          defaultSpaceIds: [],
        },
      },
    });

    const result = await callOwnershipList();
    expect(result.ok).toBe(true);

    const record = getOwnershipRecord({ tenantId: "001", subjectKind: "agent", subjectId: "bot" });
    expect(record?.bindingStatus).toBe("revoked");
    expect(record?.notes).toBe("manual cleanup");
  });

  it("does not prune non-backfill orphan agent ownership (manual / legacy assignments)", async () => {
    upsertOwnershipRecord({
      tenantId: "001",
      subjectKind: "agent",
      subjectId: "bot",
      positionId: seatId,
      positionLabel: "CEO",
      createdByUserId: managerUserId,
      createdByUserLabel: "Daniel",
      currentManagerUserId: managerUserId,
      currentManagerLabel: "Daniel",
      notes: "legacy orphan",
    });

    const result = await callOwnershipList();
    expect(result.ok).toBe(true);

    const record = getOwnershipRecord({ tenantId: "001", subjectKind: "agent", subjectId: "bot" });
    expect(record?.bindingStatus).toBe("active");
    expect(record?.notes).toBe("legacy orphan");
  });

  it("prunes only auto-backfill orphan agent ownership not in seat targets", async () => {
    upsertOwnershipRecord({
      tenantId: "001",
      subjectKind: "agent",
      subjectId: "bot",
      positionId: seatId,
      positionLabel: "CEO",
      createdByUserId: managerUserId,
      createdByUserLabel: "Daniel",
      currentManagerUserId: managerUserId,
      currentManagerLabel: "Daniel",
      notes: "mesh.ownership.list backfill",
    });

    const result = await callOwnershipList();
    expect(result.ok).toBe(true);

    const record = getOwnershipRecord({ tenantId: "001", subjectKind: "agent", subjectId: "bot" });
    expect(record?.bindingStatus).toBe("revoked");
    expect(record?.notes).toBe("mesh.ownership.list prune orphan");

    const payload = result.payload as {
      records: Array<{ subjectKind: string; subjectId: string; bindingStatus: string }>;
    };
    const activeAgentIds = payload.records
      .filter((entry) => entry.bindingStatus === "active" && entry.subjectKind === "agent")
      .map((entry) => entry.subjectId);
    expect(activeAgentIds).toEqual(expect.arrayContaining(["main", "panda"]));
    expect(activeAgentIds).not.toContain("bot");
  });

  it("backfills each seat's agents to that seat's manager (not only CEO)", async () => {
    const salesSeatId = "seat-sales";
    const salesUserId = "user-sales";
    loadEnterpriseSeatAssetsStoreMock.mockResolvedValue({
      assetBindings: {},
      seats: {
        [seatId]: {
          seatId,
          tenantId: "001",
          title: "CEO",
          currentEmployeeId: managerUserId,
          defaultAgentAssetIds: ["main"],
          defaultSpaceIds: [],
        },
        [salesSeatId]: {
          seatId: salesSeatId,
          tenantId: "001",
          title: "销售",
          currentEmployeeId: salesUserId,
          defaultAgentAssetIds: ["panda", "bot"],
          defaultSpaceIds: [],
        },
      },
    });

    // Legacy bug: primary-seat backfill attached sales bots to CEO.
    upsertOwnershipRecord({
      tenantId: "001",
      subjectKind: "agent",
      subjectId: "panda",
      positionId: seatId,
      positionLabel: "CEO",
      createdByUserId: managerUserId,
      createdByUserLabel: "Daniel",
      currentManagerUserId: managerUserId,
      currentManagerLabel: "Daniel",
      notes: "mesh.ownership.list backfill",
    });

    const result = await callOwnershipList();
    expect(result.ok).toBe(true);

    const panda = getOwnershipRecord({
      tenantId: "001",
      subjectKind: "agent",
      subjectId: "panda",
    });
    const bot = getOwnershipRecord({ tenantId: "001", subjectKind: "agent", subjectId: "bot" });
    const main = getOwnershipRecord({ tenantId: "001", subjectKind: "agent", subjectId: "main" });

    expect(main?.currentManagerUserId).toBe(managerUserId);
    expect(main?.positionLabel).toBe("CEO");
    expect(panda?.currentManagerUserId).toBe(salesUserId);
    expect(panda?.positionLabel).toBe("销售");
    expect(bot?.currentManagerUserId).toBe(salesUserId);
    expect(bot?.positionLabel).toBe("销售");
  });

  it("skips transferred agent ownership during backfill", async () => {
    upsertOwnershipRecord({
      tenantId: "001",
      subjectKind: "agent",
      subjectId: "bot",
      positionId: seatId,
      positionLabel: "CEO",
      createdByUserId: managerUserId,
      createdByUserLabel: "Daniel",
      currentManagerUserId: managerUserId,
      currentManagerLabel: "Daniel",
    });
    const { transferOwnershipRecord } = await import("../ownership-store.js");
    transferOwnershipRecord({
      tenantId: "001",
      subjectKind: "agent",
      subjectId: "bot",
      newPositionId: "seat-other",
      newPositionLabel: "Other",
      transferredByUserId: managerUserId,
      transferredByUserLabel: "Daniel",
      newCurrentManagerUserId: "other-user",
      newCurrentManagerLabel: "Other",
    });

    loadEnterpriseSeatAssetsStoreMock.mockResolvedValue({
      assetBindings: {},
      seats: {
        [seatId]: {
          seatId,
          tenantId: "001",
          title: "CEO",
          currentEmployeeId: managerUserId,
          defaultAgentAssetIds: ["main", "panda", "bot"],
          defaultSpaceIds: [],
        },
      },
    });

    await callOwnershipList();

    const record = getOwnershipRecord({ tenantId: "001", subjectKind: "agent", subjectId: "bot" });
    expect(record?.bindingStatus).toBe("transferred");
    expect(record?.currentManagerUserId).toBe("other-user");
  });
});
