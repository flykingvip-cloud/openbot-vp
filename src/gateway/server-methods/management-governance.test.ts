import { beforeEach, describe, expect, it, vi } from "vitest";

const { listMock, scopeMock, auditMock, deviceGetMock, nodeGetMock, ownershipSetMock } = vi.hoisted(
  () => ({
    listMock: vi.fn(),
    scopeMock: vi.fn(),
    auditMock: vi.fn(),
    deviceGetMock: vi.fn(),
    nodeGetMock: vi.fn(),
    ownershipSetMock: vi.fn(),
  }),
);
vi.mock("../management-governance-audit.js", () => ({
  listManagementAuditEvents: listMock,
  auditManagementDecision: auditMock,
}));
vi.mock("../scope-attribution.js", () => ({ resolveQueryScope: scopeMock }));
vi.mock("../../infra/device-pairing.js", () => ({
  getPairedDevice: deviceGetMock,
}));
vi.mock("../../infra/node-pairing.js", () => ({ getPairedNode: nodeGetMock }));
vi.mock("../management-governance-ownership.js", () => ({
  setManagementNodeOwnership: ownershipSetMock,
}));

import { managementGovernanceHandlers } from "./management-governance.js";

describe("management governance audit RPC", () => {
  beforeEach(() => {
    listMock.mockReset();
    scopeMock.mockReset();
    auditMock.mockReset();
    deviceGetMock.mockReset();
    nodeGetMock.mockReset();
    ownershipSetMock.mockReset();
  });

  it("uses the server-resolved scope and returns filtered events", async () => {
    scopeMock.mockResolvedValue({ kind: "tenant", tenantId: "tenant-a" });
    listMock.mockResolvedValue([{ action: "invoke", effect: "denied" }]);
    const respond = vi.fn();
    await managementGovernanceHandlers["management-governance.audit.list"]({
      params: { effect: "denied", limit: 20 },
      client: { sessionDomain: "enterprise" } as never,
      respond,
    } as never);

    expect(listMock).toHaveBeenCalledWith({
      scope: { kind: "tenant", tenantId: "tenant-a" },
      query: { effect: "denied", limit: 20 },
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      { scope: { kind: "tenant", tenantId: "tenant-a" }, events: expect.any(Array) },
      undefined,
    );
  });

  it("rejects tenant override and unknown parameters", async () => {
    const respond = vi.fn();
    await managementGovernanceHandlers["management-governance.audit.list"]({
      params: { tenantId: "tenant-b" },
      client: { sessionDomain: "enterprise" } as never,
      respond,
    } as never);
    expect(respond).toHaveBeenCalledWith(false, undefined, expect.any(Object));
    expect(scopeMock).not.toHaveBeenCalled();
  });

  it("assigns terminal ownership from platform scope and audits the change", async () => {
    scopeMock.mockResolvedValue({ kind: "platform" });
    deviceGetMock.mockResolvedValue({ deviceId: "node-a" });
    nodeGetMock.mockResolvedValue(null);
    const respond = vi.fn();
    await managementGovernanceHandlers["management-governance.node.assign"]({
      params: { nodeId: "node-a", tenantId: "tenant-a", ownerUserId: "user-a" },
      client: { sessionDomain: "platform" } as never,
      respond,
    } as never);

    expect(ownershipSetMock).toHaveBeenCalledWith("node-a", {
      tenantId: "tenant-a",
      ownerId: "user-a",
    });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "write" }));
    expect(respond).toHaveBeenCalledWith(
      true,
      { nodeId: "node-a", tenantId: "tenant-a", ownerUserId: "user-a" },
      undefined,
    );
  });

  it("rejects terminal ownership assignment outside platform scope", async () => {
    scopeMock.mockResolvedValue({ kind: "tenant", tenantId: "tenant-a" });
    const respond = vi.fn();
    await managementGovernanceHandlers["management-governance.node.assign"]({
      params: { nodeId: "node-a", tenantId: "tenant-a" },
      client: { sessionDomain: "enterprise" } as never,
      respond,
    } as never);
    expect(respond).toHaveBeenCalledWith(false, undefined, expect.any(Object));
    expect(ownershipSetMock).not.toHaveBeenCalled();
  });
});
