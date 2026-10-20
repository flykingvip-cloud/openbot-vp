import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveQueryScopeMock, resolveEmployeeWorkbenchActorMock, listOwnershipRecordsMock } =
  vi.hoisted(() => ({
    resolveQueryScopeMock: vi.fn(),
    resolveEmployeeWorkbenchActorMock: vi.fn(),
    listOwnershipRecordsMock: vi.fn(),
  }));
const { auditManagementDecisionMock } = vi.hoisted(() => ({
  auditManagementDecisionMock: vi.fn(),
}));

vi.mock("./scope-attribution.js", () => ({ resolveQueryScope: resolveQueryScopeMock }));
vi.mock("./employee-workbench-scope.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./employee-workbench-scope.js")>()),
  resolveEmployeeWorkbenchActor: resolveEmployeeWorkbenchActorMock,
}));
vi.mock("./ownership-store.js", () => ({ listOwnershipRecords: listOwnershipRecordsMock }));
vi.mock("./management-governance-audit.js", () => ({
  auditManagementDecision: auditManagementDecisionMock,
}));

import {
  authorizeAgentInvocation,
  evaluateAgentInvocation,
} from "./agent-invocation-governance.js";

const cfg = {
  agents: {
    list: [
      { id: "main" },
      { id: "sales", ownerId: "user-a" },
      { id: "support", ownerId: "user-b" },
    ],
  },
} as never;

describe("agent invocation governance", () => {
  beforeEach(() => {
    resolveQueryScopeMock.mockReset();
    resolveEmployeeWorkbenchActorMock.mockReset();
    listOwnershipRecordsMock.mockReset();
    auditManagementDecisionMock.mockReset();
    auditManagementDecisionMock.mockResolvedValue(undefined);
    listOwnershipRecordsMock.mockReturnValue([
      {
        tenantId: "tenant-a",
        subjectKind: "agent",
        subjectId: "sales",
        bindingStatus: "active",
      },
    ]);
  });

  it("allows platform governance to invoke across the estate", async () => {
    resolveQueryScopeMock.mockResolvedValue({ kind: "platform" });
    await expect(
      authorizeAgentInvocation({ client: null, agentId: "sales", cfg }),
    ).resolves.toEqual({ allowed: true });
    expect(auditManagementDecisionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        effect: "allowed",
        target: expect.objectContaining({
          resourceId: "sales",
          tenantId: "tenant-a",
          ownerUserId: "user-a",
        }),
      }),
    );
  });

  it("does not report an unknown platform agent invocation as allowed", async () => {
    resolveQueryScopeMock.mockResolvedValue({ kind: "platform" });
    await expect(
      authorizeAgentInvocation({ client: null, agentId: "missing", cfg }),
    ).resolves.toEqual({ allowed: false, reason: "unknown-agent" });
    expect(auditManagementDecisionMock).toHaveBeenCalledWith(
      expect.objectContaining({ effect: "denied", reason: "unknown-agent" }),
    );
  });

  it("keeps tenant invocation inside active tenant assets", async () => {
    resolveQueryScopeMock.mockResolvedValue({ kind: "tenant", tenantId: "tenant-a" });
    await expect(
      authorizeAgentInvocation({ client: {} as never, agentId: "sales", cfg }),
    ).resolves.toEqual({ allowed: true });
    await expect(
      authorizeAgentInvocation({ client: {} as never, agentId: "support", cfg }),
    ).resolves.toEqual({ allowed: false, reason: "outside-governance-scope" });
    expect(auditManagementDecisionMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ effect: "denied", reason: "outside-governance-scope" }),
    );
  });

  it("allows an employee supervisor to invoke own workers and builtin steward only", async () => {
    resolveQueryScopeMock.mockResolvedValue({ kind: "self", ownerId: "user-a" });
    resolveEmployeeWorkbenchActorMock.mockResolvedValue({
      userId: "user-a",
      userEmail: "user-a@example.com",
      seatAgentIds: ["sales"],
      seatSpaceIds: [],
    });
    await expect(
      authorizeAgentInvocation({ client: {} as never, agentId: "main", cfg }),
    ).resolves.toEqual({ allowed: true });
    await expect(
      authorizeAgentInvocation({ client: {} as never, agentId: "sales", cfg }),
    ).resolves.toEqual({ allowed: true });
    await expect(
      authorizeAgentInvocation({ client: {} as never, agentId: "support", cfg }),
    ).resolves.toEqual({ allowed: false, reason: "outside-governance-scope" });
  });

  it("evaluates the same decision without writing an audit record", async () => {
    resolveQueryScopeMock.mockResolvedValue({ kind: "platform" });
    await expect(
      evaluateAgentInvocation({ client: null, agentId: "missing", cfg }),
    ).resolves.toEqual({ allowed: false, reason: "unknown-agent" });
    await expect(evaluateAgentInvocation({ client: null, agentId: "sales", cfg })).resolves.toEqual(
      {
        allowed: true,
      },
    );
    expect(auditManagementDecisionMock).not.toHaveBeenCalled();
  });
});
