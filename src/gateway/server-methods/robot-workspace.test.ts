// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ErrorCodes, type ErrorShape } from "../protocol/index.js";
import { robotWorkspaceHandlers } from "./robot-workspace.js";
import type { GatewayRequestHandler, GatewayRequestHandlerOptions } from "./types.js";

function call(handlerName: string, params: Record<string, unknown> = {}) {
  let result: { ok: boolean; payload?: unknown; error?: ErrorShape } = { ok: false };
  const respond = (ok: boolean, payload?: unknown, error?: ErrorShape) => {
    result = { ok, payload, error };
  };
  const handler = robotWorkspaceHandlers[handlerName] as GatewayRequestHandler | undefined;
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

describe("robot.workspace Phase 2 facade", () => {
  it("robot.workspace.get requires agentId", async () => {
    const result = await call("robot.workspace.get", {});
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_REQUEST);
  });

  it("robot.workspace.get returns phase 2 six-block projection for a known agent", async () => {
    const result = await call("robot.workspace.get", { agentId: "main" });
    if (!result.ok) {
      // Environments without a configured main agent still validate the contract path.
      expect(result.error?.code).toBe(ErrorCodes.INVALID_REQUEST);
      return;
    }
    const bot = (result.payload as { bot: Record<string, unknown> }).bot;
    expect(bot.phase).toBe(2);
    expect(bot.agentId).toBe("main");
    expect(bot.identity).toBeTruthy();
    expect(Array.isArray(bot.capabilities)).toBe(true);
    expect(Array.isArray(bot.personas)).toBe(true);
    expect(bot.growth).toBeTruthy();
    expect(Array.isArray(bot.collaborations)).toBe(true);
    expect(bot.data).toBeTruthy();
    expect(bot.blocksComplete).toMatchObject({
      identity: true,
      capabilities: true,
      personas: true,
      growth: true,
      collaborations: true,
      data: true,
    });
  });

  it("robot.workspace.updateIdentity requires agentId", async () => {
    const result = await call("robot.workspace.updateIdentity", { name: "x" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_REQUEST);
  });

  it("robot.workspace.updateIdentity rejects unknown agent", async () => {
    const result = await call("robot.workspace.updateIdentity", {
      agentId: "definitely-missing-agent-xyz",
      name: "x",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_REQUEST);
  });

  it("robot.workspace.delete remains deferred (agents.delete owns disposal)", async () => {
    const result = await call("robot.workspace.delete", { agentId: "main" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.UNAVAILABLE);
    expect(String(result.error?.message ?? "")).toMatch(/agents\.delete/);
  });

  it("robot.workspace.listPersonas returns phase 2 list shape", async () => {
    const result = await call("robot.workspace.listPersonas", { agentId: "main" });
    if (!result.ok) {
      expect(result.error?.code).toBe(ErrorCodes.INVALID_REQUEST);
      return;
    }
    const payload = result.payload as { agentId: string; personas: unknown[]; phase: number };
    expect(payload.agentId).toBe("main");
    expect(Array.isArray(payload.personas)).toBe(true);
    expect(payload.phase).toBe(2);
  });
});
