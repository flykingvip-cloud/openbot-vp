// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ErrorCodes, type ErrorShape } from "../protocol/index.js";
import { meshBoundaryFacadeHandlers } from "./mesh-boundary-facade.js";
import type { GatewayRequestHandler, GatewayRequestHandlerOptions } from "./types.js";

function call(handlerName: string, params: Record<string, unknown> = {}) {
  let result: { ok: boolean; payload?: unknown; error?: ErrorShape } = { ok: false };
  const respond = (ok: boolean, payload?: unknown, error?: ErrorShape) => {
    result = { ok, payload, error };
  };
  const handler = meshBoundaryFacadeHandlers[handlerName] as GatewayRequestHandler | undefined;
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

describe("mesh boundary Phase 0 facade", () => {
  it("mesh.operations.intervene requires target identifiers", async () => {
    const result = await call("mesh.operations.intervene", {});
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_REQUEST);
  });

  it("exposes operations and performance method names", () => {
    expect(Object.keys(meshBoundaryFacadeHandlers).toSorted()).toEqual(
      [
        "mesh.operations.intervene",
        "mesh.operations.listAnomalies",
        "mesh.operations.listOnline",
        "mesh.performance.groupGrowthSummary",
        "mesh.performance.growthSummary",
        "mesh.performance.ranking",
        "mesh.performance.summary",
      ].toSorted(),
    );
  });
});
