import { afterEach, describe, expect, it, vi } from "vitest";

const listDevicePairingMock = vi.fn();
const resolveQueryScopeMock = vi.fn();

vi.mock("../../infra/device-pairing.js", () => ({
  listDevicePairing: listDevicePairingMock,
}));

vi.mock("../scope-attribution.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../scope-attribution.js")>();
  return {
    ...actual,
    resolveQueryScope: resolveQueryScopeMock,
  };
});

function captureRespond() {
  const calls: Array<{
    ok: boolean;
    payload?: unknown;
    error?: { code?: string; message?: string };
  }> = [];
  return {
    calls,
    respond: (ok: boolean, payload?: unknown, error?: { code?: string; message?: string }) => {
      calls.push({ ok, payload, error });
    },
  };
}

describe("rpc tenant scope (P1.1)", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("node.list returns only self-owned paired nodes for employee sessions", async () => {
    resolveQueryScopeMock.mockResolvedValue({ kind: "self", ownerId: "user-a" });
    listDevicePairingMock.mockResolvedValue({
      pending: [],
      paired: [
        {
          deviceId: "node-a",
          displayName: "Mac A",
          role: "node",
          ownerId: "user-a",
          createdAtMs: 1,
          approvedAtMs: 1,
        },
        {
          deviceId: "node-b",
          displayName: "Mac B",
          role: "node",
          ownerId: "user-b",
          createdAtMs: 1,
          approvedAtMs: 1,
        },
      ],
    });

    const { nodeHandlers } = await import("./nodes.js");
    const capture = captureRespond();
    await nodeHandlers["node.list"]({
      params: {},
      respond: capture.respond,
      client: { sessionDomain: "employee", user: "a@test.com" } as never,
      context: { nodeRegistry: { listConnected: () => [] } } as never,
    } as never);

    expect(capture.calls[0]?.ok).toBe(true);
    const nodes = (capture.calls[0]?.payload as { nodes?: Array<{ nodeId: string }> })?.nodes ?? [];
    expect(nodes.map((n) => n.nodeId)).toEqual(["node-a"]);
  });

  it("node.list keeps currently connected nodes under non-platform scope when pairing row is filtered", async () => {
    // Agent/CLI under platformAuth often resolve queryScope=none, which filters every
    // pairing row out of pairedById. Live connected hosts must still appear so
    // tools.exec.host=node can discover the exec surface.
    resolveQueryScopeMock.mockResolvedValue({ kind: "none" });
    listDevicePairingMock.mockResolvedValue({
      pending: [],
      paired: [
        {
          deviceId: "node-live",
          displayName: "UPBEYOND Mac",
          role: "node",
          ownerId: "someone-else",
          createdAtMs: 1,
          approvedAtMs: 1,
        },
      ],
    });

    const { nodeHandlers } = await import("./nodes.js");
    const capture = captureRespond();
    await nodeHandlers["node.list"]({
      params: {},
      respond: capture.respond,
      client: { sessionDomain: "employee" } as never,
      context: {
        nodeRegistry: {
          listConnected: () => [
            {
              nodeId: "node-live",
              displayName: "UPBEYOND Mac",
              platform: "darwin",
              caps: ["system"],
              commands: ["system.run"],
              connectedAtMs: 100,
            },
          ],
        },
      } as never,
    } as never);

    expect(capture.calls[0]?.ok).toBe(true);
    const nodes =
      (
        capture.calls[0]?.payload as {
          nodes?: Array<{ nodeId: string; connected: boolean; paired: boolean }>;
        }
      )?.nodes ?? [];
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.nodeId).toBe("node-live");
    expect(nodes[0]?.connected).toBe(true);
    // Pairing row was scope-filtered; list still surfaces the live host.
    expect(nodes[0]?.paired).toBe(false);
  });

  it("node.list elevates operator none scope to platform so pairing rows remain visible", async () => {
    resolveQueryScopeMock.mockResolvedValue({ kind: "none" });
    listDevicePairingMock.mockResolvedValue({
      pending: [],
      paired: [
        {
          deviceId: "node-live",
          displayName: "UPBEYOND Mac",
          role: "node",
          ownerId: "owner-x",
          createdAtMs: 1,
          approvedAtMs: 1,
        },
      ],
    });

    const { nodeHandlers } = await import("./nodes.js");
    const capture = captureRespond();
    await nodeHandlers["node.list"]({
      params: {},
      respond: capture.respond,
      client: {
        sessionDomain: "employee",
        connect: { client: { id: "gateway-client", mode: "backend" } },
      } as never,
      context: {
        nodeRegistry: {
          listConnected: () => [
            {
              nodeId: "node-live",
              displayName: "UPBEYOND Mac",
              platform: "darwin",
              caps: ["system"],
              commands: ["system.run"],
              connectedAtMs: 100,
            },
          ],
        },
      } as never,
    } as never);

    expect(capture.calls[0]?.ok).toBe(true);
    const nodes =
      (
        capture.calls[0]?.payload as {
          nodes?: Array<{ nodeId: string; connected: boolean; paired: boolean }>;
        }
      )?.nodes ?? [];
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.nodeId).toBe("node-live");
    expect(nodes[0]?.connected).toBe(true);
    expect(nodes[0]?.paired).toBe(true);
  });

  it("node.list still hides disconnected nodes that are outside the caller paired scope", async () => {
    resolveQueryScopeMock.mockResolvedValue({ kind: "self", ownerId: "user-a" });
    listDevicePairingMock.mockResolvedValue({
      pending: [],
      paired: [
        {
          deviceId: "node-a",
          displayName: "Mac A",
          role: "node",
          ownerId: "user-a",
          createdAtMs: 1,
          approvedAtMs: 1,
        },
        {
          deviceId: "node-b",
          displayName: "Mac B",
          role: "node",
          ownerId: "user-b",
          createdAtMs: 1,
          approvedAtMs: 1,
        },
      ],
    });

    const { nodeHandlers } = await import("./nodes.js");
    const capture = captureRespond();
    await nodeHandlers["node.list"]({
      params: {},
      respond: capture.respond,
      client: { sessionDomain: "employee", user: "a@test.com" } as never,
      // node-b is paired to someone else and not connected → must stay hidden.
      context: { nodeRegistry: { listConnected: () => [] } } as never,
    } as never);

    expect(capture.calls[0]?.ok).toBe(true);
    const nodes = (capture.calls[0]?.payload as { nodes?: Array<{ nodeId: string }> })?.nodes ?? [];
    expect(nodes.map((n) => n.nodeId)).toEqual(["node-a"]);
  });
});
