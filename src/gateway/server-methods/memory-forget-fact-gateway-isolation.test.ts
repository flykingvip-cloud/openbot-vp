/**
 * data.memory.forgetFact gateway isolation: managed / enterprise / wrong-owner deny.
 * Does not write real home memory.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";

const resolveEmployeeWorkbenchActor = vi.hoisted(() => vi.fn());
const listAgentsForGateway = vi.hoisted(() => vi.fn());
const getMemorySearchManager = vi.hoisted(() => vi.fn());

vi.mock("../../config/config.js", () => ({
  loadConfig: vi.fn(() => ({})),
  writeConfigFile: vi.fn(async () => undefined),
}));

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

vi.mock("../../memory/search-manager.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../memory/search-manager.js")>();
  return {
    ...actual,
    getMemorySearchManager,
  };
});

const { dataHandlers } = await import("./data.js");

function makeCall(
  method: keyof typeof dataHandlers,
  params: Record<string, unknown> = {},
  client: unknown = null,
) {
  const respond = vi.fn();
  const promise = dataHandlers[method]({
    params,
    respond,
    req: { type: "req" as const, id: "1", method },
    client: client as never,
    isWebchatConnect: () => false,
    context: {} as never,
  });
  return { respond, promise };
}

describe("data.memory.forgetFact real gateway handler isolation", () => {
  beforeEach(() => {
    resolveEmployeeWorkbenchActor.mockReset();
    listAgentsForGateway.mockReset();
    getMemorySearchManager.mockReset();
  });

  afterEach(() => {
    vi.mocked(loadConfig).mockReturnValue({} as OpenBotConfig);
  });

  it("rejects when data mode is managed", async () => {
    vi.mocked(loadConfig).mockReturnValue({ data: { mode: "managed" } } as OpenBotConfig);
    const { promise, respond } = makeCall("data.memory.forgetFact", {
      agentId: "main",
      atomId: "atom_1",
    });
    await promise;
    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(String(respond.mock.calls[0]?.[2]?.message ?? "")).toMatch(/managed/i);
  });

  it("rejects enterprise sessionDomain", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      data: { root: "/tmp/x", mode: "local", schemaVersion: 1 },
    } as OpenBotConfig);
    const { promise, respond } = makeCall(
      "data.memory.forgetFact",
      { agentId: "main", atomId: "atom_1" },
      { sessionDomain: "enterprise", connect: {} },
    );
    await promise;
    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(String(respond.mock.calls[0]?.[2]?.message ?? "")).toMatch(/enterprise admin/i);
  });

  it("rejects personal-workbench caller for a foreign agent (wrong owner)", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      data: { root: "/tmp/x", mode: "local", schemaVersion: 1 },
    } as OpenBotConfig);
    resolveEmployeeWorkbenchActor.mockResolvedValue({
      userId: "u1",
      userEmail: "a@example.com",
      seatAgentIds: ["owned"],
    });
    listAgentsForGateway.mockReturnValue({
      agents: [{ id: "other", ownerId: "someone-else", scope: "personal" }],
    });
    const { promise, respond } = makeCall(
      "data.memory.forgetFact",
      { agentId: "other", atomId: "atom_1" },
      { sessionDomain: "employee", connect: {} },
    );
    await promise;
    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(String(respond.mock.calls[0]?.[2]?.message ?? "")).toMatch(/permission/i);
    expect(getMemorySearchManager).not.toHaveBeenCalled();
  });

  it("returns per-source completion when manager.forgetFact succeeds", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      data: { root: "/tmp/x", mode: "local", schemaVersion: 1 },
    } as OpenBotConfig);
    resolveEmployeeWorkbenchActor.mockResolvedValue(null);
    getMemorySearchManager.mockResolvedValue({
      manager: {
        forgetFact: async () => ({
          ok: true,
          factRef: { atomId: "atom_1" },
          sources: [
            {
              sourceBindingId: "sb1",
              sourceIdentityId: "sid1",
              sourceLocator: "MEMORY.md",
              status: "forgotten",
            },
          ],
        }),
      },
    });
    const { promise, respond } = makeCall("data.memory.forgetFact", {
      agentId: "main",
      atomId: "atom_1",
      operationId: "op-test",
    });
    await promise;
    expect(respond.mock.calls[0]?.[0]).toBe(true);
    expect(respond.mock.calls[0]?.[1]?.sources?.[0]?.status).toBe("forgotten");
  });
});
