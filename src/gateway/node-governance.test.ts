import { beforeEach, describe, expect, it, vi } from "vitest";

const listDevicePairingMock = vi.fn();
const getManagementNodeOwnershipMock = vi.fn();
const resolveQueryScopeMock = vi.fn();
const auditManagementDecisionMock = vi.fn();

vi.mock("../infra/device-pairing.js", () => ({ listDevicePairing: listDevicePairingMock }));
vi.mock("./management-governance-ownership.js", () => ({
  getManagementNodeOwnership: getManagementNodeOwnershipMock,
}));
vi.mock("./scope-attribution.js", () => ({ resolveQueryScope: resolveQueryScopeMock }));
vi.mock("./management-governance-audit.js", () => ({
  auditManagementDecision: auditManagementDecisionMock,
}));

const { authorizeNodeGovernance } = await import("./node-governance.js");

describe("node governance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listDevicePairingMock.mockResolvedValue({
      pending: [],
      paired: [{ deviceId: "node-a", tenantId: "tenant-a", ownerId: "user-a" }],
    });
    getManagementNodeOwnershipMock.mockResolvedValue({ tenantId: "tenant-a", ownerId: "user-a" });
  });

  it("allows tenant administrators only inside their tenant", async () => {
    resolveQueryScopeMock.mockResolvedValue({ kind: "tenant", tenantId: "tenant-a" });
    await expect(
      authorizeNodeGovernance({ client: {} as never, nodeId: "node-a", action: "invoke" }),
    ).resolves.toMatchObject({ allowed: true });

    resolveQueryScopeMock.mockResolvedValue({ kind: "tenant", tenantId: "tenant-b" });
    await expect(
      authorizeNodeGovernance({ client: {} as never, nodeId: "node-a", action: "invoke" }),
    ).resolves.toMatchObject({ allowed: false, reason: "outside-governance-scope" });
  });

  it("allows employees only on their own terminal", async () => {
    resolveQueryScopeMock.mockResolvedValue({ kind: "self", ownerId: "user-a" });
    await expect(
      authorizeNodeGovernance({ client: {} as never, nodeId: "node-a", action: "write" }),
    ).resolves.toMatchObject({ allowed: true });

    resolveQueryScopeMock.mockResolvedValue({ kind: "self", ownerId: "user-b" });
    await expect(
      authorizeNodeGovernance({ client: {} as never, nodeId: "node-a", action: "write" }),
    ).resolves.toMatchObject({ allowed: false });
  });

  it("fails closed for unattributed nodes outside platform scope", async () => {
    listDevicePairingMock.mockResolvedValue({ pending: [], paired: [] });
    getManagementNodeOwnershipMock.mockResolvedValue(null);
    resolveQueryScopeMock.mockResolvedValue({ kind: "tenant", tenantId: "tenant-a" });
    await expect(
      authorizeNodeGovernance({ client: {} as never, nodeId: "legacy", action: "read" }),
    ).resolves.toMatchObject({ allowed: false, reason: "node-ownership-unattributed" });
  });

  it("keeps legacy nodes available to platform governance", async () => {
    listDevicePairingMock.mockResolvedValue({ pending: [], paired: [] });
    getManagementNodeOwnershipMock.mockResolvedValue(null);
    resolveQueryScopeMock.mockResolvedValue({ kind: "platform" });
    await expect(
      authorizeNodeGovernance({ client: {} as never, nodeId: "legacy", action: "invoke" }),
    ).resolves.toMatchObject({ allowed: true });
  });

  it("attributes platform actions so tenant and employee audit views can see them", async () => {
    resolveQueryScopeMock.mockResolvedValue({ kind: "platform" });
    await authorizeNodeGovernance({ client: {} as never, nodeId: "node-a", action: "invoke" });
    expect(auditManagementDecisionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        effect: "allowed",
        target: expect.objectContaining({
          resourceId: "node-a",
          tenantId: "tenant-a",
          ownerUserId: "user-a",
        }),
      }),
    );
  });
});
