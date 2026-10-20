// @vitest-environment node
// Task 1.4 (owner resolution via unified attribution) + Task 1.5 (no-session empty snapshot).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config/config.js";
import type { GatewayClient, GatewayRequestHandler } from "./server-methods/types.js";

// platformAuth disabled → no authoritative session → owner resolves to null.
vi.mock("../config/config.js", () => ({
  loadConfig: vi.fn(() => ({})),
}));

const { resolveOperationalIdentityActorUserId } =
  await import("./user-operational-identity-session.js");
const { userOperationalIdentityHandlers } =
  await import("./server-methods/user-operational-identity.js");

type Captured = { ok: boolean; payload?: Record<string, unknown>; error?: unknown };

async function invokeRead(method: string, client: GatewayClient | null): Promise<Captured> {
  const handler = userOperationalIdentityHandlers[method] as GatewayRequestHandler | undefined;
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  let captured: Captured | null = null;
  await handler({
    req: { type: "req", id: "t", method, params: {} },
    params: {},
    client: client as never,
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      captured = { ok, payload: payload as Record<string, unknown> | undefined, error };
    },
    context: {} as never,
  });
  if (!captured) {
    throw new Error(`handler ${method} did not respond`);
  }
  return captured;
}

describe("resolveOperationalIdentityActorUserId (Task 1.4)", () => {
  beforeEach(() => {
    vi.mocked(loadConfig).mockReturnValue({} as never);
  });

  it("returns the directly provided platform user id without touching the session chain", async () => {
    const ownerId = await resolveOperationalIdentityActorUserId({ platformUserId: "user-42" });
    expect(ownerId).toBe("user-42");
  });

  it("returns client.platformUserId when the email header is missing", async () => {
    const ownerId = await resolveOperationalIdentityActorUserId({
      client: { platformUserId: "user-42" } as GatewayClient,
    });
    expect(ownerId).toBe("user-42");
  });

  it("returns null when there is no session and no direct id (platformAuth disabled)", async () => {
    expect(await resolveOperationalIdentityActorUserId({ client: null })).toBeNull();
    expect(await resolveOperationalIdentityActorUserId({ client: {} as GatewayClient })).toBeNull();
  });
});

describe("no-session empty snapshot for read RPCs (Task 1.5)", () => {
  beforeEach(() => {
    vi.mocked(loadConfig).mockReturnValue({} as never);
  });

  it("user-operational-identity.list returns empty snapshot + needsLogin (not an error)", async () => {
    const res = await invokeRead("user-operational-identity.list", {} as GatewayClient);
    expect(res.ok).toBe(true);
    expect(res.payload?.needsLogin).toBe(true);
    expect(res.payload?.identities).toEqual([]);
    expect(res.payload?.grants).toEqual([]);
    expect(res.payload?.usageHistory).toEqual([]);
    expect(Array.isArray(res.payload?.providerCatalog)).toBe(true);
  });

  it("binding-request.list-pending returns empty + needsLogin", async () => {
    const res = await invokeRead(
      "user-operational-identity.binding-request.list-pending",
      {} as GatewayClient,
    );
    expect(res.ok).toBe(true);
    expect(res.payload?.needsLogin).toBe(true);
    expect(res.payload?.requests).toEqual([]);
  });

  it("continuation.list-pending returns empty + needsLogin", async () => {
    const res = await invokeRead(
      "user-operational-identity.continuation.list-pending",
      {} as GatewayClient,
    );
    expect(res.ok).toBe(true);
    expect(res.payload?.needsLogin).toBe(true);
    expect(res.payload?.continuations).toEqual([]);
  });
});
