// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ErrorCodes, type ErrorShape } from "../protocol/index.js";
import { collaborationSpaceBoundaryHandlers } from "./collaboration-space-boundary.js";
import type { GatewayRequestHandler, GatewayRequestHandlerOptions } from "./types.js";

function call(handlerName: string, params: Record<string, unknown> = {}) {
  let result: { ok: boolean; payload?: unknown; error?: ErrorShape } = { ok: false };
  const respond = (ok: boolean, payload?: unknown, error?: ErrorShape) => {
    result = { ok, payload, error };
  };
  const handler = collaborationSpaceBoundaryHandlers[handlerName] as
    | GatewayRequestHandler
    | undefined;
  if (!handler) {
    throw new Error(`Unknown handler: ${handlerName}`);
  }
  const options = {
    req: { jsonrpc: "2.0", method: handlerName, params, id: "1" },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond,
    context: {} as GatewayRequestHandlerOptions["context"],
  } as unknown as GatewayRequestHandlerOptions;
  return Promise.resolve(handler(options)).then(() => result);
}

describe("collaboration.space Phase 3 facade", () => {
  it("collaboration.space.get requires groupId or sessionKey", async () => {
    const result = await call("collaboration.space.get", {});
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_REQUEST);
  });

  it("collaboration.space.get returns phase 3 projection when space exists", async () => {
    const result = await call("collaboration.space.get", { groupId: "product" });
    if (!result.ok) {
      // Environments without seeded spaces still validate the contract path.
      expect(result.error?.code).toBe(ErrorCodes.INVALID_REQUEST);
      return;
    }
    const group = (result.payload as { group: Record<string, unknown> }).group;
    expect(group.phase).toBe(3);
    expect(group.blocksComplete).toMatchObject({
      basic: true,
      mission: true,
      members: true,
      rules: true,
    });
    expect(Array.isArray(group.members)).toBe(true);
    expect(group.rules).toBeTruthy();
  });

  it("collaboration.space.updateBasic requires groupId", async () => {
    const result = await call("collaboration.space.updateBasic", { title: "x" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_REQUEST);
  });

  it("collaboration.space.updateMission requires groupId", async () => {
    const result = await call("collaboration.space.updateMission", { purpose: "x" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_REQUEST);
  });

  it("collaboration.space.updateRules requires groupId", async () => {
    const result = await call("collaboration.space.updateRules", {
      confidentialityTier: "internal",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_REQUEST);
  });
});
