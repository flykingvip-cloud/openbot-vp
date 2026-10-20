import { beforeEach, describe, expect, it, vi } from "vitest";

const authorizeNodeGovernanceMock = vi.fn();
vi.mock("../node-governance.js", () => ({
  authorizeNodeGovernance: authorizeNodeGovernanceMock,
}));

const { execApprovalsHandlers } = await import("./exec-approvals.js");

describe("node exec approvals governance", () => {
  beforeEach(() => authorizeNodeGovernanceMock.mockReset());

  it("does not read or write approvals outside the caller's node scope", async () => {
    authorizeNodeGovernanceMock.mockResolvedValue({
      allowed: false,
      scope: { kind: "tenant", tenantId: "tenant-b" },
      ownership: { tenantId: "tenant-a", ownerId: "user-a" },
    });
    const invoke = vi.fn();
    const respondGet = vi.fn();
    await execApprovalsHandlers["exec.approvals.node.get"]({
      params: { nodeId: "node-a" },
      client: { sessionDomain: "enterprise" } as never,
      context: { nodeRegistry: { invoke } } as never,
      respond: respondGet,
    } as never);
    expect(respondGet.mock.calls[0]?.[0]).toBe(false);

    const respondSet = vi.fn();
    await execApprovalsHandlers["exec.approvals.node.set"]({
      params: { nodeId: "node-a", file: { version: 1 } },
      client: { sessionDomain: "enterprise" } as never,
      context: { nodeRegistry: { invoke } } as never,
      respond: respondSet,
    } as never);
    expect(respondSet.mock.calls[0]?.[0]).toBe(false);
    expect(authorizeNodeGovernanceMock).toHaveBeenCalledTimes(2);
    expect(invoke).not.toHaveBeenCalled();
  });
});
