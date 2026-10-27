/**
 * O5 isolation: exercise the real data.memory.forget gateway handler (not only
 * forgetMemoryEntry helper) for auth / ownership / managed / legal-allow paths.
 * Synthetic Data Space only — never touches real ~/.openbot or ~/OpenBot.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";

const resolveEmployeeWorkbenchActor = vi.hoisted(() => vi.fn());
const listAgentsForGateway = vi.hoisted(() => vi.fn());

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

describe("data.memory.forget real gateway handler isolation", () => {
  const tmpRoot = path.join(os.tmpdir(), `openbot-o5-gw-forget-${Date.now()}`);

  beforeEach(() => {
    resolveEmployeeWorkbenchActor.mockReset();
    listAgentsForGateway.mockReset();
  });

  afterEach(async () => {
    vi.mocked(loadConfig).mockReturnValue({} as OpenBotConfig);
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  it("rejects when data mode is managed (auth surface: LOCAL_ONLY)", async () => {
    vi.mocked(loadConfig).mockReturnValue({ data: { mode: "managed" } } as OpenBotConfig);
    const { promise, respond } = makeCall("data.memory.forget", {
      agentId: "main",
      memoryKey: "o5-a.md",
    });
    await promise;
    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(String(respond.mock.calls[0]?.[2]?.message ?? "")).toMatch(/managed/i);
  });

  it("rejects enterprise sessionDomain (cannot expose employee private memory)", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      data: { root: tmpRoot, mode: "local", schemaVersion: 1 },
    } as OpenBotConfig);
    const { promise, respond } = makeCall(
      "data.memory.forget",
      { agentId: "main", memoryKey: "o5-a.md" },
      { sessionDomain: "enterprise", connect: {} },
    );
    await promise;
    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(String(respond.mock.calls[0]?.[2]?.message ?? "")).toMatch(/enterprise admin/i);
  });

  it("rejects personal-workbench caller for a foreign agent (ownership)", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      data: { root: tmpRoot, mode: "local", schemaVersion: 1 },
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
      "data.memory.forget",
      { agentId: "other", memoryKey: "o5-a.md" },
      { sessionDomain: "employee", connect: {} },
    );
    await promise;
    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(String(respond.mock.calls[0]?.[2]?.message ?? "")).toMatch(/permission/i);
  });

  it("allows local operator (null client) to delete a synthetic Data Space file", async () => {
    await fs.mkdir(path.join(tmpRoot, "agents", "main", "memory", "agent"), { recursive: true });
    const memoryKey = "o5-gateway-allow.md";
    const filePath = path.join(tmpRoot, "agents", "main", "memory", "agent", memoryKey);
    await fs.writeFile(filePath, "O5GatewayAllowUniqueToken source-A\n", "utf8");
    vi.mocked(loadConfig).mockReturnValue({
      data: { root: tmpRoot, mode: "local", schemaVersion: 1 },
    } as OpenBotConfig);

    const { promise, respond } = makeCall(
      "data.memory.forget",
      { agentId: "main", memoryKey },
      null,
    );
    await promise;
    expect(respond.mock.calls[0]?.[0]).toBe(true);
    const payload = respond.mock.calls[0]?.[1] as { deletedPath?: string | null };
    expect(payload.deletedPath).toBeTruthy();
    await expect(fs.stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("allows owned employee agent and still fails closed for missing entry", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      data: { root: tmpRoot, mode: "local", schemaVersion: 1 },
    } as OpenBotConfig);
    resolveEmployeeWorkbenchActor.mockResolvedValue({
      userId: "u1",
      userEmail: "a@example.com",
      seatAgentIds: ["main"],
    });
    listAgentsForGateway.mockReturnValue({
      agents: [{ id: "main", ownerId: "u1", scope: "personal" }],
    });
    const { promise, respond } = makeCall(
      "data.memory.forget",
      { agentId: "main", memoryKey: "missing-o5.md" },
      { sessionDomain: "employee", connect: {} },
    );
    await promise;
    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(String(respond.mock.calls[0]?.[2]?.message ?? "")).toMatch(/not found/i);
  });
});
