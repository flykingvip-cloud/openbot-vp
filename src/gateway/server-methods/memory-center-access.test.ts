import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveEmployeeWorkbenchActor = vi.hoisted(() => vi.fn());
const listAgentsForGateway = vi.hoisted(() => vi.fn());

vi.mock("../employee-workbench-scope.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../employee-workbench-scope.js")>();
  return {
    ...actual,
    resolveEmployeeWorkbenchActor,
  };
});

vi.mock("../session-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../session-utils.js")>();
  return {
    ...actual,
    listAgentsForGateway,
  };
});

vi.mock("../../config/config.js", () => ({
  loadConfig: vi.fn(() => ({})),
}));

const { assertMemoryCenterAgentAccess, isAgentMemoryWorkspaceFile } =
  await import("./memory-center-access.js");

describe("memory-center-access", () => {
  beforeEach(() => {
    resolveEmployeeWorkbenchActor.mockReset();
    listAgentsForGateway.mockReset();
  });

  it("recognizes MEMORY workspace filenames", () => {
    expect(isAgentMemoryWorkspaceFile("MEMORY.md")).toBe(true);
    expect(isAgentMemoryWorkspaceFile("memory.md")).toBe(true);
    expect(isAgentMemoryWorkspaceFile("AGENTS.md")).toBe(false);
  });

  it("rejects enterprise sessions", async () => {
    const respond = vi.fn();
    const ok = await assertMemoryCenterAgentAccess({
      client: { sessionDomain: "enterprise", connect: {} as never },
      agentId: "main",
      respond,
      method: "agents.files.get",
    });
    expect(ok).toBe(false);
    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(String(respond.mock.calls[0]?.[2]?.message ?? "")).toMatch(/enterprise admin/i);
  });

  it("allows platform/null clients (local operator)", async () => {
    const respond = vi.fn();
    await expect(
      assertMemoryCenterAgentAccess({
        client: null,
        agentId: "main",
        respond,
        method: "agents.files.get",
      }),
    ).resolves.toBe(true);
    expect(respond).not.toHaveBeenCalled();
  });

  it("rejects employee sessions for foreign agents", async () => {
    resolveEmployeeWorkbenchActor.mockResolvedValue({
      userId: "u1",
      userEmail: "a@example.com",
      seatAgentIds: ["owned"],
    });
    listAgentsForGateway.mockReturnValue({
      agents: [{ id: "other", ownerId: "someone-else", scope: "personal" }],
    });
    const respond = vi.fn();
    const ok = await assertMemoryCenterAgentAccess({
      client: { sessionDomain: "employee", connect: {} as never },
      agentId: "other",
      respond,
      method: "agents.files.get",
    });
    expect(ok).toBe(false);
    expect(String(respond.mock.calls[0]?.[2]?.message ?? "")).toMatch(/permission/i);
  });
});
